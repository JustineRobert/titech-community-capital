'use strict';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// controllers/repaymentsController.js
exports.createRepayment = async (req, res) => {
  const { saccoId, memberId, amount } = req.body;
  const entry = await LedgerEntry.create({
    saccoId,
    debitAccount: `Loan:${memberId}`,
    creditAccount: `GroupWallet:${saccoId}`,
    amount,
    reference: `REPAY-${Date.now()}`
  });
  await AuditLog.create({ action: "REPAYMENT", actorId: memberId, saccoId, endpoint: req.originalUrl, payload: req.body });
  res.status(202).json({ success: true, entry });
};
