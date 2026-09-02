// backend/modules/finance/services/portfolioStressTestingService.js
'use strict';

const Loan = require('../../loans/models/Loan');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function percentage(amount, pct) {
  return round(amount * (pct / 100));
}

/**
 * -----------------------------------------------------
 * PORTFOLIO EXPOSURE
 * -----------------------------------------------------
 */

async function getLoanPortfolioExposure(
  tenantId
) {
  const loans = await Loan.find({
    tenantId,
    status: {
      $in: [
        'ACTIVE',
        'DISBURSED',
        'OVERDUE'
      ]
    }
  });

  const totalExposure =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.outstandingBalance ||
          loan.amount ||
          0
        ),
      0
    );

  return {
    loanCount: loans.length,
    totalExposure:
      round(totalExposure)
  };
}

/**
 * -----------------------------------------------------
 * LIQUIDITY POSITION
 * -----------------------------------------------------
 */

async function getLiquidityPosition(
  tenantId
) {
  const accounts =
    await Account.find({
      tenantId,
      type: 'ASSET',
      isActive: true
    });

  const liquidity =
    accounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return round(liquidity);
}

/**
 * -----------------------------------------------------
 * DEFAULT SHOCK
 * -----------------------------------------------------
 */

async function simulateDefaultShock(
  tenantId,
  defaultRate = 10
) {
  const portfolio =
    await getLoanPortfolioExposure(
      tenantId
    );

  const expectedLoss =
    percentage(
      portfolio.totalExposure,
      defaultRate
    );

  return {
    scenario:
      'DEFAULT_SHOCK',

    defaultRate,

    exposure:
      portfolio.totalExposure,

    projectedLoss:
      expectedLoss
  };
}

/**
 * -----------------------------------------------------
 * DELINQUENCY SHOCK
 * -----------------------------------------------------
 */

async function simulateDelinquencyShock(
  tenantId,
  delinquencyRate = 20
) {
  const portfolio =
    await getLoanPortfolioExposure(
      tenantId
    );

  const delayedAmount =
    percentage(
      portfolio.totalExposure,
      delinquencyRate
    );

  return {
    scenario:
      'DELINQUENCY_SHOCK',

    delinquencyRate,

    delayedPortfolio:
      delayedAmount
  };
}

/**
 * -----------------------------------------------------
 * WITHDRAWAL RUN
 * -----------------------------------------------------
 */

async function simulateMemberRun(
  tenantId,
  withdrawalRate = 30
) {
  const liquidity =
    await getLiquidityPosition(
      tenantId
    );

  const withdrawals =
    percentage(
      liquidity,
      withdrawalRate
    );

  return {
    scenario:
      'MEMBER_WITHDRAWAL_RUN',

    withdrawalRate,

    liquidity,

    projectedWithdrawals:
      withdrawals,

    remainingLiquidity:
      round(
        liquidity -
          withdrawals
      )
  };
}

/**
 * -----------------------------------------------------
 * MOBILE MONEY SETTLEMENT FAILURE
 * -----------------------------------------------------
 */

async function simulateSettlementFailure(
  tenantId
) {
  const pending =
    await Transaction.find({
      tenantId,
      status: 'PENDING'
    });

  const exposure =
    pending.reduce(
      (sum, tx) =>
        sum +
        Number(tx.amount || 0),
      0
    );

  return {
    scenario:
      'SETTLEMENT_FAILURE',

    pendingTransactions:
      pending.length,

    settlementExposure:
      round(exposure)
  };
}

/**
 * -----------------------------------------------------
 * INTEREST RATE SHOCK
 * -----------------------------------------------------
 */

async function simulateInterestRateShock(
  tenantId,
  increaseRate = 5
) {
  const portfolio =
    await getLoanPortfolioExposure(
      tenantId
    );

  const risk =
    percentage(
      portfolio.totalExposure,
      increaseRate
    );

  return {
    scenario:
      'INTEREST_RATE_SHOCK',

    increaseRate,

    projectedRisk:
      risk
  };
}

/**
 * -----------------------------------------------------
 * ECONOMIC RECESSION
 * -----------------------------------------------------
 */

async function simulateEconomicRecession(
  tenantId
) {
  const portfolio =
    await getLoanPortfolioExposure(
      tenantId
    );

  const loss =
    percentage(
      portfolio.totalExposure,
      25
    );

  return {
    scenario:
      'ECONOMIC_RECESSION',

    projectedLoss:
      loss
  };
}

/**
 * -----------------------------------------------------
 * CAPITAL ADEQUACY
 * -----------------------------------------------------
 */

async function calculateCapitalAdequacy(
  tenantId
) {
  const assets =
    await Account.find({
      tenantId,
      type: 'ASSET'
    });

  const equity =
    await Account.find({
      tenantId,
      type: 'EQUITY'
    });

  const totalAssets =
    assets.reduce(
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  const totalCapital =
    equity.reduce(
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  const ratio =
    totalAssets > 0
      ? totalCapital /
        totalAssets
      : 0;

  return {
    totalAssets:
      round(totalAssets),

    totalCapital:
      round(totalCapital),

    capitalAdequacyRatio:
      round(ratio)
  };
}

/**
 * -----------------------------------------------------
 * STRESS SCORE
 * -----------------------------------------------------
 */

async function calculateStressScore(
  tenantId
) {
  const [
    defaultShock,
    withdrawalShock
  ] = await Promise.all([
    simulateDefaultShock(
      tenantId,
      15
    ),
    simulateMemberRun(
      tenantId,
      25
    )
  ]);

  const score =
    defaultShock.projectedLoss +
    withdrawalShock.projectedWithdrawals;

  return {
    stressScore:
      round(score)
  };
}

/**
 * -----------------------------------------------------
 * SCENARIO MATRIX
 * -----------------------------------------------------
 */

async function generateScenarioMatrix(
  tenantId
) {
  return {
    mild:
      await simulateDefaultShock(
        tenantId,
        5
      ),

    moderate:
      await simulateDefaultShock(
        tenantId,
        15
      ),

    severe:
      await simulateDefaultShock(
        tenantId,
        30
      )
  };
}

/**
 * -----------------------------------------------------
 * EXECUTIVE DASHBOARD
 * -----------------------------------------------------
 */

async function getStressTestingDashboard(
  tenantId
) {
  const [
    exposure,
    capital,
    stressScore,
    defaultShock,
    delinquencyShock,
    withdrawalShock,
    settlementShock,
    recessionShock,
    scenarios
  ] = await Promise.all([
    getLoanPortfolioExposure(
      tenantId
    ),

    calculateCapitalAdequacy(
      tenantId
    ),

    calculateStressScore(
      tenantId
    ),

    simulateDefaultShock(
      tenantId,
      15
    ),

    simulateDelinquencyShock(
      tenantId,
      20
    ),

    simulateMemberRun(
      tenantId,
      30
    ),

    simulateSettlementFailure(
      tenantId
    ),

    simulateEconomicRecession(
      tenantId
    ),

    generateScenarioMatrix(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    exposure,

    capital,

    stressScore,

    scenarios: {
      defaultShock,
      delinquencyShock,
      withdrawalShock,
      settlementShock,
      recessionShock
    },

    scenarioMatrix:
      scenarios
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {

  getLoanPortfolioExposure,

  getLiquidityPosition,

  simulateDefaultShock,

  simulateDelinquencyShock,

  simulateMemberRun,

  simulateSettlementFailure,

  simulateInterestRateShock,

  simulateEconomicRecession,

  calculateCapitalAdequacy,

  calculateStressScore,

  generateScenarioMatrix,

  getStressTestingDashboard
};