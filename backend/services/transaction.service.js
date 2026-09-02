// services/transaction.service.js
// Production-ready transaction service (Mongoose + Ledger integration)

const Transaction = require("../models/Transaction");
const walletService = require("./wallet.service");
const ledgerService = require("./ledger.service");
const generateReference = require("../utils/generateReference");
const logger = require("../utils/logger"); // optional structured logger

// Example account identifiers — in production these should be resolved dynamically
// (e.g., from configuration, tenant chart of accounts, or an Accounts service).
const DEFAULT_CASH_ACCOUNT = process.env.CASH_ACCOUNT_ID || "CASH_ACCOUNT_ID";
const DEFAULT_USER_WALLET_ACCOUNT = process.env.USER_WALLET_ACCOUNT_ID || "USER_WALLET_ACCOUNT_ID";

/**
 * Create a deposit transaction (idempotent by reference)
 * data: { user, amount, currency?, tenantId, metadata?, reference? }
 */
exports.createDeposit = async (data = {}) => {
  const reference = data.reference || generateReference();

  // Idempotency: if a transaction with same reference exists, return it
  const existing = await Transaction.findOne({ reference }).exec();
  if (existing) return existing;

  const tx = new Transaction({
    ...data,
    type: "DEPOSIT",
    flow: "credit",
    status: "PENDING",
    reference,
  });

  await tx.save();
  return tx;
};

/**
 * Create a withdraw transaction (idempotent by reference)
 * data: { user, amount, currency?, tenantId, metadata?, reference? }
 */
exports.createWithdraw = async (data = {}) => {
  const reference = data.reference || generateReference();

  // Idempotency: if a transaction with same reference exists, return it
  const existing = await Transaction.findOne({ reference }).exec();
  if (existing) return existing;

  const tx = new Transaction({
    ...data,
    type: "WITHDRAW",
    flow: "debit",
    status: "PENDING",
    reference,
  });

  await tx.save();
  return tx;
};

/**
 * Process a successful transaction.
 *
 * Responsibilities:
 *  - Idempotent: no-op if already SUCCESSFUL
 *  - Create balanced ledger entries (double-entry)
 *  - Update user wallet (credit or debit depending on flow)
 *  - Mark transaction as SUCCESSFUL and persist metadata/audit info
 *
 * transaction: Mongoose document or plain object with at least:
 *   _id, amount, flow, user, tenantId, currency, reference, status
 */
exports.processSuccessfulTransaction = async (transaction) => {
  if (!transaction) throw new Error("transaction is required");

  // If passed a plain object, re-fetch to get a document instance and latest state
  let txDoc = transaction;
  if (!transaction.save) {
    txDoc = await Transaction.findById(transaction._id).exec();
    if (!txDoc) throw new Error("transaction not found");
  }

  if (txDoc.status === "SUCCESSFUL") {
    logger?.info?.("Transaction already successful", { transactionId: txDoc._id, reference: txDoc.reference });
    return txDoc;
  }

  // Ensure amount is positive and present
  const amount = txDoc.amount;
  if (amount == null || Number(amount) <= 0) {
    throw new Error("transaction amount must be a positive number");
  }

  // Determine accounts for ledger entries. In production these should be resolved per-tenant.
  const cashAccount = txDoc.metadata?.cashAccount || DEFAULT_CASH_ACCOUNT;
  const userWalletAccount = txDoc.metadata?.userWalletAccount || DEFAULT_USER_WALLET_ACCOUNT;

  // Build ledger entries depending on transaction flow.
  // For a credit flow (e.g., deposit): Cash (DEBIT) / User Wallet (CREDIT)
  // For a debit flow (e.g., withdrawal): User Wallet (DEBIT) / Cash (CREDIT)
  const entries =
    txDoc.flow === "credit"
      ? [
          { account: cashAccount, type: "DEBIT", amount, currency: txDoc.currency || "UGX", tenantId: txDoc.tenantId },
          { account: userWalletAccount, type: "CREDIT", amount, currency: txDoc.currency || "UGX", tenantId: txDoc.tenantId },
        ]
      : [
          { account: userWalletAccount, type: "DEBIT", amount, currency: txDoc.currency || "UGX", tenantId: txDoc.tenantId },
          { account: cashAccount, type: "CREDIT", amount, currency: txDoc.currency || "UGX", tenantId: txDoc.tenantId },
        ];

  // Create ledger entries (atomicity depends on ledgerService implementation)
  try {
    await ledgerService.createEntries({
      transactionId: txDoc._id,
      tenantId: txDoc.tenantId,
      entries,
    });
  } catch (err) {
    logger?.error?.("Failed to create ledger entries", { err, transactionId: txDoc._id });
    // Do not mark transaction successful if ledger creation fails
    throw err;
  }

  // Update wallet balance (idempotent behavior should be implemented in walletService)
  try {
    if (txDoc.flow === "credit") {
      await walletService.creditWallet(txDoc.user, amount, {
        transactionId: txDoc._id,
        reference: txDoc.reference,
      });
    } else {
      await walletService.debitWallet(txDoc.user, amount, {
        transactionId: txDoc._id,
        reference: txDoc.reference,
      });
    }
  } catch (err) {
    logger?.error?.("Failed to update wallet for transaction", { err, transactionId: txDoc._id });
    // Consider compensating actions or marking transaction as FAILED depending on business rules.
    throw err;
  }

  // Mark transaction as successful and persist
  txDoc.status = "SUCCESSFUL";
  txDoc.metadata = txDoc.metadata || {};
  txDoc.metadata.processedAt = new Date();
  txDoc.metadata.ledgerPosted = true;

  await txDoc.save();

  logger?.info?.("Transaction processed successfully", { transactionId: txDoc._id, reference: txDoc.reference });

  return txDoc;
};

/**
 * Process a failed transaction.
 * Marks transaction as FAILED and records failure reason in metadata.
 */
exports.processFailedTransaction = async (transaction, reason) => {
  if (!transaction) throw new Error("transaction is required");

  let txDoc = transaction;
  if (!transaction.save) {
    txDoc = await Transaction.findById(transaction._id).exec();
    if (!txDoc) throw new Error("transaction not found");
  }

  // If already successful, do not mark as failed
  if (txDoc.status === "SUCCESSFUL") {
    logger?.warn?.("Attempted to mark a successful transaction as failed", { transactionId: txDoc._id });
    return txDoc;
  }

  txDoc.status = "FAILED";
  txDoc.metadata = txDoc.metadata || {};
  txDoc.metadata.failureReason = reason || "unknown";
  txDoc.metadata.failedAt = new Date();

  await txDoc.save();

  logger?.info?.("Transaction marked as failed", { transactionId: txDoc._id, reason });

  return txDoc;
};
