// backend/modules/finance/services/predictiveRiskAnalyticsService.js

'use strict';

const Loan = require('../../loans/models/Loan');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

/**
 * ----------------------------------------------------
 * CONFIGURATION
 * ----------------------------------------------------
 */

const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * ----------------------------------------------------
 * HELPERS
 * ----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function percentage(part, total) {
  if (!total || total <= 0) return 0;
  return round((part / total) * 100);
}

function daysOverdue(date) {
  if (!date) return 0;

  const now = new Date();

  return Math.max(
    0,
    Math.floor(
      (now - new Date(date)) /
      (1000 * 60 * 60 * 24)
    )
  );
}

/**
 * ----------------------------------------------------
 * MEMBER CREDIT SCORE
 * ----------------------------------------------------
 */

async function calculateBorrowerRisk(loan) {

  let score = 100;

  score -= Math.min(
    40,
    daysOverdue(loan.nextDueDate)
  );

  score -= Number(
    loan.previousDefaults || 0
  ) * 15;

  score += Number(
    loan.totalSavingsScore || 0
  );

  score += Number(
    loan.repaymentScore || 0
  );

  score = Math.max(
    0,
    Math.min(100, score)
  );

  let riskLevel =
    RISK_LEVELS.LOW;

  if (score < 30)
    riskLevel =
      RISK_LEVELS.CRITICAL;
  else if (score < 50)
    riskLevel =
      RISK_LEVELS.HIGH;
  else if (score < 70)
    riskLevel =
      RISK_LEVELS.MEDIUM;

  return {
    score,
    riskLevel
  };
}

/**
 * ----------------------------------------------------
 * DEFAULT PROBABILITY
 * ----------------------------------------------------
 */

async function predictDefaultProbability(
  tenantId
) {

  const loans =
    await Loan.find({
      tenantId,
      status: 'ACTIVE'
    });

  const results = [];

  for (const loan of loans) {

    const overdue =
      daysOverdue(
        loan.nextDueDate
      );

    let probability = 0;

    probability +=
      overdue * 1.5;

    probability +=
      Number(
        loan.previousDefaults || 0
      ) * 15;

    probability +=
      Number(
        loan.outstandingBalance || 0
      ) /
      Math.max(
        Number(
          loan.amount || 1
        ),
        1
      ) *
      20;

    probability =
      Math.min(
        100,
        round(probability)
      );

    results.push({
      loanId: loan._id,
      borrowerId:
        loan.borrowerId,
      probability
    });
  }

  return results;
}

/**
 * ----------------------------------------------------
 * PORTFOLIO STRESS TEST
 * ----------------------------------------------------
 */

async function stressTestPortfolio(
  tenantId
) {

  const loans =
    await Loan.find({
      tenantId
    });

  const portfolio =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.outstandingBalance || 0
        ),
      0
    );

  const mildShock =
    portfolio * 0.05;

  const moderateShock =
    portfolio * 0.10;

  const severeShock =
    portfolio * 0.20;

  return {
    portfolioValue:
      round(portfolio),

    mildShockLoss:
      round(mildShock),

    moderateShockLoss:
      round(moderateShock),

    severeShockLoss:
      round(severeShock)
  };
}

/**
 * ----------------------------------------------------
 * EARLY WARNING SIGNALS
 * ----------------------------------------------------
 */

async function detectEarlyWarnings(
  tenantId
) {

  const loans =
    await Loan.find({
      tenantId,
      status: 'ACTIVE'
    });

  const warnings = [];

  for (const loan of loans) {

    const overdue =
      daysOverdue(
        loan.nextDueDate
      );

    if (overdue >= 15) {

      warnings.push({

        loanId:
          loan._id,

        borrowerId:
          loan.borrowerId,

        type:
          'PAYMENT_DELAY',

        overdueDays:
          overdue
      });
    }

    const utilization =
      Number(
        loan.outstandingBalance || 0
      ) /
      Math.max(
        Number(
          loan.amount || 1
        ),
        1
      );

    if (utilization > 0.90) {

      warnings.push({

        loanId:
          loan._id,

        borrowerId:
          loan.borrowerId,

        type:
          'HIGH_UTILIZATION',

        ratio:
          round(utilization)
      });
    }
  }

  return warnings;
}

