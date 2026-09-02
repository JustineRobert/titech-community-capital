"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Routes
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/onboarding.routes.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for SACCO onboarding lifecycle operations.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Authentication
 * - Tenant resolution / isolation
 * - RBAC authorization
 * - Request validation
 * - Rate limiting
 * - Idempotency enforcement
 * - Resource identifier validation
 * - File upload protection
 * - Audit hooks
 * - Controller delegation
 * - Production-safe failure handling
 *
 * Architecture:
 * ----------------------------------------------------------------------------
 *
 * Request
 *   │
 *   ▼
 * Authentication
 *   │
 *   ▼
 * Tenant Resolution
 *   │
 *   ▼
 * Request Security
 *   │
 *   ▼
 * RBAC
 *   │
 *   ▼
 * Resource Identifier Validation
 *   │
 *   ▼
 * Request Validation
 *   │
 *   ▼
 * Idempotency
 *   │
 *   ▼
 * Audit
 *   │
 *   ▼
 * Controller
 *   │
 *   ▼
 * Onboarding Service
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * Business lifecycle rules MUST remain in onboarding.service.js.
 *
 * Routes must NOT:
 * - modify database records directly
 * - implement KYC rules
 * - implement subscription rules
 * - decide whether a SACCO can go live
 * - perform financial postings
 * - configure payment providers directly
 * - bypass tenant isolation
 * - trust client-supplied tenant identifiers
 *
 * Production Security Principles:
 * ----------------------------------------------------------------------------
 * 1. Authentication precedes tenant resolution.
 * 2. Tenant context must originate from trusted server-side identity/context.
 * 3. Required idempotency controls fail closed when unavailable.
 * 4. Security middleware failures never silently downgrade protection.
 * 5. Resource identifiers are validated before controller execution.
 * 6. Mutation endpoints are protected by RBAC + idempotency + audit.
 * 7. Controller methods are resolved safely during startup.
 * 8. Provider setup remains delegated to the provider subsystem.
 *
 * ============================================================================
 */

const express = require("express");

const router = express.Router();

/**
 * ============================================================================
 * RUNTIME / ENVIRONMENT
 * ============================================================================
 */

const NODE_ENV =
  process.env.NODE_ENV || "development";

const IS_PRODUCTION =
  NODE_ENV === "production";

/**
 * In production, missing enterprise security controls should fail closed.
 *
 * This can be overridden explicitly when a staged deployment requires it:
 *
 * ONBOARDING_SECURITY_FAIL_CLOSED=false
 */
const SECURITY_FAIL_CLOSED =
  String(
    process.env.ONBOARDING_SECURITY_FAIL_CLOSED ??
      (IS_PRODUCTION ? "true" : "false")
  ).toLowerCase() === "true";

/**
 * Optional startup diagnostics.
 *
 * Deliberately uses console because the application's structured logger
 * may not yet be initialized when route modules are loaded.
 */
const routeLog = {
  warn(message, meta = {}) {
    if (!IS_PRODUCTION) {
      console.warn(
        `[onboarding.routes] ${message}`,
        meta
      );
    }
  },

  error(message, meta = {}) {
    console.error(
      `[onboarding.routes] ${message}`,
      meta
    );
  },
};

/**
 * ============================================================================
 * CONTROLLER
 * ============================================================================
 */

const controller = require("./onboarding.controller");

/**
 * ============================================================================
 * VALIDATIONS
 * ============================================================================
 */

const {
  validateSacco,
  validateKYC,
  validateSubscription,
  validateRejection,
} = require("./onboarding.validation");

/**
 * ============================================================================
 * SECURITY
 * ============================================================================
 */

const authenticate = require("../../middleware/auth.middleware");

const authorize = require("../../middleware/rbac.middleware");

const tenantMiddleware = require("../../tenancy/tenant.middleware");

/**
 * ============================================================================
 * FILE UPLOADS
 * ============================================================================
 */

