// backend/modules/finance/jobs/loanDelinquencyJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Loan = require('../models/Loan');
const LoanWorkflowHistory = require('../models/LoanWorkflowHistory');
const AuditLog = require('../../../shared/models/AuditLog');

/**
 * --------------------------------------------------------
 * CONFIGURATION
 * --------------------------------------------------------
 */

const JOB_NAME = 'loan-delinquency-job';

const DELINQUENCY_BUCKETS = [
  {
    min: 0,
    max: 0,
    status: 'CURRENT'
  },
  {
    min: 1,
    max: 30,
    status: 'PAR_1_30'
  },
  {
    min: 31,
    max: 60,
    status: 'PAR_31_60'
  },
  {
    min: 61,
    max: 90,
    status: 'PAR_61_90'
  },
  {
    min: 91,
    max: 180,
    status: 'PAR_91_180'
  },
  {
    min: 181,
    max: 99999,
    status: 'LOSS'
  }
];

/**
 * --------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------
 */

function executionId() {
  return `DLQ-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

function calculateDaysPastDue(dueDate) {
  if (!dueDate) return 0;

  const now = new Date();

  const due = new Date(dueDate);

  const diff =
    now.getTime() -
    due.getTime();

  return Math.max(
    0,
    Math.floor(
      diff /
      (1000 * 60 * 60 * 24)
    )
  );
}

function determineBucket(daysPastDue) {
  return DELINQUENCY_BUCKETS.find(
    bucket =>
      daysPastDue >= bucket.min &&
      daysPastDue <= bucket.max
  );
}

/**
 * --------------------------------------------------------
 * AUDIT
 * --------------------------------------------------------
 */

async function writeAuditLog({
  executionId,
  tenantId,
  status,
  metadata = {}
}) {
  try {

    await AuditLog.create({
      tenantId,

      action:
        'LOAN_DELINQUENCY_JOB',

      status,

      metadata: {
        executionId,
        hostname: os.hostname(),
        ...metadata
      }
    });

  } catch (err) {

    console.error(
      '[DELINQUENCY AUDIT ERROR]',
      err.message
    );
  }
}

/**
 * --------------------------------------------------------
 * WORKFLOW HISTORY
 * --------------------------------------------------------
 */

async function createHistory({
  tenantId,
  loanId,
  oldBucket,
  newBucket,
  daysPastDue
}) {

  await LoanWorkflowHistory.create({

    tenantId,

    loanId,

    action:
      'DELINQUENCY_STATUS_CHANGED',

    previousStatus:
      oldBucket,

    newStatus:
      newBucket,

    notes:
      `${daysPastDue} DPD`,

    timestamp:
      new Date()
  });
}

/**
 * --------------------------------------------------------
 * ESCALATION RULES
 * --------------------------------------------------------
 */

function determineEscalation(
  daysPastDue
) {

  if (daysPastDue >= 180) {
    return 'LEGAL_RECOVERY';
  }

  if (daysPastDue >= 90) {
    return 'COLLECTIONS_MANAGER';
  }

  if (daysPastDue >= 30) {
    return 'LOAN_OFFICER';
  }

  return null;
}

/**
 * --------------------------------------------------------
 * UPDATE SINGLE LOAN
 * --------------------------------------------------------
 */

async function processLoan({
  loan,
  executionId
}) {

  const daysPastDue =
    calculateDaysPastDue(
      loan.nextDueDate
    );

  const bucket =
    determineBucket(
      daysPastDue
    );

  const currentBucket =
    loan.delinquencyBucket ||
    'CURRENT';

  const escalation =
    determineEscalation(
      daysPastDue
    );

  let changed = false;

  if (
    currentBucket !==
    bucket.status
  ) {

    changed = true;

    await createHistory({

      tenantId:
        loan.tenantId,

      loanId:
        loan._id,

      oldBucket:
        currentBucket,

      newBucket:
        bucket.status,

      daysPastDue
    });
  }

  loan.daysPastDue =
    daysPastDue;

  loan.delinquencyBucket =
    bucket.status;

  loan.lastDelinquencyReviewAt =
    new Date();

  loan.escalationLevel =
    escalation;

  /**
   * Automatically update status
   */

  if (
    daysPastDue > 0 &&
    loan.status === 'ACTIVE'
  ) {

    loan.status =
      'OVERDUE';
  }

  if (
    daysPastDue >= 181
  ) {

    loan.status =
      'DEFAULTED';
  }

  await loan.save();

  return {

    loanId:
      loan._id,

    changed,

    daysPastDue,

    bucket:
      bucket.status,

    escalation,

    status:
      loan.status
  };
}

/**
 * --------------------------------------------------------
 * PROCESS TENANT
 * --------------------------------------------------------
 */

async function processTenant({
  tenantId,
  executionId
}) {

  const loans =
    await Loan.find({

      tenantId,

      status: {
        $in: [
          'ACTIVE',
          'OVERDUE'
        ]
      }
    });

  const results = [];

  let overdueCount = 0;

  let defaultedCount = 0;

  for (const loan of loans) {

    const result =
      await processLoan({

        loan,

        executionId
      });

    if (
      result.daysPastDue > 0
    ) {
      overdueCount++;
    }

    if (
      result.status ===
      'DEFAULTED'
    ) {
      defaultedCount++;
    }

    results.push(
      result
    );
  }

  return {

    tenantId,

    loansProcessed:
      loans.length,

    overdueCount,

    defaultedCount,

    results
  };
}

/**
 * --------------------------------------------------------
 * RUN
 * --------------------------------------------------------
 */

async function run({
  tenantId
}) {

  const execId =
    executionId();

  const startedAt =
    Date.now();

  await writeAuditLog({

    executionId:
      execId,

    tenantId,

    status:
      'STARTED'
  });

  try {

    const result =
      await processTenant({

        tenantId,

        executionId:
          execId
      });

    await writeAuditLog({

      executionId:
        execId,

      tenantId,

      status:
        'COMPLETED',

      metadata: {

        durationMs:
          Date.now() -
          startedAt,

        loansProcessed:
          result.loansProcessed,

        overdueCount:
          result.overdueCount,

        defaultedCount:
          result.defaultedCount
      }
    });

    return result;

  } catch (error) {

    await writeAuditLog({

      executionId:
        execId,

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
 * --------------------------------------------------------
 * BULLMQ WORKER
 * --------------------------------------------------------
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
 * --------------------------------------------------------
 * HEALTH CHECK
 * --------------------------------------------------------
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
 * --------------------------------------------------------
 * EXPORTS
 * --------------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  run,

  processJob,

  processTenant,

  processLoan,

  healthCheck,

  DELINQUENCY_BUCKETS
};