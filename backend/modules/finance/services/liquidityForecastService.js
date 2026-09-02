// backend/modules/finance/services/liquidityForecastService.js

'use strict';

const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Loan = require('../../loans/models/Loan');

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateGrowthRate(previous, current) {
  if (!previous || previous <= 0) {
    return 0;
  }

  return round(
    ((current - previous) / previous) * 100
  );
}

/**
 * -----------------------------------------------------
 * CASH POSITION
 * -----------------------------------------------------
 */

async function getCurrentCashPosition(
  tenantId
) {
  const accounts =
    await Account.find({
      tenantId,
      isActive: true,
      type: 'ASSET'
    });

  const totalCash =
    accounts.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return {
    totalCash:
      round(totalCash)
  };
}

/**
 * -----------------------------------------------------
 * SAVINGS WITHDRAWAL FORECAST
 * -----------------------------------------------------
 */

async function forecastWithdrawals(
  tenantId,
  days = 30
) {
  const withdrawals =
    await Transaction.find({
      tenantId,
      type: 'WITHDRAWAL',
      status: 'POSTED'
    });

  if (!withdrawals.length) {
    return {
      forecastAmount: 0
    };
  }

  const total =
    withdrawals.reduce(
      (sum, tx) =>
        sum +
        Number(tx.amount || 0),
      0
    );

  const avg =
    total /
    withdrawals.length;

  return {
    forecastAmount:
      round(avg * days)
  };
}

/**
 * -----------------------------------------------------
 * SAVINGS DEPOSIT FORECAST
 * -----------------------------------------------------
 */

async function forecastDeposits(
  tenantId,
  days = 30
) {
  const deposits =
    await Transaction.find({
      tenantId,
      type: 'DEPOSIT',
      status: 'POSTED'
    });

  if (!deposits.length) {
    return {
      forecastAmount: 0
    };
  }

  const total =
    deposits.reduce(
      (sum, tx) =>
        sum +
        Number(tx.amount || 0),
      0
    );

  const avg =
    total /
    deposits.length;

  return {
    forecastAmount:
      round(avg * days)
  };
}

/**
 * -----------------------------------------------------
 * LOAN DISBURSEMENT FORECAST
 * -----------------------------------------------------
 */

async function forecastLoanDisbursements(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId,
      status: {
        $in: [
          'APPROVED',
          'PENDING_DISBURSEMENT'
        ]
      }
    });

  const amount =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.amount || 0
        ),
      0
    );

  return {
    projectedDisbursement:
      round(amount)
  };
}

/**
 * -----------------------------------------------------
 * EXPECTED LOAN REPAYMENTS
 * -----------------------------------------------------
 */

async function forecastLoanRepayments(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId,
      status: 'ACTIVE'
    });

  const repayments =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.monthlyInstallment ||
          0
        ),
      0
    );

  return {
    projectedRepayments:
      round(repayments)
  };
}

/**
 * -----------------------------------------------------
 * LIQUIDITY RATIO
 * -----------------------------------------------------
 */

async function calculateLiquidityRatio(
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
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  const totalLiabilities =
    liabilities.reduce(
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  const ratio =
    totalLiabilities > 0
      ? totalAssets /
        totalLiabilities
      : 0;

  return {
    totalAssets:
      round(totalAssets),

    totalLiabilities:
      round(totalLiabilities),

    liquidityRatio:
      round(ratio)
  };
}

/**
 * -----------------------------------------------------
 * LIQUIDITY STRESS TEST
 * -----------------------------------------------------
 */

async function performStressTest(
  tenantId
) {
  const position =
    await getCurrentCashPosition(
      tenantId
    );

  const mild =
    position.totalCash *
    0.10;

  const moderate =
    position.totalCash *
    0.20;

  const severe =
    position.totalCash *
    0.35;

  return {
    currentLiquidity:
      position.totalCash,

    mildStress:
      round(mild),

    moderateStress:
      round(moderate),

    severeStress:
      round(severe)
  };
}

/**
 * -----------------------------------------------------
 * SETTLEMENT EXPOSURE
 * -----------------------------------------------------
 */

async function calculateSettlementExposure(
  tenantId
) {
  const pending =
    await Transaction.find({
      tenantId,
      status: 'PENDING'
    });

  const amount =
    pending.reduce(
      (sum, tx) =>
        sum +
        Number(tx.amount || 0),
      0
    );

  return {
    pendingSettlementAmount:
      round(amount)
  };
}

/**
 * -----------------------------------------------------
 * EARLY WARNING SIGNALS
 * -----------------------------------------------------
 */

async function generateLiquidityAlerts(
  tenantId
) {
  const liquidity =
    await calculateLiquidityRatio(
      tenantId
    );

  const alerts = [];

  if (
    liquidity.liquidityRatio <
    1.0
  ) {
    alerts.push({
      severity:
        'CRITICAL',
      message:
        'Liquidity ratio below minimum threshold.'
    });
  }

  if (
    liquidity.liquidityRatio <
    1.25
  ) {
    alerts.push({
      severity:
        'HIGH',
      message:
        'Liquidity reserve becoming constrained.'
    });
  }

  return alerts;
}

/**
 * -----------------------------------------------------
 * TREASURY FORECAST
 * -----------------------------------------------------
 */

async function generateTreasuryForecast(
  tenantId
) {
  const [
    deposits,
    withdrawals,
    repayments,
    disbursements,
    position
  ] = await Promise.all([
    forecastDeposits(
      tenantId
    ),
    forecastWithdrawals(
      tenantId
    ),
    forecastLoanRepayments(
      tenantId
    ),
    forecastLoanDisbursements(
      tenantId
    ),
    getCurrentCashPosition(
      tenantId
    )
  ]);

  const projectedPosition =
    position.totalCash +
    deposits.forecastAmount +
    repayments.projectedRepayments -
    withdrawals.forecastAmount -
    disbursements.projectedDisbursement;

  return {
    currentPosition:
      position.totalCash,

    projectedPosition:
      round(
        projectedPosition
      ),

    forecastHorizon:
      '30_DAYS'
  };
}

/**
 * -----------------------------------------------------
 * EXECUTIVE LIQUIDITY DASHBOARD
 * -----------------------------------------------------
 */

async function getLiquidityDashboard(
  tenantId
) {
  const [
    position,
    ratio,
    treasury,
    stress,
    settlement,
    alerts
  ] = await Promise.all([
    getCurrentCashPosition(
      tenantId
    ),
    calculateLiquidityRatio(
      tenantId
    ),
    generateTreasuryForecast(
      tenantId
    ),
    performStressTest(
      tenantId
    ),
    calculateSettlementExposure(
      tenantId
    ),
    generateLiquidityAlerts(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    cashPosition:
      position,

    liquidityRatio:
      ratio,

    treasuryForecast:
      treasury,

    stressTest:
      stress,

    settlementExposure:
      settlement,

    alerts
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {

  getCurrentCashPosition,

  forecastWithdrawals,

  forecastDeposits,

  forecastLoanDisbursements,

  forecastLoanRepayments,

  calculateLiquidityRatio,

  performStressTest,

  calculateSettlementExposure,

  generateLiquidityAlerts,

  generateTreasuryForecast,

  getLiquidityDashboard
};