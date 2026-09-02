"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/BadRequestError.js
 *
 * Purpose:
 *   Represents a client request that cannot be processed because the request
 *   is malformed, invalid, or otherwise unacceptable at the HTTP boundary.
 *
 * Hierarchy:
 *
 *   Error
 *      └── AppError
 *          └── BadRequestError
 *
 * =============================================================================
 */

const AppError = require("./AppError");

class BadRequestError extends AppError {
  /**
   * @param {string} [message="Bad Request"]
   * @param {object} [details]
   * @param {Error} [cause]
   */
  constructor(
    message = "Bad Request",
    details,
    cause
  ) {
    super(message, {
      statusCode: 400,
      code: "BAD_REQUEST",
      type: "BadRequestError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

module.exports = BadRequestError;