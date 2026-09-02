// ============================================================================
// TITech Community Capital
// File: backend/middleware/auditMiddleware.js
// Production Grade Audit Middleware
// Multi-Tenant | Compliance | KYC | AML | Regulatory Reporting Ready
// ============================================================================

"use strict";

const crypto = require("crypto");

const logger = require("../utils/logger");
const metricsService = require("../services/metricsService");

let auditService = null;
let requestContext = null;
let correlationMiddleware = null;

try {
  auditService = require(
    "../services/auditService"
  );
} catch (_) {}

try {
  requestContext = require(
    "./requestContext"
  );
} catch (_) {}

try {
  correlationMiddleware = require(
    "./correlationMiddleware"
  );
} catch (_) {}

const DEFAULT_EXCLUDED_PATHS =
  [
    "/health",
    "/metrics",
    "/favicon.ico",
  ];

const DEFAULT_REDACT_FIELDS =
  [
    "password",
    "pin",
    "otp",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "authorization",
    "cvv",
    "cardNumber",
    "nationalId",
    "nin",
    "securityAnswer",
    "privateKey",
  ];

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

function shouldSkip(
  req,
  options
) {
  const excluded =
    options.excludePaths ||
    DEFAULT_EXCLUDED_PATHS;

  return excluded.some(
    path =>
      req.originalUrl.startsWith(
        path
      )
  );
}

function redact(
  data,
  fields =
    DEFAULT_REDACT_FIELDS
) {
  if (
    data === null ||
    data === undefined
  ) {
    return data;
  }

  if (
    typeof data !== "object"
  ) {
    return data;
  }

  if (
    Array.isArray(data)
  ) {
    return data.map(item =>
      redact(item, fields)
    );
  }

  const copy = {
    ...data,
  };

  Object.keys(copy).forEach(
    key => {
      if (
        fields.includes(key)
      ) {
        copy[key] =
          "[REDACTED]";
      } else if (
        typeof copy[key] ===
        "object"
      ) {
        copy[key] =
          redact(
            copy[key],
            fields
          );
      }
    }
  );

  return copy;
}

function getIp(req) {
  return (
    req.headers[
      "x-forwarded-for"
    ] ||
    req.ip ||
    req.connection
      ?.remoteAddress ||
    null
  );
}

function getUserAgent(req) {
  return (
    req.get?.(
      "user-agent"
    ) || null
  );
}

function getContext(req) {
  return {
    requestId:
      req.requestId ||
      requestContext?.getRequestId?.(),

    correlationId:
      req.correlationId ||
      correlationMiddleware?.getCorrelationId?.(),

    traceId:
      req.traceId ||
      requestContext?.getTraceId?.(),

    spanId:
      req.spanId ||
      requestContext?.getSpanId?.(),

    tenantId:
      req.tenant?.id ||
      req.context
        ?.tenantId,

    userId:
      req.user?.id ||
      req.context
        ?.userId,
  };
}

async function persistAudit(
  payload
) {
  if (
    !auditService ||
    typeof auditService.log !==
      "function"
  ) {
    logger.info(
      "AUDIT",
      payload
    );
    return;
  }

  try {
    await auditService.log(
      payload
    );
  } catch (error) {
    logger.error(
      "Failed to persist audit event",
      {
        error:
          error.message,
      }
    );
  }
}

/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */

function auditMiddleware(
  options = {}
) {
  const redactFields =
    options.redactFields ||
    DEFAULT_REDACT_FIELDS;

  return function (
    req,
    res,
    next
  ) {
    if (
      shouldSkip(
        req,
        options
      )
    ) {
      return next();
    }

    const startedAt =
      Date.now();

    const auditId =
      uuid();

    const ctx =
      getContext(req);

    req.auditId =
      auditId;

    req.audit = {
      id: auditId,
      startedAt,
      metadata: {},
    };

    /**
     * ------------------------------------------------------------
     * Attach helper methods
     * ------------------------------------------------------------
     */

    req.addAuditMetadata =
      metadata => {
        req.audit.metadata =
          {
            ...req.audit
              .metadata,
            ...metadata,
          };
      };

    req.auditEvent =
      async (
        action,
        metadata = {}
      ) => {
        await persistAudit({
          auditId,
          action,
          tenantId:
            ctx.tenantId,
          userId:
            ctx.userId,
          requestId:
            ctx.requestId,
          correlationId:
            ctx.correlationId,
          traceId:
            ctx.traceId,
          metadata,
        });
      };

    /**
     * ------------------------------------------------------------
     * Request Start Audit
     * ------------------------------------------------------------
     */

    metricsService.increment(
      "audit.request.started"
    );

    persistAudit({
      auditId,
      action:
        "REQUEST_STARTED",
      tenantId:
        ctx.tenantId,
      userId:
        ctx.userId,
      requestId:
        ctx.requestId,
      correlationId:
        ctx.correlationId,
      traceId:
        ctx.traceId,
      metadata: {
        method:
          req.method,
        path:
          req.originalUrl,
        ip: getIp(req),
        userAgent:
          getUserAgent(req),
      },
    }).catch(() => {});

    /**
     * ------------------------------------------------------------
     * Response Completion
     * ------------------------------------------------------------
     */

    res.on(
      "finish",
      async () => {
        const duration =
          Date.now() -
          startedAt;

        const auditPayload =
          {
            auditId,
            action:
              "REQUEST_COMPLETED",
            tenantId:
              req.tenant?.id ||
              ctx.tenantId,

            userId:
              req.user?.id ||
              ctx.userId,

            requestId:
              req.requestId ||
              ctx.requestId,

            correlationId:
              req.correlationId ||
              ctx.correlationId,

            traceId:
              req.traceId ||
              ctx.traceId,

            spanId:
              req.spanId ||
              ctx.spanId,

            metadata: {
              method:
                req.method,
              path:
                req.originalUrl,
              statusCode:
                res.statusCode,
              duration,
              ip:
                getIp(req),
              userAgent:
                getUserAgent(
                  req
                ),
              request:
                redact(
                  req.body,
                  redactFields
                ),
              query:
                redact(
                  req.query,
                  redactFields
                ),
              params:
                redact(
                  req.params,
                  redactFields
                ),
              additional:
                req.audit
                  ?.metadata ||
                {},
            },
          };

        await persistAudit(
          auditPayload
        );

        metricsService.increment(
          "audit.request.completed"
        );

        metricsService.timing(
          "audit.request.duration",
          duration
        );

        logger.debug(
          "Audit event persisted",
          {
            auditId,
            path:
              req.originalUrl,
            status:
              res.statusCode,
            duration,
          }
        );
      }
    );

    /**
     * ------------------------------------------------------------
     * Response Error Hook
     * ------------------------------------------------------------
     */

    res.on(
      "close",
      async () => {
        if (
          res.writableEnded
        ) {
          return;
        }

        await persistAudit({
          auditId,
          action:
            "REQUEST_ABORTED",
          tenantId:
            ctx.tenantId,
          userId:
            ctx.userId,
          requestId:
            ctx.requestId,
          correlationId:
            ctx.correlationId,
          metadata: {
            method:
              req.method,
            path:
              req.originalUrl,
            ip:
              getIp(req),
          },
        });

        metricsService.increment(
          "audit.request.aborted"
        );
      }
    );

    next();
  };
}

/**
 * ============================================================================
 * Predefined Middleware
 * ============================================================================
 */

auditMiddleware.financial =
  auditMiddleware({
    redactFields: [
      ...DEFAULT_REDACT_FIELDS,
      "accountNumber",
      "balance",
      "amount",
    ],
  });

auditMiddleware.kyc =
  auditMiddleware({
    redactFields: [
      ...DEFAULT_REDACT_FIELDS,
      "passportNumber",
      "documentNumber",
      "birthDate",
    ],
  });

auditMiddleware.auth =
  auditMiddleware({
    redactFields: [
      ...DEFAULT_REDACT_FIELDS,
      "username",
      "email",
    ],
  });

/**
 * ============================================================================
 * Manual Audit Helper
 * ============================================================================
 */

auditMiddleware.log =
  async function ({
    action,
    tenantId,
    userId,
    metadata = {},
  }) {
    await persistAudit({
      auditId: uuid(),
      action,
      tenantId,
      userId,
      metadata,
      timestamp:
        new Date().toISOString(),
    });
  };

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
  auditMiddleware();
module.exports.factory =
  auditMiddleware;
module.exports.financial =
  auditMiddleware.financial;
module.exports.kyc =
  auditMiddleware.kyc;
module.exports.auth =
  auditMiddleware.auth;
module.exports.log =
  auditMiddleware.log;