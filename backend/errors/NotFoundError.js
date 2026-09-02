"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/NotFoundError.js
 *
 * Purpose:
 *   Represents a request for a resource, entity, or route that could not be
 *   found or does not exist within the current application context.
 *
 * Typical Uses:
 *   - Resource does not exist
 *   - Account/member not found
 *   - Transaction not found
 *   - Meeting not found
 *   - Route/resource lookup failure
 *
 * Hierarchy:
 *
 *   Error
 *      └── AppError
 *          └── NotFoundError
 *
 * =============================================================================
 */

const AppError = require("./AppError");

class NotFoundError extends AppError {
  /**
   * @param {string} [message="Not Found"]
   *   Human-readable error message.
   *
   * @param {object} [details]
   *   Structured internal details describing what could not be found.
   *
   * @param {Error} [cause]
   *   Optional underlying error.
   */
  constructor(
    message = "Not Found",
    details,
    cause
  ) {
    super(message, {
      statusCode: 404,
      code: "NOT_FOUND",
      type: "NotFoundError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

module.exports = NotFoundError;