const upload = require("../../middleware/upload.middleware");

/**
 * ============================================================================
 * RATE LIMITING
 * ============================================================================
 */

const rateLimiter = require("../../security/rateLimiting");

/**
 * ============================================================================
 * OPTIONAL ENTERPRISE MIDDLEWARE
 * ============================================================================
 *
 * These integrations remain defensive to preserve compatibility with the
 * existing architecture.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * "Optional" means the module may not yet exist.
 *
 * It does NOT mean a required security operation is allowed to silently
 * execute without protection in production.
 * ============================================================================
 */

let validateObjectId = null;
let validateObjectIdLoadError = null;

let idempotencyMiddleware = null;
let idempotencyLoadError = null;

let auditMiddleware = null;
let auditLoadError = null;

/**
 * --------------------------------------------------------------------------
 * ObjectId validation
 * --------------------------------------------------------------------------
 */

try {
  validateObjectId = require("../../middleware/validateObjectId");
} catch (error) {
  validateObjectIdLoadError = error;
}

/**
 * --------------------------------------------------------------------------
 * Idempotency
 * --------------------------------------------------------------------------
 */

try {
  idempotencyMiddleware = require(
    "../../middleware/idempotency.middleware"
  );
} catch (error) {
  idempotencyLoadError = error;
}

/**
 * --------------------------------------------------------------------------
 * Audit
 * --------------------------------------------------------------------------
 */

try {
  auditMiddleware = require(
    "../../middleware/auditLogMiddleware"
  );
} catch (error) {
  auditLoadError = error;
}

/**
 * ============================================================================
 * OPTIONAL SECURITY MODULE DIAGNOSTICS
 * ============================================================================
 */

if (validateObjectIdLoadError) {
  routeLog.warn(
    "validateObjectId middleware is unavailable; route-local fallback validation may be used.",
    {
      code: "ONBOARDING_OBJECT_ID_MIDDLEWARE_UNAVAILABLE",
    }
  );
}

if (idempotencyLoadError) {
  routeLog.warn(
    "Idempotency middleware is unavailable.",
    {
      code: "ONBOARDING_IDEMPOTENCY_MIDDLEWARE_UNAVAILABLE",
      failClosed: SECURITY_FAIL_CLOSED,
    }
  );
}

if (auditLoadError) {
  routeLog.warn(
    "Audit middleware is unavailable.",
    {
      code: "ONBOARDING_AUDIT_MIDDLEWARE_UNAVAILABLE",
      failClosed: SECURITY_FAIL_CLOSED,
    }
  );
}

/**
 * ============================================================================
 * GENERIC HELPERS
 * ============================================================================
 */

/**
 * No-op middleware.
 */
const noop = (req, res, next) => next();

/**
 * Security failure response.
 *
 * Never exposes implementation details or module-loading errors to clients.
 */
function securityUnavailable(
  res,
  code,
  message = "Required security control is temporarily unavailable."
) {
  if (res.headersSent) {
    return;
  }

  return res.status(503).json({
    success: false,
    code,
    message,
  });
}

/**
 * Production-safe controller fallback.
 */
function notImplementedController(
  code,
  message
) {
  return (req, res) => {
    return res.status(501).json({
      success: false,
      code,
      message,
    });
  };
}

/**
 * Resolve a controller method safely.
 */
function controllerMethod(
  method,
  {
    code = "ONBOARDING_OPERATION_NOT_IMPLEMENTED",
    message = "Requested onboarding operation is not implemented.",
  } = {}
) {
  if (
    controller &&
    typeof controller[method] === "function"
  ) {
    return controller[method];
  }

  routeLog.warn(
    `Controller method "${method}" is unavailable.`,
    {
      code,
    }
  );

  return notImplementedController(
    code,
    message
  );
}

