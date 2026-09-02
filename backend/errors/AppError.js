"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/errors/AppError.js
 *
 * Purpose:
 *   Production-grade base application/domain error used throughout the backend.
 *
 * Architecture:
 *
 *   AppError
 *      │
 *      ├── AuthenticationError
 *      ├── AuthorizationError
 *      ├── ValidationError
 *      │
 *      ├── FinancialError
 *      │   ├── InsufficientFundsError
 *      │   ├── DuplicateTransactionError
 *      │   └── ...
 *      │
 *      ├── IdempotencyError
 *      │   ├── IdempotencyConflictError
 *      │   └── ...
 *      │
 *      └── TransactionStateError
 *          ├── AccountLockedError
 *          ├── MeetingAlreadyClosedError
 *          ├── InvalidTransactionStateError
 *          └── ...
 *
 * Design Principles:
 *   ✓ Domain-neutral base error
 *   ✓ Stable machine-readable error codes
 *   ✓ HTTP status classification
 *   ✓ Operational/non-operational classification
 *   ✓ Retryability classification
 *   ✓ Native Error.cause support
 *   ✓ Safe API serialization
 *   ✓ Internal observability serialization
 *   ✓ No accidental exposure of internal details
 *   ✓ Constructor validation
 *   ✓ Node.js production compatibility
 *
 * =============================================================================
 */

class AppError extends Error {
  /**
   * Creates a new application error.
   *
   * @param {string} message
   *   Human-readable error message.
   *
   * @param {object} [options]
   *
   * @param {number} [options.statusCode=500]
   *   HTTP-compatible status code.
   *
   * @param {string} [options.code="APPLICATION_ERROR"]
   *   Stable machine-readable application error code.
   *
   * @param {string} [options.type="ApplicationError"]
   *   Logical error type.
   *
   * @param {boolean} [options.isOperational=true]
   *   Indicates whether the error is an expected operational error.
   *
   * @param {boolean} [options.retryable=false]
   *   Indicates whether the operation may safely be retried.
   *
   * @param {object} [options.details]
   *   Internal structured error details.
   *
   *   IMPORTANT:
   *   These details are intentionally NOT exposed by toJSON().
   *
   * @param {Error} [options.cause]
   *   Original underlying error.
   */
  constructor(
    message,
    {
      statusCode = 500,
      code = "APPLICATION_ERROR",
      type = "ApplicationError",
      isOperational = true,
      retryable = false,
      details,
      cause,
    } = {}
  ) {
    AppError.#validateMessage(message);

    AppError.#validateStatusCode(statusCode);

    AppError.#validateStringOption(
      code,
      "code"
    );

    AppError.#validateStringOption(
      type,
      "type"
    );

    if (typeof isOperational !== "boolean") {
      throw new TypeError(
        "AppError option 'isOperational' must be a boolean."
      );
    }

    if (typeof retryable !== "boolean") {
      throw new TypeError(
        "AppError option 'retryable' must be a boolean."
      );
    }

    if (
      details !== undefined &&
      (
        details === null ||
        typeof details !== "object" ||
        Array.isArray(details)
      )
    ) {
      throw new TypeError(
        "AppError option 'details' must be a non-null object."
      );
    }

    if (
      cause !== undefined &&
      !(cause instanceof Error)
    ) {
      throw new TypeError(
        "AppError option 'cause' must be an Error instance."
      );
    }

    /**
     * Native Error cause support.
     *
     * Node.js versions supporting Error causes will retain the original
     * error through the standard Error.cause property.
     */
    if (cause instanceof Error) {
      super(message, { cause });
    } else {
      super(message);
    }

    /**
     * -------------------------------------------------------------------------
     * Core Error Identity
     * -------------------------------------------------------------------------
     */

    this.name = this.constructor.name;

    /**
     * -------------------------------------------------------------------------
     * Stable Application Error Contract
     * -------------------------------------------------------------------------
     */

    this.statusCode = statusCode;
    this.code = code;
    this.type = type;
    this.isOperational = isOperational;
    this.retryable = retryable;

    /**
     * -------------------------------------------------------------------------
     * Internal Structured Details
     * -------------------------------------------------------------------------
     *
     * Details remain available to backend code and observability tooling,
     * but are intentionally excluded from the public API representation.
     */

    if (details !== undefined) {
      this.details = details;
    }

    /**
     * -------------------------------------------------------------------------
     * Stack Trace
     * -------------------------------------------------------------------------
     *
     * Removes the constructor frame from the generated stack when supported.
     */

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(
        this,
        this.constructor
      );
    }
  }

  /**
   * ===========================================================================
   * SAFE API SERIALIZATION
   * ===========================================================================
   *
   * Converts the error into a public-safe representation.
   *
   * IMPORTANT:
   *   - details are excluded
   *   - cause is excluded
   *   - stack is excluded
   *   - internal implementation information is excluded
   *
   * This method is intentionally safe for HTTP responses.
   *
   * @returns {object}
   */
  toJSON() {
    return this.toSafeJSON();
  }

  /**
   * Alias for explicit public/API serialization.
   *
   * @returns {object}
   */
  toSafeJSON() {
    return {
      name: this.name,
      code: this.code,
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
    };
  }

  /**
   * ===========================================================================
   * INTERNAL LOG SERIALIZATION
   * ===========================================================================
   *
   * Creates a richer representation for internal logging and observability.
   *
   * This representation MUST NOT be sent directly to API consumers.
   *
   * @returns {object}
   */
  toLogJSON() {
    const serialized = {
      name: this.name,
      code: this.code,
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      retryable: this.retryable,
      stack: this.stack,
    };

    /**
     * Include internal details only for trusted logging/observability
     * consumers.
     */
    if (this.details !== undefined) {
      serialized.details = this.details;
    }

    /**
     * Include a safe summary of the underlying cause.
     *
     * The full cause object is intentionally not returned because it may
     * contain circular references or non-serializable properties.
     */
    if (this.cause instanceof Error) {
      serialized.cause = {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack,
      };
    }

    return serialized;
  }

  /**
   * ===========================================================================
   * VALIDATION
   * ===========================================================================
   */

  /**
   * Validates the primary error message.
   *
   * @param {*} message
   * @private
   */
  static #validateMessage(message) {
    if (
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      throw new TypeError(
        "AppError message must be a non-empty string."
      );
    }
  }

  /**
   * Validates an HTTP status code.
   *
   * Application errors should normally use 4xx or 5xx status codes.
   *
   * @param {*} statusCode
   * @private
   */
  static #validateStatusCode(statusCode) {
    if (
      !Number.isInteger(statusCode) ||
      statusCode < 400 ||
      statusCode > 599
    ) {
      throw new TypeError(
        "AppError option 'statusCode' must be an integer between 400 and 599."
      );
    }
  }

  /**
   * Validates string-based error metadata.
   *
   * @param {*} value
   * @param {string} optionName
   * @private
   */
  static #validateStringOption(
    value,
    optionName
  ) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0
    ) {
      throw new TypeError(
        `AppError option '${optionName}' must be a non-empty string.`
      );
    }
  }
}

/**
 * =============================================================================
 * MODULE EXPORT
 * =============================================================================
 */

module.exports = AppError;