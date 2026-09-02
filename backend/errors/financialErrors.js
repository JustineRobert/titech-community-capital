"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/financialErrors.js
 *
 * Purpose:
 *   Canonical financial-domain error definitions for the ACFOS backend.
 *
 * Design Goals:
 *   ✓ Extend the canonical AppError hierarchy
 *   ✓ Use stable machine-readable financial error codes
 *   ✓ Provide predictable HTTP semantics
 *   ✓ Explicitly model retryability
 *   ✓ Preserve structured internal details
 *   ✓ Keep financial business rules out of AppError
 *   ✓ Support idempotent financial operations
 *   ✓ Support transaction-state enforcement
 *   ✓ Prevent accidental exposure of financial internals
 *
 * Error Architecture:
 *
 *   AppError
 *      │
 *      └── FinancialError
 *          ├── InsufficientFundsError
 *          ├── DuplicateTransactionError
 *          ├── InvalidAmountError
 *          ├── AccountLockedError
 *          ├── FinancialAccountNotFoundError
 *          ├── TransactionNotFoundError
 *          ├── TransactionStateError
 *          │
 *          └── InvalidTransactionStateError
 *
 * Notes:
 *   - Error classes remain intentionally small.
 *   - Domain services remain responsible for deciding WHEN an error occurs.
 *   - Error codes are part of the backend's public machine-readable contract.
 *
 * =============================================================================
 */

const AppError = require("./AppError");

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 *
 * Centralized constants reduce accidental code drift.
 *
 * These values should be treated as stable API/domain identifiers.
 * =============================================================================
 */

const FINANCIAL_ERROR_CODES = Object.freeze({
  FINANCIAL_ERROR: "FINANCIAL_ERROR",

  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  INVALID_AMOUNT: "INVALID_AMOUNT",

  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  INVALID_TRANSACTION_STATE: "INVALID_TRANSACTION_STATE",

  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",

  FINANCIAL_OPERATION_REJECTED: "FINANCIAL_OPERATION_REJECTED",
  FINANCIAL_OPERATION_UNAVAILABLE: "FINANCIAL_OPERATION_UNAVAILABLE",
});

/**
 * =============================================================================
 * BASE FINANCIAL ERROR
 * =============================================================================
 *
 * Base class for all financial-domain errors.
 *
 * Default status:
 *   422 Unprocessable Entity
 *
 * Why 422:
 *   The request may be syntactically valid, but the financial operation cannot
 *   be processed because a business/domain constraint has been violated.
 * =============================================================================
 */

