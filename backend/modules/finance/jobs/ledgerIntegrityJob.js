// backend/modules/finance/jobs/ledgerIntegrityJob.js

'use strict';

const crypto = require('crypto');
const os = require('os');

const Account =
  require('../models/Account');

const Transaction =
  require('../models/Transaction');

const Journal =
  require('../models/Journal');

const JournalEntry =
  require('../models/JournalEntry');

const AuditLog =
  require('../../../shared/models/AuditLog');

/**
 * -------------------------------------------------------
 * CONFIG
 * -------------------------------------------------------
 */

const JOB_NAME =
  'ledger-integrity-job';

const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
};

/**
 * -------------------------------------------------------
 * EXECUTION ID
 * -------------------------------------------------------
 */

function executionId() {

  return `LEDGER-INT-${Date.now()}-${crypto
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
  executionId,
  status,
  metadata = {}

}) {

  try {

    await AuditLog.create({

      tenantId,

      action:
        'LEDGER_INTEGRITY_JOB',

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
      '[LEDGER AUDIT ERROR]',
      error.message
    );
  }
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

  const violations = [];

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
          Number(entry.amount);
      }

      if (
        entry.direction ===
        'credit'
      ) {

        credits +=
          Number(entry.amount);
      }
    }

    if (
      debits !== credits
    ) {

      violations.push({

        type:
          'JOURNAL_IMBALANCE',

        journalId:
          journal.journalId,

        debits,

        credits
      });
    }
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * VERIFY JOURNAL TOTALS
 * -------------------------------------------------------
 */

async function verifyJournalHeaders(
  tenantId
) {

  const journals =
    await Journal.find({
      tenantId
    });

  const violations = [];

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
          Number(entry.amount);
      }

      if (
        entry.direction ===
        'credit'
      ) {
        credits +=
          Number(entry.amount);
      }
    }

    if (
      Number(
        journal.totalDebits
      ) !== debits
    ) {

      violations.push({

        type:
          'HEADER_DEBIT_MISMATCH',

        journalId:
          journal.journalId
      });
    }

    if (
      Number(
        journal.totalCredits
      ) !== credits
    ) {

      violations.push({

        type:
          'HEADER_CREDIT_MISMATCH',

        journalId:
          journal.journalId
      });
    }
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * VERIFY ACCOUNT BALANCES
 * -------------------------------------------------------
 */

async function verifyAccountBalances(
  tenantId
) {

  const accounts =
    await Account.find({
      tenantId
    });

  const violations = [];

  for (
    const account
    of accounts
  ) {

    const entries =
      await JournalEntry.find({

        tenantId,

        accountId:
          account._id
      });

    let calculated = 0;

    for (
      const entry
      of entries
    ) {

      if (
        entry.direction ===
        'credit'
      ) {

        calculated +=
          Number(entry.amount);

      } else {

        calculated -=
          Number(entry.amount);
      }
    }

    const actual =
      Number(
        account.balance
      );

    if (
      Math.abs(
        calculated -
        actual
      ) > 0.01
    ) {

      violations.push({

        type:
          'ACCOUNT_BALANCE_MISMATCH',

        accountId:
          account._id,

        calculated,

        actual
      });
    }
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * VERIFY ORPHANS
 * -------------------------------------------------------
 */

async function verifyOrphans(
  tenantId
) {

  const violations = [];

  const entries =
    await JournalEntry.find({
      tenantId
    });

  for (
    const entry
    of entries
  ) {

    const journal =
      await Journal.findOne({

        tenantId,

        journalId:
          entry.journalId
      });

    if (!journal) {

      violations.push({

        type:
          'ORPHAN_JOURNAL_ENTRY',

        entryId:
          entry._id
      });
    }
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * VERIFY HASH CHAIN
 * -------------------------------------------------------
 */

async function verifyHashes(
  tenantId
) {

  const entries =
    await JournalEntry.find({

      tenantId

    }).sort({
      createdAt: 1
    });

  const violations = [];

  let previousHash =
    null;

  for (
    const entry
    of entries
  ) {

    const payload =
      JSON.stringify({

        tenantId:
          entry.tenantId,

        journalId:
          entry.journalId,

        accountId:
          entry.accountId,

        amount:
          entry.amount,

        direction:
          entry.direction,

        previousHash
      });

    const expectedHash =
      crypto
        .createHash(
          'sha256'
        )
        .update(payload)
        .digest(
          'hex'
        );

    if (
      entry.hash !==
      expectedHash
    ) {

      violations.push({

        type:
          'HASH_MISMATCH',

        entryId:
          entry._id
      });
    }

    previousHash =
      entry.hash;
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * VERIFY TRANSACTIONS
 * -------------------------------------------------------
 */

async function verifyTransactions(
  tenantId
) {

  const txs =
    await Transaction.find({
      tenantId
    });

  const violations = [];

  for (
    const tx
    of txs
  ) {

    const journal =
      await Journal.findOne({

        tenantId,

        transactionId:
          tx._id
      });

    if (!journal) {

      violations.push({

        type:
          'MISSING_JOURNAL',

        transactionId:
          tx._id
      });
    }
  }

  return violations;
}

/**
 * -------------------------------------------------------
 * TENANT VALIDATION
 * -------------------------------------------------------
 */

async function validateTenant(
  tenantId
) {

  const violations = [];

  violations.push(
    ...(await verifyJournalBalances(
      tenantId
    ))
  );

  violations.push(
    ...(await verifyJournalHeaders(
      tenantId
    ))
  );

  violations.push(
    ...(await verifyAccountBalances(
      tenantId
    ))
  );

  violations.push(
    ...(await verifyOrphans(
      tenantId
    ))
  );

  violations.push(
    ...(await verifyHashes(
      tenantId
    ))
  );

  violations.push(
    ...(await verifyTransactions(
      tenantId
    ))
  );

  return violations;
}

/**
 * -------------------------------------------------------
 * RUN
 * -------------------------------------------------------
 */

async function run({

  tenantId

}) {

  const execId =
    executionId();

  const started =
    Date.now();

  await audit({

    tenantId,

    executionId:
      execId,

    status:
      'STARTED'
  });

  try {

    const violations =
      await validateTenant(
        tenantId
      );

    const result = {

      tenantId,

      healthy:
        violations.length === 0,

      violations,

      checkedAt:
        new Date(),

      durationMs:
        Date.now() -
        started
    };

    await audit({

      tenantId,

      executionId:
        execId,

      status:
        violations.length
          ? 'FAILED'
          : 'SUCCESS',

      metadata: {

        violations:
          violations.length
      }
    });

    return result;

  } catch (error) {

    await audit({

      tenantId,

      executionId:
        execId,

      status:
        'ERROR',

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
 * BULLMQ
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

  validateTenant,

  verifyJournalBalances,

  verifyJournalHeaders,

  verifyAccountBalances,

  verifyTransactions,

  verifyHashes,

  verifyOrphans,

  healthCheck
};