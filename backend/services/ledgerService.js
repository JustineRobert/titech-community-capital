"use strict";

/**
 * ============================================================================
 * Ledger Service
 * Enterprise Double Entry Accounting Engine
 * ============================================================================
 */

const mongoose = require("mongoose");

let LedgerEntry;

try {
  LedgerEntry = require("../models/LedgerEntry");
} catch (err) {
  console.warn(
    "[LedgerService] LedgerEntry model unavailable. Running in degraded mode."
  );
}

class LedgerService {
  /**
   * Create balanced journal entries
   */
  async createJournal({
    journalId,
    description,
    entries = [],
    source = "system",
    sourceId = null,
    tenantId = null,
    userId = null,
    metadata = {},
    session = null,
  }) {
    if (!Array.isArray(entries) || entries.length < 2) {
      throw new Error(
        "Journal requires at least one debit and one credit entry"
      );
    }

    let debitTotal = 0;
    let creditTotal = 0;

    for (const entry of entries) {
      debitTotal += Number(entry.debit || 0);
      creditTotal += Number(entry.credit || 0);
    }

    if (debitTotal !== creditTotal) {
      throw new Error(
        `Journal out of balance. Debit=${debitTotal}, Credit=${creditTotal}`
      );
    }

    if (!LedgerEntry) {
      return {
        success: true,
        degradedMode: true,
        journalId,
      };
    }

    const ledgerEntries = entries.map((entry) => ({
      journalId,
      transactionId: sourceId,
      accountCode: entry.accountCode,
      accountName: entry.accountName,
      debit: Number(entry.debit || 0),
      credit: Number(entry.credit || 0),
      currency: entry.currency || "UGX",
      description,
      source,
      sourceId,
      tenantId,
      userId,
      posted: true,
      reversed: false,
      metadata,
    }));

    const result = await LedgerEntry.insertMany(
      ledgerEntries,
      session ? { session } : {}
    );

    return {
      success: true,
      journalId,
      debitTotal,
      creditTotal,
      entries: result.length,
    };
  }

  /**
   * Deposit Posting
   */
  async recordDeposit({
    transactionId,
    amount,
    userId,
    tenantId,
    currency = "UGX",
  }) {
    return this.createJournal({
      journalId: `DEP-${Date.now()}`,
      description: "Savings Deposit",
      source: "deposit",
      sourceId: transactionId,
      tenantId,
      userId,
      entries: [
        {
          accountCode: "1010",
          accountName: "MoMo Settlement Account",
          debit: amount,
          currency,
        },
        {
          accountCode: "2010",
          accountName: "Member Savings Liability",
          credit: amount,
          currency,
        },
      ],
    });
  }

  /**
   * Loan Repayment Posting
   */
  async recordLoanRepayment({
    transactionId,
    amount,
    userId,
    tenantId,
    currency = "UGX",
  }) {
    return this.createJournal({
      journalId: `LRP-${Date.now()}`,
      description: "Loan Repayment",
      source: "loan_repayment",
      sourceId: transactionId,
      tenantId,
      userId,
      entries: [
        {
          accountCode: "1010",
          accountName: "MoMo Settlement Account",
          debit: amount,
          currency,
        },
        {
          accountCode: "1200",
          accountName: "Loan Portfolio",
          credit: amount,
          currency,
        },
      ],
    });
  }

  /**
   * Withdrawal Posting
   */
  async recordWithdrawal({
    transactionId,
    amount,
    userId,
    tenantId,
    currency = "UGX",
  }) {
    return this.createJournal({
      journalId: `WDR-${Date.now()}`,
      description: "Savings Withdrawal",
      source: "withdrawal",
      sourceId: transactionId,
      tenantId,
      userId,
      entries: [
        {
          accountCode: "2010",
          accountName: "Member Savings Liability",
          debit: amount,
          currency,
        },
        {
          accountCode: "1010",
          accountName: "MoMo Settlement Account",
          credit: amount,
          currency,
        },
      ],
    });
  }

  /**
   * Reverse Journal
   */
  async reverseJournal(journalId, reason = "Manual Reversal") {
    if (!LedgerEntry) {
      return {
        success: true,
        degradedMode: true,
      };
    }

    const entries = await LedgerEntry.find({
      journalId,
      reversed: false,
    });

    if (!entries.length) {
      throw new Error("Journal not found");
    }

    const reverseJournalId = `REV-${Date.now()}`;

    const reversalEntries = entries.map((entry) => ({
      journalId: reverseJournalId,
      transactionId: entry.transactionId,
      accountCode: entry.accountCode,
      accountName: entry.accountName,
      debit: entry.credit,
      credit: entry.debit,
      currency: entry.currency,
      description: reason,
      source: "reversal",
      sourceId: journalId,
      tenantId: entry.tenantId,
      userId: entry.userId,
      posted: true,
      reversed: false,
      metadata: {
        reversedJournalId: journalId,
      },
    }));

    await LedgerEntry.insertMany(reversalEntries);

    await LedgerEntry.updateMany(
      { journalId },
      {
        reversed: true,
      }
    );

    return {
      success: true,
      reversalJournalId: reverseJournalId,
    };
  }

  /**
   * Account Balance
   */
  async getAccountBalance(accountCode) {
    if (!LedgerEntry) {
      return {
        balance: 0,
        degradedMode: true,
      };
    }

    const result = await LedgerEntry.aggregate([
      {
        $match: {
          accountCode,
          posted: true,
          reversed: false,
        },
      },
      {
        $group: {
          _id: null,
          debit: { $sum: "$debit" },
          credit: { $sum: "$credit" },
        },
      },
    ]);

    if (!result.length) {
      return {
        accountCode,
        balance: 0,
      };
    }

    return {
      accountCode,
      balance:
        Number(result[0].debit || 0) -
        Number(result[0].credit || 0),
    };
  }
}

module.exports = new LedgerService();