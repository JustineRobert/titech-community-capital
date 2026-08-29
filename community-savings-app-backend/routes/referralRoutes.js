"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Referral API Routes
 * =============================================================================
 *
 * File:
 *   backend/routes/referralRoutes.js
 *
 * Purpose:
 *   Thin HTTP boundary for TITech referral/community-growth operations.
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        |
 *        v
 *   Request Context
 *        |
 *        +--> requestId
 *        +--> correlationId
 *        +--> tenantId
 *        +--> client/device metadata
 *        |
 *        v
 *   Authentication
 *        |
 *        v
 *   Authorization / Tenant Access
 *        |
 *        v
 *   Route Validation
 *        |
 *        v
 *   Referral Controller / Service
 *        |
 *        +--> Referral Domain
 *        +--> Idempotency
 *        +--> Audit
 *        +--> Canonical Financial Service
 *        |
 *        v
 *   HTTP Response
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * This module is an HTTP/application boundary.
 *
 * It MUST NOT:
 *
 *   - mutate wallets directly;
 *   - create ledger entries directly;
 *   - calculate/approve financial rewards directly;
 *   - bypass the canonical financial-operation boundary;
 *   - trust x-tenant-id as proof of tenant authorization;
 *   - log passwords, tokens, credentials or financial secrets.
 *
 * Referral reward posting belongs in the referral/financial service boundary.
 *
 * Enterprise Characteristics
 * -----------------------------------------------------------------------------
 * ✓ CommonJS compatible
 * ✓ Express Router
 * ✓ Dependency injection
 * ✓ Authentication boundary
 * ✓ Tenant-aware
 * ✓ Request / correlation IDs
 * ✓ Idempotency propagation
 * ✓ Validation
 * ✓ Parameter normalization
 * ✓ Bounded pagination
 * ✓ Rate-limit integration
 * ✓ Authorization hooks
 * ✓ Safe error handling
 * ✓ No sensitive data logging
 * ✓ Explicit route ordering
 * ✓ Health/readiness endpoint
 * ✓ Backward-friendly controller adapter
 * ✓ Production-safe defaults
 *
 * =============================================================================
 */

const crypto = require("node:crypto");
const express = require("express");

const logger = require("../utils/logger");

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const ROUTE_NAME = "referralRoutes";

const DEFAULT_BASE_PATH = "/referrals";

const MAX_STRING_LENGTH = 256;

const MAX_CODE_LENGTH = 128;

const MAX_PAGE_SIZE = 100;

const DEFAULT_PAGE_SIZE = 20;

const REQUEST_ID_PATTERN =
  /^[a-zA-Z0-9._:-]{8,128}$/;

const SUPPORTED_HTTP_METHODS =
  Object.freeze([
    "get",
    "post",
    "patch",
  ]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class ReferralRouteError extends Error {
  constructor(
    message,
    {
      status = 500,
      code = "REFERRAL_ROUTE_ERROR",
      details = null,
      expose = false,
    } = {}
  ) {
    super(message);

    this.name =
      "ReferralRouteError";

    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;

    Error.captureStackTrace?.(
      this,
      ReferralRouteError
    );
  }
}

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function normalizeString(
  value,
  {
    field = "value",
    required = false,
    maxLength = MAX_STRING_LENGTH,
  } = {}
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      throw new ReferralRouteError(
        `${field} is required`,
        {
          status: 400,
          code:
            "REFERRAL_VALIDATION_ERROR",
          expose: true,
        }
      );
    }

    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    if (required) {
      throw new ReferralRouteError(
        `${field} is required`,
        {
          status: 400,
          code:
            "REFERRAL_VALIDATION_ERROR",
          expose: true,
        }
      );
    }

    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new ReferralRouteError(
      `${field} exceeds maximum length`,
      {
        status: 400,
        code:
          "REFERRAL_VALIDATION_ERROR",
        expose: true,
      }
    );
  }

  return normalized;
}

function normalizeReferralCode(
  value
) {
  const code =
    normalizeString(value, {
      field:
        "referralCode",
      required: true,
      maxLength:
        MAX_CODE_LENGTH,
    });

  /**
   * Allow common referral-code characters but reject whitespace and
   * path/control characters.
   */
  if (
    !/^[a-zA-Z0-9._-]+$/.test(
      code
    )
  ) {
    throw new ReferralRouteError(
      "Invalid referral code format",
      {
        status: 400,
        code:
          "REFERRAL_CODE_INVALID",
        expose: true,
      }
    );
  }

  return code;
}

