// backend/modules/finance/services/memberBehaviorAnalyticsService.js

'use strict';

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

function daysBetween(date1, date2) {
  return Math.floor(
    Math.abs(new Date(date2) - new Date(date1)) /
      (1000 * 60 * 60 * 24)
  );
}

function riskLevel(score) {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}

/**
 * -----------------------------------------------------
 * MEMBER TRANSACTION SUMMARY
 * -----------------------------------------------------
 */

async function getMemberTransactionSummary(
  tenantId,
  memberId
) {
  const transactions =
    await Transaction.find({
      tenantId,
      memberId
    });

  const deposits =
    transactions.filter(
      tx => tx.type === 'DEPOSIT'
    );

  const withdrawals =
    transactions.filter(
      tx => tx.type === 'WITHDRAWAL'
    );

  const totalDeposits =
    deposits.reduce(
      (sum, tx) =>
        sum + Number(tx.amount || 0),
      0
    );

  const totalWithdrawals =
    withdrawals.reduce(
      (sum, tx) =>
        sum + Number(tx.amount || 0),
      0
    );

  return {
    totalTransactions:
      transactions.length,

    totalDeposits:
      round(totalDeposits),

    totalWithdrawals:
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
 * SAVINGS CONSISTENCY SCORE
 * -----------------------------------------------------
 */

async function calculateSavingsConsistency(
  tenantId,
  memberId
) {
  const deposits =
    await Transaction.find({
      tenantId,
      memberId,
      type: 'DEPOSIT'
    }).sort({
      createdAt: 1
    });

  if (deposits.length < 2) {
    return {
      score: 0,
      consistency: 'LOW'
    };
  }

  let intervals = [];

  for (
    let i = 1;
    i < deposits.length;
    i++
  ) {
    intervals.push(
      daysBetween(
        deposits[i - 1].createdAt,
        deposits[i].createdAt
      )
    );
  }

  const avg =
    intervals.reduce(
      (a, b) => a + b,
      0
    ) / intervals.length;

  let score = 100;

  if (avg > 60) score -= 60;
  else if (avg > 30) score -= 30;
  else if (avg > 14) score -= 10;

  return {
    score,
    consistency:
      score >= 80
        ? 'HIGH'
        : score >= 50
        ? 'MEDIUM'
        : 'LOW'
  };
}

/**
 * -----------------------------------------------------
 * LOAN REPAYMENT SCORE
 * -----------------------------------------------------
 */

async function calculateRepaymentBehavior(
  tenantId,
  memberId
) {
  const loans =
    await Loan.find({
      tenantId,
      borrowerId: memberId
    });

  if (!loans.length) {
    return {
      repaymentScore: 50,
      category: 'NEW_MEMBER'
    };
  }

  let score = 100;

  for (const loan of loans) {
    const overdue =
      Number(
        loan.daysPastDue || 0
      );

    score -= Math.min(
      overdue,
      50
    );
  }

  score = Math.max(
    0,
    score
  );

  return {
    repaymentScore: score,

    category:
      score >= 80
        ? 'EXCELLENT'
        : score >= 60
        ? 'GOOD'
        : score >= 40
        ? 'FAIR'
        : 'POOR'
  };
}

/**
 * -----------------------------------------------------
 * CHURN RISK ANALYSIS
 * -----------------------------------------------------
 */

async function calculateChurnRisk(
  tenantId,
  memberId
) {
  const latestTx =
    await Transaction.findOne({
      tenantId,
      memberId
    }).sort({
      createdAt: -1
    });

  if (!latestTx) {
    return {
      score: 100,
      risk: 'CRITICAL'
    };
  }

  const inactiveDays =
    daysBetween(
      latestTx.createdAt,
      new Date()
    );

  let score =
    Math.min(
      inactiveDays,
      100
    );

  return {
    inactiveDays,
    score,
    risk: riskLevel(
      100 - score
    )
  };
}

/**
 * -----------------------------------------------------
 * DORMANCY DETECTION
 * -----------------------------------------------------
 */

async function detectDormancy(
  tenantId,
  memberId
) {
  const latestTx =
    await Transaction.findOne({
      tenantId,
      memberId
    }).sort({
      createdAt: -1
    });

  if (!latestTx) {
    return {
      dormant: true,
      dormantDays: null
    };
  }

  const dormantDays =
    daysBetween(
      latestTx.createdAt,
      new Date()
    );

  return {
    dormant:
      dormantDays > 90,

    dormantDays
  };
}

/**
 * -----------------------------------------------------
 * LOYALTY SCORE
 * -----------------------------------------------------
 */

async function calculateLoyaltyScore(
  tenantId,
  memberId
) {
  const transactions =
    await Transaction.find({
      tenantId,
      memberId
    });

  const loans =
    await Loan.find({
      tenantId,
      borrowerId: memberId
    });

  let score = 0;

  score += Math.min(
    transactions.length,
    50
  );

  score += Math.min(
    loans.length * 10,
    50
  );

  return {
    loyaltyScore: score,
    tier:
      score >= 80
        ? 'PLATINUM'
        : score >= 60
        ? 'GOLD'
        : score >= 40
        ? 'SILVER'
        : 'BRONZE'
  };
}

/**
 * -----------------------------------------------------
 * MEMBER SEGMENTATION
 * -----------------------------------------------------
 */

async function classifyMemberSegment(
  tenantId,
  memberId
) {
  const summary =
    await getMemberTransactionSummary(
      tenantId,
      memberId
    );

  const savings =
    summary.netSavings;

  if (savings > 50000000)
    return 'PREMIUM';

  if (savings > 10000000)
    return 'GROWTH';

  if (savings > 1000000)
    return 'STANDARD';

  return 'BASIC';
}

/**
 * -----------------------------------------------------
 * BORROWING BEHAVIOR
 * -----------------------------------------------------
 */

async function analyzeBorrowingBehavior(
  tenantId,
  memberId
) {
  const loans =
    await Loan.find({
      tenantId,
      borrowerId: memberId
    });

  const totalBorrowed =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.amount || 0
        ),
      0
    );

  return {
    totalLoans:
      loans.length,

    totalBorrowed:
      round(
        totalBorrowed
      ),

    averageLoanSize:
      loans.length
        ? round(
            totalBorrowed /
              loans.length
          )
        : 0
  };
}

