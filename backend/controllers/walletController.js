// Wallet Controller (controllers/walletController.js)
const Wallet = require("../models/Wallet");

exports.getBalance = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.id, tenantId: req.user.tenantId });
    res.json({
      balance: wallet ? wallet.availableBalance : 0,
      currency: wallet ? wallet.currency : "UGX"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

