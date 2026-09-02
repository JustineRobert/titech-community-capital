// backend/modules/finance/jobs/statementGenerationJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Tenant = require('../../../modules/tenant/models/Tenant');

const financialStatementService = require('../services/financialStatementService');

const AuditLog = require('../../../shared/models/AuditLog');

/**
 * -----------------------------------------------------
 * CONFIGURATION
 * -----------------------------------------------------
 */

const JOB_NAME =
  'statement-generation-job';

const DEFAULT_BATCH_SIZE = 50;

const MAX_RETRIES = 5;

/**
 * -----------------------------------------------------
 * EXECUTION ID
 * -----------------------------------------------------
 */

function generateExecutionId() {
  return `STM-${Date.now()}-${crypto
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

      action:
        'STATEMENT_GENERATION_JOB',

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
      '[STATEMENT JOB AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * -----------------------------------------------------
 * GENERATE TENANT REPORTS
 * -----------------------------------------------------
 */

async function generateTenantStatements({
  tenantId,
  startDate,
  endDate,
  executionId
}) {

  const startedAt =
    Date.now();

  try {

    await writeAuditLog({
      executionId,
      tenantId,
      status: 'STARTED'
    });

    /**
     * Balance Sheet
     */
    const balanceSheet =
      await financialStatementService
        .generateBalanceSheet({
          tenantId,
          asOfDate: endDate
        });

    /**
     * Profit & Loss
     */
    const incomeStatement =
      await financialStatementService
        .generateIncomeStatement({
          tenantId,
          startDate,
          endDate
        });

    /**
     * Cash Flow
     */
    const cashFlow =
      await financialStatementService
        .generateCashFlowStatement({
          tenantId,
          startDate,
          endDate
        });

    /**
     * Trial Balance
     */
    const trialBalance =
      await financialStatementService
        .generateTrialBalance({
          tenantId,
          asOfDate: endDate
        });

    /**
     * Loan Portfolio
     */
    const loanPortfolio =
      await financialStatementService
        .generateLoanPortfolioReport({
          tenantId,
          asOfDate: endDate
        });

    /**
     * Savings Report
     */
    const savingsReport =
      await financialStatementService
        .generateSavingsReport({
          tenantId,
          asOfDate: endDate
        });

    const durationMs =
      Date.now() - startedAt;

    const summary = {

      durationMs,

      balanceSheetGenerated:
        true,

      incomeStatementGenerated:
        true,

      cashFlowGenerated:
        true,

      trialBalanceGenerated:
        true,

      loanPortfolioGenerated:
        true,

      savingsReportGenerated:
        true
    };

    await writeAuditLog({

      executionId,

      tenantId,

      status: 'COMPLETED',

      metadata: summary
    });

    return {
      tenantId,
      success: true,

      balanceSheet,
      incomeStatement,
      cashFlow,
      trialBalance,
      loanPortfolio,
      savingsReport,

      durationMs
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
 * PROCESS ALL TENANTS
 * -----------------------------------------------------
 */

async function processAllTenants({
  startDate,
  endDate,
  batchSize = DEFAULT_BATCH_SIZE
}) {

  const executionId =
    generateExecutionId();

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
            generateTenantStatements({

              tenantId:
                tenant._id,

              startDate,

              endDate,

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

    generatedAt:
      new Date(),

    results
  };
}

/**
 * -----------------------------------------------------
 * BULLMQ WORKER PROCESSOR
 * -----------------------------------------------------
 */

async function processJob(job) {

  const retries =
    job.attemptsMade || 0;

  try {

    return await processAllTenants({

      startDate:
        job.data?.startDate,

      endDate:
        job.data?.endDate,

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
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {

  JOB_NAME,

  processJob,

  processAllTenants,

  generateTenantStatements,

  healthCheck
};