/**
 * ----------------------------------------------------
 * FRAUD DETECTION
 * ----------------------------------------------------
 */

async function detectFraudPatterns(
  tenantId
) {

  const transactions =
    await Transaction.find({
      tenantId
    })
      .sort({
        createdAt: -1
      })
      .limit(1000);

  const suspicious = [];

  for (const tx of transactions) {

    const amount =
      Number(
        tx.amount || 0
      );

    if (amount > 50000000) {

      suspicious.push({

        transactionId:
          tx._id,

        reason:
          'UNUSUAL_AMOUNT'
      });
    }

    if (
      tx.status ===
      'FAILED'
    ) {

      suspicious.push({

        transactionId:
          tx._id,

        reason:
          'FAILED_TRANSACTION'
      });
    }
  }

  return suspicious;
}

/**
 * ----------------------------------------------------
 * LIQUIDITY FORECAST
 * ----------------------------------------------------
 */

async function forecastLiquidity(
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

  const projectedRatio =
    totalLiabilities
      ? totalAssets /
        totalLiabilities
      : 0;

  return {

    projectedAssets:
      round(totalAssets),

    projectedLiabilities:
      round(totalLiabilities),

    projectedLiquidityRatio:
      round(projectedRatio)
  };
}

/**
 * ----------------------------------------------------
 * CHURN PREDICTION
 * ----------------------------------------------------
 */

async function predictMemberChurn(
  tenantId
) {

  const transactions =
    await Transaction.find({
      tenantId
    });

  const inactiveMembers =
    transactions.filter(tx => {

      const age =
        daysOverdue(
          tx.createdAt
        );

      return age > 90;
    });

  return {

    predictedInactiveMembers:
      inactiveMembers.length,

    churnRisk:
      percentage(
        inactiveMembers.length,
        transactions.length
      )
  };
}

/**
 * ----------------------------------------------------
 * SACCO HEALTH FORECAST
 * ----------------------------------------------------
 */

async function forecastHealthScore(
  tenantId
) {

  const defaults =
    await predictDefaultProbability(
      tenantId
    );

  const averageRisk =
    defaults.length
      ? defaults.reduce(
          (sum, item) =>
            sum +
            item.probability,
          0
        ) /
        defaults.length
      : 0;

  const score =
    Math.max(
      0,
      100 - averageRisk
    );

  return {

    projectedHealthScore:
      round(score),

    riskIndex:
      round(averageRisk)
  };
}

/**
 * ----------------------------------------------------
 * EXECUTIVE RISK DASHBOARD
 * ----------------------------------------------------
 */

async function getExecutiveRiskDashboard(
  tenantId
) {

  const [
    defaults,
    stress,
    warnings,
    fraud,
    liquidity,
    churn,
    health
  ] = await Promise.all([

    predictDefaultProbability(
      tenantId
    ),

    stressTestPortfolio(
      tenantId
    ),

    detectEarlyWarnings(
      tenantId
    ),

    detectFraudPatterns(
      tenantId
    ),

    forecastLiquidity(
      tenantId
    ),

    predictMemberChurn(
      tenantId
    ),

    forecastHealthScore(
      tenantId
    )
  ]);

  return {

    generatedAt:
      new Date(),

    defaults,
    stress,
    warnings,
    fraud,
    liquidity,
    churn,
    health
  };
}

/**
 * ----------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------
 */

module.exports = {

  calculateBorrowerRisk,

  predictDefaultProbability,

  stressTestPortfolio,

  detectEarlyWarnings,

  detectFraudPatterns,

  forecastLiquidity,

  predictMemberChurn,

  forecastHealthScore,

  getExecutiveRiskDashboard
};
