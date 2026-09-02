// backend/modules/finance/services/writeOffService.js

'use strict';

const mongoose = require('mongoose');

const Loan = require('../../loans/models/Loan');
const Journal = require('../models/Journal');
const Transaction = require('../models/Transaction');

const ledgerService = require('./ledgerService');

/**
 * ---------------------------------------------------------
 * CONSTANTS
 * ---------------------------------------------------------
 */

const WRITE_OFF_TYPES = {
  PARTIAL: 'PARTIAL',
  FULL: 'FULL'
};

const LOAN_STATUS = {
  ACTIVE: 'ACTIVE',
  OVERDUE: 'OVERDUE',
  NON_PERFORMING: 'NON_PERFORMING',
  WRITTEN_OFF: 'WRITTEN_OFF'
};

/**
 * ---------------------------------------------------------
 * VALIDATE LOAN ELIGIBILITY
 * ---------------------------------------------------------
 */

async function validateWriteOffEligibility(
  loan
) {

  if (!loan) {
    throw new Error(
      'Loan not found'
    );
  }

  if (
    loan.status !==
      LOAN_STATUS.NON_PERFORMING &&
    loan.status !==
      LOAN_STATUS.OVERDUE
  ) {
    throw new Error(
      'Loan not eligible for write-off'
    );
  }

  if (
    loan.outstandingBalance <= 0
  ) {
    throw new Error(
      'No outstanding balance'
    );
  }

  return true;
}

/**
 * ---------------------------------------------------------
 * CREATE WRITE-OFF
 * ---------------------------------------------------------
 *
 * Debit:
 * Loan Loss Provision
 *
 * Credit:
 * Loan Receivable
 *
 * IFRS-Compliant
 * Double Entry
 * ---------------------------------------------------------
 */

exports.writeOffLoan =
  async ({
    tenantId,
    loanId,
    amount,
    writeOffType =
      WRITE_OFF_TYPES.FULL,
    provisionAccountId,
    loanReceivableAccountId,
    reason,
    approvedBy,
    createdBy
  }) => {

    const session =
      await mongoose.startSession();

    session.startTransaction();

    try {

      const loan =
        await Loan.findOne({
          _id: loanId,
          tenantId
        }).session(session);

      await validateWriteOffEligibility(
        loan
      );

      const outstanding =
        Number(
          loan.outstandingBalance
        );

      const writeOffAmount =
        amount
          ? Number(amount)
          : outstanding;

      if (
        writeOffAmount >
        outstanding
      ) {
        throw new Error(
          'Write-off exceeds outstanding balance'
        );
      }

      const reference =
        `WO-${loan.loanNumber}-${Date.now()}`;

      const transaction =
        await Transaction.create(
          [
            {
              tenantId,
              reference,
              type:
                'WRITE_OFF',
              amount:
                writeOffAmount,
              description:
                reason,
              status:
                'PENDING',
              createdBy
            }
          ],
          { session }
        );

      const tx =
        transaction[0];

      const journal =
        await ledgerService.createJournal({
          tenantId,
          transactionId:
            tx._id,
          reference,
          description:
            `Loan write-off (${loan.loanNumber})`,
          createdBy,
          entries: [
            {
              accountId:
                provisionAccountId,
              amount:
                writeOffAmount,
              direction:
                'DEBIT',
              entryType:
                'WRITE_OFF'
            },
            {
              accountId:
                loanReceivableAccountId,
              amount:
                writeOffAmount,
              direction:
                'CREDIT',
              entryType:
                'WRITE_OFF'
            }
          ]
        });

      await ledgerService.postJournal(
        journal.journalId,
        approvedBy
      );

      loan.totalWrittenOff =
        Number(
          loan.totalWrittenOff || 0
        ) +
        writeOffAmount;

      loan.outstandingBalance =
        outstanding -
        writeOffAmount;

      if (
        writeOffType ===
          WRITE_OFF_TYPES.FULL ||
        loan.outstandingBalance <= 0
      ) {

        loan.status =
          LOAN_STATUS.WRITTEN_OFF;
      }

      if (!loan.writeOffHistory) {
        loan.writeOffHistory = [];
      }

      loan.writeOffHistory.push({
        amount:
          writeOffAmount,
        type:
          writeOffType,
        reason,
        approvedBy,
        createdBy,
        transactionId:
          tx._id,
        journalId:
          journal.journalId,
        date:
          new Date()
      });

      await loan.save({
        session
      });

      tx.status =
        'POSTED';

      await tx.save({
        session
      });

      await session.commitTransaction();

      return {
        success: true,
        loanId,
        transactionId:
          tx._id,
        journalId:
          journal.journalId,
        writeOffAmount
      };

    } catch (error) {

      await session.abortTransaction();

      throw error;

    } finally {

      session.endSession();

    }
  };