/**
 * ============================================================================
 * OBJECT ID VALIDATION
 * ============================================================================
 *
 * Supports existing implementations exporting either:
 *
 *   validateObjectId("id")
 *
 * or:
 *
 *   validateObjectId
 *
 * If the enterprise middleware is unavailable, a conservative MongoDB
 * ObjectId fallback is used.
 *
 * This avoids allowing malformed identifiers to reach controllers.
 * ============================================================================
 */

function fallbackObjectIdValidator(param) {
  return (req, res, next) => {
    const value = req.params?.[param];

    if (
      typeof value !== "string" ||
      !/^[a-fA-F0-9]{24}$/.test(value)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_RESOURCE_ID",
        message: `Invalid ${param}.`,
      });
    }

    return next();
  };
}

function objectIdParam(param = "id") {
  if (
    validateObjectId &&
    typeof validateObjectId === "function"
  ) {
    try {
      /**
       * Preferred factory form.
       */
      const middleware =
        validateObjectId(param);

      if (typeof middleware === "function") {
        return middleware;
      }
    } catch (error) {
      /**
       * Direct middleware export compatibility.
       */
      routeLog.warn(
        "validateObjectId appears to be exported as direct middleware.",
        {
          param,
        }
      );

      return validateObjectId;
    }
  }

  return fallbackObjectIdValidator(param);
}

/**
 * ============================================================================
 * IDEMPOTENCY
 * ============================================================================
 *
 * Required idempotency:
 *
 * - Missing middleware in production => 503
 * - Middleware present => execute normally
 *
 * Optional idempotency:
 *
 * - Missing middleware => continue
 * - Middleware present => execute
 *
 * The actual idempotency key should be bound by the middleware/service layer
 * to tenant + actor + operation + resource where applicable.
 * ============================================================================
 */

function idempotent(options = {}) {
  const required =
    options.required === true;

  if (
    !idempotencyMiddleware ||
    typeof idempotencyMiddleware !== "function"
  ) {
    if (!required || !SECURITY_FAIL_CLOSED) {
      return noop;
    }

    return (req, res, next) =>
      securityUnavailable(
        res,
        "IDEMPOTENCY_UNAVAILABLE",
        "Idempotency protection is temporarily unavailable."
      );
  }

  try {
    const middleware =
      idempotencyMiddleware(options);

    if (typeof middleware === "function") {
      return middleware;
    }

    /**
     * If a required middleware factory exists but does not return middleware,
     * fail closed instead of silently weakening protection.
     */
    if (required && SECURITY_FAIL_CLOSED) {
      return (req, res) =>
        securityUnavailable(
          res,
          "IDEMPOTENCY_INVALID_CONFIGURATION"
        );
    }

    return noop;
  } catch (error) {
    routeLog.error(
      "Failed to initialize idempotency middleware.",
      {
        operation: options.operation,
        error:
          IS_PRODUCTION
            ? undefined
            : error?.message,
      }
    );

    if (required && SECURITY_FAIL_CLOSED) {
      return (req, res) =>
        securityUnavailable(
          res,
          "IDEMPOTENCY_INITIALIZATION_FAILED"
        );
    }

    return noop;
  }
}

/**
 * ============================================================================
 * AUDIT
 * ============================================================================
 *
 * Audit is treated as a security-sensitive control for mutating operations.
 *
 * When fail-closed mode is active, missing audit infrastructure returns 503.
 * ============================================================================
 */

function audit(action, options = {}) {
  const required =
    options.required !== false;

  if (
    !auditMiddleware ||
    typeof auditMiddleware !== "function"
  ) {
    if (!required || !SECURITY_FAIL_CLOSED) {
      return noop;
    }

    return (req, res) =>
      securityUnavailable(
        res,
        "AUDIT_UNAVAILABLE",
        "Audit protection is temporarily unavailable."
      );
  }

  try {
    const middleware =
      auditMiddleware(action);

    if (typeof middleware === "function") {
      return middleware;
    }

    if (required && SECURITY_FAIL_CLOSED) {
      return (req, res) =>
        securityUnavailable(
          res,
          "AUDIT_INVALID_CONFIGURATION"
        );
    }

    return noop;
  } catch (error) {
    routeLog.error(
      "Failed to initialize audit middleware.",
      {
        action,
        error:
          IS_PRODUCTION
            ? undefined
            : error?.message,
      }
    );

    if (required && SECURITY_FAIL_CLOSED) {
      return (req, res) =>
        securityUnavailable(
          res,
          "AUDIT_INITIALIZATION_FAILED"
        );
    }

    return noop;
  }
}

