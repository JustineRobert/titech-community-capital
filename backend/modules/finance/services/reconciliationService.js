// backend/modules/finance/services/reconciliationService.js

'use strict';

const crypto = require('crypto');

const Journal = require('../models/Journal');
const JournalEntry = require('../models/JournalEntry');
const Transaction = require('../models/Transaction');

/**
 * --------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------
 */

function hash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function amount(v) {
  return Number(Number(v || 0).toFixed(2));
}

/**
 * --------------------------------------------------------
 * VERIFY INTERNAL JOURNAL BALANCE
 * --------------------------------------------------------
 */

exports.verifyJournalIntegrity =
  async function verifyJournalIntegrity(
    tenantId,
    journalId
  ) {

    const entries =
      await JournalEntry.find({
        tenantId,
        journalId
      });

    let debits = 0;
    let credits = 0;

    for (const entry of entries) {

      if (entry.direction === 'DEBIT') {
        debits += amount(entry.amount);
      }

      if (entry.direction === 'CREDIT') {
        credits += amount(entry.amount);
      }
    }

    return {
      balanced:
        amount(debits) === amount(credits),
      totalDebits:
        amount(debits),
      totalCredits:
        amount(credits)
    };
  };

/**
 * --------------------------------------------------------
 * VERIFY HASH CHAIN
 * --------------------------------------------------------
 */

exports.verifyJournalHashChain =
  async function (
    tenantId,
    journalId
  ) {

    const entries =
      await JournalEntry
        .find({
          tenantId,
          journalId
        })
        .sort({
          createdAt: 1
        });

    let previousHash = null;

    for (const entry of entries) {

      const payload =
        JSON.stringify({
          tenantId:
            entry.tenantId,
          journalId:
            entry.journalId,
          transactionId:
            entry.transactionId,
          accountId:
            entry.accountId,
          amount:
            entry.amount?.toString(),
          direction:
            entry.direction,
          previousHash
        });

      const expectedHash =
        hash(payload);

      if (
        expectedHash !==
        entry.hash
      ) {
        return {
          valid: false,
          compromisedEntry:
            entry._id
        };
      }

      previousHash =
        entry.hash;
    }

    return {
      valid: true
    };
  };

/**
 * --------------------------------------------------------
 * RECONCILE PROVIDER FILE
 * --------------------------------------------------------
 *
 * ledgerRecords
 * providerRecords
 *
 * MTN
 * Airtel
 * Bank
 */

exports.reconcileProviderRecords =
  async function ({
    tenantId,
    provider,
    ledgerRecords,
    providerRecords
  }) {

    const matches = [];
    const mismatches = [];
    const missing = [];
    const duplicates = [];

    const providerMap =
      new Map();

    for (
      const providerRecord
      of providerRecords
    ) {

      const key =
        providerRecord.reference;

      if (
        providerMap.has(key)
      ) {

        duplicates.push(
          providerRecord
        );

        continue;
      }

      providerMap.set(
        key,
        providerRecord
      );
    }

    for (
      const ledgerRecord
      of ledgerRecords
    ) {

      const providerRecord =
        providerMap.get(
          ledgerRecord.reference
        );

      if (
        !providerRecord
      ) {

        missing.push(
          ledgerRecord
        );

        continue;
      }

      if (
        amount(
          ledgerRecord.amount
        ) !==
        amount(
          providerRecord.amount
        )
      ) {

        mismatches.push({
          ledger:
            ledgerRecord,
          provider:
            providerRecord,
          reason:
            'AMOUNT_MISMATCH'
        });

        continue;
      }

      matches.push({
        ledger:
          ledgerRecord,
        provider:
          providerRecord
      });
    }

    return {
      tenantId,
      provider,
      reconciledAt:
        new Date(),
      matches,
      mismatches,
      missing,
      duplicates,
      success:
        mismatches.length === 0 &&
        missing.length === 0
    };
  };

/**
 * --------------------------------------------------------
 * AUTO RECONCILE JOURNAL
 * --------------------------------------------------------
 */

exports.autoReconcileJournal =
  async function ({
    tenantId,
    journalId,
    reconciledBy
  }) {

    const journal =
      await Journal.findOne({
        tenantId,
        journalId
      });

    if (!journal) {
      throw new Error(
        'Journal not found'
      );
    }

    const integrity =
      await exports.verifyJournalIntegrity(
        tenantId,
        journalId
      );

    if (
      !integrity.balanced
    ) {

      throw new Error(
        'Journal imbalance detected'
      );
    }

    const hashValidation =
      await exports.verifyJournalHashChain(
        tenantId,
        journalId
      );

    if (
      !hashValidation.valid
    ) {

      throw new Error(
        'Hash chain validation failed'
      );
    }

    journal.reconciliationStatus =
      'RECONCILED';

    journal.reconciledAt =
      new Date();

    journal.reconciledBy =
      reconciledBy;

    await journal.save();

    await JournalEntry.updateMany(
      {
        tenantId,
        journalId
      },
      {
        reconciliationStatus:
          'RECONCILED'
      }
    );

    return journal;
  };

/**
 * --------------------------------------------------------
 * DETECT DUPLICATE TRANSACTIONS
 * --------------------------------------------------------
 */

exports.detectDuplicateTransactions =
  async function (
    tenantId,
    startDate,
    endDate
  ) {

    return Transaction.aggregate([
      {
        $match: {
          tenantId,
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      {
        $group: {
          _id: '$reference',
          count: {
            $sum: 1
          },
          docs: {
            $push: '$$ROOT'
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
  };

/**
 * --------------------------------------------------------
 * DETECT UNRECONCILED JOURNALS
 * --------------------------------------------------------
 */

exports.getUnreconciledJournals =
  async function (
    tenantId
  ) {

    return Journal.find({
      tenantId,
      reconciliationStatus:
        {
          $ne:
            'RECONCILED'
        }
    })
    .sort({
      createdAt: -1
    });
  };

/**
 * --------------------------------------------------------
 * DAILY RECONCILIATION SUMMARY
 * --------------------------------------------------------
 */

exports.generateDailySummary =
  async function (
    tenantId,
    date
  ) {

    const start =
      new Date(date);

    start.setHours(
      0,
      0,
      0,
      0
    );

    const end =
      new Date(date);

    end.setHours(
      23,
      59,
      59,
      999
    );

    const journals =
      await Journal.countDocuments({
        tenantId,
        createdAt: {
          $gte: start,
          $lte: end
        }
      });

    const transactions =
      await Transaction.countDocuments({
        tenantId,
        createdAt: {
          $gte: start,
          $lte: end
        }
      });

    const unreconciled =
      await Journal.countDocuments({
        tenantId,
        reconciliationStatus:
          {
            $ne:
              'RECONCILED'
          }
      });

    return {
      tenantId,
      date,
      journals,
      transactions,
      unreconciled,
      generatedAt:
        new Date()
    };
  };

