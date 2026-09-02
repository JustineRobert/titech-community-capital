"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/ConflictError.js
 *
 * Purpose:
 *   Represents a request that cannot be completed because it conflicts with
 *   the current state of a resource or business operation.
 *
 * Typical Uses:
 *   - Duplicate resource creation
 *   - Duplicate financial transaction
 *   - Idempotency conflicts
 *   - Resource state conflicts
 *   - Concurrent modification conflicts
 *
 * Hierarchy:
 *
 *   Error
 *      └── AppError
 *          └── ConflictError
 *
 * =============================================================================
 */

const AppError = require("./AppError");

class ConflictError extends AppError {
  /**
   * @param {string} [message="Conflict"]
   *   Human-readable conflict message.
   *
   * @param {object} [details]
   *   Structured internal details about the conflict.
   *
   * @param {Error} [cause]
   *   Optional underlying error.
   */
  constructor(
    message = "Conflict",
    details,
    cause
  ) {
    super(message, {
      statusCode: 409,
      code: "CONFLICT",
      type: "ConflictError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

module.exports = ConflictError;