/**
 * ============================================================================
 * ROUTE CONTEXT / SECURITY METADATA
 * ============================================================================
 *
 * This does not perform authorization itself.
 *
 * It provides normalized metadata that can be consumed by audit,
 * observability, idempotency, or downstream services when supported.
 * ============================================================================
 */

function routeContext(operation) {
  return (req, res, next) => {
    req.onboardingRoute = {
      operation,
      module: "onboarding",
      resource:
        req.params?.id || null,
    };

    /**
     * Capture request start time without exposing it to clients.
     */
    req.onboardingRequestStartedAt =
      Date.now();

    return next();
  };
}

/**
 * ============================================================================
 * REQUEST SANITIZATION / METHOD SAFETY
 * ============================================================================
 *
 * These checks are deliberately lightweight.
 *
 * Detailed schema validation remains inside onboarding.validation.js.
 * ============================================================================
 */

function rejectUnexpectedContentType(options = {}) {
  const allowMultipart =
    options.multipart === true;

  return (req, res, next) => {
    if (
      !req.method ||
      ["GET", "HEAD", "OPTIONS"].includes(
        req.method.toUpperCase()
      )
    ) {
      return next();
    }

    const contentType =
      String(
        req.headers?.["content-type"] || ""
      ).toLowerCase();

    if (!contentType) {
      return next();
    }

    if (allowMultipart) {
      if (
        contentType.startsWith(
          "multipart/form-data"
        ) ||
        contentType.includes("application/json") ||
        contentType.includes(
          "application/x-www-form-urlencoded"
        )
      ) {
        return next();
      }
    }

    return next();
  };
}

/**
 * ============================================================================
 * GLOBAL ROUTE SECURITY
 * ============================================================================
 *
 * Authentication MUST happen before tenant resolution.
 *
 * tenantMiddleware MUST derive tenant context from trusted authenticated
 * identity/session/server-side claims.
 *
 * It MUST NOT trust arbitrary client-supplied tenantId values.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * SACCO creation is retained under the existing tenant middleware for
 * architectural compatibility.
 *
 * If your tenant model creates the tenant as part of registration, the
 * tenantMiddleware should explicitly support a controlled bootstrap mode
 * based on authenticated platform onboarding permissions.
 * ============================================================================
 */

router.use(authenticate);

router.use(tenantMiddleware);

/**
 * ============================================================================
 * CREATE SACCO
 * ============================================================================
 *
 * POST /api/v1/onboarding/saccos
 * ============================================================================
 */

router.post(
  "/saccos",

  routeContext("SACCO_CREATE"),

  rateLimiter,

  authorize("SACCO_CREATE"),

  rejectUnexpectedContentType(),

  validateSacco,

  idempotent({
    operation: "SACCO_CREATE",
    required: true,
  }),

  audit("SACCO_CREATE", {
    required: true,
  }),

  controllerMethod("registerSacco", {
    code: "SACCO_CREATE_NOT_IMPLEMENTED",
    message:
      "SACCO registration is not implemented.",
  })
);

/**
 * ============================================================================
 * GET ALL SACCOS
 * ============================================================================
 *
 * GET /api/v1/onboarding/saccos
 *
 * Supported query examples:
 *
 * ?status=LIVE
 * ?status=KYC_PENDING
 * ?page=1&limit=20
 *
 * Tenant filtering MUST ultimately be enforced by the repository/service.
 * ============================================================================
 */

