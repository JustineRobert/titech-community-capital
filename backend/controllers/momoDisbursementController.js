// Disbursement (Withdraw) (controllers/momoDisbursementController.js)

const axios = require("axios");
const { randomUUID } = require('crypto');
const Transaction = require("../models/Transaction");
const { getMomoToken } = require("../services/momoTokenService");

exports.disburse = async (req, res) => {
  try {
    const token = await getMomoToken();
    const referenceId = randomUUID();

    await Transaction.create({
      userId: req.user.id,
      type: "WITHDRAW",
      amount: req.body.amount,
      phone: req.body.phone,
      externalId: referenceId
    });

    await axios.post(
      `${process.env.MOMO_BASE_URL}/disbursement/v1_0/transfer`,
      {
        amount: req.body.amount,
        currency: "UGX",
        externalId: referenceId,
        payee: { partyIdType: "MSISDN", partyId: req.body.phone },
        payerMessage: "Withdrawal",
        payeeNote: "Savings withdrawal"
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": process.env.MOMO_ENV,
          "Ocp-Apim-Subscription-Key":
            process.env.DISBURSEMENT_SUBSCRIPTION_KEY
        }
      }
    );

    res.json({ referenceId, status: "PENDING" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
