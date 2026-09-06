'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Authentication Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/auth.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP routing boundary for:
 *
 *   - user registration
 *   - authentication
 *   - refresh-token lifecycle
 *   - logout
 *   - global logout
 *   - current-user profile
 *   - session management
 *   - administrator session management
 *   - authentication status
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Authentication
 *        ↓
 *   RBAC
 *        ↓
 *   Controller
 *        ↓
 *   Authentication / Session Service
 *
 * This router MUST NOT:
 *
 *   ✗ hash passwords
 *   ✗ issue JWTs directly
 *   ✗ modify refresh-token state directly
 *   ✗ access MongoDB directly
 *   ✗ manipulate sessions directly
 *   ✗ implement business authentication rules
 *
 * Those responsibilities belong to the authentication/session services and
 * their controllers.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 * ✓ Fail closed when required middleware/controllers are missing
 * ✓ Authentication attempts are rate limited
 * ✓ Password-reset requests are rate limited
 * ✓ Localhost rate-limit bypass is explicit and opt-in only
 * ✓ Request IDs and correlation IDs are propagated
 * ✓ Sensitive authentication responses are non-cacheable
 * ✓ Session IDs are validated before controllers execute
 * ✓ Admin routes require authenticated admin authorization
 * ✓ Internal errors never expose stack traces or infrastructure details
 * ✓ /refresh-token remains as a backward-compatible alias
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS references are replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

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
  'TITech Community Capital Ltd';

/**
 * ============================================================================
 * REQUIRED CONTROLLER CONTRACT
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
    ] !== 'function'
  ) {
    throw new Error(
      `[${ROUTER_NAME}] Missing authController export: ${handler}`,
    );
  }
}

if (
  !emailController ||
  typeof emailController
    .requestPasswordReset !== 'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing emailController.requestPasswordReset export.`,
  );
}

if (
  typeof emailController.resetPassword !== 'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing emailController.resetPassword export.`,
  );
}

if (
  typeof authenticate !== 'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing authenticate middleware export.`,
  );
}

if (
  typeof requireRole !== 'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Missing requireRole middleware export.`,
  );
}

if (
  !validationRules ||
  typeof handleValidation !== 'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] Authentication validation infrastructure is incomplete.`,
  );
}

/**
 * ============================================================================
 * ENVIRONMENT
 * ============================================================================
 */

const isProduction =
  process.env.NODE_ENV === 'production';

/**
 * Explicit development-only localhost rate-limit bypass.
 *
 * Disabled by default.
 *
 * To enable locally:
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
  ).toLowerCase() === 'true';

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

function getRequestId(req) {
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
    getRequestId(req);

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
 * RESPONSE SECURITY HEADERS
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
 * BODY PARSER
 * ============================================================================
 */

router.use(
  express.json({
    limit:
      process.env.TITECH_AUTH_BODY_LIMIT ||
      '1mb',

    strict:
      true,
  }),
);

/**
 * ============================================================================
 * RATE LIMIT HELPERS
 * ============================================================================
 */

function getClientAddress(req) {
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
    getClientAddress(req);

  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.includes('127.0.0.1')
  );
}

function createLimiter({
  windowMs,
  max,
  message,
  code = 'RATE_LIMITED',
}) {
  return rateLimit({
    windowMs,
    max,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    skip:
      shouldBypassLocalhost,

    keyGenerator(req) {
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
          windowMs / 1000,
        );

      res.setHeader(
        'Retry-After',
        String(retryAfter),
      );

      return res.status(429).json({
        success: false,

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
 */

const registerLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      20,

    message:
      'Too many registration attempts. Please try again later.',

    code:
      'REGISTRATION_RATE_LIMITED',
  });

const loginLimiter =
  createLimiter({
    windowMs:
      5 * 60 * 1000,

    max:
      50,

    message:
      'Too many authentication attempts. Please try again later.',

    code:
      'LOGIN_RATE_LIMITED',
  });

const passwordResetLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      10,

    message:
      'Too many password reset requests. Please try again later.',

    code:
      'PASSWORD_RESET_RATE_LIMITED',
  });

const refreshLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      120,

    message:
      'Too many token refresh requests. Please try again later.',

    code:
      'REFRESH_RATE_LIMITED',
  });

const logoutLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      60,

    message:
      'Too many logout requests.',

    code:
      'LOGOUT_RATE_LIMITED',
  });

const sessionLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      120,

    message:
      'Too many session requests.',

    code:
      'SESSION_RATE_LIMITED',
  });

