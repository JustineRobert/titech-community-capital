"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/index.js
 *
 * Purpose:
 *   Canonical error registry and public export surface for the backend.
 *
 * Design Goals:
 *   ✓ One canonical error import location
 *   ✓ No legacy ApiError dependency
 *   ✓ Consistent AppError hierarchy
 *   ✓ Centralized error-class exports
 *   ✓ Safe AppError detection
 *   ✓ Future-proof for domain-specific errors
 *   ✓ Suitable for controllers, middleware, services and domain logic
 *
 * Canonical Usage:
 *
 *   const {
 *     AppError,
 *     BadRequestError,
 *     ConflictError,
 *     NotFoundError,
 *     PaymentRequiredError,
 *     isAppError,
 *   } = require("../errors");
 *
 * Error Architecture:
 *
 *   Error
 *     │
 *     └── AppError
 *          │
 *          ├── BadRequestError
 *          ├── ConflictError
 *          ├── NotFoundError
 *          ├── PaymentRequiredError
 *          │
 *          ├── AuthenticationError
 *          ├── AuthorizationError
 *          ├── ValidationError
 *          │
 *          ├── FinancialError
 *          │   ├── InsufficientFundsError
 *          │   ├── DuplicateTransactionError
 *          │   └── ...
 *          │
 *          ├── IdempotencyError
 *          │   ├── IdempotencyConflictError
 *          │   └── ...
 *          │
 *          └── TransactionStateError
 *              ├── AccountLockedError
 *              ├── MeetingAlreadyClosedError
 *              ├── InvalidTransactionStateError
 *              └── ...
 *
 * =============================================================================
 */

/**
 * =============================================================================
 * CORE ERROR
 * =============================================================================
 */

const AppError = require("./AppError");

/**
 * =============================================================================
 * HTTP / API ERRORS
 * =============================================================================
 */

const BadRequestError = require("./BadRequestError");
const ConflictError = require("./ConflictError");
const NotFoundError = require("./NotFoundError");
const PaymentRequiredError = require("./PaymentRequiredError");

/**
 * =============================================================================
 * ERROR TYPE GUARD
 * =============================================================================
 *
 * Determines whether a value belongs to the canonical AppError hierarchy.
 *
 * This is deliberately based on instanceof rather than checking an arbitrary
 * object property such as `isOperational`, `code`, or `statusCode`.
 *
 * @param {*} error
 * @returns {boolean}
 */
function isAppError(error) {
  return error instanceof AppError;
}

/**
 * =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 *
 * Converts an arbitrary thrown value into the canonical AppError contract.
 *
 * This is useful at application boundaries where JavaScript allows values
 * other than Error objects to be thrown.
 *
 * Existing AppError instances are returned unchanged.
 *
 * Native Error instances are wrapped while preserving the original error
 * through `cause`.
 *
 * Non-Error values are converted into a safe ApplicationError.
 *
 * @param {*} error
 * @param {object} [options]
 * @param {string} [options.message]
 * @returns {AppError}
 */
function normalizeError(error, options = {}) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      options.message || error.message || "An unexpected error occurred.",
      {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        type: "InternalError",
        isOperational: false,
        retryable: false,
        cause: error,
      }
    );
  }

  let message = options.message;

  if (!message) {
    if (typeof error === "string") {
      message = error;
    } else {
      message = "An unexpected error occurred.";
    }
  }

  return new AppError(message, {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    type: "InternalError",
    isOperational: false,
    retryable: false,
  });
}

/**
 * =============================================================================
 * ASSERTION HELPER
 * =============================================================================
 *
 * Throws an AppError when a condition is false.
 *
 * This helper is intentionally lightweight. Domain-specific validation should
 * still use dedicated domain errors where appropriate.
 *
 * @param {boolean} condition
 * @param {AppError} error
 * @throws {AppError}
 */
function assertAppError(condition, error) {
  if (!condition) {
    if (!(error instanceof AppError)) {
      throw new TypeError(
        "assertAppError requires an instance of AppError."
      );
    }

    throw error;
  }
}

/**
 * =============================================================================
 * PUBLIC EXPORTS
 * =============================================================================
 *
 * Keep this object explicit and stable.
 *
 * Do not dynamically scan the filesystem for error classes. Explicit exports
 * make dependency behavior deterministic and easier to audit.
 * =============================================================================
 */

module.exports = Object.freeze({
  /**
   * Core
   */
  AppError,

  /**
   * HTTP / API
   */
  BadRequestError,
  ConflictError,
  NotFoundError,
  PaymentRequiredError,

  /**
   * Utilities
   */
  isAppError,
  normalizeError,
  assertAppError,
});