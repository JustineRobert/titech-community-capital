// middlewares/apiGatewayTransform.js
"use strict";

const winston = require("winston");

// Configure logger (extend with transports if needed)
const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

module.exports = (req, res, next) => {
  try {
    // ✅ Version routing: remap v1 endpoints
    if (req.url.startsWith("/api/v1")) {
      req.url = req.url.replace("/api/v1", "/transactions");
    }

    // ✅ Field normalization: unify phone fields
    if (req.body && req.body.phoneNumber && !req.body.phone) {
      req.body.phone = req.body.phoneNumber;
    }

    // ✅ Inject request metadata
    req.gateway = {
      requestId: req.headers["x-request-id"] || Date.now().toString(),
      source: "public-api",
      timestamp: new Date(),
      clientIp: req.ip,
      userAgent: req.headers["user-agent"] || "unknown",
    };

    // ✅ Mask sensitive data for safe logging
    req.safeBody = {
      ...req.body,
      phone: req.body?.phone ? "***masked***" : undefined,
    };

    logger.debug("API Gateway transform applied", {
      requestId: req.gateway.requestId,
      url: req.url,
      source: req.gateway.source,
      clientIp: req.gateway.clientIp,
      safeBody: req.safeBody,
    });

    next();
  } catch (err) {
    logger.error("API Gateway transform failed", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      success: false,
      message: "Internal API Gateway transform error",
    });
  }
};