function normalizeUserId(
  value,
  field = "userId"
) {
  return normalizeString(
    value,
    {
      field,
      required: true,
      maxLength: 128,
    }
  );
}

function normalizeRequestId(
  value
) {
  const normalized =
    value == null
      ? null
      : String(value).trim();

  if (
    !normalized ||
    !REQUEST_ID_PATTERN.test(
      normalized
    )
  ) {
    return crypto.randomUUID();
  }

  return normalized;
}

function normalizePage(
  value
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(parsed) ||
    parsed < 1
  ) {
    return 1;
  }

  return parsed;
}

function normalizeLimit(
  value
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(parsed) ||
    parsed < 1
  ) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(
    parsed,
    MAX_PAGE_SIZE
  );
}

/**
 * Tenant context is contextual only.
 *
 * Backend authentication/authorization middleware MUST independently confirm
 * that the caller has access to this tenant.
 */
function resolveTenantId(
  req
) {
  const fromRequest =
    req.tenantId;

  if (fromRequest) {
    return String(
      fromRequest
    ).trim();
  }

  const fromUser =
    req.user?.tenantId ||
    req.user?.tenant ||
    req.auth?.tenantId ||
    null;

  return fromUser
    ? String(fromUser).trim()
    : null;
}

function resolveAuthenticatedUserId(
  req
) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.auth?.userId ||
    req.auth?.id ||
    null
  );
}

function safeErrorMessage(
  error
) {
  if (
    error?.expose === true
  ) {
    return (
      error.message ||
      "Referral request failed"
    );
  }

  return "Referral request could not be completed";
}

function logContext(req) {
  return {
    route:
      ROUTE_NAME,

    requestId:
      req.requestId ||
      null,

    correlationId:
      req.correlationId ||
      null,

    tenantId:
      resolveTenantId(
        req
      ),

    userId:
      resolveAuthenticatedUserId(
        req
      ),
  };
}

/**
 * =============================================================================
 * Dependency Resolution
 * =============================================================================
 *
 * Explicit injection remains preferred.
 *
 * The fallback paths exist only to make this route file easier to integrate
 * with existing TITech repository structures while the domain layer is being
 * standardized.
 */

function resolveController(
  suppliedController
) {
  if (
    suppliedController
  ) {
    return suppliedController;
  }

  const candidates =
    Object.freeze([
      "../controllers/referralController",
      "../controllers/referral.controller",
      "../controllers/referralsController",
      "../controllers/referrals.controller",
    ]);

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(candidate);

      if (!loaded) {
        continue;
      }

      if (
        typeof loaded ===
        "function"
      ) {
        return new loaded();
      }

      if (
        loaded.default
      ) {
        if (
          typeof loaded.default ===
          "function"
        ) {
          return new loaded.default();
        }

        return loaded.default;
      }

      return loaded;
    } catch (error) {
      if (
        error?.code !==
        "MODULE_NOT_FOUND"
      ) {
        throw error;
      }
    }
  }

  return null;
}

function resolveMiddleware(
  supplied,
  candidates
) {
  if (supplied) {
    return supplied;
  }

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(candidate);

      if (
        typeof loaded ===
        "function"
      ) {
        return loaded;
      }

      if (
        loaded?.default &&
        typeof loaded.default ===
          "function"
      ) {
        return loaded.default;
      }
    } catch (error) {
      if (
        error?.code !==
        "MODULE_NOT_FOUND"
      ) {
        throw error;
      }
    }
  }

  return null;
}

/**
 * =============================================================================
 * Authentication / Authorization Middleware Adapters
 * =============================================================================
 */

function buildMiddleware(
  config
) {
  const authenticate =
    config.authenticate ||
    resolveMiddleware(
      null,
      [
        "../middleware/auth",
        "../middleware/authMiddleware",
        "../middleware/authentication",
        "../middleware/authenticate",
      ]
    );

  const authorize =
    config.authorize ||
    resolveMiddleware(
      null,
      [
        "../middleware/authorize",
        "../middleware/authorization",
        "../middleware/authorizeMiddleware",
      ]
    );

  const tenantMiddleware =
    config.tenantMiddleware ||
    resolveMiddleware(
      null,
      [
        "../middleware/tenant",
        "../middleware/tenantMiddleware",
        "../middleware/tenantContext",
      ]
    );

  const rateLimit =
    config.rateLimit ||
    resolveMiddleware(
      null,
      [
        "../middleware/rateLimit",
        "../middleware/rateLimiter",
        "../middleware/rateLimiting",
      ]
    );

  return {
    authenticate,
    authorize,
    tenantMiddleware,
    rateLimit,
  };
}

