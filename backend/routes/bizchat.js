'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise BizChat Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/bizchat.js
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 * POST /api/bizchat/execute
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Authentication
 *        ↓
 *   Tenant / Admin Context
 *        ↓
 *   Permission Enforcement
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Request Validation
 *        ↓
 *   BizChat Controller
 *        ↓
 *   BizChat Service / Domain Services
 *
 * Security principles
 * ----------------------------------------------------------------------------
 * ✓ Authentication is mandatory
 * ✓ Permission enforcement is mandatory
 * ✓ Tenant context is trusted, not client-selected
 * ✓ BizChat execution is rate limited
 * ✓ Input is validated before controller execution
 * ✓ Responses are non-cacheable
 * ✓ Request/correlation IDs are propagated
 * ✓ Internal exceptions are not exposed to clients
 * ✓ No direct database/repository access
 * ✓ No financial business logic in the route
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS terminology is replaced by TITech Community Capital.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

const requireAuth =
  require('../middleware/requireAuth');

const checkPermission =
  require('../middleware/checkPermission');

const bizchatController =
  require('../controllers/bizchat.controller');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechBizChatRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech BizChat';

const EXECUTE_PERMISSION =
  'bizchat.execute';

const DEFAULT_RATE_LIMIT =
  30;

const DEFAULT_MAX_MESSAGE_LENGTH =
  10000;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

if (
  !bizchatController ||
  typeof bizchatController.execute !==
    'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing bizchatController.execute export.`,
  );
}

/**
 * ============================================================================
 * NORMALIZATION
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return normalized || fallback;
}

/**
 * ============================================================================
 * REQUEST / CORRELATION METADATA
 * ============================================================================
 */

function requestMetadata(
  req,
  res,
  next,
) {
  const requestId =
    normalizeString(
      req.requestId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ],
    ) ||
    crypto.randomUUID();

  const correlationId =
    normalizeString(
      req.correlationId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-correlation-id'
      ],
    ) ||
    requestId;

  req.requestId =
    requestId;

  req.correlationId =
    correlationId;

  res.setHeader(
    'X-Request-Id',
    requestId,
  );

  res.setHeader(
    'X-Correlation-Id',
    correlationId,
  );

  next();
}

router.use(
  requestMetadata,
);

/**
 * ============================================================================
 * SECURITY HEADERS
 * ============================================================================
 */

router.use(
  (
    req,
    res,
    next,
  ) => {
    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    res.setHeader(
      'Pragma',
      'no-cache',
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff',
    );

    res.setHeader(
      'Referrer-Policy',
      'no-referrer',
    );

    res.setHeader(
      'X-Frame-Options',
      'DENY',
    );

    next();
  },
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

if (
  typeof requireAuth !==
  'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] requireAuth middleware is required.`,
  );
}

router.use(
  requireAuth,
);

/**
 * ============================================================================
 * TITech ADMIN / TENANT CONTEXT
 * ============================================================================
 *
 * Uses the canonical adminContext utility when available.
 *
 * The route never treats req.body.tenantId or req.query.tenantId as trusted
 * tenant identity.
 * ============================================================================
 */

let adminContextMiddleware =
  null;

try {
  const adminContext =
    require('../utils/admin/adminContext');

  if (
    typeof adminContext?.middleware ===
    'function'
  ) {
    adminContextMiddleware =
      adminContext.middleware({
        requiredTenant:
          true,

        requiredActor:
          true,

        service:
          'TITech BizChat API',

        serviceVersion:
          ROUTER_VERSION,
      });
  }
} catch {
  adminContextMiddleware =
    null;
}

if (
  adminContextMiddleware
) {
  router.use(
    adminContextMiddleware,
  );
} else {
  router.use(
    fallbackTenantContext,
  );
}

/**
 * ============================================================================
 * RATE LIMITING
 * ============================================================================
 *
 * BizChat can be significantly more expensive than a normal CRUD request.
 * ============================================================================
 */

const parsedRateLimit =
  Number(
    process.env.TITECH_BIZCHAT_RATE_LIMIT ||
      DEFAULT_RATE_LIMIT,
  );

const bizchatRateLimit =
  Number.isInteger(
    parsedRateLimit,
  ) &&
  parsedRateLimit > 0
    ? parsedRateLimit
    : DEFAULT_RATE_LIMIT;

