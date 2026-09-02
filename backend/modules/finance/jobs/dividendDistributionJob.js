// backend/modules/finance/jobs/dividendDistributionJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Member =
  require('../../members/models/Member');

const Account =
  require('../models/Account');

const Transaction =
  require('../models/Transaction');

const AuditLog =
  require('../../../shared/models/AuditLog');

const ledgerService =
  require('../services/ledgerService');

/**
 * -------------------------------------------------------
 * CONFIG
 * -------------------------------------------------------
 */

const JOB_NAME =
  'dividend-distribution-job';

const DIVIDEND_EXPENSE_ACCOUNT =
  'DIVIDEND_EXPENSE';

const MEMBER_DIVIDEND_LIABILITY =
  'MEMBER_DIVIDEND_PAYABLE';

/**
 * -------------------------------------------------------
 * EXECUTION ID
 * -------------------------------------------------------
 */

function executionId() {

  return `DIV-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * -------------------------------------------------------
 * AUDIT
 * -------------------------------------------------------
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
        'DIVIDEND_DISTRIBUTION',

      status,

      metadata: {
        hostname:
          os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[DIVIDEND AUDIT]',
      error.message
    );
  }
}

/**
 * -------------------------------------------------------
 * MEMBER ELIGIBILITY
 * -------------------------------------------------------
 */

async function eligibleMembers(
  tenantId
) {

  return Member.find({

    tenantId,

    status: 'ACTIVE',

    isDeleted: {
      $ne: true
    },

    shareBalance: {
      $gt: 0
    }
  });
}

/**
 * -------------------------------------------------------
 * TOTAL SHARE CAPITAL
 * -------------------------------------------------------
 */

function totalShares(
  members
) {

  return members.reduce(

    (sum, member) =>
      sum +
      Number(
        member.shareBalance || 0
      ),

    0
  );
}

/**
 * -------------------------------------------------------
 * CALCULATE DIVIDEND
 * -------------------------------------------------------
 */

function calculateDividend({

  memberShares,

  totalShares,

  distributableProfit
}) {

  if (
    totalShares <= 0
  ) {
    return 0;
  }

  return Number(
    (
      (memberShares /
        totalShares) *
      distributableProfit
    ).toFixed(2)
  );
}

/**
 * -------------------------------------------------------
 * DISTRIBUTE MEMBER DIVIDEND
 * -------------------------------------------------------
 */

async function distributeMember({

  tenantId,

  member,

  amount,

  distributionReference,

  expenseAccountId,

  liabilityAccountId
}) {

  if (
    amount <= 0
  ) {
    return null;
  }

  const reference =
    `${distributionReference}-${member._id}`;

  return ledgerService.postTransaction({

    tenantId,

    debitAccountId:
      expenseAccountId,

    creditAccountId:
      liabilityAccountId,

    amount,

    reference,

    description:
      `Dividend distribution for member ${member._id}`
  });
}

/**
 * -------------------------------------------------------
 * DISTRIBUTE DIVIDENDS
 * -------------------------------------------------------
 */

async function run({

  tenantId,

  distributableProfit,

  fiscalYear,

  approvedBy
}) {

  const id =
    executionId();

  const started =
    Date.now();

  await audit({

    tenantId,

    status:
      'STARTED',

    metadata: {
      executionId:
        id,

      fiscalYear,

      distributableProfit
    }
  });

  try {

    if (
      distributableProfit <= 0
    ) {

      throw new Error(
        'No distributable profit available'
      );
    }

    const members =
      await eligibleMembers(
        tenantId
      );

    if (
      !members.length
    ) {

      throw new Error(
        'No eligible members found'
      );
    }

    const expenseAccount =
      await Account.getByCode(
        tenantId,
        DIVIDEND_EXPENSE_ACCOUNT
      );

    const liabilityAccount =
      await Account.getByCode(
        tenantId,
        MEMBER_DIVIDEND_LIABILITY
      );

    if (
      !expenseAccount ||
      !liabilityAccount
    ) {

      throw new Error(
        'Dividend GL accounts not configured'
      );
    }

    const totalShareCapital =
      totalShares(
        members
      );

    const distributionReference =
      `DIVIDEND-${fiscalYear}`;

    const distributions = [];

    let totalDistributed =
      0;

    for (
      const member
      of members
    ) {

      const amount =
        calculateDividend({

          memberShares:
            Number(
              member.shareBalance || 0
            ),

          totalShares:
            totalShareCapital,

          distributableProfit
        });

      await distributeMember({

        tenantId,

        member,

        amount,

        distributionReference,

        expenseAccountId:
          expenseAccount._id,

        liabilityAccountId:
          liabilityAccount._id
      });

      distributions.push({

        memberId:
          member._id,

        shares:
          member.shareBalance,

        dividend:
          amount
      });

      totalDistributed +=
        amount;
    }

    await audit({

      tenantId,

      status:
        'SUCCESS',

      metadata: {

        executionId:
          id,

        fiscalYear,

        approvedBy,

        memberCount:
          distributions.length,

        totalDistributed,

        durationMs:
          Date.now() -
          started
      }
    });

    return {

      success: true,

      tenantId,

      fiscalYear,

      executionId:
        id,

      memberCount:
        distributions.length,

      totalDistributed,

      durationMs:
        Date.now() -
        started,

      distributions
    };

  } catch (error) {

    await audit({

      tenantId,

      status:
        'FAILED',

      metadata: {

        executionId:
          id,

        fiscalYear,

        error:
          error.message
      }
    });

    throw error;
  }
}

/**
 * -------------------------------------------------------
 * BULLMQ PROCESSOR
 * -------------------------------------------------------
 */

async function processJob(
  job
) {

  return run({

    tenantId:
      job.data.tenantId,

    distributableProfit:
      job.data.distributableProfit,

    fiscalYear:
      job.data.fiscalYear,

    approvedBy:
      job.data.approvedBy
  });
}

/**
 * -------------------------------------------------------
 * HEALTH CHECK
 * -------------------------------------------------------
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
 * -------------------------------------------------------
 * EXPORTS
 * -------------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  run,

  processJob,

  eligibleMembers,

  totalShares,

  calculateDividend,

  healthCheck
};