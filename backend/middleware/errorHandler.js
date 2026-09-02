"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/middleware/errorHandler.js
 *
 * Purpose:
 *   Production-grade global Express error boundary.
 *
 * Responsibilities:
 *   ✓ Centralized error normalization
 *   ✓ Stable API error response contract
 *   ✓ Correlation/request ID propagation
 *   ✓ Structured error logging
 *   ✓ Safe production error handling
 *   ✓ Development diagnostics
 *   ✓ Mongoose error normalization
 *   ✓ JWT error normalization
 *   ✓ Multer/file-upload error normalization
 *   ✓ JSON/body-parser error normalization
 *   ✓ Validation error normalization
 *   ✓ Duplicate-resource handling
 *   ✓ Rate-limit handling
 *   ✓ CORS error handling
 *   ✓ Headers-sent protection
 *   ✓ HTTP status validation
 *   ✓ Sensitive-data protection
 *
 * Bootstrap position:
 *
 *   Environment
 *       ↓
 *   Configuration
 *       ↓
 *   Logger
 *       ↓
 *   Observability
 *       ↓
 *   Resilience
 *       ↓
 *   Database
 *       ↓
 *   Middleware
 *       ↓
 *   Routes
 *       ↓
 *   404 Handler
 *       ↓
 *   Global Error Handler   ← THIS MODULE
 *       ↓
 *   HTTP Server
 *
 * =============================================================================
 */

const { randomUUID } = require("node:crypto");

const logger = require("../utils/logger");

/**
 * =============================================================================
 * Runtime
 * =============================================================================
 */

const NODE_ENV = String(
  process.env.NODE_ENV || "development"
).trim().toLowerCase();

const IS_PRODUCTION = NODE_ENV === "production";
const IS_DEVELOPMENT = NODE_ENV === "development";

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_STATUS_CODE = 500;
const DEFAULT_CLIENT_MESSAGE = "Internal server error";

const MAX_SAFE_STATUS_CODE = 599;
const MIN_SAFE_STATUS_CODE = 400;

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

/**
 * Determines whether a value is a valid HTTP error status code.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidErrorStatus(value) {
  return (
    Number.isInteger(value) &&
    value >= MIN_SAFE_STATUS_CODE &&
    value <= MAX_SAFE_STATUS_CODE
  );
}

/**
 * Safely resolves an error HTTP status.
 *
 * Priority:
 *   1. statusCode
 *   2. status
 *   3. default 500
 *
 * @param {Error|object} err
 * @returns {number}
 */
function resolveStatusCode(err) {
  if (!err) {
    return DEFAULT_STATUS_CODE;
  }

  if (isValidErrorStatus(err.statusCode)) {
    return err.statusCode;
  }

  if (isValidErrorStatus(err.status)) {
    return err.status;
  }

  return DEFAULT_STATUS_CODE;
}

/**
 * Determines whether an error is safe to expose to the client.
 *
 * Custom application errors can explicitly mark themselves as operational.
 *
 * @param {Error|object} err
 * @returns {boolean}
 */
function isOperationalError(err) {
  if (!err) {
    return false;
  }

  if (err.isOperational === true) {
    return true;
  }

  const statusCode = resolveStatusCode(err);

  return statusCode >= 400 && statusCode < 500;
}

/**
 * Safely extracts a request ID.
 *
 * Supports the conventions used by the TITech bootstrap:
 *
 *   req.requestId
 *   req.correlationId
 *   req.id
 *
 * Falls back to UUID only when no request identifier exists.
 *
 * @param {object} req
 * @returns {string}
 */
function resolveErrorId(req) {
  return (
    req?.requestId ||
    req?.correlationId ||
    req?.id ||
    randomUUID()
  );
}

/**
 * Safely converts an unknown value into a string.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function safeString(value, fallback = "") {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

/**
 * =============================================================================
 * Debug Details
 * =============================================================================
 */

/**
 * Extracts safe diagnostics.
 *
 * IMPORTANT:
 * These details are intentionally never exposed in production.
 *
 * @param {Error|object} err
 * @returns {object}
 */
function pickDebugDetails(err) {
  if (!err || typeof err !== "object") {
    return {};
  }

  const details = {};

  if (err.code !== undefined) {
    details.code = err.code;
  }

  if (err.path !== undefined) {
    details.path = err.path;
  }

  if (err.kind !== undefined) {
    details.kind = err.kind;
  }

  if (err.type !== undefined) {
    details.type = err.type;
  }

  if (err.status !== undefined) {
    details.status = err.status;
  }

  if (err.statusCode !== undefined) {
    details.statusCode = err.statusCode;
  }

  if (err.name) {
    details.name = err.name;
  }

  if (err.method) {
    details.method = err.method;
  }

  if (err.field) {
    details.field = err.field;
  }

  if (err.stack && IS_DEVELOPMENT) {
    details.stack = err.stack;
  }

  return details;
}