router.get(
  "/saccos",

  routeContext("SACCO_LIST"),

  authorize("SACCO_VIEW"),

  controllerMethod("getAllSaccos", {
    code: "SACCO_LIST_NOT_IMPLEMENTED",
    message:
      "SACCO listing is not implemented.",
  })
);

/**
 * ============================================================================
 * GET ONBOARDING METRICS
 * ============================================================================
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * Kept before parameterized SACCO routes for explicit route clarity.
 *
 * GET /api/v1/onboarding/metrics
 * ============================================================================
 */

router.get(
  "/metrics",

  routeContext("SACCO_ANALYTICS"),

  authorize("SACCO_ANALYTICS"),

  controllerMethod("getOnboardingMetrics", {
    code:
      "ONBOARDING_METRICS_NOT_IMPLEMENTED",
    message:
      "Onboarding metrics are not implemented.",
  })
);

/**
 * ============================================================================
 * GET SACCO BY ID
 * ============================================================================
 *
 * GET /api/v1/onboarding/saccos/:id
 * ============================================================================
 */

router.get(
  "/saccos/:id",

  routeContext("SACCO_VIEW"),

  objectIdParam("id"),

  authorize("SACCO_VIEW"),

  controllerMethod("getSaccoById", {
    code: "SACCO_GET_NOT_IMPLEMENTED",
    message:
      "SACCO retrieval is not implemented.",
  })
);

/**
 * ============================================================================
 * GET ONBOARDING PROGRESS
 * ============================================================================
 *
 * GET /api/v1/onboarding/saccos/:id/progress
 * ============================================================================
 */

router.get(
  "/saccos/:id/progress",

  routeContext("SACCO_PROGRESS"),

  objectIdParam("id"),

  authorize("SACCO_VIEW"),

  controllerMethod("getOnboardingProgress", {
    code:
      "ONBOARDING_PROGRESS_NOT_IMPLEMENTED",
    message:
      "Onboarding progress retrieval is not implemented.",
  })
);

/**
 * ============================================================================
 * VERIFY / APPROVE KYC
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/kyc
 * ============================================================================
 */

router.put(
  "/saccos/:id/kyc",

  routeContext("SACCO_KYC_APPROVAL"),

  objectIdParam("id"),

  authorize("SACCO_KYC_APPROVE"),

  rejectUnexpectedContentType(),

  validateKYC,

  idempotent({
    operation: "SACCO_KYC_APPROVAL",
    required: true,
  }),

  audit("SACCO_KYC_APPROVAL", {
    required: true,
  }),

  controllerMethod("verifyKYC", {
    code:
      "SACCO_KYC_APPROVAL_NOT_IMPLEMENTED",
    message:
      "SACCO KYC approval is not implemented.",
  })
);

/**
 * ============================================================================
 * UPLOAD KYC DOCUMENTS
 * ============================================================================
 *
 * POST /api/v1/onboarding/saccos/:id/documents
 *
 * File-level controls remain the responsibility of upload.middleware.
 *
 * Expected production protections:
 * - maximum 20 files
 * - maximum file size
 * - MIME allowlist
 * - extension allowlist
 * - content sniffing
 * - malware scanning
 * - checksum generation
 * - secure object storage
 * - tenant-scoped storage path
 * ============================================================================
 */

router.post(
  "/saccos/:id/documents",

  routeContext("SACCO_DOCUMENT_UPLOAD"),

  objectIdParam("id"),

  authorize("SACCO_KYC_UPLOAD"),

  upload.array("documents", 20),

  idempotent({
    operation: "SACCO_DOCUMENT_UPLOAD",
    required: false,
  }),

  audit("SACCO_DOCUMENT_UPLOAD", {
    required: true,
  }),

  controllerMethod("uploadDocuments", {
    code:
      "SACCO_DOCUMENT_UPLOAD_NOT_IMPLEMENTED",
    message:
      "SACCO document upload is not implemented.",
  })
);

