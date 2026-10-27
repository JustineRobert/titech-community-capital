
/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/errors/ApiError.js
 * Standardized API Error — Native ESM
 * ============================================================================
 *
 * Features:
 * - Standardized API errors
 * - HTTP status support
 * - Stable error codes
 * - Validation errors
 * - Loan workflow errors
 * - Payment provider errors
 * - Correlation metadata
 * - Consistent JSON serialization
 * - CommonJS interoperability for supported Node.js runtimes
 *
 * Module strategy:
 * - Application source uses native ESM.
 * - Supports default, named HttpStatus and individual named exports.
 * - The class is available as both a named and default export.
 * - CommonJS interoperability is declared exactly once.
 * ============================================================================
 */

import * as httpStatusModule from '../constants/httpStatus.js';

/**
 * Support the existing HTTP status module's available export shape.
 */
const HttpStatus =
  httpStatusModule.default ??
  httpStatusModule.HttpStatus ??
  httpStatusModule;

/**
 * Standardized application error for API and domain operations.
 *
 * Existing constructor signature:
 * new ApiError(message, status, code, details, metadata)
 */
class ApiError extends Error {
  constructor(
    message,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    code = 'INTERNAL_ERROR',
    details = null,
    metadata = {},
  ) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize using TITech's established API response structure.
   */
  toJSON() {
    return {
      success: false,
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        status: this.status,
        details: this.details,
        metadata: this.metadata,
        timestamp: this.timestamp,
      },
    };
  }

  /**
   * Validation error.
   */
  static validation(
    message = 'Validation failed',
    details = null,
  ) {
    return new ApiError(
      message,
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      details,
    );
  }

  /**
   * Authentication error.
   */
  static unauthorized(message = 'Unauthorized') {
    return new ApiError(
      message,
      HttpStatus.UNAUTHORIZED,
      'UNAUTHORIZED',
    );
  }

  /**
   * Authorization error.
   */
  static forbidden(message = 'Access denied') {
    return new ApiError(
      message,
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
    );
  }

  /**
   * Resource not found.
   */
  static notFound(message = 'Resource not found') {
    return new ApiError(
      message,
      HttpStatus.NOT_FOUND,
      'NOT_FOUND',
    );
  }

  /**
   * Conflict error.
   */
  static conflict(message = 'Conflict detected') {
    return new ApiError(
      message,
      HttpStatus.CONFLICT,
      'CONFLICT',
    );
  }

  /**
   * Payment failure.
   */
  static paymentFailed(
    message = 'Payment failed',
    details = null,
  ) {
    return new ApiError(
      message,
      HttpStatus.PAYMENT_REQUIRED ??
        HttpStatus.BAD_REQUEST,
      'PAYMENT_FAILED',
      details,
    );
  }

  /**
   * Insufficient funds.
   */
  static insufficientFunds(
    message = 'Insufficient funds',
  ) {
    return new ApiError(
      message,
      HttpStatus.INSUFFICIENT_FUNDS ??
        HttpStatus.PAYMENT_REQUIRED ??
        HttpStatus.UNPROCESSABLE_ENTITY ??
        HttpStatus.BAD_REQUEST,
      'INSUFFICIENT_FUNDS',
    );
  }

  /**
   * Rate-limit error.
   */
  static rateLimitExceeded(
    message = 'Too many requests',
  ) {
    return new ApiError(
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMIT_EXCEEDED',
    );
  }

  /**
   * Loan eligibility error.
   */
  static loanNotEligible(
    message = 'Member not eligible for loan',
    details = null,
  ) {
    return new ApiError(
      message,
      HttpStatus.LOAN_NOT_ELIGIBLE ??
        HttpStatus.UNPROCESSABLE_ENTITY ??
        HttpStatus.BAD_REQUEST,
      'LOAN_NOT_ELIGIBLE',
      details,
    );
  }

  /**
   * Duplicate transaction.
   */
  static duplicateTransaction(transactionId) {
    return new ApiError(
      `Duplicate transaction detected: ${transactionId}`,
      HttpStatus.CONFLICT,
      'DUPLICATE_TRANSACTION',
    );
  }

  /**
   * Internal application error.
   */
  static internal(
    message = 'Internal server error',
    details = null,
  ) {
    return new ApiError(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      details,
    );
  }
}

/* ============================================================================
 * Public API
 * ========================================================================== */

/**
 * Native ESM:
 *   import ApiError from '../errors/ApiError.js';
 *   import { ApiError } from '../errors/ApiError.js';
 */
export { ApiError };
export default ApiError;

/**
 * CommonJS interoperability for supported Node.js runtimes.
 *
 * Preserve the legacy class-returning interface:
 *   const ApiError = require('../errors/ApiError.js');
 *
 * Node.js must support the special ESM export name "module.exports".
 * Verify Jest interoperability separately.
 */
export { ApiError as 'module.exports' };