/**
 * =============================================================================
 * Error Normalization
 * =============================================================================
 */

/**
 * Normalizes arbitrary errors into a consistent internal representation.
 *
 * @param {Error|object} err
 * @returns {{
 *   type: string,
 *   message: string,
 *   statusCode: number,
 *   operational: boolean,
 *   details?: object
 * }}
 */
function normalizeError(err) {
  if (!err) {
    return {
      type: "UnknownError",
      message: DEFAULT_CLIENT_MESSAGE,
      statusCode: DEFAULT_STATUS_CODE,
      operational: false,
    };
  }

  const statusCode = resolveStatusCode(err);

  const type = safeString(
    err.type || err.name,
    statusCode >= 500 ? "InternalError" : "Error"
  );

  const message = safeString(
    err.message,
    statusCode >= 500 ? DEFAULT_CLIENT_MESSAGE : "Request failed"
  );

  return {
    type,
    message,
    statusCode,
    operational: isOperationalError(err),
    ...(IS_PRODUCTION
      ? {}
      : {
          details: pickDebugDetails(err),
        }),
  };
}

/**
 * =============================================================================
 * Validation Helpers
 * =============================================================================
 */

/**
 * Normalizes express-validator/custom validation errors.
 *
 * Supports:
 *
 *   err.errors
 *   err.status
 *   err.statusCode
 *
 * @param {*} errors
 * @returns {Array<object>}
 */
function normalizeValidationErrors(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.map((error) => ({
    field:
      error?.path ||
      error?.param ||
      error?.field ||
      error?.location ||
      "unknown",
    message:
      error?.msg ||
      error?.message ||
      "Invalid value",
    ...(error?.location
      ? { location: error.location }
      : {}),
    ...(error?.value !== undefined && !IS_PRODUCTION
      ? { value: error.value }
      : {}),
  }));
}

/**
 * =============================================================================
 * Mongoose Helpers
 * =============================================================================
 */

/**
 * Normalizes Mongoose ValidationError.
 *
 * @param {Error} err
 * @returns {Array<object>}
 */
function normalizeMongooseValidationErrors(err) {
  return Object.values(err?.errors || {}).map((error) => ({
    field: error?.path || "unknown",
    message: error?.message || "Validation failed",
    ...(error?.kind ? { kind: error.kind } : {}),
  }));
}

/**
 * Extracts the first duplicate-key field from MongoDB/Mongoose.
 *
 * @param {Error|object} err
 * @returns {string}
 */
function resolveDuplicateField(err) {
  if (err?.keyPattern && typeof err.keyPattern === "object") {
    const fields = Object.keys(err.keyPattern);

    if (fields.length > 0) {
      return fields[0];
    }
  }

  if (err?.keyValue && typeof err.keyValue === "object") {
    const fields = Object.keys(err.keyValue);

    if (fields.length > 0) {
      return fields[0];
    }
  }

  return "resource";
}

/**
 * =============================================================================
 * Response Writer
 * =============================================================================
 */

/**
 * Sends the standardized API error envelope.
 *
 * Response contract:
 *
 * {
 *   errorId: "...",
 *   message: "...",
 *   type: "...",
 *   errors: [],
 *   meta: {}
 * }
 *
 * `meta` is intentionally omitted in production.
 *
 * @param {import("express").Response} res
 * @param {object} options
 * @returns {import("express").Response}
 */
function sendError(
  res,
  {
    errorId,
    statusCode,
    message,
    type,
    errors,
    meta,
    retryAfter,
  }
) {
  const payload = {
    errorId,
    message,
    ...(type ? { type } : {}),
    ...(Array.isArray(errors) && errors.length
      ? { errors }
      : {}),
    ...(!IS_PRODUCTION && meta
      ? { meta }
      : {}),
  };

  if (
    retryAfter !== undefined &&
    retryAfter !== null
  ) {
    res.setHeader(
      "Retry-After",
      String(retryAfter)
    );
  }

  return res.status(statusCode).json(payload);
}

/**
 * =============================================================================
 * Structured Logging
 * =============================================================================
 */

/**
 * Logs an error without allowing logging failures to break the error boundary.
 *
 * @param {Error|object} err
 * @param {object} req
 * @param {string} errorId
 * @param {number} statusCode
 */
