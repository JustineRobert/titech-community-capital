// controllers/momoCallback.controller.js
"use strict";

const { createTransaction } = require("../transaction/transaction.service");
const logger = require("../utils/logger") || console;

/**
 * Handle MoMo Callback
 * - Validates payload
 * - Processes only successful transactions
 * - Enforces idempotency via externalId
 */
exports.handleMomoCallback = async (req, res) => {
  try {
    const { status, externalId, amount } = req.body;

    if (!externalId || !amount) {
      logger.warn("[MoMoCallback] Missing required fields", { body: req.body });
      return res.status(400).json({ error: "Invalid callback payload" });
    }

    if (status !== "SUCCESSFUL") {
      logger.info("[MoMoCallback] Ignored non-successful callback", {
        externalId,
        status,
      });
      return res.status(200).send("Ignored");
    }

    await createTransaction({
      tenantId: req.tenantId,
      type: "deposit",
      amount,
      idempotencyKey: externalId,
    });

    logger.info("[MoMoCallback] Processed successful deposit", {
      tenantId: req.tenantId,
      externalId,
      amount,
    });

    return res.status(200).send("Processed");
  } catch (error) {
    logger.error("[MoMoCallback] Error processing callback", {
      error: error.message,
      body: req.body,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
};
