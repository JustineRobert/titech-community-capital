// backend/modules/finance/services/dividendForecastService.js

'use strict';

const Account = require('../models/Account');
const Transaction = require('../models/Transaction');

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
 * GET MEMBER SHARE CAPITAL
 * -------------------------------------------------------
 */

async function getShareCapital(
  tenantId
) {
  const shareAccounts =
    await Account.find({
      tenantId,
      accountCategory: 'SHARE_CAPITAL',
      isActive: true
    });

  const total =
    shareAccounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return round(total);
}

/**
 * -------------------------------------------------------
 * RETAINED EARNINGS
 * -------------------------------------------------------
 */

async function getRetainedEarnings(
  tenantId
) {
  const retained =
    await Account.findOne({
      tenantId,
      accountCategory:
        'RETAINED_EARNINGS'
    });

  return round(
    retained?.balance || 0
  );
}

/**
 * -------------------------------------------------------
 * CURRENT YEAR PROFIT
 * -------------------------------------------------------
 */

async function getCurrentYearProfit(
  tenantId
) {
  const revenueAccounts =
    await Account.find({
      tenantId,
      type: 'REVENUE'
    });

  const expenseAccounts =
    await Account.find({
      tenantId,
      type: 'EXPENSE'
    });

  const revenue =
    revenueAccounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  const expenses =
    expenseAccounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return round(
    revenue - expenses
  );
}

/**
 * -------------------------------------------------------
 * AVAILABLE DISTRIBUTABLE PROFIT
 * -------------------------------------------------------
 */

async function getDistributableProfit(
  tenantId
) {
  const profit =
    await getCurrentYearProfit(
      tenantId
    );

  const retained =
    await getRetainedEarnings(
      tenantId
    );

  return round(
    profit + retained
  );
}

/**
 * -------------------------------------------------------
 * DIVIDEND FORECAST
 * -------------------------------------------------------
 */

async function forecastDividendPool(
  tenantId,
  payoutRatio = 40
) {
  const profit =
    await getDistributableProfit(
      tenantId
    );

  const dividendPool =
    profit *
    (payoutRatio / 100);

  return {
    distributableProfit:
      round(profit),

    payoutRatio,

    forecastDividendPool:
      round(dividendPool)
  };
}

/**
 * -------------------------------------------------------
 * DIVIDEND PER SHARE
 * -------------------------------------------------------
 */

async function forecastDividendPerShare(
  tenantId,
  payoutRatio = 40
) {
  const pool =
    await forecastDividendPool(
      tenantId,
      payoutRatio
    );

  const shareCapital =
    await getShareCapital(
      tenantId
    );

  if (
    !shareCapital ||
    shareCapital <= 0
  ) {
    return {
      dividendPerShare: 0
    };
  }

  return {
    dividendPerShare:
      round(
        pool.forecastDividendPool /
          shareCapital
      )
  };
}

/**
 * -------------------------------------------------------
 * MEMBER DIVIDEND FORECAST
 * -------------------------------------------------------
 */

async function forecastMemberDividend({
  memberShareValue,
  tenantId,
  payoutRatio = 40
}) {
  const perShare =
    await forecastDividendPerShare(
      tenantId,
      payoutRatio
    );

  const dividend =
    Number(
      memberShareValue || 0
    ) *
    perShare.dividendPerShare;

  return {
    memberShareValue,

    estimatedDividend:
      round(dividend)
  };
}

/**
 * -------------------------------------------------------
 * RESERVE IMPACT ANALYSIS
 * -------------------------------------------------------
 */

async function analyzeReserveImpact(
  tenantId,
  payoutRatio = 40
) {
  const pool =
    await forecastDividendPool(
      tenantId,
      payoutRatio
    );

  const profit =
    pool.distributableProfit;

  const retainedAfter =
    profit -
    pool.forecastDividendPool;

  return {
    dividendPool:
      pool.forecastDividendPool,

    retainedAfterDividend:
      round(retainedAfter),

    reserveRetentionRate:
      round(
        (retainedAfter /
          Math.max(
            profit,
            1
          )) *
          100
      )
  };
}

/**
 * -------------------------------------------------------
 * DIVIDEND SUSTAINABILITY
 * -------------------------------------------------------
 */

async function calculateDividendSustainability(
  tenantId
) {
  const profit =
    await getDistributableProfit(
      tenantId
    );

  const shareCapital =
    await getShareCapital(
      tenantId
    );

  const ratio =
    shareCapital > 0
      ? profit /
        shareCapital
      : 0;

  let rating =
    'LOW';

  if (ratio >= 0.20)
    rating = 'HIGH';
  else if (ratio >= 0.10)
    rating = 'MEDIUM';

  return {
    profitabilityRatio:
      round(ratio),

    sustainabilityRating:
      rating
  };
}

/**
 * -------------------------------------------------------
 * MULTI-YEAR FORECAST
 * -------------------------------------------------------
 */

async function generateFiveYearForecast(
  tenantId,
  annualGrowthRate = 10,
  payoutRatio = 40
) {
  const currentProfit =
    await getDistributableProfit(
      tenantId
    );

  const forecast = [];

  let projectedProfit =
    currentProfit;

  for (
    let year = 1;
    year <= 5;
    year++
  ) {
    projectedProfit =
      projectedProfit *
      (1 +
        annualGrowthRate /
          100);

    forecast.push({
      year,

      projectedProfit:
        round(
          projectedProfit
        ),

      projectedDividendPool:
        round(
          projectedProfit *
            (payoutRatio /
              100)
        )
    });
  }

  return forecast;
}

/**
 * -------------------------------------------------------
 * SCENARIO ANALYSIS
 * -------------------------------------------------------
 */

async function scenarioAnalysis(
  tenantId
) {
  const scenarios =
    await Promise.all([
      forecastDividendPool(
        tenantId,
        30
      ),
      forecastDividendPool(
        tenantId,
        40
      ),
      forecastDividendPool(
        tenantId,
        60
      )
    ]);

  return {
    conservative:
      scenarios[0],

    standard:
      scenarios[1],

    aggressive:
      scenarios[2]
  };
}

/**
 * -------------------------------------------------------
 * EXECUTIVE DASHBOARD
 * -------------------------------------------------------
 */

async function getDividendForecastDashboard(
  tenantId
) {
  const [
    pool,
    perShare,
    sustainability,
    reserves,
    forecast,
    scenarios
  ] = await Promise.all([
    forecastDividendPool(
      tenantId
    ),

    forecastDividendPerShare(
      tenantId
    ),

    calculateDividendSustainability(
      tenantId
    ),

    analyzeReserveImpact(
      tenantId
    ),

    generateFiveYearForecast(
      tenantId
    ),

    scenarioAnalysis(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    dividendPool:
      pool,

    dividendPerShare:
      perShare,

    sustainability,

    reserves,

    fiveYearForecast:
      forecast,

    scenarios
  };
}

/**
 * -------------------------------------------------------
 * EXPORTS
 * -------------------------------------------------------
 */

module.exports = {

  getShareCapital,

  getRetainedEarnings,

  getCurrentYearProfit,

  getDistributableProfit,

  forecastDividendPool,

  forecastDividendPerShare,

  forecastMemberDividend,

  analyzeReserveImpact,

  calculateDividendSustainability,

  generateFiveYearForecast,

  scenarioAnalysis,

  getDividendForecastDashboard
};