import LedgerEntry from '../models/LedgerEntry.js';

export async function getBalance(req, res) {
  const { id } = req.params;
  const entries = await LedgerEntry.findAll({ where: { saccoId: id } });
  const balance = entries.reduce((acc, e) => {
    if (e.creditAccount.startsWith("GroupWallet")) acc += parseFloat(e.amount);
    if (e.debitAccount.startsWith("GroupWallet")) acc -= parseFloat(e.amount);
    return acc;
  }, 0);
  res.json({ saccoId: id, balance });
}

export async function getLedger(req, res) {
  const { id } = req.params;
  const entries = await LedgerEntry.findAll({ where: { saccoId: id }, order: [["createdAt", "DESC"]] });
  res.json(entries);
}

export default { getBalance, getLedger };
