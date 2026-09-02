// controllers/transaction.controller.js
"use strict";

const { createTransaction } = require("../modules/transaction/transaction.service");

/**
 * Deposit Controller
 * - Creates a deposit transaction
 * - Enforces tenant context and idempotency
 */
exports.deposit = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const transaction = await createTransaction({
      tenantId: req.tenantId,
      type: "deposit",
      amount,
      idempotencyKey: req.headers["idempotency-key"],
    });

    return res.json(transaction);
  } catch (error) {
    console.error("[TransactionController] Deposit error:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
