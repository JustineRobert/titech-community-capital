// backend/modules/finance/jobs/interestAccrualJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Tenant = require('../../../modules/tenant/models/Tenant');

const interestAccrualService =
  require('../services/interestAccrualService');

const AuditLog =
  require('../../../shared/models/AuditLog');

/**
 * -----------------------------------------------------
 * CONFIGURATION
 * -----------------------------------------------------
 */

const JOB_NAME = 'interest-accrual-job';

const DEFAULT_BATCH_SIZE = 100;

const MAX_RETRIES = 5;

/**
 * -----------------------------------------------------
 * EXECUTION ID
 * -----------------------------------------------------
 */

function generateExecutionId() {
  return `INT-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * -----------------------------------------------------
 * AUDIT LOGGING
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
      action: 'INTEREST_ACCRUAL_JOB',
      tenantId,
      status,

      metadata: {
        executionId,
        hostname: os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[INTEREST ACCRUAL AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * -----------------------------------------------------
 * PROCESS SAVINGS INTEREST
 * -----------------------------------------------------
 */

async function processSavingsInterest({
  tenantId
}) {

  return interestAccrualService
    .accrueSavingsInterest({
      tenantId
    });
}

/**
 * -----------------------------------------------------
 * PROCESS LOAN INTEREST
 * -----------------------------------------------------
 */

async function processLoanInterest({
  tenantId
}) {

  return interestAccrualService
    .accrueLoanInterest({
      tenantId
    });
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

  const startedAt = Date.now();

  try {

    await writeAuditLog({
      executionId,
      tenantId,
      status: 'STARTED'
    });

    /**
     * Savings Interest
     */
    const savingsResult =
      await processSavingsInterest({
        tenantId
      });

    /**
     * Loan Interest
     */
    const loanResult =
      await processLoanInterest({
        tenantId
      });

    const durationMs =
      Date.now() - startedAt;

    const summary = {
      durationMs,

      savingsAccruals:
        savingsResult?.processed || 0,

      savingsInterest:
        savingsResult?.totalInterest || 0,

      loanAccruals:
        loanResult?.processed || 0,

      loanInterest:
        loanResult?.totalInterest || 0
    };

    await writeAuditLog({
      executionId,
      tenantId,
      status: 'COMPLETED',
      metadata: summary
    });

    return {
      success: true,
      tenantId,
      ...summary
    };

  } catch (error) {

    await writeAuditLog({
      executionId,
      tenantId,
      status: 'FAILED',

      metadata: {
        error: error.message
      }
    });

    throw error;
  }
}

/**
 * -----------------------------------------------------
 * PROCESS ALL TENANTS
 * -----------------------------------------------------
 */

async function processAllTenants(
  options = {}
) {

  const executionId =
    generateExecutionId();

  const batchSize =
    options.batchSize ||
    DEFAULT_BATCH_SIZE;

  console.info(
    `[${JOB_NAME}] Started`,
    executionId
  );

  const tenants =
    await Tenant.find({
      isActive: true
    })
      .select('_id')
      .lean();

  const results = [];

  for (
    let i = 0;
    i < tenants.length;
    i += batchSize
  ) {

    const batch =
      tenants.slice(
        i,
        i + batchSize
      );

    const batchResults =
      await Promise.allSettled(
        batch.map(
          tenant =>
            processTenant({
              tenantId:
                tenant._id,
              executionId
            })
        )
      );

    results.push(
      ...batchResults
    );
  }

  const successful =
    results.filter(
      r =>
        r.status ===
        'fulfilled'
    ).length;

  const failed =
    results.filter(
      r =>
        r.status ===
        'rejected'
    ).length;

  console.info(
    `[${JOB_NAME}] Completed`,
    {
      executionId,
      successful,
      failed
    }
  );

  return {
    executionId,
    successful,
    failed,
    total:
      results.length,
    results
  };
}

/**
 * -----------------------------------------------------
 * BULLMQ PROCESSOR
 * -----------------------------------------------------
 */

async function processJob(job) {

  const retries =
    job.attemptsMade || 0;

  try {

    return await processAllTenants({
      batchSize:
        job.data?.batchSize
    });

  } catch (error) {

    if (
      retries >=
      MAX_RETRIES
    ) {
      throw error;
    }

    throw error;
  }
}

/**
 * -----------------------------------------------------
 * HEALTH CHECK
 * -----------------------------------------------------
 */

async function healthCheck() {

  return {
    job: JOB_NAME,
    hostname:
      os.hostname(),
    status: 'HEALTHY',
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

  processJob,

  processTenant,

  processAllTenants,

  healthCheck
};