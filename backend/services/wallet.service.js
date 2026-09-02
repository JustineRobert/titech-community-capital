// services/walletService.js

const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const ledgerService = require("./ledgerService");
const logger = require("../utils/logger"); // Winston logger

/**
 * Utility: retry with exponential backoff + structured logging
 *
 * @param {Function} fn - async function to execute
 * @param {String} requestId - correlation ID for tracing
 * @param {Number} retries - max retry attempts
 * @param {Number} delay - initial delay in ms
 */
async function retryWithBackoff(fn, requestId, retries = 5, delay = 200) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      logger.info(`Attempt ${attempt + 1} of ${retries}`, { requestId });
      return await fn();
    } catch (err) {
      attempt++;
      logger.warn(`Attempt ${attempt} failed: ${err.message}`, { requestId });
      if (attempt >= retries) {
        logger.error(`All ${retries} attempts failed`, { requestId });
        throw err;
      }
      const backoff = delay * Math.pow(2, attempt);
      logger.info(`Retrying after ${backoff}ms`, { requestId });
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Credit a user's wallet with atomic transaction + retry + logging
 */
exports.creditWallet = async ({ userId, tenantId, amount, requestId }) => {
  return retryWithBackoff(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info(`Starting creditWallet transaction`, { requestId, userId, tenantId, amount });

      const wallet = await Wallet.findOne({ userId, tenantId }).session(session);
      if (!wallet) throw new Error("Wallet not found");

      wallet.balance = parseFloat(wallet.balance.toString()) + amount;
      await wallet.save({ session });
      logger.info(`Wallet credited successfully`, { requestId, userId, newBalance: wallet.balance });

      // 🔹 Ledger entry: MoMo pool → User wallet
      await ledgerService.recordEntry({
        tenantId,
        debit: "MOMO_POOL",
        credit: userId.toString(),
        amount,
        ref: `deposit:${Date.now()}`,
        requestId,
      });
      logger.info(`Ledger entry recorded for deposit`, { requestId, userId });

      await session.commitTransaction();
      logger.info(`Transaction committed`, { requestId, userId });
      return wallet;
    } catch (err) {
      await session.abortTransaction();
      logger.error(`Transaction aborted: ${err.message}`, { requestId, userId });
      throw err;
    } finally {
      session.endSession();
      logger.debug(`Session ended`, { requestId, userId });
    }
  }, requestId);
};

/**
 * Debit a user's wallet with atomic transaction + retry + logging
 */
exports.debitWallet = async ({ userId, tenantId, amount, requestId }) => {
  return retryWithBackoff(async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      logger.info(`Starting debitWallet transaction`, { requestId, userId, tenantId, amount });

      const wallet = await Wallet.findOne({ userId, tenantId }).session(session);
      if (!wallet) throw new Error("Wallet not found");

      if (parseFloat(wallet.balance.toString()) < amount) {
        throw new Error("Insufficient funds");
      }

      wallet.balance = parseFloat(wallet.balance.toString()) - amount;
      await wallet.save({ session });
      logger.info(`Wallet debited successfully`, { requestId, userId, newBalance: wallet.balance });

      // 🔹 Ledger entry: User wallet → MoMo pool
      await ledgerService.recordEntry({
        tenantId,
        debit: userId.toString(),
        credit: "MOMO_POOL",
        amount,
        ref: `withdrawal:${Date.now()}`,
        requestId,
      });
      logger.info(`Ledger entry recorded for withdrawal`, { requestId, userId });

      await session.commitTransaction();
      logger.info(`Transaction committed`, { requestId, userId });
      return wallet;
    } catch (err) {
      await session.abortTransaction();
      logger.error(`Transaction aborted: ${err.message}`, { requestId, userId });
      throw err;
    } finally {
      session.endSession();
      logger.debug(`Session ended`, { requestId, userId });
    }
  }, requestId);
};
