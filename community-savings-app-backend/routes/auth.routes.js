'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Authentication Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/auth.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP boundary for authentication, session management, token
 * lifecycle and administrator session operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 * Public:
 *
 *   POST /register
 *   POST /login
 *   POST /forgot-password
 *   POST /refresh
 *   POST /refresh-token          (legacy compatibility alias)
 *   POST /logout
 *
 * Authenticated:
 *
 *   POST   /logout-all
 *   GET    /me
 *   GET    /sessions
 *   DELETE /sessions/:id
 *
 * Administrator:
 *
 *   GET    /admin/sessions
 *   DELETE /admin/sessions/:id
 *
 * Operational:
 *
 *   GET    /status
 *
 * Security architecture
 * ----------------------------------------------------------------------------
 * Request
 *   ↓
 * Request / correlation metadata
 *   ↓
 * Security headers
 *   ↓
 * Rate limiting
 *   ↓
 * Input validation
 *   ↓
 * Authentication
 *   ↓
 * RBAC / permission enforcement
 *   ↓
 * Controller
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router MUST NOT:
 *
 *   ✗ hash passwords
 *   ✗ issue JWTs directly
 *   ✗ refresh token state directly
 *   ✗ modify sessions directly
 *   ✗ access MongoDB directly
 *   ✗ perform tenant authorization itself
 *
 * Those responsibilities belong to authentication/session services and
 * middleware.
 *
 * TITech terminology is used consistently.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

const asyncHandler =
  require('../utils/asyncHandler');

const {
  validationRules,
  handleValidation,
} =
  require('../utils/validators');

const {
  authenticate,
  requireRole,
} =
  require('../middleware/auth');

const authController =
  require('../controllers/authController');

const emailController =
  require('../controllers/emailController');

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
  'TITechAuthenticationRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'auth';

const APPLICATION_NAME =
  'TITech Community Capital';

/**
 * ============================================================================
 * CONTROLLER VALIDATION
 * ============================================================================
 */

const REQUIRED_AUTH_HANDLERS =
  Object.freeze([
    'register',
    'login',
    'refresh',
    'logout',
    'logoutAll',
    'me',
    'listSessions',
    'revokeSession',
    'adminListSessions',
    'adminRevokeSession',
  ]);

for (
  const handler of
  REQUIRED_AUTH_HANDLERS
) {
  if (
    typeof authController[
      handler
    ] !==
    'function'
  ) {
    throw new Error(
      `[${ROUTER_NAME}] Missing authController export: ${handler}`,
    );
  }
}

if (
  typeof emailController
    ?.requestPasswordReset !==
  'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing emailController.requestPasswordReset export.`,
  );
}

/**
 * ============================================================================
 * ENVIRONMENT / SECURITY FLAGS
 * ============================================================================
 */

const isProduction =
  process.env.NODE_ENV ===
  'production';

/**
 * Localhost bypass is deliberately OFF by default.
 *
 * To enable it in local development:
 *
 *   TITECH_AUTH_ALLOW_LOCALHOST_RATE_LIMIT_BYPASS=true
 *
 * Never enable this in production.
 */
const allowLocalhostRateLimitBypass =
  !isProduction &&
  String(
    process.env
      .TITECH_AUTH_ALLOW_LOCALHOST_RATE_LIMIT_BYPASS ||
      '',
  ).toLowerCase() ===
    'true';

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 */

function getRequestId(
  req,
) {
  return (
    normalizeString(
      req.requestId,
    ) ||
    normalizeString(
      req.id,
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ],
    ) ||
    crypto.randomUUID()
  );
}

function getCorrelationId(
  req,
  requestId,
) {
  return (
    normalizeString(
      req.correlationId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-correlation-id'
      ],
    ) ||
    requestId
  );
}

