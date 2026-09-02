// ============================================================================
// TITech Community Capital
// File: backend/middleware/requestContext.js
// Production Grade Request Context Middleware
// Multi-Tenant | Distributed Tracing | Async Context Propagation
// ============================================================================

"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

let logger = null;
function getLogger() {
  if (logger) return logger;

  try {
    logger = require("../utils/logger");
  } catch (_) {
    logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };
  }

  return logger;
}

let metricsService = null;
function getMetricsService() {
  if (metricsService) return metricsService;

  try {
    metricsService = require("../services/metricsService");
  } catch (_) {
    metricsService = {
      increment() {},
      timing() {},
    };
  }

  return metricsService;
}

let correlationMiddleware = null;
let auditService = null;

try {
  correlationMiddleware = require(
    "./correlationMiddleware"
  );
} catch (_) {}

try {
  auditService = require(
    "../services/auditService"
  );
} catch (_) {}

const asyncLocalStorage =
  new AsyncLocalStorage();

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  "titech-community-capital";

const SERVICE_VERSION =
  process.env.SERVICE_VERSION ||
  "1.0.0";

const NODE_ENV =
  process.env.NODE_ENV ||
  "development";

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function uuid() {
  if (
    typeof crypto.randomUUID ===
    "function"
  ) {
    return crypto.randomUUID();
  }

  return crypto
    .randomBytes(16)
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

function createRequestContext(
  req = {}
) {
  const existing =
    req.context || {};

  return {
    id:
      existing.id ||
      uuid(),

    requestId:
      existing.requestId ||
      req.requestId ||
      req.headers?.[
        "x-request-id"
      ] ||
      uuid(),

    correlationId:
      existing.correlationId ||
      req.correlationId ||
      req.headers?.[
        "x-correlation-id"
      ] ||
      uuid(),

    traceId:
      existing.traceId ||
      req.traceId ||
      req.headers?.[
        "x-trace-id"
      ] ||
      uuid(),

    spanId:
      existing.spanId ||
      req.spanId ||
      req.headers?.[
        "x-span-id"
      ] ||
      uuid(),

    tenantId:
      existing.tenantId ||
      req.tenant?.id ||
      req.headers?.[
        "x-tenant-id"
      ] ||
      null,

    organizationId:
      existing.organizationId ||
      req.tenant
        ?.organizationId ||
      null,

    userId:
      existing.userId ||
      req.user?.id ||
      req.headers?.[
        "x-user-id"
      ] ||
      null,

    email:
      existing.email ||
      req.user?.email ||
      null,

    roles:
      req.user?.roles ||
      [],

    permissions:
      req.user?.permissions ||
      [],

    ip:
      req.ip ||
      req.headers?.[
        "x-forwarded-for"
      ] ||
      null,

    userAgent:
      req.get?.(
        "user-agent"
      ) || null,

    method:
      req.method,

    path:
      req.originalUrl,

    protocol:
      req.protocol,

    hostname:
      req.hostname,

    service:
      SERVICE_NAME,

    version:
      SERVICE_VERSION,

    environment:
      NODE_ENV,

    startedAt:
      Date.now(),

    metadata:
      existing.metadata || {},
  };
}

/**
 * ============================================================================
 * Context Accessors
 * ============================================================================
 */

function getContext() {
  return (
    asyncLocalStorage.getStore() ||
    {}
  );
}

function get(key) {
  return getContext()[key];
}

function set(key, value) {
  const ctx =
    getContext();

  if (!ctx) {
    return;
  }

  ctx[key] = value;
}

function merge(values) {
  const ctx =
    getContext();

  if (!ctx) {
    return;
  }

  Object.assign(
    ctx,
    values
  );
}

/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function requestContext(
  req,
  res,
  next
) {
  const context =
    createRequestContext(
      req
    );

  req.context = context;

  req.requestContext =
    context;

  /**
   * Make context easily accessible
   */
  req.getContext =
    () => context;

  req.setContext =
    (key, value) => {
      context[key] = value;
    };

  res.locals.context =
    context;

  /**
   * Response Headers
   */
  res.setHeader(
    "x-request-id",
    context.requestId
  );

  res.setHeader(
    "x-correlation-id",
    context.correlationId
  );

  res.setHeader(
    "x-trace-id",
    context.traceId
  );

  res.setHeader(
    "x-span-id",
    context.spanId
  );

  asyncLocalStorage.run(
    context,
    () => {
      getLogger().debug(
        "Request context created",
        {
          requestId:
            context.requestId,
          correlationId:
            context.correlationId,
          path:
            context.path,
          method:
            context.method,
        }
      );

      getMetricsService().increment(
        "request_context.created"
      );

      res.on(
        "finish",
        () => {
          const duration =
            Date.now() -
            context.startedAt;

          context.completedAt =
            Date.now();

          context.duration =
            duration;

          getMetricsService().timing(
            "request_context.duration",
            duration
          );

          getLogger().debug(
            "Request context completed",
            {
              requestId:
                context.requestId,
              duration,
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
                  "REQUEST_CONTEXT_COMPLETED",

                tenantId:
                  context.tenantId,

                userId:
                  context.userId,

                correlationId:
                  context.correlationId,

                requestId:
                  context.requestId,

                metadata:
                  {
                    method:
                      context.method,
                    path:
                      context.path,
                    duration,
                    status:
                      res.statusCode,
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
 * Manual Context Execution
 * ============================================================================
 */

requestContext.run =
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
 * Create Detached Context
 * ============================================================================
 */

requestContext.create =
  function (
    overrides = {}
  ) {
    return {
      id: uuid(),
      requestId: uuid(),
      correlationId:
        uuid(),
      traceId: uuid(),
      spanId: uuid(),
      service:
        SERVICE_NAME,
      version:
        SERVICE_VERSION,
      environment:
        NODE_ENV,
      startedAt:
        Date.now(),
      metadata: {},
      ...overrides,
    };
  };

/**
 * ============================================================================
 * Child Context
 * ============================================================================
 */

requestContext.createChild =
  function (
    operation,
    metadata = {}
  ) {
    const parent =
      getContext();

    return {
      ...parent,
      parentRequestId:
        parent.requestId,
      parentSpanId:
        parent.spanId,
      spanId: uuid(),
      operation,
      metadata: {
        ...parent.metadata,
        ...metadata,
      },
      startedAt:
        Date.now(),
    };
  };

/**
 * ============================================================================
 * Queue Serialization
 * ============================================================================
 */

requestContext.serialize =
  function () {
    return JSON.stringify(
      getContext()
    );
  };

requestContext.deserialize =
  function (
    payload
  ) {
    try {
      return JSON.parse(
        payload
      );
    } catch {
      return {};
    }
  };

/**
 * ============================================================================
 * Context Propagation Headers
 * ============================================================================
 */

requestContext.headers =
  function () {
    const ctx =
      getContext();

    return {
      "x-request-id":
        ctx.requestId,

      "x-correlation-id":
        ctx.correlationId,

      "x-trace-id":
        ctx.traceId,

      "x-span-id":
        ctx.spanId,

      "x-tenant-id":
        ctx.tenantId,

      "x-user-id":
        ctx.userId,
    };
  };

/**
 * ============================================================================
 * Error Enrichment
 * ============================================================================
 */

requestContext.attachToError =
  function (
    error
  ) {
    const ctx =
      getContext();

    if (!ctx) {
      return error;
    }

    error.requestId =
      ctx.requestId;

    error.correlationId =
      ctx.correlationId;

    error.traceId =
      ctx.traceId;

    error.spanId =
      ctx.spanId;

    error.tenantId =
      ctx.tenantId;

    error.userId =
      ctx.userId;

    return error;
  };

/**
 * ============================================================================
 * Context Accessors
 * ============================================================================
 */

requestContext.get =
  get;

requestContext.set =
  set;

requestContext.merge =
  merge;

requestContext.getContext =
  getContext;

requestContext.getRequestId =
  () => get(
    "requestId"
  );

requestContext.getCorrelationId =
  () => get(
    "correlationId"
  );

requestContext.getTraceId =
  () => get(
    "traceId"
  );

requestContext.getSpanId =
  () => get(
    "spanId"
  );

requestContext.getTenantId =
  () => get(
    "tenantId"
  );

requestContext.getUserId =
  () => get(
    "userId"
  );

/**
 * ============================================================================
 * Correlation Middleware Integration
 * ============================================================================
 */

requestContext.fromCorrelation =
  function () {
    if (
      !correlationMiddleware
    ) {
      return null;
    }

    return correlationMiddleware.getContext();
  };

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
  requestContext;