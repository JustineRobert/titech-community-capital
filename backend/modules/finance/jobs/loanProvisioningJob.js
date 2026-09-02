// backend/modules/finance/jobs/loanProvisioningJob.js
'use strict';

const crypto = require('crypto');
const os = require('os');

const Loan =
  require('../models/Loan');

const Journal =
  require('../models/Journal');

const AuditLog =
  require('../../../shared/models/AuditLog');

const ledgerService =
  require('../services/ledgerService');

/**
 * -----------------------------------------------------
 * CONFIG
 * -----------------------------------------------------
 */

const JOB_NAME =
  'loan-provisioning-job';

const MAX_RETRIES = 5;

/**
 * -----------------------------------------------------
 * IFRS9 / SACCO PROVISION MATRIX
 * -----------------------------------------------------
 */

const PROVISION_MATRIX = [
  {
    minDays: 0,
    maxDays: 30,
    stage: 'STAGE_1',
    rate: 0.01
  },
  {
    minDays: 31,
    maxDays: 90,
    stage: 'STAGE_2',
    rate: 0.10
  },
  {
    minDays: 91,
    maxDays: 180,
    stage: 'STAGE_3',
    rate: 0.50
  },
  {
    minDays: 181,
    maxDays: 99999,
    stage: 'DEFAULT',
    rate: 1.00
  }
];

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function generateExecutionId() {

  return `PROV-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

function calculateDaysPastDue(
  dueDate
) {

  const today =
    new Date();

  const due =
    new Date(dueDate);

  const diff =
    today - due;

  return Math.max(
    0,
    Math.floor(
      diff /
      (1000 * 60 * 60 * 24)
    )
  );
}

function determineProvisionBucket(
  daysPastDue
) {

  return PROVISION_MATRIX.find(
    bucket =>
      daysPastDue >= bucket.minDays &&
      daysPastDue <= bucket.maxDays
  );
}

/**
 * -----------------------------------------------------
 * AUDIT
 * -----------------------------------------------------
 */

async function writeAuditLog({

  executionId,
  tenantId,
  status,
  metadata = {}
}) {

  try {

    await AuditLog.create({

      action:
        'LOAN_PROVISIONING_JOB',

      tenantId,

      status,

      metadata: {

        executionId,

        hostname:
          os.hostname(),

        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[PROVISION AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * -----------------------------------------------------
 * CALCULATE PROVISION
 * -----------------------------------------------------
 */

function calculateProvisionAmount({
  outstandingBalance,
  provisionRate
}) {

  return Number(
    (
      outstandingBalance *
      provisionRate
    ).toFixed(2)
  );
}

/**
 * -----------------------------------------------------
 * CREATE PROVISION JOURNAL
 * -----------------------------------------------------
 */

async function createProvisionJournal({

  tenantId,
  loan,
  provisionAmount,
  stage
}) {

  if (
    provisionAmount <= 0
  ) {
    return null;
  }

  const reference =
    `PROV-${loan._id}-${Date.now()}`;

  /**
   * Chart of Accounts Example:
   *
   * Loan Loss Expense
   * Allowance for Loan Loss
   */

  const debitAccountId =
    process.env
      .LOAN_LOSS_EXPENSE_ACCOUNT;

  const creditAccountId =
    process.env
      .LOAN_LOSS_ALLOWANCE_ACCOUNT;

  if (
    !debitAccountId ||
    !creditAccountId
  ) {

    throw new Error(
      'Provision account configuration missing'
    );
  }

  return ledgerService.postTransaction({

    tenantId,

    debitAccountId,

    creditAccountId,

    amount:
      provisionAmount,

    reference,

    description:
      `Loan Provision (${stage})`
  });
}

/**
 * -----------------------------------------------------
 * PROCESS SINGLE LOAN
 * -----------------------------------------------------
 */

async function processLoan({

  tenantId,
  loan,
  executionId
}) {

  const daysPastDue =
    calculateDaysPastDue(
      loan.nextDueDate
    );

  const bucket =
    determineProvisionBucket(
      daysPastDue
    );

  const provisionAmount =
    calculateProvisionAmount({

      outstandingBalance:
        loan.outstandingBalance,

      provisionRate:
        bucket.rate
    });

  await createProvisionJournal({

    tenantId,

    loan,

    provisionAmount,

    stage:
      bucket.stage
  });

  loan.provisionStage =
    bucket.stage;

  loan.provisionRate =
    bucket.rate;

  loan.provisionAmount =
    provisionAmount;

  loan.lastProvisionedAt =
    new Date();

  await loan.save();

  return {

    loanId:
      loan._id,

    stage:
      bucket.stage,

    rate:
      bucket.rate,

    daysPastDue,

    provisionAmount
  };
}

/**
 * -----------------------------------------------------
 * PROCESS TENANT
 * -----------------------------------------------------
 */

async function processTenant({

  tenantId,
  executionId
}) {

  const activeLoans =
    await Loan.find({

      tenantId,

      status: {
        $in: [
          'ACTIVE',
          'OVERDUE'
        ]
      }
    });

  const results =
    [];

  let totalProvision =
    0;

  for (
    const loan of activeLoans
  ) {

    const result =
      await processLoan({

        tenantId,

        loan,

        executionId
      });

    totalProvision +=
      result.provisionAmount;

    results.push(
      result
    );
  }

  return {

    tenantId,

    loansProcessed:
      results.length,

    totalProvision,

    results
  };
}

/**
 * -----------------------------------------------------
 * RUN JOB
 * -----------------------------------------------------
 */

async function run({

  tenantId
}) {

  const executionId =
    generateExecutionId();

  const startedAt =
    Date.now();

  await writeAuditLog({

    executionId,

    tenantId,

    status:
      'STARTED'
  });

  try {

    const result =
      await processTenant({

        tenantId,

        executionId
      });

    await writeAuditLog({

      executionId,

      tenantId,

      status:
        'COMPLETED',

      metadata: {

        loansProcessed:
          result.loansProcessed,

        totalProvision:
          result.totalProvision,

        durationMs:
          Date.now() -
          startedAt
      }
    });

    return result;

  } catch (error) {

    await writeAuditLog({

      executionId,

      tenantId,

      status:
        'FAILED',

      metadata: {
        error:
          error.message
      }
    });

    throw error;
  }
}

/**
 * -----------------------------------------------------
 * BULLMQ WORKER
 * -----------------------------------------------------
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
 * -----------------------------------------------------
 * HEALTH CHECK
 * -----------------------------------------------------
 */

async function healthCheck() {

  return {

    job:
      JOB_NAME,

    hostname:
      os.hostname(),

    status:
      'HEALTHY',

    timestamp:
      new Date()
    };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  run,

  processJob,

  processTenant,

  processLoan,

  healthCheck,

  MAX_RETRIES
};