function requestMetadata(
  req,
  res,
  next,
) {
  const requestId =
    getRequestId(
      req,
    );

  const correlationId =
    getCorrelationId(
      req,
      requestId,
    );

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

/**
 * ============================================================================
 * SECURITY RESPONSE HEADERS
 * ============================================================================
 */

function securityHeaders(
  req,
  res,
  next,
) {
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
}

router.use(
  requestMetadata,
);

router.use(
  securityHeaders,
);

/**
 * ============================================================================
 * RATE LIMIT CONFIGURATION
 * ============================================================================
 */

function getClientAddress(
  req,
) {
  return (
    normalizeString(
      req.ip,
    ) ||
    normalizeString(
      req.socket?.remoteAddress,
    ) ||
    normalizeString(
      req.connection?.remoteAddress,
    ) ||
    'unknown'
  );
}

function shouldBypassLocalhost(
  req,
) {
  if (
    !allowLocalhostRateLimitBypass
  ) {
    return false;
  }

  const ip =
    getClientAddress(
      req,
    );

  return (
    ip ===
      '127.0.0.1' ||
    ip ===
      '::1' ||
    ip.includes(
      '127.0.0.1',
    )
  );
}

function createLimiter({
  windowMs,
  max,
  message,
  code =
    'RATE_LIMITED',
  skipSuccessfulRequests =
    false,
}) {
  return rateLimit({
    windowMs,

    max,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests,

    skip:
      shouldBypassLocalhost,

    keyGenerator(
      req,
    ) {
      return getClientAddress(
        req,
      );
    },

    handler(
      req,
      res,
    ) {
      const retryAfter =
        Math.ceil(
          windowMs /
            1000,
        );

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

        code,

        message,

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
}

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 *
 * Authentication endpoints should generally count both successes and failures.
 * Otherwise an attacker can consume successful login/reset operations without
 * being meaningfully throttled.
 * ============================================================================
 */

const registerLimiter =
  createLimiter({
    windowMs:
      15 *
      60 *
      1000,

    max:
      20,

    message:
      'Too many registration attempts. Please try again later.',

    code:
      'REGISTRATION_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

const loginLimiter =
  createLimiter({
    windowMs:
      5 *
      60 *
      1000,

    max:
      50,

    message:
      'Too many authentication attempts. Please try again later.',

    code:
      'LOGIN_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

const passwordResetLimiter =
  createLimiter({
    windowMs:
      15 *
      60 *
      1000,

    max:
      10,

    message:
      'Too many password reset requests. Please try again later.',

    code:
      'PASSWORD_RESET_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

const refreshLimiter =
  createLimiter({
    windowMs:
      60 *
      1000,

    max:
      120,

    message:
      'Too many token refresh requests. Please try again later.',

    code:
      'REFRESH_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

const logoutLimiter =
  createLimiter({
    windowMs:
      60 *
      1000,

    max:
      60,

    message:
      'Too many logout requests.',

    code:
      'LOGOUT_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

const sessionLimiter =
  createLimiter({
    windowMs:
      60 *
      1000,

    max:
      120,

    message:
      'Too many session requests.',

    code:
      'SESSION_RATE_LIMITED',

    skipSuccessfulRequests:
      false,
  });

/**
 * ============================================================================
 * VALIDATION HELPERS
 * ============================================================================
 */

function requireValidationRule(
  name,
) {
  const rule =
    validationRules?.[
      name
    ];

  if (
    typeof rule !==
    'function' &&
    !Array.isArray(
      rule,
    )
  ) {
    throw new Error(
      `[${ROUTER_NAME}] Missing validation rule: ${name}`,
    );
  }

  return rule;
}

function validateSessionId(
  req,
  res,
  next,
) {
  const id =
    normalizeString(
      req.params?.id,
    );

  if (
    !id
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'SESSION_ID_REQUIRED',

      message:
        'Session ID is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    id.length >
    200
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_SESSION_ID',

      message:
        'Session ID is invalid.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    /[\u0000-\u001F\u007F]/.test(
      id,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_SESSION_ID',

      message:
        'Session ID contains unsupported characters.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  next();
}

/**
 * Password-reset payloads are intentionally validated without allowing the
 * router to distinguish whether an email exists.
 *
 * The controller should always return a generic response.
 */
function validatePasswordResetRequest(
  req,
  res,
  next,
) {
  const email =
    normalizeString(
      req.body?.email,
    )?.toLowerCase();

  if (
    !email
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'EMAIL_REQUIRED',

      message:
        'A valid email address is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    email.length >
    320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_EMAIL',

      message:
        'A valid email address is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.body =
    {
      ...req.body,

      email,
    };

  next();
}

/**
 * ============================================================================
 * AUTHENTICATION CONTEXT
 * ============================================================================
 */

function getAuthenticatedUser(
  req,
) {
  return (
    req.user ||
    req.auth ||
    null
  );
}

function requireAuthenticatedActor(
  req,
) {
  const user =
    getAuthenticatedUser(
      req,
    );

  if (
    !user
  ) {
    return false;
  }

  return true;
}

/**
 * ============================================================================
 * ADMIN AUTHORIZATION
 * ============================================================================
 *
 * We retain requireRole('admin') because it already exists in your project,
 * but wrap it so future permission middleware can replace it centrally.
 * ============================================================================
 */

function adminOnly(
  req,
  res,
  next,
) {
  return requireRole(
    'admin',
  )(
    req,
    res,
    next,
  );
}

/**
 * ============================================================================
 * ROUTER PUBLIC MIDDLEWARE
 * ============================================================================
 */

router.use(
  express.json({
    limit:
      process.env.TITECH_AUTH_BODY_LIMIT ||
      '1mb',
  }),
);

/**
 * ============================================================================
 * PUBLIC ROUTES
 * ============================================================================
 */

/**
 * POST /register
 */
router.post(
  '/register',

  registerLimiter,

  requireValidationRule(
    'register',
  ),

  handleValidation,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.register(
        req,
        res,
      );
    },
  ),
);

/**
 * POST /login
 */
router.post(
  '/login',

  loginLimiter,

  requireValidationRule(
    'login',
  ),

  handleValidation,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.login(
        req,
        res,
      );
    },
  ),
);

/**
 * POST /forgot-password
 *
 * Do not reveal whether an account exists.
 */
router.post(
  '/forgot-password',

  passwordResetLimiter,

  validatePasswordResetRequest,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return emailController.requestPasswordReset(
        req,
        res,
      );
    },
  ),
);

/**
 * POST /refresh
 */
router.post(
  '/refresh',

  refreshLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.refresh(
        req,
        res,
      );
    },
  ),
);

/**
 * POST /refresh-token
 *
 * Backward-compatible legacy alias.
 */
router.post(
  '/refresh-token',

  refreshLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.refresh(
        req,
        res,
      );
    },
  ),
);

/**
 * POST /logout
 *
 * Logout remains public because access-token/session invalidation may be
 * required after partial authentication state loss.
 */
router.post(
  '/logout',

  logoutLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.logout(
        req,
        res,
      );
    },
  ),
);

/**
 * ============================================================================
 * AUTHENTICATED ROUTES
 * ============================================================================
 */

/**
 * POST /logout-all
 */
router.post(
  '/logout-all',

  authenticate,

  sessionLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.logoutAll(
        req,
        res,
      );
    },
  ),
);

/**
 * GET /me
 */
router.get(
  '/me',

  authenticate,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.me(
        req,
        res,
      );
    },
  ),
);

