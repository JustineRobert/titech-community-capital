'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Analytics Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/adminAnalytics.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for TITech Community Capital administrative analytics.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 * GET /api/admin/analytics/payments?from=&to=
 * GET /api/admin/analytics/users?days=30
 * GET /api/admin/analytics/loans
 * GET /api/admin/analytics/referrals
 * GET /api/admin/analytics/dashboard?from=&to=&days=30
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * HTTP
 *   ↓
 * Authentication
 *   ↓
 * Admin context
 *   ↓
 * Tenant context
 *   ↓
 * Permission / RBAC
 *   ↓
 * Validation / normalization
 *   ↓
 * AnalyticsService
 *
 * This router MUST NOT:
 *   - query MongoDB directly
 *   - calculate financial metrics itself
 *   - authorize tenants from query parameters
 *   - expose stack traces
 *   - accept invalid date ranges silently
 *   - allow arbitrary unbounded `days`
 *
 * ============================================================================
 */

const express = require('express');
const asyncHandler =
  require('express-async-handler');

const AnalyticsService =
  require('../services/analyticsService');

/**
 * ============================================================================
 * OPTIONAL / CANONICAL ADMIN UTILITIES
 * ============================================================================
 */

let adminContext = null;
let adminValidation = null;
let adminDates = null;

try {
  adminContext =
    require('../utils/admin/adminContext');
} catch {
  adminContext = null;
}

try {
  adminValidation =
    require('../utils/admin/adminValidation');
} catch {
  adminValidation = null;
}

try {
  adminDates =
    require('../utils/admin/adminDates');
} catch {
  adminDates = null;
}

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechAdminAnalyticsRoutes';

const ROUTER_VERSION =
  '2026.1';

const DEFAULT_DAYS =
  30;

const MAX_DAYS =
  3660;

const MAX_PAGE_SIZE =
  100;

const PERMISSIONS = Object.freeze({
  READ:
    'admin.analytics.read',
});

/**
 * ============================================================================
 * ROUTER
 * ============================================================================
 */

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * CONTROLLER / SERVICE SAFETY CHECK
 * ============================================================================
 */

if (
  !AnalyticsService ||
  typeof AnalyticsService !==
    'object'
) {
  throw new Error(
    'TITech AnalyticsService is not available.',
  );
}

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 */

function requestMetadata(
  req,
  res,
  next,
) {
  req.requestId =
    req.requestId ||
    req.headers?.[
      'x-request-id'
    ] ||
    require('node:crypto').randomUUID();

  req.correlationId =
    req.correlationId ||
    req.headers?.[
      'x-correlation-id'
    ] ||
    req.requestId;

  res.setHeader(
    'X-Request-Id',
    req.requestId,
  );

  res.setHeader(
    'X-Correlation-Id',
    req.correlationId,
  );

  res.setHeader(
    'Cache-Control',
    'no-store',
  );

  next();
}

router.use(
  requestMetadata,
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 *
 * In a production TITech deployment, authentication should already be applied
 * globally. We deliberately do not silently disable it here.
 * ============================================================================
 */

let authenticate;

try {
  authenticate =
    require('../middleware/authMiddleware');
} catch {
  try {
    authenticate =
      require('../middleware/auth');
  } catch {
    authenticate = null;
  }
}

if (
  typeof authenticate !==
  'function'
) {
  throw new Error(
    'TITech admin analytics requires authentication middleware.',
  );
}

router.use(
  authenticate,
);

/**
 * ============================================================================
 * TENANT CONTEXT
 * ============================================================================
 */

let tenantMiddleware = null;

try {
  tenantMiddleware =
    require('../middleware/tenantMiddleware');
} catch {
  try {
    tenantMiddleware =
      require('../middleware/tenant');
  } catch {
    tenantMiddleware = null;
  }
}

if (
  tenantMiddleware &&
  typeof tenantMiddleware ===
    'function'
) {
  router.use(
    tenantMiddleware,
  );
}

/**
 * ============================================================================
 * ADMIN CONTEXT
 * ============================================================================
 */

if (
  adminContext &&
  typeof adminContext.middleware ===
    'function'
) {
  router.use(
    adminContext.middleware({
      requiredTenant:
        true,

      requiredActor:
        true,

      service:
        'TITech Admin Analytics API',

      serviceVersion:
        ROUTER_VERSION,
    }),
  );
} else {
  router.use(
    fallbackTenantGuard,
  );
}

/**
 * ============================================================================
 * ADMIN AUTHORIZATION
 * ============================================================================
 *
 * Prefer the project's centralized authorization middleware when available.
 * Fallback permits only the existing User model's `admin` role.
 * ============================================================================
 */

let authorizationModule = null;

try {
  authorizationModule =
    require('../middleware/authorize');
} catch {
  authorizationModule = null;
}

router.use(
  createAdminAuthorization(),
);

/**
 * ============================================================================
 * DATE RANGE VALIDATION
 * ============================================================================
 */

function parseDate(
  value,
  field,
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return null;
  }

  if (
    adminDates &&
    typeof adminDates.toDate ===
      'function'
  ) {
    return adminDates.toDate(
      value,
      {
        field,
        required: true,
      },
    );
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    const error =
      new Error(
        `${field} must be a valid ISO date.`,
      );

    error.statusCode =
      400;

    error.code =
      'INVALID_ANALYTICS_DATE';

    throw error;
  }

  return date;
}