/**
 * Adapt middleware with different signatures without making the route layer
 * depend on a single implementation.
 */
function optionalMiddleware(
  middleware
) {
  return typeof middleware ===
    "function"
    ? middleware
    : (_req, _res, next) =>
        next();
}

/**
 * =============================================================================
 * Controller Adapter
 * =============================================================================
 */

async function invokeController(
  controller,
  methodNames,
  req,
  res,
  options = {}
) {
  if (!controller) {
    throw new ReferralRouteError(
      "Referral service is not configured",
      {
        status: 503,
        code:
          "REFERRAL_SERVICE_UNAVAILABLE",
      }
    );
  }

  let method = null;

  for (const methodName of methodNames) {
    if (
      typeof controller[
        methodName
      ] === "function"
    ) {
      method =
        controller[methodName];
      break;
    }
  }

  if (!method) {
    throw new ReferralRouteError(
      `Referral controller method not implemented: ${methodNames.join(
        ", "
      )}`,
      {
        status: 501,
        code:
          "REFERRAL_OPERATION_NOT_IMPLEMENTED",
      }
    );
  }

  const context = {
    requestId:
      req.requestId,

    correlationId:
      req.correlationId,

    transactionId:
      req.transactionId ||
      null,

    tenantId:
      resolveTenantId(req),

    userId:
      resolveAuthenticatedUserId(
        req
      ),

    actor: req.user ||
      req.auth ||
      null,

    ip:
      req.ip ||
      null,

    userAgent:
      req.get?.(
        "user-agent"
      ) || null,

    method:
      req.method,

    path:
      req.originalUrl ||
      req.url,

    idempotencyKey:
      req.idempotencyKey ||
      req.get?.(
        "Idempotency-Key"
      ) ||
      null,
  };

  const payload = {
    params:
      req.params || {},

    query:
      req.query || {},

    body:
      req.body || {},

    context,
  };

  /**
   * Prefer a context-aware controller contract:
   *
   *   controller.method(payload, context)
   *
   * Legacy adapters can still use:
   *
   *   controller.method(req, res)
   *
   * by setting `legacyControllerContract: true`.
   */
  if (
    options.legacyControllerContract
  ) {
    return method.call(
      controller,
      req,
      res
    );
  }

  return method.call(
    controller,
    payload,
    context
  );
}

/**
 * =============================================================================
 * Request Context Middleware
 * =============================================================================
 *
 * The application-wide request-context middleware is authoritative when
 * installed. This local middleware is defensive and only fills missing values.
 */