/**
 * GET /sessions
 */
router.get(
  '/sessions',

  authenticate,

  sessionLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.listSessions(
        req,
        res,
      );
    },
  ),
);

/**
 * DELETE /sessions/:id
 */
router.delete(
  '/sessions/:id',

  authenticate,

  sessionLimiter,

  validateSessionId,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.revokeSession(
        req,
        res,
      );
    },
  ),
);

/**
 * ============================================================================
 * ADMIN SESSION MANAGEMENT
 * ============================================================================
 */

/**
 * GET /admin/sessions
 */
router.get(
  '/admin/sessions',

  authenticate,

  adminOnly,

  sessionLimiter,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.adminListSessions(
        req,
        res,
      );
    },
  ),
);

/**
 * DELETE /admin/sessions/:id
 */
router.delete(
  '/admin/sessions/:id',

  authenticate,

  adminOnly,

  sessionLimiter,

  validateSessionId,

  asyncHandler(
    async (
      req,
      res,
    ) => {
      return authController.adminRevokeSession(
        req,
        res,
      );
    },
  ),
);

/**
 * ============================================================================
 * AUTHENTICATED STATUS
 * ============================================================================
 *
 * Keep this endpoint intentionally small. It should not become a secondary
 * source of sensitive authentication/session information.
 * ============================================================================
 */

router.get(
  '/status',

  authenticate,

  (
    req,
    res,
  ) => {
    const user =
      getAuthenticatedUser(
        req,
      );

    if (
      !user
    ) {
      return res.status(
        401,
      ).json({
        success:
          false,

        code:
          'AUTHENTICATION_REQUIRED',

        message:
          'Authentication is required.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    return res.status(
      200,
    ).json({
      success:
        true,

      authenticated:
        true,

      service:
        SERVICE_NAME,

      version:
        ROUTER_VERSION,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),

      user: {
        id:
          normalizeString(
            user.id ||
              user._id ||
              user.userId,
          ),

        role:
          normalizeString(
            user.role,
          ),
      },
    });
  },
);

/**
 * ============================================================================
 * ROUTE 404
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
        'AUTH_ROUTE_NOT_FOUND',

      message:
        'Authentication endpoint not found.',

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
 * ROUTE ERROR HANDLER
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

    const response = {
      success:
        false,

      code:
        normalizeString(
          error?.code,
        ) ||
        (
          clientError
            ? 'AUTH_REQUEST_ERROR'
            : 'AUTH_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The authentication request could not be completed.'
            )
          : 'The authentication request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

    /**
     * Only expose structured error details for controlled client errors.
     */
    if (
      clientError &&
      error?.details
    ) {
      response.details =
        error.details;
    }

    return res
      .status(
        statusCode,
      )
      .json(
        response,
      );
  },
);

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
    value ===
      undefined ||
    value ===
      null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return (
    normalized ||
    fallback
  );
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

router.applicationName =
  APPLICATION_NAME;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;