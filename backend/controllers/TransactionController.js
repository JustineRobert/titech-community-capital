import {
  createTransaction,
  postEntries,
  finalize,
  reverse,
} from '../services/ledgerService.js';

export const deposit = async (req, res) => {
  try {
    const { amount, accountId } = req.body;

    const txn = await createTransaction({
      type: 'deposit',
      amount,
      tenantId: req.headers['x-tenant-id'],
    });

    await postEntries(txn._id, [
      { accountId: 'momo_clearing', type: 'debit', amount },
      { accountId, type: 'credit', amount },
    ]);

    await finalize(txn._id);

    res.json({ success: true, txnId: txn._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};