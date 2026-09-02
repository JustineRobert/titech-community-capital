// backend/modules/finance/services/ledgerService.js

'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Journal = require('../models/Journal');
const JournalEntry = require('../models/JournalEntry');

const { checkDuplicate } = require('../utils/idempotency');

/**
 * ---------------------------------------------------------
 * CONSTANTS
 * ---------------------------------------------------------
 */

const JOURNAL_STATUS = {
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED'
};

/**
 * ---------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------
 */

function generateJournalId() {
  return `JRN-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function sha256(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

function decimal(value) {
  return Number(Number(value).toFixed(2));
}

/**
 * ---------------------------------------------------------
 * VERIFY JOURNAL BALANCE
 * ---------------------------------------------------------
 */

exports.verifyJournalBalance = (entries = []) => {

  let totalDebits = 0;
  let totalCredits = 0;

  for (const entry of entries) {

    const amount = decimal(entry.amount);

    if (entry.direction === 'DEBIT') {
      totalDebits += amount;
    }

    if (entry.direction === 'CREDIT') {
      totalCredits += amount;
    }
  }

  totalDebits = decimal(totalDebits);
  totalCredits = decimal(totalCredits);

  if (totalDebits !== totalCredits) {

    throw new Error(
      `Journal imbalance detected. Debits=${totalDebits} Credits=${totalCredits}`
    );
  }

  return {
    balanced: true,
    totalDebits,
    totalCredits
  };
};

/**
 * ---------------------------------------------------------
 * VERIFY ACCOUNT OWNERSHIP
 * ---------------------------------------------------------
 */

async function verifyAccountsBelongToTenant(
  tenantId,
  entries
) {

  const accountIds =
    entries.map(
      e => e.accountId
    );

  const count =
    await Account.countDocuments({
      _id: { $in: accountIds },
      tenantId
    });

  if (
    count !== accountIds.length
  ) {
    throw new Error(
      'Cross-tenant account access detected'
    );
  }
}

/**
 * ---------------------------------------------------------
 * CREATE JOURNAL
 * ---------------------------------------------------------
 */

exports.createJournal = async ({
  tenantId,
  transactionId,
  reference,
  description,
  entries,
  createdBy
}) => {

  if (!tenantId) {
    throw new Error('tenantId required');
  }

  if (!entries?.length) {
    throw new Error('entries required');
  }

  await verifyAccountsBelongToTenant(
    tenantId,
    entries
  );

  const {
    totalDebits,
    totalCredits
  } =
    exports.verifyJournalBalance(
      entries
    );

  const journalId =
    generateJournalId();

  const journal =
    await Journal.create({
      tenantId,
      transactionId,
      journalId,
      reference,
      description,
      totalDebits,
      totalCredits,
      balanced: true,
      status: JOURNAL_STATUS.DRAFT,
      createdBy
    });

  let previousHash = null;

  const entryDocs = [];

  for (const entry of entries) {

    const payload =
      JSON.stringify({
        tenantId,
        journalId,
        transactionId,
        accountId:
          entry.accountId,
        amount:
          entry.amount,
        direction:
          entry.direction,
        previousHash
      });

    const hash =
      sha256(payload);

    entryDocs.push({
      tenantId,
      journalId,
      transactionId,
      accountId:
        entry.accountId,
      amount:
        entry.amount,
      direction:
        entry.direction,
      currency:
        entry.currency ||
        'UGX',
      entryType:
        entry.entryType,
      description,
      reference,
      previousHash,
      hash,
      createdBy
    });

    previousHash = hash;
  }

  await JournalEntry.insertMany(
    entryDocs
  );

  return journal;
};

/**
 * ---------------------------------------------------------
 * POST JOURNAL
 * ---------------------------------------------------------
 */

exports.postJournal = async (
  journalId,
  postedBy
) => {

  const session =
    await mongoose.startSession();

  session.startTransaction();

  try {

    const journal =
      await Journal.findOne({
        journalId
      }).session(session);

    if (!journal) {
      throw new Error(
        'Journal not found'
      );
    }

    if (
      journal.status ===
      JOURNAL_STATUS.POSTED
    ) {
      throw new Error(
        'Journal already posted'
      );
    }

    const entries =
      await JournalEntry.find({
        journalId
      }).session(session);

    exports.verifyJournalBalance(
      entries
    );

    for (
      const entry of entries
    ) {

      const account =
        await Account.findById(
          entry.accountId
        ).session(session);

      if (!account) {
        throw new Error(
          'Account missing'
        );
      }

      const amount =
        decimal(entry.amount);

      if (
        entry.direction ===
        'DEBIT'
      ) {

        account.balance =
          decimal(
            account.balance -
            amount
          );

      } else {

        account.balance =
          decimal(
            account.balance +
            amount
          );
      }

      await account.save({
        session
      });
    }

    journal.status =
      JOURNAL_STATUS.POSTED;

    journal.postedAt =
      new Date();

    journal.postedBy =
      postedBy;

    await journal.save({
      session
    });

    await session.commitTransaction();

    return journal;

  } catch (error) {

    await session.abortTransaction();

    throw error;

  } finally {

    session.endSession();

  }
};

/**
 * ---------------------------------------------------------
 * REVERSE JOURNAL
 * ---------------------------------------------------------
 */

exports.reverseJournal = async ({
  journalId,
  reason,
  reversedBy
}) => {

  const originalJournal =
    await Journal.findOne({
      journalId
    });

  if (!originalJournal) {
    throw new Error(
      'Journal not found'
    );
  }

  const entries =
    await JournalEntry.find({
      journalId
    });

  const reversalEntries =
    entries.map(entry => ({
      accountId:
        entry.accountId,
      amount:
        entry.amount,
      direction:
        entry.direction ===
        'DEBIT'
          ? 'CREDIT'
          : 'DEBIT',
      currency:
        entry.currency,
      entryType:
        'REVERSAL'
    }));

  const reversalJournal =
    await exports.createJournal({
      tenantId:
        originalJournal.tenantId,
      transactionId:
        originalJournal.transactionId,
      reference:
        `REV-${journalId}`,
      description:
        reason ||
        `Reversal ${journalId}`,
      entries:
        reversalEntries,
      createdBy:
        reversedBy
    });

  await exports.postJournal(
    reversalJournal.journalId,
    reversedBy
  );

  originalJournal.reversed =
    true;

  originalJournal.reversalJournalId =
    reversalJournal.journalId;

  originalJournal.status =
    JOURNAL_STATUS.REVERSED;

  await originalJournal.save();

  return reversalJournal;
};

/**
 * ---------------------------------------------------------
 * RECONCILE JOURNAL
 * ---------------------------------------------------------
 */

exports.reconcileJournal =
  async ({
    journalId,
    reconciledBy,
    evidence = {}
  }) => {

    const journal =
      await Journal.findOne({
        journalId
      });

    if (!journal) {
      throw new Error(
        'Journal not found'
      );
    }

    journal.reconciliationStatus =
      'RECONCILED';

    journal.reconciledAt =
      new Date();

    journal.reconciledBy =
      reconciledBy;

    journal.reconciliationEvidence =
      evidence;

    await journal.save();

    await JournalEntry.updateMany(
      { journalId },
      {
        reconciliationStatus:
          'RECONCILED'
      }
    );

    return journal;
  };

/**
 * ---------------------------------------------------------
 * POST TRANSACTION
 * ---------------------------------------------------------
 */

exports.postTransaction =
  async ({
    tenantId,
    debitAccountId,
    creditAccountId,
    amount,
    reference,
    description,
    createdBy
  }) => {

    await checkDuplicate(
      reference
    );

    const transaction =
      await Transaction.create({
        tenantId,
        reference,
        amount,
        description,
        status: 'PENDING',
        createdBy
      });

    const journal =
      await exports.createJournal({
        tenantId,
        transactionId:
          transaction._id,
        reference,
        description,
        createdBy,
        entries: [
          {
            accountId:
              debitAccountId,
            amount,
            direction:
              'DEBIT',
            entryType:
              'ADJUSTMENT'
          },
          {
            accountId:
              creditAccountId,
            amount,
            direction:
              'CREDIT',
            entryType:
              'ADJUSTMENT'
          }
        ]
      });

    await exports.postJournal(
      journal.journalId,
      createdBy
    );

    transaction.status =
      'POSTED';

    await transaction.save();

    return {
      success: true,
      transactionId:
        transaction._id,
      journalId:
        journal.journalId
    };
  };

/**
 * ---------------------------------------------------------
 * RECORD BALANCED TRANSACTION
 * ---------------------------------------------------------
 */

exports.recordBalancedTransaction =
  async params => {

    if (
      decimal(
        params.debitAmount
      ) !==
      decimal(
        params.creditAmount
      )
    ) {

      throw new Error(
        'Ledger imbalance'
      );
    }

    return exports.postTransaction({
      tenantId:
        params.tenantId,
      debitAccountId:
        params.debitAccountId,
      creditAccountId:
        params.creditAccountId,
      amount:
        params.debitAmount,
      reference:
        params.reference,
      description:
        params.description,
      createdBy:
        params.createdBy
    });
  };