class FinancialError extends AppError {
  /**
   * @param {string} message
   * @param {object} [options]
   * @param {number} [options.statusCode=422]
   * @param {string} [options.code=FINANCIAL_ERROR]
   * @param {string} [options.type="FinancialError"]
   * @param {boolean} [options.isOperational=true]
   * @param {boolean} [options.retryable=false]
   * @param {object} [options.details]
   * @param {Error} [options.cause]
   */
  constructor(
    message = "Financial operation failed.",
    {
      statusCode = 422,
      code = FINANCIAL_ERROR_CODES.FINANCIAL_ERROR,
      type = "FinancialError",
      isOperational = true,
      retryable = false,
      details,
      cause,
    } = {}
  ) {
    super(message, {
      statusCode,
      code,
      type,
      isOperational,
      retryable,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * INSUFFICIENT FUNDS
 * =============================================================================
 *
 * Indicates that an account does not have enough available funds to complete
 * the requested financial operation.
 *
 * This is an operational business error and is NOT normally retryable unless
 * the account balance changes independently of the failed request.
 * =============================================================================
 */

class InsufficientFundsError extends FinancialError {
  /**
   * @param {string} [message="Insufficient funds."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Insufficient funds.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 422,
      code: FINANCIAL_ERROR_CODES.INSUFFICIENT_FUNDS,
      type: "InsufficientFundsError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * INVALID AMOUNT
 * =============================================================================
 *
 * Indicates that an amount supplied to a financial operation is invalid.
 *
 * Examples:
 *   - Zero amount
 *   - Negative amount
 *   - Unsupported precision
 *   - Amount outside allowed business limits
 * =============================================================================
 */

class InvalidAmountError extends FinancialError {
  /**
   * @param {string} [message="Invalid financial amount."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Invalid financial amount.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 422,
      code: FINANCIAL_ERROR_CODES.INVALID_AMOUNT,
      type: "InvalidAmountError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * DUPLICATE TRANSACTION
 * =============================================================================
 *
 * Indicates that a transaction with the same business identity already exists.
 *
 * This is especially important at the idempotency + financial transaction
 * boundary.
 * =============================================================================
 */

class DuplicateTransactionError extends FinancialError {
  /**
   * @param {string} [message="Duplicate transaction."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Duplicate transaction.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 409,
      code: FINANCIAL_ERROR_CODES.DUPLICATE_TRANSACTION,
      type: "DuplicateTransactionError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * TRANSACTION NOT FOUND
 * =============================================================================
 *
 * Indicates that a requested financial transaction does not exist.
 * =============================================================================
 */

class TransactionNotFoundError extends FinancialError {
  /**
   * @param {string} [message="Transaction not found."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Transaction not found.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 404,
      code: FINANCIAL_ERROR_CODES.TRANSACTION_NOT_FOUND,
      type: "TransactionNotFoundError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * INVALID TRANSACTION STATE
 * =============================================================================
 *
 * Indicates that a financial transaction cannot transition from its current
 * state into the requested state.
 *
 * Example:
 *
 *   POSTED → POSTED
 *   REVERSED → POSTED
 *   CANCELLED → SETTLED
 * =============================================================================
 */

class InvalidTransactionStateError extends FinancialError {
  /**
   * @param {string} [message="Invalid transaction state."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Invalid transaction state.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 409,
      code: FINANCIAL_ERROR_CODES.INVALID_TRANSACTION_STATE,
      type: "InvalidTransactionStateError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * ACCOUNT LOCKED
 * =============================================================================
 *
 * Indicates that a financial account is currently prevented from performing
 * financial operations.
 *
 * Examples:
 *   - Compliance hold
 *   - Security lock
 *   - Administrative lock
 *   - Account closure workflow
 * =============================================================================
 */

class AccountLockedError extends FinancialError {
  /**
   * @param {string} [message="Account is locked."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Account is locked.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 423,
      code: FINANCIAL_ERROR_CODES.ACCOUNT_LOCKED,
      type: "AccountLockedError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * ACCOUNT NOT FOUND
 * =============================================================================
 *
 * Indicates that the financial account associated with the requested operation
 * could not be located.
 * =============================================================================
 */

class FinancialAccountNotFoundError extends FinancialError {
  /**
   * @param {string} [message="Financial account not found."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Financial account not found.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 404,
      code: FINANCIAL_ERROR_CODES.ACCOUNT_NOT_FOUND,
      type: "FinancialAccountNotFoundError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * FINANCIAL OPERATION REJECTED
 * =============================================================================
 *
 * Generic business-level rejection when a financial operation is intentionally
 * refused by a domain rule but a more specific error class is not appropriate.
 * =============================================================================
 */

class FinancialOperationRejectedError extends FinancialError {
  /**
   * @param {string} [message="Financial operation rejected."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Financial operation rejected.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 422,
      code: FINANCIAL_ERROR_CODES.FINANCIAL_OPERATION_REJECTED,
      type: "FinancialOperationRejectedError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * FINANCIAL OPERATION UNAVAILABLE
 * =============================================================================
 *
 * Indicates that a required financial subsystem or capability is temporarily
 * unavailable.
 *
 * This differs from a business rejection:
 *
 *   REJECTED    → operation is invalid/unacceptable.
 *   UNAVAILABLE → operation may become possible later.
 *
 * Therefore this error is explicitly retryable by default.
 * =============================================================================
 */

class FinancialOperationUnavailableError extends FinancialError {
  /**
   * @param {string} [message="Financial operation is temporarily unavailable."]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Financial operation is temporarily unavailable.",
    details,
    cause
  ) {
    super(message, {
      statusCode: 503,
      code: FINANCIAL_ERROR_CODES.FINANCIAL_OPERATION_UNAVAILABLE,
      type: "FinancialOperationUnavailableError",
      isOperational: true,
      retryable: true,
      details,
      cause,
    });
  }
}

/**
 * =============================================================================
 * PUBLIC EXPORTS
 * =============================================================================
 *
 * Frozen exports prevent accidental mutation of the module's public registry.
 * =============================================================================
 */

module.exports = Object.freeze({
  /**
   * Base
   */
  FinancialError,

  /**
   * Financial domain errors
   */
  InsufficientFundsError,
  InvalidAmountError,
  DuplicateTransactionError,
  TransactionNotFoundError,
  InvalidTransactionStateError,
  AccountLockedError,
  FinancialAccountNotFoundError,
  FinancialOperationRejectedError,
  FinancialOperationUnavailableError,

  /**
   * Stable machine-readable codes
   */
  FINANCIAL_ERROR_CODES,
});