// backend/modules/finance/jobs/auditVerificationJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const AuditLog =
  require('../../../shared/models/AuditLog');

const JournalEntry =
  require('../models/JournalEntry');

const Journal =
  require('../models/Journal');

const Transaction =
  require('../models/Transaction');

/**
 * -------------------------------------------------------
 * CONFIG
 * -------------------------------------------------------
 */

const JOB_NAME =
  'audit-verification-job';

/**
 * -------------------------------------------------------
 * EXECUTION ID
 * -------------------------------------------------------
 */

function executionId() {

  return `AUDIT-VERIFY-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
}

/**
 * -------------------------------------------------------
 * SHA256
 * -------------------------------------------------------
 */

function sha256(payload) {

  return crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex');
}

/**
 * -------------------------------------------------------
 * AUDIT TRAIL
 * -------------------------------------------------------
 */

async function writeAudit({
  tenantId,
  status,
  metadata = {}
}) {

  try {

    await AuditLog.create({

      tenantId,

      action:
        'AUDIT_VERIFICATION_JOB',

      status,

      metadata: {
        hostname:
          os.hostname(),
        ...metadata
      }
    });

  } catch (error) {

    console.error(
      '[AUDIT VERIFY]',
      error.message
    );
  }
}

/**
 * -------------------------------------------------------
 * VERIFY AUDIT HASH CHAIN
 * -------------------------------------------------------
 */

async function verifyAuditChain(
  tenantId
) {

  const logs =
    await AuditLog.find({
      tenantId
    })
      .sort({
        createdAt: 1
      })
      .lean();

  const issues = [];

  let previousHash = null;

  for (
    let i = 0;
    i < logs.length;
    i++
  ) {

    const log = logs[i];

    if (
      String(
        log.previousHash || ''
      ) !==
      String(
        previousHash || ''
      )
    ) {

      issues.push({

        type:
          'AUDIT_CHAIN_BREAK',

        recordId:
          log._id,

        sequence:
          i + 1
      });
    }

    previousHash =
      log.hash;
  }

  return {

    total:
      logs.length,

    issues
  };
}

/**
 * -------------------------------------------------------
 * VERIFY JOURNAL ENTRY HASH CHAIN
 * -------------------------------------------------------
 */

async function verifyJournalHashes(
  tenantId
) {

  const entries =
    await JournalEntry.find({
      tenantId
    })
      .sort({
        createdAt: 1
      })
      .lean();

  const issues = [];

  let previousHash = null;

  for (
    let i = 0;
    i < entries.length;
    i++
  ) {

    const entry =
      entries[i];

    const payload = {

      tenantId:
        entry.tenantId,

      journalId:
        entry.journalId,

      transactionId:
        entry.transactionId,

      accountId:
        entry.accountId,

      amount:
        entry.amount,

      direction:
        entry.direction,

      previousHash:
        entry.previousHash
    };

    const expectedHash =
      sha256(
        JSON.stringify(
          payload
        )
      );

    if (
      expectedHash !==
      entry.hash
    ) {

      issues.push({

        type:
          'HASH_MISMATCH',

        journalId:
          entry.journalId,

        entryId:
          entry._id
      });
    }

    if (
      String(
        entry.previousHash || ''
      ) !==
      String(
        previousHash || ''
      )
    ) {

      issues.push({

        type:
          'CHAIN_BREAK',

        journalId:
          entry.journalId,

        entryId:
          entry._id
      });
    }

    previousHash =
      entry.hash;
  }

  return {

    total:
      entries.length,

    issues
  };
}

/**
 * -------------------------------------------------------
 * VERIFY JOURNAL BALANCES
 * -------------------------------------------------------
 */

async function verifyJournalBalances(
  tenantId
) {

  const journals =
    await Journal.find({
      tenantId
    });

  const issues = [];

  for (
    const journal
    of journals
  ) {

    const entries =
      await JournalEntry.find({

        tenantId,

        journalId:
          journal.journalId
      });

    let debits = 0;
    let credits = 0;

    for (
      const entry
      of entries
    ) {

      if (
        entry.direction ===
        'debit'
      ) {

        debits +=
          Number(
            entry.amount
          );
      }

      if (
        entry.direction ===
        'credit'
      ) {

        credits +=
          Number(
            entry.amount
          );
      }
    }

    if (
      debits !== credits
    ) {

      issues.push({

        type:
          'UNBALANCED_JOURNAL',

        journalId:
          journal.journalId,

        debits,

        credits
      });
    }
  }

  return {

    total:
      journals.length,

    issues
  };
}

/**
 * -------------------------------------------------------
 * VERIFY TRANSACTION REFERENCES
 * -------------------------------------------------------
 */

async function verifyTransactions(
  tenantId
) {

  const duplicates =
    await Transaction.aggregate([
      {
        $match: {
          tenantId
        }
      },
      {
        $group: {
          _id:
            '$reference',
          count: {
            $sum: 1
          }
        }
      },
      {
        $match: {
          count: {
            $gt: 1
          }
        }
      }
    ]);

  return {

    duplicates:
      duplicates.length,

    issues:
      duplicates.map(
        item => ({
          type:
            'DUPLICATE_REFERENCE',

          reference:
            item._id,

          count:
            item.count
        })
      )
  };
}

/**
 * -------------------------------------------------------
 * EXECUTE VERIFICATION
 * -------------------------------------------------------
 */

async function run({
  tenantId
}) {

  const id =
    executionId();

  const started =
    Date.now();

  await writeAudit({

    tenantId,

    status:
      'STARTED',

    metadata: {
      executionId:
        id
    }
  });

  try {

    const [
      auditChain,
      journalHashes,
      journalBalances,
      transactions
    ] = await Promise.all([

      verifyAuditChain(
        tenantId
      ),

      verifyJournalHashes(
        tenantId
      ),

      verifyJournalBalances(
        tenantId
      ),

      verifyTransactions(
        tenantId
      )
    ]);

    const totalIssues =

      auditChain.issues
        .length +

      journalHashes
        .issues.length +

      journalBalances
        .issues.length +

      transactions
        .issues.length;

    const report = {

      tenantId,

      executionId:
        id,

      generatedAt:
        new Date(),

      durationMs:
        Date.now() -
        started,

      passed:
        totalIssues ===
        0,

      totalIssues,

      auditChain,

      journalHashes,

      journalBalances,

      transactions
    };

    await writeAudit({

      tenantId,

      status:
        'SUCCESS',

      metadata: {

        executionId:
          id,

        totalIssues
      }
    });

    return report;

  } catch (error) {

    await writeAudit({

      tenantId,

      status:
        'FAILED',

      metadata: {

        executionId:
          id,

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
      job.data.tenantId
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

  verifyAuditChain,

  verifyJournalHashes,

  verifyJournalBalances,

  verifyTransactions,

  healthCheck
};