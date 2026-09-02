// backend/modules/finance/jobs/yearEndClosingJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Account =
  require('../models/Account');

const AuditLog =
  require('../../../shared/models/AuditLog');

const Journal =
  require('../models/Journal');

const ledgerService =
  require('../services/ledgerService');

/**
 * ----------------------------------------------------
 * CONFIG
 * ----------------------------------------------------
 */

const JOB_NAME =
  'year-end-closing-job';

const RETAINED_EARNINGS_CODE =
  'RETAINED_EARNINGS';

/**
 * ----------------------------------------------------
 * EXECUTION ID
 * ----------------------------------------------------
 */

function generateExecutionId() {

  return `YEC-${Date.now()}-${crypto
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
  status,
  metadata = {}
}) {

  try {

    await AuditLog.create({

      tenantId,

      action:
        'YEAR_END_CLOSING',

      status,

      metadata: {
        hostname:
          os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[YEAR END AUDIT]',
      error.message
    );
  }
}

/**
 * ----------------------------------------------------
 * LOAD REVENUE ACCOUNTS
 * ----------------------------------------------------
 */

async function getRevenueAccounts(
  tenantId
) {

  return Account.find({

    tenantId,

    type: 'REVENUE',

    isActive: true
  });
}

/**
 * ----------------------------------------------------
 * LOAD EXPENSE ACCOUNTS
 * ----------------------------------------------------
 */

async function getExpenseAccounts(
  tenantId
) {

  return Account.find({

    tenantId,

    type: 'EXPENSE',

    isActive: true
  });
}

/**
 * ----------------------------------------------------
 * CALCULATE PROFIT
 * ----------------------------------------------------
 */

async function calculateNetIncome(
  tenantId
) {

  const revenues =
    await getRevenueAccounts(
      tenantId
    );

  const expenses =
    await getExpenseAccounts(
      tenantId
    );

  const totalRevenue =
    revenues.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  const totalExpense =
    expenses.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return {

    totalRevenue,

    totalExpense,

    netIncome:
      totalRevenue -
      totalExpense
  };
}

/**
 * ----------------------------------------------------
 * FIND RETAINED EARNINGS
 * ----------------------------------------------------
 */

async function getRetainedEarnings(
  tenantId
) {

  const account =
    await Account.getByCode(
      tenantId,
      RETAINED_EARNINGS_CODE
    );

  if (!account) {

    throw new Error(
      'Retained earnings account not configured'
    );
  }

  return account;
}

/**
 * ----------------------------------------------------
 * CLOSE REVENUE ACCOUNT
 * ----------------------------------------------------
 */

async function closeRevenueAccount({
  tenantId,
  account,
  retainedEarnings
}) {

  const balance =
    Number(
      account.balance || 0
    );

  if (balance <= 0) {
    return;
  }

  await ledgerService.postTransaction({

    tenantId,

    debitAccountId:
      account._id,

    creditAccountId:
      retainedEarnings._id,

    amount:
      balance,

    reference:
      `YEC-REV-${account.code}`,

    description:
      `Year-end closing revenue account ${account.code}`
  });
}

/**
 * ----------------------------------------------------
 * CLOSE EXPENSE ACCOUNT
 * ----------------------------------------------------
 */

async function closeExpenseAccount({
  tenantId,
  account,
  retainedEarnings
}) {

  const balance =
    Number(
      account.balance || 0
    );

  if (balance <= 0) {
    return;
  }

  await ledgerService.postTransaction({

    tenantId,

    debitAccountId:
      retainedEarnings._id,

    creditAccountId:
      account._id,

    amount:
      balance,

    reference:
      `YEC-EXP-${account.code}`,

    description:
      `Year-end closing expense account ${account.code}`
  });
}

/**
 * ----------------------------------------------------
 * DUPLICATE CLOSING CHECK
 * ----------------------------------------------------
 */

async function alreadyClosed({
  tenantId,
  fiscalYear
}) {

  const existing =
    await Journal.findOne({

      tenantId,

      reference:
        `YEAR-END-${fiscalYear}`
    });

  return !!existing;
}

/**
 * ----------------------------------------------------
 * EXECUTE CLOSING
 * ----------------------------------------------------
 */

async function run({

  tenantId,

  fiscalYear,

  approvedBy
}) {

  const executionId =
    generateExecutionId();

  const started =
    Date.now();

  await audit({

    tenantId,

    status: 'STARTED',

    metadata: {

      executionId,

      fiscalYear
    }
  });

  try {

    const closed =
      await alreadyClosed({

        tenantId,

        fiscalYear
      });

    if (closed) {

      throw new Error(
        `Fiscal year ${fiscalYear} already closed`
      );
    }

    const retainedEarnings =
      await getRetainedEarnings(
        tenantId
      );

    const revenues =
      await getRevenueAccounts(
        tenantId
      );

    const expenses =
      await getExpenseAccounts(
        tenantId
      );

    const profit =
      await calculateNetIncome(
        tenantId
      );

    for (const revenue of revenues) {

      await closeRevenueAccount({

        tenantId,

        account: revenue,

        retainedEarnings
      });
    }

    for (const expense of expenses) {

      await closeExpenseAccount({

        tenantId,

        account: expense,

        retainedEarnings
      });
    }

    await audit({

      tenantId,

      status: 'SUCCESS',

      metadata: {

        executionId,

        fiscalYear,

        approvedBy,

        totalRevenue:
          profit.totalRevenue,

        totalExpense:
          profit.totalExpense,

        netIncome:
          profit.netIncome,

        durationMs:
          Date.now() -
          started
      }
    });

    return {

      success: true,

      tenantId,

      fiscalYear,

      executionId,

      totalRevenue:
        profit.totalRevenue,

      totalExpense:
        profit.totalExpense,

      netIncome:
        profit.netIncome,

      retainedEarningsAccount:
        retainedEarnings.code,

      durationMs:
        Date.now() -
        started
    };

  } catch (error) {

    await audit({

      tenantId,

      status: 'FAILED',

      metadata: {

        executionId,

        fiscalYear,

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
      job.data.tenantId,

    fiscalYear:
      job.data.fiscalYear,

    approvedBy:
      job.data.approvedBy
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

  calculateNetIncome,

  getRevenueAccounts,

  getExpenseAccounts,

  getRetainedEarnings,

  healthCheck
};