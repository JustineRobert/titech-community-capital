// backend/modules/finance/jobs/reconciliationJob.js

'use strict';

const os = require('os');
const crypto = require('crypto');

const reconciliationService =
  require('../services/reconciliationService');

const Tenant =
  require('../../../modules/tenant/models/Tenant');

const AuditLog =
  require('../../../shared/models/AuditLog');

/**
 * -----------------------------------------------------
 * CONFIG
 * -----------------------------------------------------
 */

const JOB_NAME =
  'financial-reconciliation';

const DEFAULT_BATCH_SIZE = 100;

const MAX_RETRIES = 5;

/**
 * -----------------------------------------------------
 * GENERATE EXECUTION ID
 * -----------------------------------------------------
 */

function generateExecutionId() {
  return `REC-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * -----------------------------------------------------
 * AUDIT EVENT
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
        'RECONCILIATION_JOB',

      tenantId,

      status,

      metadata: {
        executionId,
        hostname:
          os.hostname(),
        ...metadata
      }
    });

  } catch (err) {

    console.error(
      '[RECONCILIATION AUDIT ERROR]',
      err.message
    );
  }
}

/**
 * -----------------------------------------------------
 * RECONCILE SINGLE TENANT
 * -----------------------------------------------------
 */

async function reconcileTenant({
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
     * Journal Reconciliation
     */
    const journalResult =
      await reconciliationService
        .reconcileJournalEntries({
          tenantId
        });

    /**
     * Mobile Money Reconciliation
     */
    const momoResult =
      await reconciliationService
        .reconcileMobileMoney({
          tenantId
        });

    /**
     * Bank Reconciliation
     */
    const bankResult =
      await reconciliationService
        .reconcileBankStatements({
          tenantId
        });

    /**
     * Ledger Validation
     */
    const ledgerValidation =
      await reconciliationService
        .validateLedgerBalances({
          tenantId
        });

    const completedAt =
      Date.now();

    const durationMs =
      completedAt -
      startedAt;

    await writeAuditLog({
      executionId,
      tenantId,
      status: 'COMPLETED',

      metadata: {
        durationMs,

        journalResult,

        momoResult,

        bankResult,

        ledgerValidation
      }
    });

    return {
      success: true,
      tenantId,
      durationMs,

      journalResult,

      momoResult,

      bankResult,

      ledgerValidation
    };

  } catch (error) {

    await writeAuditLog({
      executionId,
      tenantId,
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
 * -----------------------------------------------------
 * RECONCILE ALL TENANTS
 * -----------------------------------------------------
 */

async function reconcileAllTenants(
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
            reconcileTenant({
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
 * BULLMQ WORKER HANDLER
 * -----------------------------------------------------
 */

async function processJob(
  job
) {

  const retries =
    job.attemptsMade || 0;

  try {

    return await reconcileAllTenants({
      batchSize:
        job.data.batchSize
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

  try {

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

  } catch (error) {

    return {
      job:
        JOB_NAME,

      status:
        'UNHEALTHY',

      error:
        error.message
    };
  }
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  processJob,

  healthCheck,

  reconcileTenant,

  reconcileAllTenants
};