/**
 * ---------------------------------------------------------
 * POST WRITE-OFF RECOVERY
 * ---------------------------------------------------------
 *
 * Recovery after loan
 * has already been written off.
 *
 * Debit:
 * Cash/Bank
 *
 * Credit:
 * Recovery Income
 * ---------------------------------------------------------
 */

exports.recordRecovery =
  async ({
    tenantId,
    loanId,
    amount,
    cashAccountId,
    recoveryIncomeAccountId,
    createdBy
  }) => {

    const loan =
      await Loan.findOne({
        _id: loanId,
        tenantId
      });

    if (!loan) {
      throw new Error(
        'Loan not found'
      );
    }

    if (
      loan.status !==
      LOAN_STATUS.WRITTEN_OFF
    ) {
      throw new Error(
        'Recovery allowed only on written-off loans'
      );
    }

    const reference =
      `REC-${loan.loanNumber}-${Date.now()}`;

    const transaction =
      await Transaction.create({
        tenantId,
        reference,
        amount,
        type:
          'RECOVERY',
        status:
          'PENDING',
        createdBy
      });

    const journal =
      await ledgerService.createJournal({
        tenantId,
        transactionId:
          transaction._id,
        reference,
        description:
          'Written-off loan recovery',
        createdBy,
        entries: [
          {
            accountId:
              cashAccountId,
            amount,
            direction:
              'DEBIT',
            entryType:
              'RECOVERY'
          },
          {
            accountId:
              recoveryIncomeAccountId,
            amount,
            direction:
              'CREDIT',
            entryType:
              'RECOVERY'
          }
        ]
      });

    await ledgerService.postJournal(
      journal.journalId,
      createdBy
    );

    transaction.status =
      'POSTED';

    await transaction.save();

    if (!loan.recoveryHistory) {
      loan.recoveryHistory = [];
    }

    loan.recoveryHistory.push({
      amount,
      transactionId:
        transaction._id,
      journalId:
        journal.journalId,
      recoveredAt:
        new Date()
    });

    await loan.save();

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
 * GET WRITE-OFF PORTFOLIO
 * ---------------------------------------------------------
 */

exports.getWriteOffPortfolio =
  async function (
    tenantId
  ) {

    return Loan.find({
      tenantId,
      status:
        LOAN_STATUS.WRITTEN_OFF
    })
      .select(
        'loanNumber outstandingBalance totalWrittenOff writeOffHistory'
      )
      .sort({
        updatedAt: -1
      });
  };

/**
 * ---------------------------------------------------------
 * GENERATE WRITE-OFF REPORT
 * ---------------------------------------------------------
 */

exports.generateWriteOffReport =
  async function (
    tenantId,
    startDate,
    endDate
  ) {

    const loans =
      await Loan.find({
        tenantId,
        status:
          LOAN_STATUS.WRITTEN_OFF,
        updatedAt: {
          $gte:
            startDate,
          $lte:
            endDate
        }
      });

    let totalWrittenOff = 0;

    for (const loan of loans) {

      totalWrittenOff +=
        Number(
          loan.totalWrittenOff || 0
        );
    }

    return {
      tenantId,
      totalLoans:
        loans.length,
      totalWrittenOff,
      generatedAt:
        new Date(),
      loans
    };
  };