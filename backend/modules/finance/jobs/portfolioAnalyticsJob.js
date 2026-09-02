// backend/modules/finance/jobs/portfolioAnalyticsJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Loan =
  require('../../loans/models/Loan');

const Transaction =
  require('../models/Transaction');

const Journal =
  require('../models/Journal');

const Account =
  require('../models/Account');

const AuditLog =
  require('../../../shared/models/AuditLog');

/**
 * ----------------------------------------------------
 * CONFIG
 * ----------------------------------------------------
 */

const JOB_NAME =
  'portfolio-analytics-job';

/**
 * ----------------------------------------------------
 * EXECUTION ID
 * ----------------------------------------------------
 */

function generateExecutionId() {

  return `PORT-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * ----------------------------------------------------
 * AUDIT
 * ----------------------------------------------------
 */

async function audit({
  tenantId,
  executionId,
  status,
  metadata = {}
}) {

  try {

    await AuditLog.create({

      tenantId,

      action:
        'PORTFOLIO_ANALYTICS',

      status,

      metadata: {
        executionId,
        hostname: os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[PORTFOLIO AUDIT]',
      error.message
    );
  }
}

/**
 * ----------------------------------------------------
 * PORTFOLIO AT RISK
 * ----------------------------------------------------
 */

async function calculatePAR(
  tenantId
) {

  const loans =
    await Loan.find({
      tenantId
    });

  let outstanding = 0;
  let par30 = 0;
  let par60 = 0;
  let par90 = 0;

  const now = new Date();

  for (const loan of loans) {

    const balance =
      Number(
        loan.outstandingBalance || 0
      );

    outstanding += balance;

    const overdueDays =
      loan.nextDueDate
        ? Math.floor(
            (now -
              new Date(
                loan.nextDueDate
              )) /
              86400000
          )
        : 0;

    if (overdueDays > 30) {
      par30 += balance;
    }

    if (overdueDays > 60) {
      par60 += balance;
    }

    if (overdueDays > 90) {
      par90 += balance;
    }
  }

  return {

    outstanding,

    par30,

    par60,

    par90,

    par30Ratio:
      outstanding > 0
        ? (par30 /
            outstanding) *
          100
        : 0,

    par60Ratio:
      outstanding > 0
        ? (par60 /
            outstanding) *
          100
        : 0,

    par90Ratio:
      outstanding > 0
        ? (par90 /
            outstanding) *
          100
        : 0
  };
}

/**
 * ----------------------------------------------------
 * LOAN PORTFOLIO
 * ----------------------------------------------------
 */

async function loanPortfolioMetrics(
  tenantId
) {

  const totalLoans =
    await Loan.countDocuments({
      tenantId
    });

  const activeLoans =
    await Loan.countDocuments({
      tenantId,
      status: 'ACTIVE'
    });

  const overdueLoans =
    await Loan.countDocuments({
      tenantId,
      status: 'OVERDUE'
    });

  const closedLoans =
    await Loan.countDocuments({
      tenantId,
      status: 'CLOSED'
    });

  const disbursements =
    await Loan.aggregate([
      {
        $match: {
          tenantId
        }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: '$amount'
          }
        }
      }
    ]);

  return {

    totalLoans,

    activeLoans,

    overdueLoans,

    closedLoans,

    totalDisbursed:
      disbursements[0]?.total || 0
  };
}

/**
 * ----------------------------------------------------
 * COLLECTION EFFICIENCY
 * ----------------------------------------------------
 */

async function collectionMetrics(
  tenantId
) {

  const repayments =
    await Transaction.aggregate([

      {
        $match: {
          tenantId,
          type:
            'LOAN_REPAYMENT'
        }
      },

      {
        $group: {
          _id: null,
          total: {
            $sum: '$amount'
          }
        }
      }
    ]);

  const expected =
    await Loan.aggregate([
      {
        $match: {
          tenantId,
          status: 'ACTIVE'
        }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum:
              '$expectedRepayment'
          }
        }
      }
    ]);

  const collected =
    repayments[0]?.total || 0;

  const expectedAmount =
    expected[0]?.total || 0;

  return {

    collected,

    expected:
      expectedAmount,

    efficiency:
      expectedAmount > 0
        ? (collected /
            expectedAmount) *
          100
        : 0
  };
}

/**
 * ----------------------------------------------------
 * SAVINGS ANALYTICS
 * ----------------------------------------------------
 */

async function savingsMetrics(
  tenantId
) {

  const deposits =
    await Transaction.aggregate([

      {
        $match: {
          tenantId,
          type: 'DEPOSIT'
        }
      },

      {
        $group: {
          _id: null,
          total: {
            $sum: '$amount'
          }
        }
      }
    ]);

  const withdrawals =
    await Transaction.aggregate([

      {
        $match: {
          tenantId,
          type:
            'WITHDRAWAL'
        }
      },

      {
        $group: {
          _id: null,
          total: {
            $sum: '$amount'
          }
        }
      }
    ]);

  const totalDeposits =
    deposits[0]?.total || 0;

  const totalWithdrawals =
    withdrawals[0]?.total || 0;

  return {

    totalDeposits,

    totalWithdrawals,

    netGrowth:
      totalDeposits -
      totalWithdrawals
  };
}

/**
 * ----------------------------------------------------
 * LIQUIDITY
 * ----------------------------------------------------
 */

async function liquidityMetrics(
  tenantId
) {

  const assets =
    await Account.aggregate([

      {
        $match: {
          tenantId,
          type: 'ASSET'
        }
      },

      {
        $group: {
          _id: null,
          total: {
            $sum: '$balance'
          }
        }
      }
    ]);

  const liabilities =
    await Account.aggregate([

      {
        $match: {
          tenantId,
          type:
            'LIABILITY'
        }
      },

      {
        $group: {
          _id: null,
          total: {
            $sum: '$balance'
          }
        }
      }
    ]);

  const assetTotal =
    Number(
      assets[0]?.total || 0
    );

  const liabilityTotal =
    Number(
      liabilities[0]?.total || 0
    );

  return {

    assets:
      assetTotal,

    liabilities:
      liabilityTotal,

    liquidityRatio:
      liabilityTotal > 0
        ? assetTotal /
          liabilityTotal
        : assetTotal
  };
}

/**
 * ----------------------------------------------------
 * EXECUTE ANALYTICS
 * ----------------------------------------------------
 */

async function run({
  tenantId
}) {

  const executionId =
    generateExecutionId();

  const started =
    Date.now();

  await audit({

    tenantId,

    executionId,

    status: 'STARTED'
  });

  try {

    const analytics = {

      tenantId,

      generatedAt:
        new Date(),

      portfolio:
        await loanPortfolioMetrics(
          tenantId
        ),

      portfolioRisk:
        await calculatePAR(
          tenantId
        ),

      collections:
        await collectionMetrics(
          tenantId
        ),

      savings:
        await savingsMetrics(
          tenantId
        ),

      liquidity:
        await liquidityMetrics(
          tenantId
        ),

      durationMs:
        Date.now() -
        started
    };

    await audit({

      tenantId,

      executionId,

      status: 'SUCCESS',

      metadata: {

        durationMs:
          analytics.durationMs
      }
    });

    return analytics;

  } catch (error) {

    await audit({

      tenantId,

      executionId,

      status: 'FAILED',

      metadata: {
        error:
          error.message
      }
    });

    throw error;
  }
}

/**
 * ----------------------------------------------------
 * BULLMQ PROCESSOR
 * ----------------------------------------------------
 */

async function processJob(
  job
) {

  return run({

    tenantId:
      job.data.tenantId
  });
}

/**
 * ----------------------------------------------------
 * HEALTH CHECK
 * ----------------------------------------------------
 */

async function healthCheck() {

  return {

    job:
      JOB_NAME,

    status:
      'HEALTHY',

    hostname:
      os.hostname(),

    timestamp:
      new Date()
  };
}

/**
 * ----------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  run,

  processJob,

  calculatePAR,

  loanPortfolioMetrics,

  collectionMetrics,

  savingsMetrics,

  liquidityMetrics,

  healthCheck
};