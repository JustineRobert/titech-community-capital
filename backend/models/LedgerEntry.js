// ============================================================================
// backend/models/LedgerEntry.js
// Enterprise Ledger Entry Model
// TITech Community Capital
// Double-Entry Accounting Foundation
// ============================================================================

"use strict";

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ============================================================================
// ENUMS
// ============================================================================

const ENTRY_TYPES = [
  "DEBIT",
  "CREDIT",
];

const ACCOUNT_TYPES = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];

const SOURCES = [
  "SAVINGS",
  "LOAN",
  "MOMO_COLLECTION",
  "MOMO_DISBURSEMENT",
  "SETTLEMENT",
  "INTEREST",
  "FEE",
  "ADJUSTMENT",
  "REVERSAL",
  "MANUAL",
  "SYSTEM",
];

// ============================================================================
// LEDGER ENTRY SCHEMA
// ============================================================================

const LedgerEntrySchema = new Schema(
  {
    // ------------------------------------------------------------------------
    // Tenant Isolation
    // ------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: false,
    },

    // ------------------------------------------------------------------------
    // Journal Batch
    // ------------------------------------------------------------------------

    journalId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    // ------------------------------------------------------------------------
    // Transaction Link
    // ------------------------------------------------------------------------

    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
      required: false,
    },

    externalId: {
      type: String,
      trim: true,
      index: true,
    },

    referenceId: {
      type: String,
      trim: true,
      index: true,
    },

    providerReference: {
      type: String,
      trim: true,
      index: true,
    },

    // ------------------------------------------------------------------------
    // Account
    // ------------------------------------------------------------------------

    accountCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    accountName: {
      type: String,
      required: true,
      trim: true,
    },

    accountType: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
      index: true,
    },

    // ------------------------------------------------------------------------
    // Entry
    // ------------------------------------------------------------------------

    entryType: {
      type: String,
      enum: ENTRY_TYPES,
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "UGX",
      uppercase: true,
      trim: true,
    },

    // ------------------------------------------------------------------------
    // Source
    // ------------------------------------------------------------------------

    source: {
      type: String,
      enum: SOURCES,
      default: "SYSTEM",
      index: true,
    },

    sourceId: {
      type: String,
      trim: true,
      index: true,
    },

    // ------------------------------------------------------------------------
    // User
    // ------------------------------------------------------------------------

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      index: true,
    },

    loanId: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      index: true,
    },

    savingsAccountId: {
      type: Schema.Types.ObjectId,
      ref: "SavingsAccount",
      index: true,
    },

    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      index: true,
    },

    // ------------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------------

    posted: {
      type: Boolean,
      default: true,
      index: true,
    },

    reversed: {
      type: Boolean,
      default: false,
      index: true,
    },

    reversalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },

    // ------------------------------------------------------------------------
    // Description
    // ------------------------------------------------------------------------

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 5000,
    },

    // ------------------------------------------------------------------------
    // Metadata
    // ------------------------------------------------------------------------

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "ledger_entries",
  }
);

// ============================================================================
// INDEXES
// ============================================================================

LedgerEntrySchema.index({
  journalId: 1,
  accountCode: 1,
  entryType: 1,
});

LedgerEntrySchema.index({
  createdAt: -1,
});

// ============================================================================
// VIRTUALS
// ============================================================================

LedgerEntrySchema.virtual("isDebit").get(function () {
  return this.entryType === "DEBIT";
});

LedgerEntrySchema.virtual("isCredit").get(function () {
  return this.entryType === "CREDIT";
});

// ============================================================================
// STATIC HELPERS
// ============================================================================

LedgerEntrySchema.statics.createDebit = function (payload) {
  return this.create({
    ...payload,
    entryType: "DEBIT",
  });
};

LedgerEntrySchema.statics.createCredit = function (payload) {
  return this.create({
    ...payload,
    entryType: "CREDIT",
  });
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports =
  mongoose.models.LedgerEntry ||
  mongoose.model("LedgerEntry", LedgerEntrySchema);
