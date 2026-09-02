// middlewares/errorMiddleware.js

/**
 * Global Error Handler Middleware (Production-Grade)
 *
 * ✅ Handles Mongoose, validation, and custom errors
 * ✅ Structured logging (ELK / observability ready)
 * ✅ Prevents stack leaks in production
 * ✅ Standardized API response (enterprise format)
 * ✅ Supports request tracing (requestId)
 */

const logger = require("../utils/logger");

module.exports = (err, req, res, next) => {
  // ✅ Default values
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let errorCode = err.errorCode || "ERR_INTERNAL";

  // ✅ --- MONGOOSE ERROR HANDLING ---
  // Invalid ObjectId
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid resource ID: ${err.value}`;
    errorCode = "ERR_INVALID_ID";
  }

  // Duplicate key
  if (err.code && err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0];
    message = `Duplicate value for field: ${field}`;
    errorCode = "ERR_DUPLICATE";
  }

  // Validation error
  if (err.name === "ValidationError") {
    statusCode = 400;
    const errors = Object.values(err.errors).map(e => e.message);
    message = errors.join(", ");
    errorCode = "ERR_VALIDATION";
  }

  // ✅ --- AUTHORIZATION ERRORS ---
  if (err.name === "UnauthorizedError") {
    statusCode = 401;
    errorCode = "ERR_UNAUTHORIZED";
  }

  if (err.name === "ForbiddenError") {
    statusCode = 403;
    errorCode = "ERR_FORBIDDEN";
  }

  // ✅ --- STRUCTURED LOGGING ---
  logger.error({
    message,
    errorCode,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    requestId: req.requestId || null,
    userId: req.user?.id || null,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  // ✅ --- RESPONSE FORMAT (ENTERPRISE STANDARD) ---
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
    }
  });
};
