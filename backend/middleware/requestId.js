// middleware/requestId.js
'use strict';

const { randomUUID } = require('crypto');

/**
 * Middleware to attach a correlation ID to each request.
 * - Reuses X-Request-Id if provided by client/upstream.
 * - Generates a new UUID if missing.
 * - Sets req.requestId and response header.
 * - Ensures downstream services can propagate the same ID.
 */
module.exports = (req, res, next) => {
  const requestId = req.headers["x-request-id"] || randomUUID();

  // Attach to request object
  req.requestId = requestId;

  // Set response header so clients/logs can correlate
  res.setHeader("X-Request-Id", requestId);

  // Optionally inject into logger context if you use Winston
  if (req.logger) {
    req.logger.defaultMeta = { ...(req.logger.defaultMeta || {}), requestId };
  }

  next();
};
