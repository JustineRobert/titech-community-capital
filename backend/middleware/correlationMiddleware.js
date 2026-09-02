// ============================================================================
// TITech Community Capital
// File: backend/middleware/correlationMiddleware.js
// Production Grade Correlation & Request Context Middleware
// Multi-Tenant | Microservices | Distributed Tracing | OpenTelemetry Ready
// ============================================================================

"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

const logger = require("../utils/logger");
const metricsService = require("../services/metricsService");

let auditService = null;

try {
  auditService = require(
    "../services/auditService"
  );
} catch (_) {}

const asyncLocalStorage =
  new AsyncLocalStorage();

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const HEADER_NAMES = {
  correlationId:
    "x-correlation-id",

  requestId:
    "x-request-id",

  traceId:
    "x-trace-id",

  spanId:
    "x-span-id",

  tenantId:
    "x-tenant-id",

  userId:
    "x-user-id",
};

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  "titech-community-capital";

const NODE_ENV =
  process.env.NODE_ENV ||
  "development";

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function uuid() {
  return crypto.randomUUID();
}

function randomHex(
  bytes = 8
) {
  return crypto
    .randomBytes(bytes)
    .toString("hex");
}

function sanitize(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return String(value)
    .trim()
    .substring(0, 255);
}

function createContext(req) {
  const correlationId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .correlationId
      ]
    ) || uuid();

  const requestId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .requestId
      ]
    ) || uuid();

  const traceId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .traceId
      ]
    ) || randomHex(16);

  const spanId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .spanId
      ]
    ) || randomHex(8);

  const tenantId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .tenantId
      ]
    );

  const userId =
    sanitize(
      req.headers[
        HEADER_NAMES
          .userId
      ]
    );

  return {
    correlationId,
    requestId,
    traceId,
    spanId,
    tenantId,
    userId,
    service:
      SERVICE_NAME,
    environment:
      NODE_ENV,
    startedAt:
      Date.now(),
  };
}

/**
 * ============================================================================
 * Async Context Accessors
 * ============================================================================
 */

function getContext() {
  return (
    asyncLocalStorage.getStore() ||
    {}
  );
}

function getCorrelationId() {
  return getContext()
    .correlationId;
}

function getRequestId() {
  return getContext()
    .requestId;
}

function getTraceId() {
  return getContext().traceId;
}

function getSpanId() {
  return getContext().spanId;
}

function getTenantId() {
  return getContext()
    .tenantId;
}

function getUserId() {
  return getContext().userId;
}

/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function correlationMiddleware(
  req,
  res,
  next
) {
  const context =
    createContext(req);

  /**
   * ------------------------------------------------------------------------
   * Attach to Request
   * ------------------------------------------------------------------------
   */

  req.correlationId =
    context.correlationId;

  req.requestId =
    context.requestId;

  req.traceId =
    context.traceId;

  req.spanId =
    context.spanId;

  req.context = {
    ...(req.context || {}),
    ...context,
  };

  /**
   * ------------------------------------------------------------------------
   * Response Headers
   * ------------------------------------------------------------------------
   */

  res.setHeader(
    HEADER_NAMES
      .correlationId,
    context.correlationId
  );

  res.setHeader(
    HEADER_NAMES.requestId,
    context.requestId
  );

  res.setHeader(
    HEADER_NAMES.traceId,
    context.traceId
  );

  res.setHeader(
    HEADER_NAMES.spanId,
    context.spanId
  );

  /**
   * ------------------------------------------------------------------------
   * Request Metrics
   * ------------------------------------------------------------------------
   */

  metricsService.increment(
    "request.received"
  );

  /**
   * ------------------------------------------------------------------------
   * Async Context
   * ------------------------------------------------------------------------
   */

  asyncLocalStorage.run(
    context,
    () => {
      logger.debug(
        "Request context initialized",
        {
          correlationId:
            context.correlationId,
          requestId:
            context.requestId,
          traceId:
            context.traceId,
          method:
            req.method,
          path:
            req.originalUrl,
        }
      );

      /**
       * --------------------------------------------------------------------
       * Response Lifecycle
       * --------------------------------------------------------------------
       */

      res.on(
        "finish",
        async () => {
          const duration =
            Date.now() -
            context.startedAt;

          metricsService.trackRequest(
            {
              route:
                req.route
                  ?.path ||
                req.originalUrl,

              method:
                req.method,

              statusCode:
                res.statusCode,

              duration,

              tenantId:
                req.tenant
                  ?.id,
            }
          );

          logger.info(
            "Request completed",
            {
              correlationId:
                context.correlationId,

              requestId:
                context.requestId,

              traceId:
                context.traceId,

              status:
                res.statusCode,

              duration,

              method:
                req.method,

              path:
                req.originalUrl,
            }
          );

          if (
            auditService &&
            typeof auditService.log ===
              "function"
          ) {
            auditService
              .log({
                action:
                  "REQUEST_COMPLETED",

                correlationId:
                  context.correlationId,

                requestId:
                  context.requestId,

                traceId:
                  context.traceId,

                tenantId:
                  req.tenant
                    ?.id,

                userId:
                  req.user
                    ?.id,

                metadata:
                  {
                    method:
                      req.method,
                    path:
                      req.originalUrl,
                    status:
                      res.statusCode,
                    duration,
                    ip:
                      req.ip,
                  },
              })
              .catch(
                () => {}
              );
          }
        }
      );

      next();
    }
  );
}

/**
 * ============================================================================
 * Manual Context Creation
 * ============================================================================
 */

correlationMiddleware.runWithContext =
  function (
    context,
    callback
  ) {
    return asyncLocalStorage.run(
      context,
      callback
    );
  };

/**
 * ============================================================================
 * Accessors
 * ============================================================================
 */

correlationMiddleware.getContext =
  getContext;

correlationMiddleware.getCorrelationId =
  getCorrelationId;

correlationMiddleware.getRequestId =
  getRequestId;

correlationMiddleware.getTraceId =
  getTraceId;

correlationMiddleware.getSpanId =
  getSpanId;

correlationMiddleware.getTenantId =
  getTenantId;

correlationMiddleware.getUserId =
  getUserId;

/**
 * ============================================================================
 * Context Builder
 * ============================================================================
 */

correlationMiddleware.createContext =
  createContext;

/**
 * ============================================================================
 * Child Span Creation
 * ============================================================================
 */

correlationMiddleware.createChildSpan =
  function (
    name = "operation"
  ) {
    const parent =
      getContext();

    return {
      ...parent,
      parentSpanId:
        parent.spanId,
      spanId:
        randomHex(8),
      operation:
        name,
      startedAt:
        Date.now(),
    };
  };

/**
 * ============================================================================
 * Express Error Helper
 * ============================================================================
 */

correlationMiddleware.attachErrorContext =
  function (
    error
  ) {
    const ctx =
      getContext();

    if (!ctx) {
      return error;
    }

    error.correlationId =
      ctx.correlationId;

    error.requestId =
      ctx.requestId;

    error.traceId =
      ctx.traceId;

    error.spanId =
      ctx.spanId;

    return error;
  };

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
  correlationMiddleware;