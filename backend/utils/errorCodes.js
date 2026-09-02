// utils/errorCodes.js
'use strict';

/**
 * Centralized error codes for the TITech Fintech API.
 * 
 * Usage:
 *   throw new ApiError(errorCodes.VALIDATION_ERROR, "Invalid input");
 * 
 * Codes are grouped by domain for clarity and consistency.
 */

const errorCodes = Object.freeze({
  // ✅ General
  INTERNAL_ERROR: "ERR_INTERNAL",          // Unexpected server error
  NOT_FOUND: "ERR_NOT_FOUND",              // Resource not found
  VALIDATION_ERROR: "ERR_VALIDATION",      // Input validation failed

  // ✅ Auth
  UNAUTHORIZED: "ERR_UNAUTHORIZED",        // Missing or invalid credentials
  FORBIDDEN: "ERR_FORBIDDEN",              // User lacks permission

  // ✅ Wallet
  INSUFFICIENT_BALANCE: "ERR_INSUFFICIENT_BALANCE", // Not enough funds
  WALLET_NOT_FOUND: "ERR_WALLET_NOT_FOUND",         // Wallet does not exist

  // ✅ Transactions
  TRANSACTION_FAILED: "ERR_TRANSACTION_FAILED",     // Generic transaction failure
  DUPLICATE_TRANSACTION: "ERR_DUPLICATE_TRANSACTION", // Duplicate detected

  // ✅ Mobile Money (MoMo)
  MOMO_FAILED: "ERR_MOMO_FAILED",          // MoMo provider error

  // ✅ Fraud
  FRAUD_DETECTED: "ERR_FRAUD_FLAGGED",     // Transaction flagged for fraud
});

module.exports = errorCodes;
