// ============================================================================
// TITech Community Capital – Repayment Service
// File: backend/modules/finance/services/repaymentService.js
// Production-grade
// ============================================================================

'use strict';

const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Wallet = require('../models/Wallet');
const LedgerEntry = require('../models/LedgerEntry');
const Journal = require('../models/Journal');
const logger = require('../../../../utils/logger');

const ApiError = require('../../../../errors/ApiError');
const NotFoundError = require('../../../../errors/NotFoundError');
const ConflictError = require('../../../../errors/ConflictError');
const PaymentRequiredError = require('../../../../errors/PaymentRequiredError');
const BadRequestError = require('../../../../errors/BadRequestError');

/**
 * processRepayment
 *
 * Atomic repayment workflow:
 *  - idempotency check (Journal.paymentId)
 *  - debit payer wallet
 *  - apply repayment to loan (balance/status)
 *  - create Journal record
 *  - post double-entry ledger lines (via LedgerEntry.postTransaction) in same session
 *
 * All DB writes occur inside a single mongoose transaction (session).
 *
 * Params:
 *  - tenantId
 *  - loanId
 *  - payerWalletId
 *  - amount
 *  - paymentId (idempotency key) - REQUIRED
 *  - opts: {
 *      currency,
 *      debitAccountCode,
 *      creditAccountCode,
 *      description,
 *      requestId,
 *      provider,
 *      momoTransactionId,
 *      metadata,
 *      createdBy
 *    }
 *
 * Returns:
 *  { idempotent: boolean, journalId, ledgerEntryIds }
 */
async function processRepayment({ tenantId, loanId, payerWalletId, amount, paymentId, opts = {} }) {
  // Basic validation
  if (!paymentId || String(paymentId).trim() === '') {
    throw new BadRequestError('paymentId required for idempotency');
  }
  if (!tenantId) throw new BadRequestError('tenantId is required');
  if (!loanId) throw new BadRequestError('loanId is required');
  if (!payerWalletId) throw new BadRequestError('payerWalletId is required');

  const repayment = Number(amount);
  if (!Number.isFinite(repayment) || repayment <= 0) {
    throw new BadRequestError('Invalid repayment amount');
  }

  const currency = (opts.currency || 'UGX').toString().toUpperCase();
  const debitAccountCode = opts.debitAccountCode || 'CASH';
  const creditAccountCode = opts.creditAccountCode || 'LOAN_RECEIVABLE';

  const session = await mongoose.startSession();

  try {
    let result = null;

    // Use withTransaction to ensure commit/abort semantics and retry on transient errors
    await session.withTransaction(async () => {
      // 1) Idempotency check (tenant scoped)
      const existingJournal = await Journal.findOne({ tenantId, paymentId }).session(session);
      if (existingJournal) {
        // Idempotent: return existing journal reference (no error)
        logger.info('Repayment idempotency hit - returning existing journal', { tenantId, paymentId, journalId: existingJournal._id });
        result = { idempotent: true, journalId: existingJournal._id, ledgerEntryIds: existingJournal.ledgerEntryIds || [] };
        return;
      }

      // 2) Load loan and wallet within session
      const loan = await Loan.findOne({ _id: loanId, tenantId }).session(session);
      if (!loan) throw new NotFoundError('Loan not found');

      if (!['ACTIVE', 'APPROVED'].includes(loan.status)) {
        throw new BadRequestError('Loan not active for repayment', { status: loan.status });
      }

      const wallet = await Wallet.findOne({ _id: payerWalletId, tenantId }).session(session);
      if (!wallet) throw new NotFoundError('Payer wallet not found');

      // 3) Debit payer wallet (atomic). Wallet.debit must accept session.
      try {
        await wallet.debit(repayment, { session });
      } catch (err) {
        // Map to domain error
        throw new PaymentRequiredError(err.message || 'Insufficient wallet balance');
      }

      // 4) Apply repayment to loan (graceful edge cases)
      // Use numeric arithmetic on JS numbers because Loan getters/setters handle Decimal128 conversion
      const newBalance = Math.max(Number(loan.balance) - repayment, 0);
      loan.balance = newBalance;
      if (newBalance === 0) loan.status = 'COMPLETED';
      await loan.save({ session });

      // 5) Create Journal (placeholder) within session
      const journalDoc = await Journal.create(
        [
          {
            tenantId,
            referenceType: 'LoanRepayment',
            referenceId: loan._id,
            description: opts.description || `Repayment for loan ${loan._id}`,
            amount: mongoose.Types.Decimal128.fromString(repayment.toFixed(2)),
            currency,
            paymentId,
            provider: opts.provider || null,
            momoTransactionId: opts.momoTransactionId || null,
            createdBy: opts.createdBy || null,
            metadata: opts.metadata || {},
            journalType: 'LOAN_REPAYMENT',
            status: 'POSTED',
          },
        ],
        { session }
      );

      const journal = journalDoc[0];

      // 6) Post double-entry ledger lines within same session
      // Debit: CASH (increase asset)
      // Credit: LOAN_RECEIVABLE (decrease receivable)
      const ledgerEntries = await LedgerEntry.postTransaction(
        {
          tenantId,
          debitAccountCode,
          creditAccountCode,
          amount: repayment,
          currency,
          referenceType: 'LoanRepayment',
          referenceId: loan._id,
          description: opts.description || `Loan repayment ${paymentId}`,
          requestId: opts.requestId || null,
          provider: opts.provider || null,
          momoTransactionId: opts.momoTransactionId || null,
          metadata: { paymentId, ...opts.metadata },
          journalId: journal._id,
        },
        { session }
      );

      // 7) Link ledger entries to journal and save
      journal.ledgerEntryIds = ledgerEntries.map((d) => d._id);
      await journal.save({ session });

      // 8) Prepare result
      result = { idempotent: false, journalId: journal._id, ledgerEntryIds: journal.ledgerEntryIds };
      logger.info('Repayment transaction prepared (will commit)', { tenantId, loanId, payerWalletId, amount: repayment, paymentId, journalId: journal._id });
    }, {
      // Optional transaction options: read/write concern can be set here if needed
      readPreference: 'primary',
      readConcern: { level: 'local' },
      writeConcern: { w: 'majority' },
    });

    // If result is null something unexpected happened
    if (!result) {
      throw ApiError.internal('Repayment transaction did not complete');
    }

    // Success
    return result;
  } catch (err) {
    // Map known ApiError through, otherwise wrap
    if (err instanceof ApiError) {
      throw err;
    }

    // If mongoose transaction aborted due to our thrown ApiError, rethrow
    if (err && err.name && err.name === 'MongoError' && err.code === 11000) {
      // Unique index violation (possible idempotency race)
      throw new ConflictError('Duplicate payment detected', { raw: err.message });
    }

    // Wrap unknown errors
    logger.error('Unexpected error in processRepayment', { error: err?.message || err, tenantId, loanId, paymentId });
    throw ApiError.from(err);
  } finally {
    try {
      session.endSession();
    } catch (e) {
      // best-effort cleanup
      logger.warn('Failed to end mongoose session cleanly', { error: e?.message || e });
    }
  }
}

module.exports = { processRepayment };
