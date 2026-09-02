// backend/modules/finance/services/TransactionService.js
const Transaction = require('../models/Transaction');
const LedgerEntry = require('../models/LedgerEntry');

class TransactionService {
  static async postTransaction(transactionId) {
    const tx = await Transaction.findById(transactionId);

    if (!tx) throw new Error('Transaction not found');
    if (tx.status === 'POSTED') return tx;

    // ✅ Mark as posted
    tx.status = 'POSTED';
    await tx.save();

    // ✅ Create ledger entries (double-entry)
    await LedgerEntry.postTransaction({
      tenantId: tx.tenantId,
      transactionId: tx._id,
      debitAccountId: tx.debitAccountId,
      creditAccountId: tx.creditAccountId,
      amount: tx.amount,
      currency: tx.currency,
      reference: tx.reference,
      description: tx.description,
      requestId: tx.requestId,
      provider: tx.provider,
      momoTransactionId: tx.momoTransactionId,
    });

    return tx;
  }
}

module.exports = TransactionService;