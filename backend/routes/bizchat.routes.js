'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise BizChat Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/bizchat.routes.js
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 * POST /api/bizchat/execute
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   Request
 *      ↓
 *   Request / Correlation Metadata
 *      ↓
 *   Authentication
 *      ↓
 *   Tenant / Admin Context
 *      ↓
 *   Permission
 *      ↓
 *   Rate Limiting
 *      ↓
 *   Request Validation
 *      ↓
 *   BizChat Controller
 *      ↓
 *   BizChat Service / Domain Services
 *
 * This route MUST NOT:
 *
 *   ✗ execute financial operations directly
 *   ✗ access repositories directly
 *   ✗ bypass RBAC
 *   ✗ accept an arbitrary tenantId as trusted context
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

const PERMISSION =
  'bizchat.execute';

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
 * REQUEST METADATA
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

function requestContext(
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

  res.setHeader(
    'Cache-Control',
    'no-store',
  );

  next();
}

router.use(
  requestContext,
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
      'X-Content-Type-Options',
      'nosniff',
    );

    res.setHeader(
      'Referrer-Policy',
      'no-referrer',
    );

    next();
  },
);

/**
 * ============================================================================
 * RATE LIMITER
 * ============================================================================
 *
 * BizChat may become an expensive orchestration/AI endpoint, so it should not
 * be treated like a normal read-only API.
 * ============================================================================
 */

const bizchatLimiter =
  rateLimit({
    windowMs:
      60 * 1000,

    max:
      Number(
        process.env.TITECH_BIZCHAT_RATE_LIMIT ||
          30,
      ),

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    keyGenerator(
      req,
    ) {
      return (
        normalizeString(
          req.user?.id ||
            req.user?._id ||
            req.auth?.userId,
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
 * AUTHENTICATION
 * ============================================================================
 */

router.use(
  requireAuth,
);

/**
 * ============================================================================
 * OPTIONAL CANONICAL ADMIN / REQUEST CONTEXT
 * ============================================================================
 *
 * BizChat should inherit the same tenant context used by TITech services.
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
}

/**
 * ============================================================================
 * REQUEST BODY VALIDATION
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

  /**
   * Accept common command/message shapes while allowing the controller/service
   * to own domain-specific validation.
   */
  const message =
    body.message ||
    body.prompt ||
    body.command ||
    null;

  if (
    typeof message !==
      'string' ||
    message.trim()
      .length === 0
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_MESSAGE_REQUIRED',

      message:
        'A BizChat message or command is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    message.length >
    Number(
      process.env.TITECH_BIZCHAT_MAX_MESSAGE_LENGTH ||
        10000,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'BIZCHAT_MESSAGE_TOO_LONG',

      message:
        'The BizChat message exceeds the maximum supported length.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Prevent obvious control-character injection into logs/transport.
   * Normal newlines/tabs remain permitted.
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

  next();
}

/**
 * ============================================================================
 * PERMISSION
 * ============================================================================
 *
 * `checkPermission` is now actually used.
 *
 * Depending on the project's middleware contract, this supports:
 *
 *   checkPermission('bizchat.execute')
 *
 * or an array-style permission contract.
 * ============================================================================
 */

function permissionMiddleware() {
  if (
    typeof checkPermission !==
    'function'
  ) {
    throw new Error(
      `[${ROUTER_NAME}] checkPermission middleware is required.`,
    );
  }

  return checkPermission(
    PERMISSION,
  );
}

/**
 * ============================================================================
 * EXECUTE
 * ============================================================================
 *
 * POST /api/bizchat/execute
 * ============================================================================
 */

router.post(
  '/execute',

  bizchatLimiter,

  permissionMiddleware(),

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
        'TITech BizChat',

      version:
        ROUTER_VERSION,

      authenticated:
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

    return res.status(
      statusCode,
    ).json({
      success:
        false,

      code:
        error?.code ||
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
    });
  },
);

/**
 * ============================================================================
 * ASYNC HANDLER
 * ============================================================================
 *
 * Falls back only for compatibility if the project's utility does not expose
 * the expected middleware.
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
 * METADATA
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.permission =
  PERMISSION;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;