// utils/AppError.js
'use strict';

const errorCodes = require('./errorCodes');

/**
 * Custom application error class
 * Provides structured error handling with status codes and error codes.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {string} [errorCode=errorCodes.INTERNAL_ERROR] - Application error code
   */
  constructor(message, statusCode = 500, errorCode = errorCodes.INTERNAL_ERROR) {
    super(message);

    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      success: false,
      errorCode: this.errorCode,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

module.exports = AppError;