function parseDays(
  value,
) {
  const normalized =
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
      ? DEFAULT_DAYS
      : Number(value);

  if (
    !Number.isInteger(
      normalized,
    ) ||
    normalized < 1 ||
    normalized > MAX_DAYS
  ) {
    const error =
      new Error(
        `days must be an integer between 1 and ${MAX_DAYS}.`,
      );

    error.statusCode =
      400;

    error.code =
      'INVALID_ANALYTICS_DAYS';

    throw error;
  }

  return normalized;
}

function parseDateRange(
  req,
) {
  const from =
    parseDate(
      req.query.from,
      'from',
    );

  const to =
    parseDate(
      req.query.to,
      'to',
    );

  const resolvedTo =
    to ||
    new Date();

  const resolvedFrom =
    from ||
    new Date(
      resolvedTo.getTime() -
        DEFAULT_DAYS *
          24 *
          60 *
          60 *
          1000,
    );

  if (
    resolvedFrom >
    resolvedTo
  ) {
    const error =
      new Error(
        '`from` cannot be later than `to`.',
      );

    error.statusCode =
      400;

    error.code =
      'INVALID_ANALYTICS_DATE_RANGE';

    throw error;
  }

  return {
    from:
      resolvedFrom,

    to:
      resolvedTo,

    fromIso:
      resolvedFrom.toISOString(),

    toIso:
      resolvedTo.toISOString(),
  };
}

/**
 * ============================================================================
 * TENANT RESOLUTION
 * ============================================================================
 *
 * NEVER use req.query.tenantId as authoritative tenant context.
 * ============================================================================
 */

function getTrustedTenantId(
  req,
) {
  const tenantId =
    req.adminContext?.tenantId ||
    req.tenantId ||
    req.user?.tenantId ||
    req.auth?.tenantId;

  if (
    !tenantId
  ) {
    const error =
      new Error(
        'Tenant context is required for administrative analytics.',
      );

    error.statusCode =
      403;

    error.code =
      'TENANT_CONTEXT_REQUIRED';

    throw error;
  }

  return String(
    tenantId,
  );
}

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

function getRequestContext(
  req,
) {
  return {
    tenantId:
      getTrustedTenantId(
        req,
      ),

    actorId:
      req.adminContext?.actorId ||
      req.user?._id ||
      req.user?.id ||
      req.auth?.userId ||
      null,

    requestId:
      req.requestId,

    correlationId:
      req.correlationId,
  };
}

/**
 * ============================================================================
 * ADMIN AUTHORIZATION
 * ============================================================================
 */