function logError(err, req, errorId, statusCode) {
  try {
    const logPayload = {
      errorId,
      timestamp: new Date().toISOString(),

      request: {
        method: req?.method,
        url: req?.originalUrl || req?.url,
        path: req?.path,
        ip: req?.ip,
        userAgent: req?.get?.("user-agent"),
      },

      response: {
        statusCode,
      },

      error: {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        type: err?.type,
        status: err?.status,
        statusCode: err?.statusCode,
        operational: isOperationalError(err),
      },

      user: {
        userId:
          req?.user?.id ||
          req?.user?._id ||
          undefined,
      },
    };

    /**
     * Stack traces are useful internally during development.
     *
     * In production we still log the stack because the logger is an
     * internal observability boundary. The client never receives it.
     */
    if (err?.stack) {
      logPayload.error.stack = err.stack;
    }

    logger.error(
      "Unhandled application error",
      logPayload
    );
  } catch (_) {
    /**
     * Never allow the logger to create a secondary application failure.
     */
  }
}

/**
 * =============================================================================
 * Global Error Handler
 * =============================================================================
 */

/**
 * Global Express error-handling middleware.
 *
 * IMPORTANT:
 * This middleware MUST be registered after:
 *
 *   - all application middleware
 *   - all routes
 *   - 404 handling
 *
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function errorHandler(err, req, res, next) {
  const errorId = resolveErrorId(req);

  const statusCode = resolveStatusCode(err);

  /**
   * ---------------------------------------------------------------------------
   * Headers already sent
   * ---------------------------------------------------------------------------
   *
   * Express can no longer safely modify the response.
   * Delegate back to Express' final handler.
   */
  if (res.headersSent) {
    try {
      logger.error(
        "Error occurred after response headers were sent",
        {
          errorId,
          method: req?.method,
          url: req?.originalUrl || req?.url,
          statusCode,
          message: err?.message,
          stack: err?.stack,
        }
      );
    } catch (_) {
      // Intentionally ignored.
    }

    return next(err);
  }

  /**
   * ---------------------------------------------------------------------------
   * Structured logging
   * ---------------------------------------------------------------------------
   */
  logError(
    err,
    req,
    errorId,
    statusCode
  );

  /**
   * ===========================================================================
   * 1. JSON / Body Parser Errors
   * ===========================================================================
   */

  if (
    err?.type === "entity.parse.failed" ||
    (
      err instanceof SyntaxError &&
      err?.status === 400 &&
      "body" in err
    )
  ) {
    return sendError(res, {
      errorId,
      statusCode: 400,
      message: "Invalid JSON payload",
      type: "BadRequest",
    });
  }

  /**
   * ===========================================================================
   * 2. Request Entity Too Large
   * ===========================================================================
   */

  if (
    err?.type === "entity.too.large" ||
    err?.status === 413
  ) {
    return sendError(res, {
      errorId,
      statusCode: 413,
      message: "Request payload is too large",
      type: "PayloadTooLarge",
    });
  }

  /**
   * ===========================================================================
   * 3. Validation Errors
   * ===========================================================================
   */

  if (
    Array.isArray(err?.errors) &&
    (
      err?.status === 400 ||
      err?.statusCode === 400 ||
      err?.name === "ValidationError"
    )
  ) {
    const errors =
      err?.name === "ValidationError"
        ? normalizeMongooseValidationErrors(err)
        : normalizeValidationErrors(err.errors);

    return sendError(res, {
      errorId,
      statusCode: 400,
      message: "Validation error",
      type: "ValidationError",
      errors,
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 4. Mongoose ValidationError
   * ===========================================================================
   */

  if (err?.name === "ValidationError") {
    return sendError(res, {
      errorId,
      statusCode: 400,
      message: "Validation error",
      type: "ValidationError",
      errors: normalizeMongooseValidationErrors(err),
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 5. Mongoose CastError
   * ===========================================================================
   */

  if (err?.name === "CastError") {
    const field = safeString(
      err.path,
      "value"
    );

    return sendError(res, {
      errorId,
      statusCode: 400,
      message: `Invalid value for '${field}'`,
      type: "CastError",
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 6. MongoDB Duplicate Key
   * ===========================================================================
   */

  if (
    err?.code === 11000 ||
    err?.code === 11001
  ) {
    const field =
      resolveDuplicateField(err);

    return sendError(res, {
      errorId,
      statusCode: 409,
      message: `${field} already exists`,
      type: "DuplicateKeyError",
      errors: [
        {
          field,
          message: `${field} already exists`,
        },
      ],
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 7. JWT Errors
   * ===========================================================================
   */

  if (
    err?.name === "JsonWebTokenError"
  ) {
    return sendError(res, {
      errorId,
      statusCode: 401,
      message: "Invalid authentication token",
      type: "AuthenticationError",
    });
  }

  if (
    err?.name === "TokenExpiredError"
  ) {
    return sendError(res, {
      errorId,
      statusCode: 401,
      message: "Authentication token has expired",
      type: "AuthenticationError",
    });
  }

  if (
    err?.name === "NotBeforeError"
  ) {
    return sendError(res, {
      errorId,
      statusCode: 401,
      message: "Authentication token is not active",
      type: "AuthenticationError",
    });
  }

  /**
   * ===========================================================================
   * 8. Multer / File Upload Errors
   * ===========================================================================
   */

  if (
    err?.name === "MulterError"
  ) {
    let message =
      err.message ||
      "File upload error";

    let uploadStatus = 400;

    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        message =
          "Uploaded file exceeds the permitted size";
        uploadStatus = 413;
        break;

      case "LIMIT_FILE_COUNT":
        message =
          "Too many files uploaded";
        break;

      case "LIMIT_UNEXPECTED_FILE":
        message =
          "Unexpected file field";
        break;

      case "LIMIT_FIELD_COUNT":
        message =
          "Too many form fields";
        break;

      case "LIMIT_FIELD_SIZE":
        message =
          "Form field exceeds the permitted size";
        uploadStatus = 413;
        break;

      default:
        break;
    }

    return sendError(res, {
      errorId,
      statusCode: uploadStatus,
      message,
      type: "UploadError",
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 9. CORS Errors
   * ===========================================================================
   */

  if (
    err?.message ===
    "Not allowed by CORS"
  ) {
    return sendError(res, {
      errorId,
      statusCode: 403,
      message: "Origin not allowed",
      type: "CorsError",
    });
  }

  /**
   * ===========================================================================
   * 10. Rate Limit Errors
   * ===========================================================================
   */

  if (
    err?.name === "RateLimitError" ||
    err?.statusCode === 429 ||
    err?.status === 429
  ) {
    const retryAfter =
      err?.retryAfter ??
      err?.retryAfterSeconds;

    return sendError(res, {
      errorId,
      statusCode: 429,
      message:
        "Too many requests. Please try again later.",
      type: "RateLimitError",
      retryAfter,
    });
  }

  /**
   * ===========================================================================
   * 11. Not Found
   * ===========================================================================
   */

  if (
    err?.statusCode === 404 ||
    err?.status === 404 ||
    err?.name === "NotFoundError"
  ) {
    return sendError(res, {
      errorId,
      statusCode: 404,
      message:
        IS_PRODUCTION
          ? "Resource not found"
          : (
              err?.message ||
              "Resource not found"
            ),
      type: "NotFoundError",
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 12. Custom Application Errors
   * ===========================================================================
   *
   * Recommended application error shape:
   *
   *   const error = new Error("Insufficient funds");
   *   error.statusCode = 422;
   *   error.code = "INSUFFICIENT_FUNDS";
   *   error.isOperational = true;
   *
   * This allows business-domain errors to pass through safely while still
   * hiding unexpected internal failures.
   */

  if (
    isOperationalError(err) &&
    isValidErrorStatus(statusCode)
  ) {
    return sendError(res, {
      errorId,
      statusCode,
      message:
        safeString(
          err?.message,
          "Request failed"
        ),
      type:
        safeString(
          err?.type || err?.name,
          "ApplicationError"
        ),
      errors:
        Array.isArray(err?.errors)
          ? normalizeValidationErrors(
              err.errors
            )
          : undefined,
      meta: normalizeError(err),
    });
  }

  /**
   * ===========================================================================
   * 13. Unexpected Internal Errors
   * ===========================================================================
   *
   * NEVER expose:
   *
   *   - stack traces
   *   - database connection strings
   *   - filesystem paths
   *   - SQL/Mongo queries
   *   - JWT secrets
   *   - environment variables
   *   - internal service details
   *   - arbitrary Error.message values
   *
   * in production.
   */

  return sendError(res, {
    errorId,
    statusCode: 500,
    message: DEFAULT_CLIENT_MESSAGE,
    type: "InternalError",
    meta: normalizeError(err),
  });
}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = {
  errorHandler,
  normalizeError,
  normalizeValidationErrors,
  normalizeMongooseValidationErrors,
  sendError,
  resolveStatusCode,
  isOperationalError,
};