const bizchatLimiter =
  rateLimit({
    windowMs:
      60 * 1000,

    max:
      bizchatRateLimit,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    keyGenerator(
      req,
    ) {
      /**
       * Prefer the authenticated actor as the application-level key while
       * retaining IP fallback for malformed/unauthenticated traffic.
       */
      return (
        normalizeString(
          req.user?.id ||
            req.user?._id ||
            req.user?.userId ||
            req.auth?.userId ||
            req.adminContext?.actorId,
        ) ||
        normalizeString(
          req.ip,
        ) ||
        'unknown'
      );
    },

    handler(
      req,
      res,
    ) {
      const retryAfter =
        60;

      res.setHeader(
        'Retry-After',
        String(
          retryAfter,
        ),
      );

      return res.status(
        429,
      ).json({
        success:
          false,

        code:
          'BIZCHAT_RATE_LIMITED',

        message:
          'Too many BizChat execution requests. Please try again later.',

        retryAfter,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
    },
  });

/**
 * ============================================================================
 * PERMISSION ENFORCEMENT
 * ============================================================================
 *
 * Prefer:
 *
 *   checkPermission('bizchat.execute')
 *
 * If the project's middleware uses another signature, adapt the middleware
 * itself rather than bypassing this security boundary.
 * ============================================================================
 */

function requireBizChatPermission(
  req,
  res,
  next,
) {
  if (
    typeof checkPermission !==
    'function'
  ) {
    return res.status(
      500,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_PERMISSION_MIDDLEWARE_UNAVAILABLE',

      message:
        'BizChat permission enforcement is unavailable.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Most TITech middleware implementations expose a factory:
   *
   *   checkPermission('permission.name')
   *
   * Resolve once and execute it for the current request.
   */
  let permissionMiddleware;

  try {
    permissionMiddleware =
      checkPermission(
        EXECUTE_PERMISSION,
      );
  } catch (error) {
    return next(
      error,
    );
  }

  if (
    typeof permissionMiddleware !==
    'function'
  ) {
    return res.status(
      500,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_PERMISSION_CONTRACT_INVALID',

      message:
        'BizChat permission middleware has an invalid contract.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  return permissionMiddleware(
    req,
    res,
    next,
  );
}

/**
 * ============================================================================
 * REQUEST VALIDATION
 * ============================================================================
 */

function validateExecuteRequest(
  req,
  res,
  next,
) {
  const body =
    req.body;

  if (
    !body ||
    typeof body !==
      'object' ||
    Array.isArray(
      body,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_BIZCHAT_REQUEST',

      message:
        'BizChat execution requires a JSON object request body.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  const message =
    body.message ||
    body.prompt ||
    body.command ||
    null;

  if (
    typeof message !==
      'string' ||
    message.trim().length ===
      0
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_MESSAGE_REQUIRED',

      message:
        'A BizChat message, prompt, or command is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  const maxMessageLength =
    Number(
      process.env
        .TITECH_BIZCHAT_MAX_MESSAGE_LENGTH ||
        DEFAULT_MAX_MESSAGE_LENGTH,
    );

  const safeMaxMessageLength =
    Number.isInteger(
      maxMessageLength,
    ) &&
    maxMessageLength > 0
      ? maxMessageLength
      : DEFAULT_MAX_MESSAGE_LENGTH;

  if (
    message.length >
    safeMaxMessageLength
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_MESSAGE_TOO_LONG',

      message:
        `The BizChat input exceeds the maximum length of ${safeMaxMessageLength} characters.`,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Reject binary/control-character noise while allowing ordinary whitespace,
   * newlines and tabs.
   */
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
      message,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'UNSAFE_BIZCHAT_INPUT',

      message:
        'The BizChat request contains unsupported control characters.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Normalize the canonical message field without destroying additional
   * controller/service fields.
   */
  req.body =
    {
      ...body,

      message:
        message.trim(),
    };

  next();
}

/**
 * ============================================================================
 * TENANT FALLBACK
 * ============================================================================
 *
 * This is only used when the canonical adminContext middleware cannot be
 * loaded. It still fails closed when no trusted tenant is available.
 * ============================================================================
 */

function fallbackTenantContext(
  req,
  res,
  next,
) {
  const tenantId =
    normalizeString(
      req.tenantId ||
        req.user?.tenantId ||
        req.auth?.tenantId,
    );

  const actorId =
    normalizeString(
      req.user?.id ||
        req.user?._id ||
        req.user?.userId ||
        req.auth?.userId,
    );

  if (!tenantId) {
    return res.status(
      403,
    ).json({
      success:
        false,

      code:
        'TENANT_CONTEXT_REQUIRED',

      message:
        'A trusted tenant context is required for BizChat.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (!actorId) {
    return res.status(
      401,
    ).json({
      success:
        false,

      code:
        'ACTOR_CONTEXT_REQUIRED',

      message:
        'An authenticated actor context is required for BizChat.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.tenantId =
    tenantId;

  req.adminContext =
    {
      tenantId,

      actorId,

      userId:
        actorId,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    };

  next();
}

/**
 * ============================================================================
 * EXECUTION ROUTE
 * ============================================================================
 *
 * POST /api/bizchat/execute
 * ============================================================================
 */

router.post(
  '/execute',

  bizchatLimiter,

  requireBizChatPermission,

  validateExecuteRequest,

  asyncHandler(
    bizchatController.execute,
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
        SERVICE_NAME,

      version:
        ROUTER_VERSION,

      authenticated:
        true,

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
        'BIZCHAT_ROUTE_NOT_FOUND',

      message:
        'BizChat endpoint not found.',

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
 * CENTRALIZED ERROR HANDLER
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
      ) >= 400 &&
      Number(
        error?.statusCode,
      ) < 600
        ? Number(
            error.statusCode,
          )
        : 500;

    const clientError =
      statusCode >= 400 &&
      statusCode < 500;

    const response = {
      success:
        false,

      code:
        normalizeString(
          error?.code,
        ) ||
        (
          clientError
            ? 'BIZCHAT_REQUEST_ERROR'
            : 'BIZCHAT_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The BizChat request could not be completed.'
            )
          : 'The BizChat request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

    /**
     * Do not expose stacks, provider errors, database errors or filesystem
     * details.
     */
    if (
      clientError &&
      error?.details
    ) {
      response.details =
        error.details;
    }

    return res.status(
      statusCode,
    ).json(
      response,
    );
  },
);

/**
 * ============================================================================
 * ASYNC HANDLER
 * ============================================================================
 *
 * The project may already provide utils/asyncHandler, but this local wrapper
 * keeps this route self-contained if the imported utility has a different
 * contract.
 * ============================================================================
 */

function asyncHandler(
  handler,
) {
  return (
    req,
    res,
    next,
  ) => {
    Promise.resolve(
      handler(
        req,
        res,
        next,
      ),
    ).catch(
      next,
    );
  };
}

/**
 * ============================================================================
 * ROUTER METADATA
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.serviceName =
  SERVICE_NAME;

router.permission =
  EXECUTE_PERMISSION;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;