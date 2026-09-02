"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/PaymentRequiredError.js
 *
 * Purpose:
 *   Represents a request that requires payment, funding, or completion of a
 *   financial obligation before the requested operation can proceed.
 *
 * Typical Uses:
 *   - Payment required before service activation
 *   - Outstanding financial obligation
 *   - Required account funding
 *   - Billing-related application conditions
 *
 * Hierarchy:
 *
 *   Error
 *      └── AppError
 *          └── PaymentRequiredError
 *
 * =============================================================================
 */

const AppError = require("./AppError");

class PaymentRequiredError extends AppError {
  /**
   * @param {string} [message="Payment Required"]
   *   Human-readable error message.
   *
   * @param {object} [details]
   *   Structured internal details describing the payment requirement.
   *
   * @param {Error} [cause]
   *   Optional underlying error.
   */
  constructor(
    message = "Payment Required",
    details,
    cause
  ) {
    super(message, {
      statusCode: 402,
      code: "PAYMENT_REQUIRED",
      type: "PaymentRequiredError",
      isOperational: true,
      retryable: false,
      details,
      cause,
    });
  }
}

module.exports = PaymentRequiredError;