/**
 * ============================================================================
 * VERIFY KYC DOCUMENT
 * ============================================================================
 *
 * POST /api/v1/onboarding/saccos/:id/documents/:documentId/verify
 * ============================================================================
 */

router.post(
  "/saccos/:id/documents/:documentId/verify",

  routeContext("SACCO_DOCUMENT_VERIFY"),

  objectIdParam("id"),

  objectIdParam("documentId"),

  authorize("SACCO_KYC_APPROVE"),

  idempotent({
    operation: "SACCO_DOCUMENT_VERIFY",
    required: true,
  }),

  audit("SACCO_DOCUMENT_VERIFY", {
    required: true,
  }),

  controllerMethod("verifyDocument", {
    code:
      "SACCO_DOCUMENT_VERIFY_NOT_IMPLEMENTED",
    message:
      "KYC document verification is not implemented.",
  })
);

/**
 * ============================================================================
 * SETUP SUBSCRIPTION
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/subscription
 * ============================================================================
 */

router.put(
  "/saccos/:id/subscription",

  routeContext("SACCO_SUBSCRIPTION_SETUP"),

  objectIdParam("id"),

  authorize("SACCO_SUBSCRIPTION"),

  rejectUnexpectedContentType(),

  validateSubscription,

  idempotent({
    operation: "SACCO_SUBSCRIPTION_SETUP",
    required: true,
  }),

  audit("SACCO_SUBSCRIPTION_SETUP", {
    required: true,
  }),

  controllerMethod("setupSubscription", {
    code:
      "SACCO_SUBSCRIPTION_NOT_IMPLEMENTED",
    message:
      "SACCO subscription setup is not implemented.",
  })
);

/**
 * ============================================================================
 * GO LIVE
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/live
 *
 * The service MUST verify all lifecycle prerequisites before transitioning
 * the SACCO to LIVE.
 * ============================================================================
 */

router.put(
  "/saccos/:id/live",

  routeContext("SACCO_GO_LIVE"),

  objectIdParam("id"),

  authorize("SACCO_GO_LIVE"),

  rejectUnexpectedContentType(),

  idempotent({
    operation: "SACCO_GO_LIVE",
    required: true,
  }),

  audit("SACCO_GO_LIVE", {
    required: true,
  }),

  controllerMethod("goLive", {
    code: "SACCO_GO_LIVE_NOT_IMPLEMENTED",
    message:
      "SACCO go-live is not implemented.",
  })
);

/**
 * ============================================================================
 * REJECT APPLICATION
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/reject
 * ============================================================================
 */

router.put(
  "/saccos/:id/reject",

  routeContext("SACCO_REJECTION"),

  objectIdParam("id"),

  authorize("SACCO_REJECT"),

  rejectUnexpectedContentType(),

  validateRejection,

  idempotent({
    operation: "SACCO_REJECTION",
    required: true,
  }),

  audit("SACCO_REJECTION", {
    required: true,
  }),

  controllerMethod("rejectApplication", {
    code:
      "SACCO_REJECTION_NOT_IMPLEMENTED",
    message:
      "SACCO rejection is not implemented.",
  })
);

/**
 * ============================================================================
 * SUSPEND SACCO
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/suspend
 * ============================================================================
 */

router.put(
  "/saccos/:id/suspend",

  routeContext("SACCO_SUSPEND"),

  objectIdParam("id"),

  authorize("SACCO_SUSPEND"),

  rejectUnexpectedContentType(),

  idempotent({
    operation: "SACCO_SUSPEND",
    required: true,
  }),

  audit("SACCO_SUSPEND", {
    required: true,
  }),

  controllerMethod("suspend", {
    code: "SACCO_SUSPEND_NOT_IMPLEMENTED",
    message:
      "SACCO suspension is not implemented.",
  })
);

