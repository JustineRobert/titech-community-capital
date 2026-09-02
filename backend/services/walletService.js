// ============================================================================
// TITech Community Capital
// Enterprise Wallet Service
// File: backend/services/walletService.js
// Production Grade
// ============================================================================

"use strict";

const crypto = require("crypto");
const EventEmitter = require("events");

const logger = require("../utils/logger");
const metrics = require("./metricsService");
const auditService = require('./auditService');

let Wallet;
let Transaction;
let User;
let SavingsAccount;
let NotificationService;
let MobileMoneySettlementService;

try {
  Wallet = require("../models/Wallet");
} catch (_) {}

try {
  Transaction =
    require("../models/Transaction");
} catch (_) {}

try {
  User = require("../models/User");
} catch (_) {}

try {
  SavingsAccount =
    require("../models/SavingsAccount");
} catch (_) {}

try {
  NotificationService =
    require("./notificationService");
} catch (_) {}

try {
  MobileMoneySettlementService =
    require("./mobileMoneySettlementService");
} catch (_) {}

class WalletService extends EventEmitter {
  constructor() {
    super();

    this.cache =
      new Map();

    this.LOCKS =
      new Map();
  }

  // ===========================================================================
  // Wallet Retrieval
  // ===========================================================================

  async getWallet(
    userId,
    tenantId
  ) {
    try {
      const cacheKey =
        `${tenantId}:${userId}`;

      if (
        this.cache.has(
          cacheKey
        )
      ) {
        return this.cache.get(
          cacheKey
        );
      }

      const wallet =
        await Wallet.findOne({
          userId: userId,
          tenantId:
            tenantId,
        });

      if (wallet) {
        this.cache.set(
          cacheKey,
          wallet
        );
      }

      return wallet;
    } catch (error) {
      logger.error(
        "Wallet lookup failed",
        {
          userId,
          tenantId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Create Wallet
  // ===========================================================================

  async createWallet(
    payload
  ) {
    const {
      userId,
      tenantId,
      currency = "UGX",
    } = payload;

    try {
      const existing =
        await this.getWallet(
          userId,
          tenantId
        );

      if (existing) {
        return existing;
      }

      const wallet =
        await Wallet.create({
          userId: userId,
          tenantId:
            tenantId,
          balance: 0,
          currency,
          walletNumber:
            this.generateWalletNumber(),
          status:
            "active",
        });

      metrics.increment(
        "wallet.created"
      );

      logger.info(
        "Wallet created",
        {
          walletId:
            wallet._id,
          userId,
          tenantId,
        }
      );

      return wallet;
    } catch (error) {
      logger.error(
        "Wallet creation failed",
        {
          userId,
          tenantId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Deposit
  // ===========================================================================

  async deposit({
    walletId,
    amount,
    reference,
    channel =
      "SYSTEM",
    metadata = {},
  }) {
    return this.executeLocked(
      walletId,
      async () => {
        const wallet =
          await Wallet.findById(
            walletId
          );

        if (!wallet) {
          throw new Error(
            "Wallet not found"
          );
        }

        const previous =
          wallet.balance;

        wallet.balance =
          Number(
            wallet.balance
          ) + Number(amount);

        await wallet.save();

        await this.recordTransaction(
          {
            wallet,
            type:
              "CREDIT",
            amount,
            reference,
            channel,
            metadata,
            balanceBefore:
              previous,
            balanceAfter:
              wallet.balance,
          }
        );

        metrics.increment(
          "wallet.deposit.success"
        );

        // Audit log
        try {
          await auditService.logAction({ action: 'wallet:deposit', userId: wallet.user, tenantId: wallet.tenant, entityType: 'Wallet', entityId: wallet._id, metadata: { amount, reference } });
        } catch (e) {
          logger.error('Failed to write audit for wallet.deposit', { error: e.message });
        }

        this.emit(
          "wallet.deposit",
          {
            walletId,
            amount,
          }
        );

        return wallet;
      }
    );
  }

  // ===========================================================================
  // Withdraw
  // ===========================================================================

  async withdraw({
    walletId,
    amount,
    reference,
    channel =
      "SYSTEM",
    metadata = {},
  }) {
    return this.executeLocked(
      walletId,
      async () => {
        const wallet =
          await Wallet.findById(
            walletId
          );

        if (!wallet) {
          throw new Error(
            "Wallet not found"
          );
        }

        if (
          Number(
            wallet.balance
          ) < Number(amount)
        ) {
          throw new Error(
            "Insufficient balance"
          );
        }

        const previous =
          wallet.balance;

        wallet.balance =
          Number(
            wallet.balance
          ) - Number(amount);

        await wallet.save();

        await this.recordTransaction(
          {
            wallet,
            type:
              "DEBIT",
            amount,
            reference,
            channel,
            metadata,
            balanceBefore:
              previous,
            balanceAfter:
              wallet.balance,
          }
        );

        metrics.increment(
          "wallet.withdraw.success"
        );

        try {
          await auditService.logAction({ action: 'wallet:withdraw', userId: wallet.user, tenantId: wallet.tenant, entityType: 'Wallet', entityId: wallet._id, metadata: { amount, reference } });
        } catch (e) {
          logger.error('Failed to write audit for wallet.withdraw', { error: e.message });
        }

        this.emit(
          "wallet.withdraw",
          {
            walletId,
            amount,
          }
        );

        return wallet;
      }
    );
  }

  // ===========================================================================
  // Transfer
  // ===========================================================================

  async transfer({
    fromWalletId,
    toWalletId,
    amount,
    reference,
    metadata = {},
  }) {
    const transactionId =
      crypto.randomUUID();

    await this.withdraw({
      walletId:
        fromWalletId,
      amount,
      reference:
        reference ||
        transactionId,
      channel:
        "TRANSFER",
      metadata,
    });

    await this.deposit({
      walletId:
        toWalletId,
      amount,
      reference:
        reference ||
        transactionId,
      channel:
        "TRANSFER",
      metadata,
    });

    metrics.increment(
      "wallet.transfer.success"
    );

    try {
      await auditService.logAction({ action: 'wallet:transfer', userId: null, tenantId: null, entityType: 'Wallet', entityId: null, metadata: { fromWalletId, toWalletId, amount, reference } });
    } catch (e) {
      logger.error('Failed to write audit for wallet.transfer', { error: e.message });
    }

    return {
      transactionId,
      success: true,
    };
  }

  // ===========================================================================
  // Mobile Money Funding
  // ===========================================================================

  async fundFromMobileMoney(
    payload
  ) {
    if (
      !MobileMoneySettlementService
    ) {
      throw new Error(
        "Mobile money service unavailable"
      );
    }

    const settlement =
      await MobileMoneySettlementService.recordSettlement(
        payload
      );

    await this.deposit({
      walletId:
        payload.walletId,
      amount:
        payload.amount,
      reference:
        settlement.reference,
      channel:
        "MOBILE_MONEY",
      metadata:
        settlement,
    });

    return settlement;
  }

  // ===========================================================================
  // Savings Deposit
  // ===========================================================================

  async transferToSavings(
    payload
  ) {
    const {
      walletId,
      savingsAccountId,
      amount,
    } = payload;

    await this.withdraw({
      walletId,
      amount,
      channel:
        "SAVINGS",
    });

    if (
      SavingsAccount?.credit
    ) {
      await SavingsAccount.credit(
        savingsAccountId,
        amount
      );
    }

    metrics.increment(
      "wallet.savings.transfer"
    );

    return {
      success: true,
    };
  }

  // ===========================================================================
  // Transactions
  // ===========================================================================

  async recordTransaction(
    payload
  ) {
    if (
      !Transaction
    ) {
      return;
    }

    await Transaction.create({
      wallet:
        payload.wallet._id,
      tenant:
        payload.wallet.tenant,
      user:
        payload.wallet.user,
      type:
        payload.type,
      amount:
        payload.amount,
      reference:
        payload.reference,
      channel:
        payload.channel,
      metadata:
        payload.metadata,
      balanceBefore:
        payload.balanceBefore,
      balanceAfter:
        payload.balanceAfter,
      status:
        "SUCCESS",
      createdAt:
        new Date(),
    });
    // Audit log for recorded transaction
    try {
      await auditService.logAction({ action: 'wallet:record_transaction', userId: payload.wallet.user, tenantId: payload.wallet.tenant, entityType: 'Transaction', entityId: null, metadata: { type: payload.type, amount: payload.amount, reference: payload.reference } });
    } catch (e) {
      logger.error('Failed to write audit for wallet.recordTransaction', { error: e.message });
    }
  }

  // ===========================================================================
  // Balance
  // ===========================================================================

  async getBalance(
    walletId
  ) {
    const wallet =
      await Wallet.findById(
        walletId
      );

    if (!wallet) {
      throw new Error(
        "Wallet not found"
      );
    }

    return {
      walletId,
      balance:
        wallet.balance,
      currency:
        wallet.currency,
    };
  }

  async getBalanceByUser(userId, tenantId) {
    const wallet = await Wallet.findOne({ userId: userId, tenantId: tenantId });
    if (!wallet) throw new Error('Wallet not found for user');
    return { walletId: wallet._id, balance: wallet.balance, currency: wallet.currency };
  }

  // ===========================================================================
  // Locking
  // ===========================================================================

  async executeLocked(
    key,
    fn
  ) {
    while (
      this.LOCKS.get(key)
    ) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            50
          )
      );
    }

    this.LOCKS.set(
      key,
      true
    );

    try {
      return await fn();
    } finally {
      this.LOCKS.delete(
        key
      );
    }
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  async notify(
    userId,
    message
  ) {
    try {
      if (
        NotificationService?.send
      ) {
        await NotificationService.send(
          {
            userId,
            message,
          }
        );
      }
    } catch (error) {
      logger.error(
        "Wallet notification failed",
        {
          userId,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Wallet Number Generator
  // ===========================================================================

  generateWalletNumber() {
    return `WAL-${Date.now()}-${Math.floor(
      Math.random() *
        100000
    )}`;
  }

  // ===========================================================================
  // Health
  // ===========================================================================

  async health() {
    return {
      service:
        "wallet-service",
      status:
        "healthy",
      cacheSize:
        this.cache.size,
      activeLocks:
        this.LOCKS.size,
      uptime:
        process.uptime(),
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new WalletService();