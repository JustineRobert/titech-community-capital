// backend/modules/finance/middleware/validateLoan.js
'use strict';

exports.createLoan = (req, res, next) => {
  const { principal, interestRate, termMonths } = req.body;

  if (!principal || principal <= 0)
    return res.status(400).json({ error: 'Invalid principal' });

  if (!interestRate)
    return res.status(400).json({ error: 'Interest rate required' });

  if (!termMonths)
    return res.status(400).json({ error: 'Loan term required' });

  next();
};

exports.disburseLoan = (req, res, next) => {
  const { cashAccountId, loanAccountId } = req.body;

  if (!cashAccountId || !loanAccountId)
    return res.status(400).json({ error: 'Account IDs required' });

  next();
};

exports.repayLoan = (req, res, next) => {
  const { amount } = req.body;

  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid repayment amount' });

  next();
};