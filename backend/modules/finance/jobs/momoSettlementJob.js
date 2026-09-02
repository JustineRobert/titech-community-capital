// backend/modules/finance/jobs/momoSettlementJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Transaction =
  require('../models/Transaction');

const Journal =
  require('../models/Journal');

const AuditLog =
  require('../../../shared/models/AuditLog');

const ledgerService =
  require('../services/ledgerService');

const momoService =
  require('../../payments/momo/momoService');

/**
 * ---------------------------------------------------------
 * CONFIG
 * ---------------------------------------------------------
 */

const JOB_NAME =
  'momo-settlement-job';

const MAX_RETRIES = 5;

const STATUS = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED'
};

/**
 * ---------------------------------------------------------
 * EXECUTION ID
 * ---------------------------------------------------------
 */

function executionId() {

  return `MOMO-STL-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * ---------------------------------------------------------
 * AUDIT
 * ---------------------------------------------------------
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
        'MOMO_SETTLEMENT_JOB',

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
      '[MOMO AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * ---------------------------------------------------------
 * VERIFY MTN TRANSACTION
 * ---------------------------------------------------------
 */

async function verifyMomoTransaction(
  transaction
) {

  const response =
    await momoService.getTransactionStatus(
      transaction.externalReference
    );

  return response;
}

/**
 * ---------------------------------------------------------
 * SETTLEMENT POSTING
 * ---------------------------------------------------------
 */

async function postSettlement({
  transaction
}) {

  const reference =
    `MOMO-STL-${transaction.reference}`;

  /**
   * Example Accounts:
   *
   * MTN Clearing Account
   * Member Wallet Account
   */

  const debitAccountId =
    process.env
      .MOMO_CLEARING_ACCOUNT_ID;

  const creditAccountId =
    transaction.creditAccountId;

  if (
    !debitAccountId ||
    !creditAccountId
  ) {

    throw new Error(
      'Settlement account configuration missing'
    );
  }

  return ledgerService.postTransaction({

    tenantId:
      transaction.tenantId,

    debitAccountId,

    creditAccountId,

    amount:
      Number(transaction.amount),

    reference,

    description:
      `MTN Settlement ${transaction.reference}`
  });
}

/**
 * ---------------------------------------------------------
 * PROCESS SINGLE TRANSACTION
 * ---------------------------------------------------------
 */

async function processTransaction({
  transaction,
  executionId
}) {

  const momoResult =
    await verifyMomoTransaction(
      transaction
    );

  if (!momoResult) {

    throw new Error(
      'MTN verification failed'
    );
  }

  /**
   * Pending
   */

  if (
    momoResult.status ===
    STATUS.PENDING
  ) {

    return {
      transactionId:
        transaction._id,

      settled: false,

      status:
        STATUS.PENDING
    };
  }

  /**
   * Failed
   */

  if (
    momoResult.status ===
    STATUS.FAILED
  ) {

    transaction.status =
      'FAILED';

    transaction.metadata =
      transaction.metadata || {};

    transaction.metadata
      .settlementFailure =
      momoResult;

    await transaction.save();

    return {

      transactionId:
        transaction._id,

      settled: false,

      status:
        STATUS.FAILED
    };
  }

  /**
   * Successful settlement
   */

  if (
    momoResult.status ===
    STATUS.SUCCESS
  ) {

    await postSettlement({
      transaction
    });

    transaction.status =
      'POSTED';

    transaction.settledAt =
      new Date();

    transaction.metadata =
      transaction.metadata || {};

    transaction.metadata
      .momoSettlement =
      momoResult;

    await transaction.save();

    return {

      transactionId:
        transaction._id,

      settled: true,

      status:
        STATUS.SUCCESS
    };
  }

  return null;
}

/**
 * ---------------------------------------------------------
 * PROCESS TENANT
 * ---------------------------------------------------------
 */

async function processTenant({
  tenantId,
  executionId
}) {

  const transactions =
    await Transaction.find({

      tenantId,

      provider: 'MTN',

      status: 'PENDING'
    });

  let settled = 0;

  let failed = 0;

  let pending = 0;

  const results = [];

  for (
    const transaction of transactions
  ) {

    try {

      const result =
        await processTransaction({

          transaction,

          executionId
        });

      results.push(result);

      if (
        result?.status ===
        STATUS.SUCCESS
      ) {
        settled++;
      }

      else if (
        result?.status ===
        STATUS.FAILED
      ) {
        failed++;
      }

      else {
        pending++;
      }

    } catch (error) {

      failed++;

      results.push({

        transactionId:
          transaction._id,

        error:
          error.message
      });
    }
  }

  return {

    tenantId,

    processed:
      transactions.length,

    settled,

    failed,

    pending,

    results
  };
}

/**
 * ---------------------------------------------------------
 * RUN
 * ---------------------------------------------------------
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

        processed:
          result.processed,

        settled:
          result.settled,

        failed:
          result.failed
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
 * ---------------------------------------------------------
 * BULLMQ WORKER
 * ---------------------------------------------------------
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
 * ---------------------------------------------------------
 * HEALTH CHECK
 * ---------------------------------------------------------
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
 * ---------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  MAX_RETRIES,

  run,

  processJob,

  processTenant,

  processTransaction,

  verifyMomoTransaction,

  postSettlement,

  healthCheck
};