/**
 * ============================================================================
 * SESSION ID VALIDATION
 * ============================================================================
 */

function validateSessionId(
  req,
  res,
  next,
) {
  const id =
    normalizeString(
      req.params?.id,
    );

  if (!id) {
    return res.status(400).json({
      success: false,

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

  if (id.length > 200) {
    return res.status(400).json({
      success: false,

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
    return res.status(400).json({
      success: false,

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

  req.validatedSessionId =
    id;

  next();
}

/**
 * ============================================================================
 * PASSWORD RESET VALIDATION
 * ============================================================================
 *
 * This validates syntax only.
 *
 * The controller MUST return a generic response regardless of whether the
 * account exists to prevent account/email enumeration.
 * ============================================================================
 */

function validatePasswordReset(
  req,
  res,
  next,
) {
  const email =
    normalizeString(
      req.body?.email,
    )?.toLowerCase();

  if (!email) {
    return res.status(400).json({
      success: false,

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
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email,
    )
  ) {
    return res.status(400).json({
      success: false,

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

  req.body = {
    ...req.body,
    email,
  };

  next();
}

/**
 * ============================================================================
 * AUTHENTICATED USER VALIDATION
 * ============================================================================
 */

function getAuthenticatedUser(req) {
  return (
    req.user ||
    req.auth ||
    null
  );
}

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

  validationRules.register,

  handleValidation,

  asyncHandler(
    authController.register,
  ),
);

/**
 * POST /login
 */
router.post(
  '/login',

  loginLimiter,

  validationRules.login,

  handleValidation,

  asyncHandler(
    authController.login,
  ),
);

/**
 * POST /forgot-password
 */
router.post(
  '/forgot-password',

  passwordResetLimiter,

  validatePasswordReset,

  asyncHandler(
    emailController.requestPasswordReset,
  ),
);

/**
 * POST /reset-password
 *
 * Canonical authentication compatibility endpoint. The password-reset
 * implementation remains owned by emailController/passwordResetService so
 * there is no second password-reset business implementation.
 */
router.post(
  '/reset-password',

  passwordResetLimiter,

  asyncHandler(
    emailController.resetPassword,
  ),
);

/**
 * POST /refresh
 *
 * Canonical refresh endpoint.
 */
router.post(
  '/refresh',

  refreshLimiter,

  asyncHandler(
    authController.refresh,
  ),
);

/**
 * POST /refresh-token
 *
 * Legacy compatibility alias.
 *
 * New clients should use /refresh.
 */
router.post(
  '/refresh-token',

  refreshLimiter,

  asyncHandler(
    authController.refresh,
  ),
);

/**
 * POST /logout
 *
 * Kept unauthenticated because logout should remain possible even when the
 * client-side authentication state is partially expired.
 *
 * The controller must invalidate any supplied session/refresh state safely.
 */
router.post(
  '/logout',

  logoutLimiter,

  asyncHandler(
    authController.logout,
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
    authController.logoutAll,
  ),
);

/**
 * GET /me
 */
router.get(
  '/me',

  authenticate,

  asyncHandler(
    authController.me,
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
    authController.listSessions,
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
    authController.revokeSession,
  ),
);

/**
 * ============================================================================
 * ADMIN ROUTES
 * ============================================================================
 */

/**
 * GET /admin/sessions
 */
router.get(
  '/admin/sessions',

  authenticate,

  requireRole('admin'),

  sessionLimiter,

  asyncHandler(
    authController.adminListSessions,
  ),
);

/**
 * DELETE /admin/sessions/:id
 */
router.delete(
  '/admin/sessions/:id',

  authenticate,

  requireRole('admin'),

  sessionLimiter,

  validateSessionId,

  asyncHandler(
    authController.adminRevokeSession,
  ),
);

/**
 * ============================================================================
 * AUTHENTICATION STATUS
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

    if (!user) {
      return res.status(401).json({
        success: false,

        code:
          'AUTHENTICATION_REQUIRED',

        message:
          'Authentication is required.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
    }

    return res.status(200).json({
      success: true,

      authenticated: true,

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
 * NOT FOUND
 * ============================================================================
 */

router.use(
  (
    req,
    res,
  ) => {
    return res.status(404).json({
      success: false,

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
      return next(error);
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
      success: false,

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
     * Structured details are safe to expose only when the originating error
     * explicitly classifies itself as a controlled client error.
     */
    if (
      clientError &&
      error?.details
    ) {
      response.details =
        error.details;
    }

    return res
      .status(statusCode)
      .json(response);
  },
);

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

module.exports = router;