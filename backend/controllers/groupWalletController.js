// controllers/groupWalletController.js
const { LedgerEntry } = require("../models");

exports.getBalance = async (req, res) => {
  const { id } = req.params;
  const entries = await LedgerEntry.findAll({ where: { saccoId: id } });
  const balance = entries.reduce((acc, e) => {
    if (e.creditAccount.startsWith("GroupWallet")) acc += parseFloat(e.amount);
    if (e.debitAccount.startsWith("GroupWallet")) acc -= parseFloat(e.amount);
    return acc;
  }, 0);
  res.json({ saccoId: id, balance });
};

exports.getLedger = async (req, res) => {
  const { id } = req.params;
  const entries = await LedgerEntry.findAll({ where: { saccoId: id }, order: [["createdAt", "DESC"]] });
  res.json(entries);
};