function requestContextMiddleware(
  req,
  res,
  next
) {
  try {
    req.requestId =
      req.requestId ||
      normalizeRequestId(
        req.get?.(
          "x-request-id"
        )
      );

    req.correlationId =
      req.correlationId ||
      normalizeRequestId(
        req.get?.(
          "x-correlation-id"
        )
      );

    req.transactionId =
      req.transactionId ||
      normalizeRequestId(
        req.get?.(
          "x-transaction-id"
        )
      );

    req.tenantId =
      resolveTenantId(req);

    const idempotencyKey =
      req.get?.(
        "Idempotency-Key"
      );

    if (
      idempotencyKey
    ) {
      req.idempotencyKey =
        normalizeString(
          idempotencyKey,
          {
            field:
              "Idempotency-Key",
            maxLength: 256,
          }
        );
    }

    if (
      !res.headersSent
    ) {
      res.setHeader(
        "X-Request-Id",
        req.requestId
      );

      res.setHeader(
        "X-Correlation-Id",
        req.correlationId
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * =============================================================================
 * Tenant Enforcement Middleware
 * =============================================================================
 *
 * This validates the presence/consistency of tenant context but does not itself
 * decide whether the authenticated actor is authorized for that tenant.
 */

function requireTenantContext(
  req,
  _res,
  next
) {
  try {
    const tenantId =
      resolveTenantId(req);

    if (!tenantId) {
      throw new ReferralRouteError(
        "Tenant context is required",
        {
          status: 400,
          code:
            "TENANT_CONTEXT_REQUIRED",
          expose: true,
        }
      );
    }

    req.tenantId =
      tenantId;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * =============================================================================
 * Authenticated-user consistency middleware
 * =============================================================================
 */

function requireAuthenticatedUser(
  req,
  _res,
  next
) {
  try {
    const userId =
      resolveAuthenticatedUserId(
        req
      );

    if (!userId) {
      throw new ReferralRouteError(
        "Authentication is required",
        {
          status: 401,
          code:
            "AUTHENTICATION_REQUIRED",
          expose: true,
        }
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * =============================================================================
 * Validation Middleware
 * =============================================================================
 */

function validateReferralCodeParam(
  req,
  _res,
  next
) {
  try {
    req.params.code =
      normalizeReferralCode(
        req.params.code
      );

    next();
  } catch (error) {
    next(error);
  }
}

function validateUserIdParam(
  req,
  _res,
  next
) {
  try {
    req.params.userId =
      normalizeUserId(
        req.params.userId
      );

    next();
  } catch (error) {
    next(error);
  }
}

function validateReferralSubmission(
  req,
  _res,
  next
) {
  try {
    const body =
      req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new ReferralRouteError(
        "Referral request body is required",
        {
          status: 400,
          code:
            "REFERRAL_BODY_REQUIRED",
          expose: true,
        }
      );
    }

    /**
     * Accept common naming variants while normalizing them into a predictable
     * controller payload.
     */
    const referralCode =
      body.referralCode ||
      body.code ||
      body.referral_code ||
      null;

    if (
      referralCode
    ) {
      body.referralCode =
        normalizeReferralCode(
          referralCode
        );
    }

    if (
      body.referredUserId
    ) {
      body.referredUserId =
        normalizeUserId(
          body.referredUserId,
          "referredUserId"
        );
    }

    if (
      body.referrerUserId
    ) {
      body.referrerUserId =
        normalizeUserId(
          body.referrerUserId,
          "referrerUserId"
        );
    }

    /**
     * Do not allow clients to dictate tenant identity through the body.
     */
    delete body.tenantId;

    /**
     * Clients also cannot assign financial reward amounts through this route.
     *
     * Reward amount is calculated/authorized by the referral domain service.
     */
    delete body.rewardAmount;

    delete body.amount;

    delete body.rewardCurrency;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * =============================================================================
 * Rate-limit Policy
 * =============================================================================
 *
 * The actual rate limiter remains injectable.
 *
 * Suggested production policies:
 *
 *   Public referral-code lookup:
 *     moderate IP-based rate limit
 *
 *   Referral application:
 *     strict actor/IP rate limit
 *
 *   Reward/administrative operations:
 *     strict authenticated privileged rate limit
 */

function resolveRateLimiter(
  configuredLimiter,
  fallback
) {
  if (
    typeof configuredLimiter ===
    "function"
  ) {
    return configuredLimiter;
  }

  return (
    fallback ||
    ((_req, _res, next) =>
      next())
  );
}

/**
 * =============================================================================
 * Route Factory
 * =============================================================================
 */

function createReferralRouter(
  config = {}
) {
  const router =
    express.Router();

  const controller =
    resolveController(
      config.controller
    );

  const middleware =
    buildMiddleware(
      config
    );

  const authenticate =
    optionalMiddleware(
      middleware.authenticate
    );

  const authorize =
    optionalMiddleware(
      middleware.authorize
    );

  const tenantMiddleware =
    optionalMiddleware(
      middleware.tenantMiddleware
    );

  const publicRateLimiter =
    resolveRateLimiter(
      config.publicRateLimiter,
      middleware.rateLimit
    );

  const authenticatedRateLimiter =
    resolveRateLimiter(
      config.authenticatedRateLimiter,
      middleware.rateLimit
    );

  const privilegedRateLimiter =
    resolveRateLimiter(
      config.privilegedRateLimiter,
      middleware.rateLimit
    );

  const legacyControllerContract =
    Boolean(
      config.legacyControllerContract
    );

  /**
   * ========================================================================
   * Router-level request context
   * ========================================================================
   */
  router.use(
    requestContextMiddleware
  );

  /**
   * ========================================================================
   * GET /health
   * ========================================================================
   *
   * Lightweight route-health check.
   *
   * This is NOT a financial health/readiness check.
   */
  router.get(
    "/health",
    async (req, res, next) => {
      try {
        const health = {
          ok: true,
          service:
            "titech-community-capital",
          component:
            ROUTE_NAME,
          timestamp:
            new Date().toISOString(),
        };

        if (
          controller &&
          typeof controller
            .health === "function"
        ) {
          health.controller =
            await controller.health();
        }

        res.status(200).json(
          {
            success: true,
            data: health,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * GET /code/:code
   * ========================================================================
   *
   * Public referral-code lookup.
   *
   * Intended for registration/onboarding UX.
   *
   * IMPORTANT:
   *   Do not return private user information or reward balances here.
   */
  router.get(
    "/code/:code",
    publicRateLimiter,
    validateReferralCodeParam,
    async (req, res, next) => {
      try {
        const result =
          await invokeController(
            controller,
            [
              "getReferralByCode",
              "lookupReferralCode",
              "getCode",
              "resolveReferralCode",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * POST /apply
   * ========================================================================
   *
   * Authenticated referral association/application.
   *
   * Business rules remain in the controller/service.
   */
  router.post(
    "/apply",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authenticatedRateLimiter,
    validateReferralSubmission,
    async (req, res, next) => {
      try {
        const result =
          await invokeController(
            controller,
            [
              "applyReferral",
              "createReferral",
              "attachReferral",
              "registerReferral",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * GET /me
   * ========================================================================
   *
   * Current authenticated user's referral profile/statistics.
   */
  router.get(
    "/me",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authenticatedRateLimiter,
    async (req, res, next) => {
      try {
        const result =
          await invokeController(
            controller,
            [
              "getMyReferral",
              "getReferralProfile",
              "getMyReferralProfile",
              "getReferralStats",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * GET /me/referrals
   * ========================================================================
   *
   * Paginated referrals belonging to the current authenticated user.
   */
  router.get(
    "/me/referrals",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authenticatedRateLimiter,
    async (req, res, next) => {
      try {
        req.query.page =
          normalizePage(
            req.query.page
          );

        req.query.limit =
          normalizeLimit(
            req.query.limit
          );

        const result =
          await invokeController(
            controller,
            [
              "getMyReferrals",
              "listMyReferrals",
              "getReferrals",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || {
                items: [],
                page:
                  req.query.page,
                limit:
                  req.query.limit,
              },
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * GET /user/:userId
   * ========================================================================
   *
   * Tenant-scoped administrative/privileged referral lookup.
   *
   * This endpoint is intentionally protected with authorization middleware.
   *
   * Recommended permission:
   *
   *   referrals.read
   */
  router.get(
    "/user/:userId",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authorize,
    privilegedRateLimiter,
    validateUserIdParam,
    async (req, res, next) => {
      try {
        const result =
          await invokeController(
            controller,
            [
              "getUserReferral",
              "getReferralByUserId",
              "getReferralProfileByUserId",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * GET /analytics
   * ========================================================================
   *
   * Tenant-scoped referral analytics.
   *
   * Recommended permission:
   *
   *   referrals.analytics.read
   */
  router.get(
    "/analytics",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authorize,
    privilegedRateLimiter,
    async (req, res, next) => {
      try {
        req.query.page =
          normalizePage(
            req.query.page
          );

        req.query.limit =
          normalizeLimit(
            req.query.limit
          );

        const result =
          await invokeController(
            controller,
            [
              "getReferralAnalytics",
              "getAnalytics",
              "getReferralMetrics",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * POST /reward
   * ========================================================================
   *
   * Privileged/manual reward operation.
   *
   * SECURITY:
   *   The route does NOT accept a reward amount as authoritative financial
   *   truth. The downstream domain service must calculate/validate the reward.
   *
   * Recommended permission:
   *
   *   referrals.rewards.issue
   *
   * This endpoint should be used sparingly. Automated referral rewards should
   * generally originate from an event/queue flow and be processed by:
   *
   *   referralRewardWorker
   *
   * followed by the canonical financial operation boundary.
   */
  router.post(
    "/reward",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authorize,
    privilegedRateLimiter,
    async (req, res, next) => {
      try {
        /**
         * Idempotency is mandatory for a financial-affecting operation.
         */
        const idempotencyKey =
          req.idempotencyKey ||
          req.get?.(
            "Idempotency-Key"
          );

        if (
          !idempotencyKey
        ) {
          throw new ReferralRouteError(
            "Idempotency-Key is required for referral reward operations",
            {
              status: 400,
              code:
                "IDEMPOTENCY_KEY_REQUIRED",
              expose: true,
            }
          );
        }

        req.idempotencyKey =
          normalizeString(
            idempotencyKey,
            {
              field:
                "Idempotency-Key",
              required: true,
              maxLength: 256,
            }
          );

        /**
         * Client cannot directly dictate final financial amounts.
         */
        if (
          Object.prototype.hasOwnProperty.call(
            req.body || {},
            "rewardAmount"
          ) ||
          Object.prototype.hasOwnProperty.call(
            req.body || {},
            "amount"
          )
        ) {
          delete req.body.rewardAmount;
          delete req.body.amount;
        }

        const result =
          await invokeController(
            controller,
            [
              "issueReferralReward",
              "processReferralReward",
              "rewardReferral",
              "grantReferralReward",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
            idempotencyKey:
              req.idempotencyKey,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * POST /admin/reconcile
   * ========================================================================
   *
   * Privileged referral/reward reconciliation endpoint.
   *
   * Recommended permission:
   *
   *   referrals.reconcile
   */
  router.post(
    "/admin/reconcile",
    authenticate,
    requireAuthenticatedUser,
    tenantMiddleware,
    requireTenantContext,
    authorize,
    privilegedRateLimiter,
    async (req, res, next) => {
      try {
        const result =
          await invokeController(
            controller,
            [
              "reconcileReferrals",
              "reconcileReferralRewards",
              "reconcile",
            ],
            req,
            res,
            {
              legacyControllerContract,
            }
          );

        res.status(200).json(
          {
            success: true,
            data:
              result || null,
            requestId:
              req.requestId,
            correlationId:
              req.correlationId,
          }
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * ========================================================================
   * 404 for referral subroutes
   * ========================================================================
   */
  router.use(
    (req, _res, next) => {
      next(
        new ReferralRouteError(
          "Referral endpoint not found",
          {
            status: 404,
            code:
              "REFERRAL_ROUTE_NOT_FOUND",
            expose: true,
            details: {
              method:
                req.method,
              path:
                req.originalUrl ||
                req.url,
            },
          }
        )
      );
    }
  );

  /**
   * ========================================================================
   * Router Error Handler
   * ========================================================================
   *
   * This is intentionally last.
   *
   * It never exposes:
   *
   *   - stack traces
   *   - database connection details
   *   - internal file paths
   *   - authentication secrets
   *   - financial internals
   */
  router.use(
    (error, req, res, _next) => {
      const status =
        Number.isInteger(
          error?.status
        ) &&
        error.status >= 400 &&
        error.status <= 599
          ? error.status
          : 500;

      const code =
        error?.code ||
        "REFERRAL_ROUTE_ERROR";

      logger.error(
        `[${ROUTE_NAME}] Request failed`,
        {
          ...logContext(req),
          status,
          code,
          error:
            error?.message ||
            "Unknown referral route error",
        }
      );

      if (
        res.headersSent
      ) {
        return;
      }

      return res
        .status(status)
        .json({
          success: false,

          error: {
            code,

            message:
              safeErrorMessage(
                error
              ),

            requestId:
              req.requestId ||
              null,

            correlationId:
              req.correlationId ||
              null,
          },
        });
    }
  );

  return router;
}

/**
 * =============================================================================
 * Default Router
 * =============================================================================
 *
 * This object is created without automatically starting workers, queues, or
 * other infrastructure.
 *
 * The application's canonical bootstrap layer can mount it explicitly:
 *
 *   app.use(
 *     "/api/referrals",
 *     referralRoutes
 *   );
 *
 * =============================================================================
 */

const referralRoutes =
  createReferralRouter();

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports =
  referralRoutes;

module.exports.createReferralRouter =
  createReferralRouter;

module.exports.ReferralRouteError =
  ReferralRouteError;

module.exports.DEFAULT_BASE_PATH =
  DEFAULT_BASE_PATH;

module.exports.ROUTE_NAME =
  ROUTE_NAME;