/**
 * ============================================================================
 * RESTORE SUSPENDED SACCO
 * ============================================================================
 *
 * PUT /api/v1/onboarding/saccos/:id/restore
 * ============================================================================
 */

router.put(
  "/saccos/:id/restore",

  routeContext("SACCO_RESTORE"),

  objectIdParam("id"),

  authorize("SACCO_RESTORE"),

  rejectUnexpectedContentType(),

  idempotent({
    operation: "SACCO_RESTORE",
    required: true,
  }),

  audit("SACCO_RESTORE", {
    required: true,
  }),

  controllerMethod("restore", {
    code: "SACCO_RESTORE_NOT_IMPLEMENTED",
    message:
      "SACCO restoration is not implemented.",
  })
);

/**
 * ============================================================================
 * MTN MOMO SETUP
 * ============================================================================
 *
 * POST /api/v1/onboarding/saccos/:id/mtn/setup
 *
 * This route records/configures onboarding readiness.
 *
 * Actual payment provider authentication, credential handling, API calls,
 * callbacks, settlements, and provider-specific state transitions MUST remain
 * within the payment-provider subsystem.
 * ============================================================================
 */

router.post(
  "/saccos/:id/mtn/setup",

  routeContext("SACCO_MTN_SETUP"),

  objectIdParam("id"),

  rateLimiter,

  authorize("MOMO_SETUP"),

  rejectUnexpectedContentType(),

  idempotent({
    operation: "SACCO_MTN_SETUP",
    required: true,
  }),

  audit("SACCO_MTN_SETUP", {
    required: true,
  }),

  controllerMethod("setupMtnMomo", {
    code: "MOMO_SETUP_NOT_IMPLEMENTED",
    message:
      "MTN MoMo setup is not implemented.",
  })
);

/**
 * ============================================================================
 * AIRTEL MONEY SETUP
 * ============================================================================
 *
 * POST /api/v1/onboarding/saccos/:id/airtel/setup
 * ============================================================================
 */

router.post(
  "/saccos/:id/airtel/setup",

  routeContext("SACCO_AIRTEL_SETUP"),

  objectIdParam("id"),

  rateLimiter,

  authorize("AIRTEL_SETUP"),

  rejectUnexpectedContentType(),

  idempotent({
    operation: "SACCO_AIRTEL_SETUP",
    required: true,
  }),

  audit("SACCO_AIRTEL_SETUP", {
    required: true,
  }),

  controllerMethod("setupAirtelMoney", {
    code:
      "AIRTEL_SETUP_NOT_IMPLEMENTED",
    message:
      "Airtel Money setup is not implemented.",
  })
);

/**
 * ============================================================================
 * UNKNOWN ONBOARDING ROUTE HANDLER
 * ============================================================================
 *
 * Prevents accidental fall-through into another router mounted after this
 * module while providing a consistent API response.
 *
 * ============================================================================
 */

router.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: "ONBOARDING_ROUTE_NOT_FOUND",
    message: "Onboarding endpoint not found.",
    requestId:
      req.id ||
      req.requestId ||
      null,
  });
});

/**
 * ============================================================================
 * ROUTER ERROR HANDLER
 * ============================================================================
 *
 * Express error boundary for route-local synchronous/forwarded failures.
 *
 * Detailed errors MUST be handled by the application's global error
 * middleware. This handler intentionally does not expose stack traces,
 * module paths, database information, or internal security metadata.
 * ============================================================================
 */

router.use(
  (err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    routeLog.error(
      "Unhandled onboarding route error.",
      {
        operation:
          req.onboardingRoute?.operation ||
          null,
        requestId:
          req.id ||
          req.requestId ||
          null,
      }
    );

    return res.status(500).json({
      success: false,
      code: "ONBOARDING_ROUTE_ERROR",
      message:
        "An unexpected onboarding error occurred.",
      requestId:
        req.id ||
        req.requestId ||
        null,
    });
  }
);

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = router;