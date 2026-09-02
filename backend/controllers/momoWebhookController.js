// controllers/momoWebhookController.js
// Production-ready webhook handler for MoMo notifications.
// Exports a named handler `momoCallback` expected by routes/momoRoutes.js

const mongoose = require("mongoose");
const { randomUUID } = require('crypto');
const LedgerEntry = require("../models/LedgerEntry");
const Transaction = require("../models/Transaction");

/**
 * Generate a short error id for logs and responses.
 */
function makeErrorId() {
  return randomUUID();
}

/**
 * Check mongoose connection readiness.
 * readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 */
function isDbReady() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

/**
 * momoCallback
 *
 * POST /webhook
 * - Validates payload minimally.
 * - Performs idempotency checks against momoTransactionId and reference.
 * - Creates a LedgerEntry and optionally a Transaction record.
 * - Returns 503 when DB is not ready so callers can retry.
 */
async function momoCallback(req, res) {
  const errorId = makeErrorId();

  try {
    if (!isDbReady()) {
      req.log && req.log.warn && req.log.warn({ errorId }, "DB not ready for webhook processing");
      return res.status(503).json({ message: "Service temporarily unavailable", errorId });
    }

    const payload = req.body || {};

    // Normalize common provider fields
    const momoTransactionId = payload.momoTransactionId || payload.financialTransactionId || null;
    const reference = payload.reference || payload.externalReference || null;
    const amount = payload.amount || payload.value || payload.transactionAmount;
    const currency = (payload.currency || payload.currencyCode || "UGX").toUpperCase();
    const account = payload.account || payload.accountId || payload.destinationAccount;
    const transactionId = payload.transaction || payload.transactionId || null;
    const type = payload.type || "CREDIT";
    const tenantId = payload.tenantId || payload.saccoId || null;
    const description = payload.description || payload.note || null;
    const metadata = payload.metadata || {};

    // Basic validation
    if (!momoTransactionId && !reference) {
      return res.status(400).json({
        message: "Either momoTransactionId (or financialTransactionId) or reference is required for idempotency",
      });
    }
    if (!amount) return res.status(400).json({ message: "amount is required" });
    if (!account) return res.status(400).json({ message: "account is required" });
    if (!tenantId) return res.status(400).json({ message: "tenantId is required" });

    // Idempotency check: prefer LedgerEntry, fallback to Transaction
    const idempotencyQuery = { $or: [] };
    if (momoTransactionId) idempotencyQuery.$or.push({ momoTransactionId });
    if (reference) idempotencyQuery.$or.push({ reference });

    if (idempotencyQuery.$or.length > 0) {
      const existingEntry = await LedgerEntry.findOne(idempotencyQuery).lean().exec();
      if (existingEntry) {
        return res.status(200).json({
          message: "Already processed (ledger entry)",
          existingId: existingEntry._id,
        });
      }

      const existingTx = await Transaction.findOne(idempotencyQuery).lean().exec();
      if (existingTx) {
        return res.status(200).json({
          message: "Already processed (transaction)",
          existingTransactionId: existingTx._id,
        });
      }
    }

    // Prepare ledger document
    const ledgerDoc = {
      account,
      transaction: transactionId || undefined,
      type: type === "DEBIT" ? "DEBIT" : "CREDIT",
      amount:
        typeof amount === "object" && amount._bsontype === "Decimal128"
          ? amount
          : mongoose.Types.Decimal128.fromString(String(amount)),
      currency,
      tenantId,
      description,
      reference: reference || undefined,
      momoTransactionId: momoTransactionId || undefined,
      metadata,
    };

    const created = await LedgerEntry.create(ledgerDoc);

    // Optionally create a Transaction record (non-blocking)
    try {
      if (!transactionId && momoTransactionId) {
        await Transaction.create({
          tenantId,
          momoTransactionId,
          reference: reference || undefined,
          amount: mongoose.Types.Decimal128.fromString(String(amount)),
          currency,
          status: "COMPLETED",
          metadata: { createdFrom: "momoWebhook", ...metadata },
        });
      }
    } catch (txErr) {
      req.log && req.log.warn && req.log.warn({ txErr, errorId }, "Transaction create warning");
    }

    return res.status(201).json({
      message: "Ledger entry created",
      id: created._id,
    });
  } catch (err) {
    const eid = makeErrorId();
    if (req.log && req.log.error) {
      req.log.error({ err, eid }, "Unhandled error in momo webhook");
    } else {
      console.error("Unhandled error in momo webhook", { eid, err });
    }

    if (err && err.name === "MongooseError" && /buffering timed out/i.test(err.message)) {
      return res.status(503).json({ message: "Database not ready", errorId: eid });
    }

    return res.status(500).json({ message: "Internal server error", errorId: eid });
  }
}

/**
 * Export named handler expected by routes/momoRoutes.js
 */
module.exports = {
  momoCallback,
};