/**
 * -----------------------------------------------------
 * COMPLETE MEMBER PROFILE
 * -----------------------------------------------------
 */

async function getMemberBehaviorProfile(
  tenantId,
  memberId
) {
  const [
    summary,
    savings,
    repayment,
    churn,
    dormancy,
    loyalty,
    borrowing
  ] = await Promise.all([
    getMemberTransactionSummary(
      tenantId,
      memberId
    ),

    calculateSavingsConsistency(
      tenantId,
      memberId
    ),

    calculateRepaymentBehavior(
      tenantId,
      memberId
    ),

    calculateChurnRisk(
      tenantId,
      memberId
    ),

    detectDormancy(
      tenantId,
      memberId
    ),

    calculateLoyaltyScore(
      tenantId,
      memberId
    ),

    analyzeBorrowingBehavior(
      tenantId,
      memberId
    )
  ]);

  const segment =
    await classifyMemberSegment(
      tenantId,
      memberId
    );

  return {
    summary,
    savings,
    repayment,
    churn,
    dormancy,
    loyalty,
    borrowing,
    segment,
    generatedAt:
      new Date()
  };
}

/**
 * -----------------------------------------------------
 * EXECUTIVE DASHBOARD
 * -----------------------------------------------------
 */

async function getBehaviorDashboard(
  tenantId,
  memberIds = []
) {
  const dashboard = [];

  for (const memberId of memberIds) {
    dashboard.push(
      await getMemberBehaviorProfile(
        tenantId,
        memberId
      )
    );
  }

  return {
    generatedAt:
      new Date(),
    members:
      dashboard.length,
    analytics:
      dashboard
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {
  getMemberTransactionSummary,
  calculateSavingsConsistency,
  calculateRepaymentBehavior,
  calculateChurnRisk,
  detectDormancy,
  calculateLoyaltyScore,
  classifyMemberSegment,
  analyzeBorrowingBehavior,
  getMemberBehaviorProfile,
  getBehaviorDashboard
};