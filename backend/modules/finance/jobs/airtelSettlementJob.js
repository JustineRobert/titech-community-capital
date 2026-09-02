// backend/modules/finance/jobs/airtelSettlementJob.js

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

const airtelService =
  require('../../payments/airtel/airtelService');

/**
 * ---------------------------------------------------------
 * CONFIGURATION
 * ---------------------------------------------------------
 */

const JOB_NAME =
  'airtel-settlement-job';

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

function generateExecutionId() {

  return `AIRTEL-STL-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * ---------------------------------------------------------
 * AUDIT LOGGING
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
        'AIRTEL_SETTLEMENT_JOB',

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
      '[AIRTEL AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * ---------------------------------------------------------
 * VERIFY AIRTEL TRANSACTION
 * ---------------------------------------------------------
 */

async function verifyAirtelTransaction(
  transaction
) {

  const response =
    await airtelService.getTransactionStatus(
      transaction.externalReference
    );

  return response;
}

/**
 * ---------------------------------------------------------
 * LEDGER SETTLEMENT
 * ---------------------------------------------------------
 */

async function postSettlement({
  transaction
}) {

  const reference =
    `AIRTEL-STL-${transaction.reference}`;

  const debitAccountId =
    process.env
      .AIRTEL_CLEARING_ACCOUNT_ID;

  const creditAccountId =
    transaction.creditAccountId;

  if (
    !debitAccountId ||
    !creditAccountId
  ) {

    throw new Error(
      'Airtel settlement accounts not configured'
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
      `Airtel Settlement ${transaction.reference}`
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

  const airtelResult =
    await verifyAirtelTransaction(
      transaction
    );

  if (!airtelResult) {

    throw new Error(
      'Airtel verification failed'
    );
  }

  /**
   * Pending
   */

  if (
    airtelResult.status ===
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
    airtelResult.status ===
    STATUS.FAILED
  ) {

    transaction.status =
      'FAILED';

    transaction.metadata =
      transaction.metadata || {};

    transaction.metadata
      .airtelSettlementFailure =
      airtelResult;

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
    airtelResult.status ===
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
      .airtelSettlement =
      airtelResult;

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

      provider: 'AIRTEL',

      status: 'PENDING'
    });

  let settled = 0;
  let failed = 0;
  let pending = 0;

  const results = [];

  for (
    const transaction
    of transactions
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

      } else if (

        result?.status ===
        STATUS.FAILED

      ) {

        failed++;

      } else {

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
 * RUN JOB
 * ---------------------------------------------------------
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

        durationMs:
          Date.now() -
          startedAt,

        processed:
          result.processed,

        settled:
          result.settled,

        failed:
          result.failed,

        pending:
          result.pending
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
 * ---------------------------------------------------------
 * BULLMQ WORKER
 * ---------------------------------------------------------
 */

async function processJob(job) {

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

  verifyAirtelTransaction,

  postSettlement,

  healthCheck
};