function createAdminAuthorization() {
  if (
    typeof authorizationModule ===
    'function'
  ) {
    return authorizationModule(
      'ADMIN',
    );
  }

  if (
    typeof authorizationModule?.authorize ===
    'function'
  ) {
    return authorizationModule.authorize(
      'ADMIN',
    );
  }

  if (
    typeof authorizationModule?.requireRole ===
    'function'
  ) {
    return authorizationModule.requireRole(
      'admin',
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    const role =
      String(
        req.user?.role ||
          req.auth?.role ||
          '',
      ).toLowerCase();

    if (
      role ===
      'admin'
    ) {
      return next();
    }

    return res.status(
      403,
    ).json({
      success:
        false,

      code:
        'ADMIN_ACCESS_REQUIRED',

      message:
        'Administrative privileges are required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  };
}

/**
 * ============================================================================
 * FALLBACK TENANT GUARD
 * ============================================================================
 */

function fallbackTenantGuard(
  req,
  res,
  next,
) {
  const tenantId =
    req.tenantId ||
    req.user?.tenantId ||
    req.auth?.tenantId;

  if (
    !tenantId
  ) {
    return res.status(
      403,
    ).json({
      success:
        false,

      code:
        'TENANT_CONTEXT_REQUIRED',

      message:
        'Tenant context is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.tenantId =
    String(
      tenantId,
    );

  next();
}

/**
 * ============================================================================
 * ANALYTICS SERVICE ADAPTERS
 * ============================================================================
 *
 * Keep the router compatible with the canonical service while allowing a
 * gradual transition from the older signatures:
 *
 *   getPaymentMetrics(from, to)
 *   getUserMetrics(days)
 *   getLoanMetrics()
 *   getReferralMetrics()
 *
 * to a more enterprise signature:
 *
 *   getPaymentMetrics({ tenantId, from, to, context })
 *
 * The adapter prefers the enterprise signature if the service advertises it.
 * ============================================================================
 */

async function getPaymentMetrics(
  context,
  range,
) {
  const method =
    resolveServiceMethod(
      [
        'getPaymentMetrics',
        'payments',
      ],
    );

  if (
    method.acceptsObject
  ) {
    return method.fn({
      ...context,
      ...range,
    });
  }

  return method.fn(
    range.from,
    range.to,
  );
}

async function getUserMetrics(
  context,
  days,
) {
  const method =
    resolveServiceMethod(
      [
        'getUserMetrics',
        'users',
      ],
    );

  if (
    method.acceptsObject
  ) {
    return method.fn({
      ...context,

      days,
    });
  }

  return method.fn(
    days,
  );
}

async function getLoanMetrics(
  context,
  range,
) {
  const method =
    resolveServiceMethod(
      [
        'getLoanMetrics',
        'loans',
      ],
    );

  if (
    method.acceptsObject
  ) {
    return method.fn({
      ...context,
      ...range,
    });
  }

  return method.fn();
}

async function getReferralMetrics(
  context,
  range,
) {
  const method =
    resolveServiceMethod(
      [
        'getReferralMetrics',
        'referrals',
      ],
    );

  if (
    method.acceptsObject
  ) {
    return method.fn({
      ...context,
      ...range,
    });
  }

  return method.fn();
}

function resolveServiceMethod(
  candidates,
) {
  for (
    const candidate of
    candidates
  ) {
    const fn =
      AnalyticsService[
        candidate
      ];

    if (
      typeof fn ===
      'function'
    ) {
      return {
        fn:
          fn.bind(
            AnalyticsService,
          ),

        /**
         * Existing analyticsService APIs generally use positional arguments.
         * Services that explicitly expose `acceptsContextObject === true` can
         * opt into the enterprise object contract.
         */
        acceptsObject:
          AnalyticsService
            .acceptsContextObject ===
          true,
      };
    }
  }

  const error =
    new Error(
      `Analytics service method not implemented: ${candidates.join(
        ', ',
      )}`,
    );

  error.statusCode =
    501;

  error.code =
    'ANALYTICS_SERVICE_METHOD_NOT_IMPLEMENTED';

  throw error;
}

/**
 * ============================================================================
 * RESPONSE ENVELOPE
 * ============================================================================
 */

function sendAnalyticsResponse(
  req,
  res,
  data,
  {
    meta = {},
  } = {},
) {
  return res.status(
    200,
  ).json({
    success:
      true,

    data,

    meta: {
      service:
        'TITech AnalyticsService',

      tenantId:
        getTrustedTenantId(
          req,
        ),

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      generatedAt:
        new Date().toISOString(),

      ...meta,
    },
  });
}

/**
 * ============================================================================
 * PAYMENT ANALYTICS
 * ============================================================================
 *
 * GET /api/admin/analytics/payments?from=&to=
 * ============================================================================
 */

router.get(
  '/payments',
  asyncHandler(
    async (
      req,
      res,
    ) => {
      const context =
        getRequestContext(
          req,
        );

      const range =
        parseDateRange(
          req,
        );

      const metrics =
        await getPaymentMetrics(
          context,
          range,
        );

      return sendAnalyticsResponse(
        req,
        res,
        metrics,
        {
          meta: {
            range: {
              from:
                range.fromIso,

              to:
                range.toIso,
            },
          },
        },
      );
    },
  ),
);

/**
 * ============================================================================
 * USER ANALYTICS
 * ============================================================================
 *
 * GET /api/admin/analytics/users?days=30
 * ============================================================================
 */

router.get(
  '/users',
  asyncHandler(
    async (
      req,
      res,
    ) => {
      const context =
        getRequestContext(
          req,
        );

      const days =
        parseDays(
          req.query.days,
        );

      const metrics =
        await getUserMetrics(
          context,
          days,
        );

      return sendAnalyticsResponse(
        req,
        res,
        metrics,
        {
          meta: {
            days,
          },
        },
      );
    },
  ),
);

/**
 * ============================================================================
 * LOAN ANALYTICS
 * ============================================================================
 *
 * GET /api/admin/analytics/loans
 * ============================================================================
 */

router.get(
  '/loans',
  asyncHandler(
    async (
      req,
      res,
    ) => {
      const context =
        getRequestContext(
          req,
        );

      const range =
        parseDateRange(
          req,
        );

      const metrics =
        await getLoanMetrics(
          context,
          range,
        );

      return sendAnalyticsResponse(
        req,
        res,
        metrics,
        {
          meta: {
            range: {
              from:
                range.fromIso,

              to:
                range.toIso,
            },
          },
        },
      );
    },
  ),
);

/**
 * ============================================================================
 * REFERRAL ANALYTICS
 * ============================================================================
 */

router.get(
  '/referrals',
  asyncHandler(
    async (
      req,
      res,
    ) => {
      const context =
        getRequestContext(
          req,
        );

      const range =
        parseDateRange(
          req,
        );

      const metrics =
        await getReferralMetrics(
          context,
          range,
        );

      return sendAnalyticsResponse(
        req,
        res,
        metrics,
        {
          meta: {
            range: {
              from:
                range.fromIso,

              to:
                range.toIso,
            },
          },
        },
      );
    },
  ),
);

/**
 * ============================================================================
 * COMPOSITE DASHBOARD
 * ============================================================================
 *
 * GET /api/admin/analytics/dashboard
 *
 * The four datasets use a single resolved tenant + time window so the dashboard
 * is internally consistent.
 * ============================================================================
 */

router.get(
  '/dashboard',
  asyncHandler(
    async (
      req,
      res,
    ) => {
      const context =
        getRequestContext(
          req,
        );

      const range =
        parseDateRange(
          req,
        );

      const days =
        parseDays(
          req.query.days,
        );

      const [
        payments,
        users,
        loans,
        referrals,
      ] =
        await Promise.all([
          getPaymentMetrics(
            context,
            range,
          ),

          getUserMetrics(
            context,
            days,
          ),

          getLoanMetrics(
            context,
            range,
          ),

          getReferralMetrics(
            context,
            range,
          ),
        ]);

      return sendAnalyticsResponse(
        req,
        res,
        {
          payments,
          users,
          loans,
          referrals,
        },
        {
          meta: {
            range: {
              from:
                range.fromIso,

              to:
                range.toIso,
            },

            days,

            components: [
              'payments',
              'users',
              'loans',
              'referrals',
            ],
          },
        },
      );
    },
  ),
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
  '/health',
  (
    req,
    res,
  ) => {
    return res.status(
      200,
    ).json({
      success:
        true,

      service:
        'TITech Admin Analytics',

      router:
        ROUTER_NAME,

      version:
        ROUTER_VERSION,

      analyticsService:
        Boolean(
          AnalyticsService,
        ),

      tenantScoped:
        true,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    });
  },
);

/**
 * ============================================================================
 * NOT FOUND
 * ============================================================================
 */

router.use(
  (
    req,
    res,
  ) => {
    return res.status(
      404,
    ).json({
      success:
        false,

      code:
        'ANALYTICS_ENDPOINT_NOT_FOUND',

      message:
        'Analytics endpoint not found.',

      path:
        req.originalUrl,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    });
  },
);

/**
 * ============================================================================
 * ERROR HANDLER
 * ============================================================================
 */

router.use(
  (
    error,
    req,
    res,
    next,
  ) => {
    if (
      res.headersSent
    ) {
      return next(
        error,
      );
    }

    const statusCode =
      Number(
        error?.statusCode,
      ) >=
        400 &&
      Number(
        error?.statusCode,
      ) <
        600
        ? Number(
            error.statusCode,
          )
        : 500;

    const clientError =
      statusCode >=
        400 &&
      statusCode <
        500;

    return res.status(
      statusCode,
    ).json({
      success:
        false,

      code:
        error?.code ||
        (
          clientError
            ? 'ANALYTICS_REQUEST_ERROR'
            : 'ANALYTICS_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The analytics request could not be completed.'
            )
          : 'The analytics request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    });
  },
);

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  router;

module.exports.ROUTER_NAME =
  ROUTER_NAME;

module.exports.ROUTER_VERSION =
  ROUTER_VERSION;

module.exports.PERMISSIONS =
  PERMISSIONS;