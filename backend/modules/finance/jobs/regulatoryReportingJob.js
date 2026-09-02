// backend/modules/finance/jobs/regulatoryReportingJob.js
'use strict';

const crypto = require('crypto');
const os = require('os');

const Transaction =
  require('../models/Transaction');

const Journal =
  require('../models/Journal');

const Loan =
  require('../../loans/models/Loan');

const Member =
  require('../../members/models/Member');

const AuditLog =
  require('../../../shared/models/AuditLog');

const financialStatementService =
  require('../services/financialStatementService');

/**
 * -------------------------------------------------------
 * CONFIG
 * -------------------------------------------------------
 */

const JOB_NAME =
  'regulatory-reporting-job';

const REPORT_TYPES = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  ANNUAL: 'ANNUAL'
};

/**
 * -------------------------------------------------------
 * EXECUTION ID
 * -------------------------------------------------------
 */

function generateExecutionId() {

  return `REG-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * -------------------------------------------------------
 * AUDIT LOGGING
 * -------------------------------------------------------
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
        'REGULATORY_REPORT_GENERATION',

      status,

      metadata: {
        executionId,
        hostname: os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[REGULATORY AUDIT ERROR]',
      error.message
    );
  }
}

/**
 * -------------------------------------------------------
 * REPORT PERIOD
 * -------------------------------------------------------
 */

function getPeriod(type) {

  const endDate =
    new Date();

  const startDate =
    new Date();

  switch (type) {

    case REPORT_TYPES.MONTHLY:

      startDate.setMonth(
        startDate.getMonth() - 1
      );

      break;

    case REPORT_TYPES.QUARTERLY:

      startDate.setMonth(
        startDate.getMonth() - 3
      );

      break;

    case REPORT_TYPES.ANNUAL:

      startDate.setFullYear(
        startDate.getFullYear() - 1
      );

      break;

    default:

      throw new Error(
        'Invalid report type'
      );
  }

  return {
    startDate,
    endDate
  };
}

/**
 * -------------------------------------------------------
 * MEMBER REPORT
 * -------------------------------------------------------
 */

async function buildMemberReport(
  tenantId
) {

  const totalMembers =
    await Member.countDocuments({
      tenantId
    });

  const activeMembers =
    await Member.countDocuments({
      tenantId,
      isActive: true
    });

  const verifiedMembers =
    await Member.countDocuments({
      tenantId,
      kycStatus: 'VERIFIED'
    });

  return {

    totalMembers,

    activeMembers,

    verifiedMembers,

    unverifiedMembers:
      totalMembers -
      verifiedMembers
  };
}

/**
 * -------------------------------------------------------
 * SAVINGS REPORT
 * -------------------------------------------------------
 */

async function buildSavingsReport(
  tenantId,
  startDate,
  endDate
) {

  const deposits =
    await Transaction.aggregate([

      {
        $match: {
          tenantId,
          type: 'DEPOSIT',
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },

      {
        $group: {
          _id: null,
          totalAmount: {
            $sum: '$amount'
          },
          totalCount: {
            $sum: 1
          }
        }
      }
    ]);

  return {

    totalDeposits:
      deposits[0]?.totalAmount || 0,

    totalDepositTransactions:
      deposits[0]?.totalCount || 0
  };
}

/**
 * -------------------------------------------------------
 * LOAN REPORT
 * -------------------------------------------------------
 */

async function buildLoanReport(
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

  const disbursed =
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

    portfolioValue:
      disbursed[0]?.total || 0
  };
}

/**
 * -------------------------------------------------------
 * AML REPORT
 * -------------------------------------------------------
 */

async function buildAMLReport(
  tenantId,
  startDate,
  endDate
) {

  const suspiciousThreshold =
    10000000; // UGX

  const suspiciousTransactions =
    await Transaction.countDocuments({

      tenantId,

      amount: {
        $gte:
          suspiciousThreshold
      },

      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

  return {

    suspiciousTransactions,

    threshold:
      suspiciousThreshold
  };
}

/**
 * -------------------------------------------------------
 * JOURNAL REPORT
 * -------------------------------------------------------
 */

async function buildJournalReport(
  tenantId,
  startDate,
  endDate
) {

  const totalJournals =
    await Journal.countDocuments({

      tenantId,

      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

  const postedJournals =
    await Journal.countDocuments({

      tenantId,

      status: 'POSTED',

      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

  return {

    totalJournals,

    postedJournals
  };
}

/**
 * -------------------------------------------------------
 * GENERATE REPORT
 * -------------------------------------------------------
 */

async function generateReport({

  tenantId,

  reportType =
    REPORT_TYPES.MONTHLY

}) {

  const executionId =
    generateExecutionId();

  const {
    startDate,
    endDate
  } = getPeriod(
    reportType
  );

  await audit({

    tenantId,

    executionId,

    status: 'STARTED'
  });

  try {

    const financials =
      await financialStatementService
        .generateFinancialStatements({

          tenantId,

          startDate,

          endDate
        });

    const report = {

      executionId,

      tenantId,

      reportType,

      generatedAt:
        new Date(),

      reportingPeriod: {
        startDate,
        endDate
      },

      members:
        await buildMemberReport(
          tenantId
        ),

      savings:
        await buildSavingsReport(
          tenantId,
          startDate,
          endDate
        ),

      loans:
        await buildLoanReport(
          tenantId
        ),

      aml:
        await buildAMLReport(
          tenantId,
          startDate,
          endDate
        ),

      journals:
        await buildJournalReport(
          tenantId,
          startDate,
          endDate
        ),

      financialStatements:
        financials
    };

    await audit({

      tenantId,

      executionId,

      status: 'SUCCESS',

      metadata: {

        reportType
      }
    });

    return report;

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
 * -------------------------------------------------------
 * BULLMQ PROCESSOR
 * -------------------------------------------------------
 */

async function processJob(
  job
) {

  return generateReport({

    tenantId:
      job.data.tenantId,

    reportType:
      job.data.reportType
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

  REPORT_TYPES,

  generateReport,

  processJob,

  buildMemberReport,

  buildSavingsReport,

  buildLoanReport,

  buildAMLReport,

  buildJournalReport,

  healthCheck
};