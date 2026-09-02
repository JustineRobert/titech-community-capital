'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Help Center Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/helpCenter.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for the TITech Community Capital Help Center.
 *
 * Public endpoints
 * ----------------------------------------------------------------------------
 * GET  /categories
 * GET  /category/:slug
 * GET  /article/:slug
 * GET  /search
 * GET  /featured
 * GET  /popular
 *
 * Feedback
 * ----------------------------------------------------------------------------
 * POST /article/:slug/feedback
 *
 * Administrative endpoint
 * ----------------------------------------------------------------------------
 * POST /init
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Authentication / RBAC for protected operations
 *        ↓
 *   Help Center Controller
 *        ↓
 *   Service / Repository
 *
 * This router MUST NOT:
 *
 *   ✗ access the database directly
 *   ✗ modify Help Center content directly
 *   ✗ trust client-supplied tenantId
 *   ✗ expose internal exceptions
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology has been replaced with TITech Community
 * Capital.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

const {
  param,
  query,
  body,
} =
  require('express-validator');

const helpCenterController =
  require('../controllers/helpCenterController');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * OPTIONAL AUTHENTICATION / VALIDATION INFRASTRUCTURE
 * ============================================================================
 */

let verifyToken =
  null;

let requireRole =
  null;

try {
  const auth =
    require('../middleware/auth');

  verifyToken =
    auth?.verifyToken ||
    auth?.authenticate;

  requireRole =
    auth?.requireRole ||
    null;
} catch {
  verifyToken =
    null;

  requireRole =
    null;
}

let handleValidation =
  null;

try {
  const validators =
    require('../utils/validators');

  handleValidation =
    validators?.handleValidation ||
    validators?.handleValidationErrors ||
    null;
} catch {
  handleValidation =
    null;
}

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechHelpCenterRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech Help Center';

const MAX_SLUG_LENGTH =
  150;

const MAX_SEARCH_LENGTH =
  200;

const MAX_FEEDBACK_LENGTH =
  1000;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
  Object.freeze([
    'getCategories',
    'getArticlesByCategory',
    'getArticle',
    'searchArticles',
    'getFeaturedArticles',
    'getPopularArticles',
    'submitFeedback',
    'initializeHelpCenter',
  ]);

for (
  const method of
    REQUIRED_CONTROLLERS
) {
  if (
    typeof helpCenterController?.[
      method
    ] !== 'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Missing helpCenterController.${method} export.`,
    );
  }
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
    String(
      value,
    ).trim();

  return (
    normalized ||
    fallback
  );
}

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
 * SECURITY / CACHE HEADERS
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
      'strict-origin-when-cross-origin',
    );

    next();
  },
);

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 */

const publicReadLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_HELP_CENTER_READ_RATE_LIMIT',
        180,
      ),

    code:
      'HELP_CENTER_READ_RATE_LIMITED',

    message:
      'Too many Help Center requests. Please try again later.',
  });

const searchLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_HELP_CENTER_SEARCH_RATE_LIMIT',
        60,
      ),

    code:
      'HELP_CENTER_SEARCH_RATE_LIMITED',

    message:
      'Too many Help Center searches. Please try again later.',
  });

const feedbackLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_HELP_CENTER_FEEDBACK_RATE_LIMIT',
        15,
      ),

    code:
      'HELP_CENTER_FEEDBACK_RATE_LIMITED',

    message:
      'Too many Help Center feedback submissions. Please try again later.',
  });

const adminLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_HELP_CENTER_ADMIN_RATE_LIMIT',
        20,
      ),

    code:
      'HELP_CENTER_ADMIN_RATE_LIMITED',

    message:
      'Too many administrative Help Center requests. Please try again later.',
  });

function getPositiveIntegerEnv(
  name,
  fallback,
) {
  const value =
    Number(
      process.env[name],
    );

  return (
    Number.isInteger(
      value,
    ) &&
    value > 0
  )
    ? value
    : fallback;
}

function createLimiter({
  windowMs,
  max,
  code,
  message,
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

    keyGenerator(
      req,
    ) {
      return (
        normalizeString(
          req.user?.id ||
            req.user?._id ||
            req.user?.userId ||
            req.auth?.userId,
        ) ||
        normalizeString(
          req.ip,
        ) ||
        normalizeString(
          req.socket?.remoteAddress,
        ) ||
        'unknown'
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
 * VALIDATION
 * ============================================================================
 */

const categorySlugValidators =
  [
    param('slug')
      .trim()
      .notEmpty()
      .withMessage(
        'Category slug is required.',
      )
      .isLength({
        max:
          MAX_SLUG_LENGTH,
      })
      .withMessage(
        'Category slug is too long.',
      )
      .matches(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/i,
      )
      .withMessage(
        'Category slug must be a valid slug.',
      ),
  ];

const articleSlugValidators =
  [
    param('slug')
      .trim()
      .notEmpty()
      .withMessage(
        'Article slug is required.',
      )
      .isLength({
        max:
          MAX_SLUG_LENGTH,
      })
      .withMessage(
        'Article slug is too long.',
      )
      .matches(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/i,
      )
      .withMessage(
        'Article slug must be a valid slug.',
      ),
  ];

const searchValidators =
  [
    query('q')
      .optional()
      .trim()
      .isLength({
        min:
          1,

        max:
          MAX_SEARCH_LENGTH,
      })
      .withMessage(
        `Search query must be between 1 and ${MAX_SEARCH_LENGTH} characters.`,
      )
      .custom(
        (value) => {
          if (
            /[\u0000-\u001F\u007F]/.test(
              value,
            )
          ) {
            throw new Error(
              'Search query contains unsupported characters.',
            );
          }

          return true;
        },
      ),

    query('page')
      .optional()
      .toInt()
      .isInt({
        min:
          1,
      })
      .withMessage(
        'page must be at least 1.',
      ),

    query('limit')
      .optional()
      .toInt()
      .isInt({
        min:
          1,

        max:
          100,
      })
      .withMessage(
        'limit must be between 1 and 100.',
      ),
  ];

const feedbackValidators =
  [
    ...articleSlugValidators,

    body('helpful')
      .optional()
      .isBoolean()
      .withMessage(
        'helpful must be a boolean.',
      )
      .toBoolean(),

    body('rating')
      .optional()
      .isInt({
        min:
          1,

        max:
          5,
      })
      .withMessage(
        'rating must be an integer between 1 and 5.',
      )
      .toInt(),

    body('comment')
      .optional()
      .isString()
      .trim()
      .isLength({
        max:
          MAX_FEEDBACK_LENGTH,
      })
      .withMessage(
        `Feedback comment cannot exceed ${MAX_FEEDBACK_LENGTH} characters.`,
      ),
  ];

function validationMiddleware(
  rules,
) {
  if (
    typeof handleValidation !==
    'function'
  ) {
    /**
     * Fail closed rather than allowing malformed public/admin input through
     * when validation infrastructure is expected but unavailable.
     */
    return (
      req,
      res,
    ) => {
      return res.status(
        500,
      ).json({
        success:
          false,

        code:
          'HELP_CENTER_VALIDATION_UNAVAILABLE',

        message:
          'Help Center validation infrastructure is unavailable.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    };
  }

  return [
    ...rules,
    handleValidation,
  ];
}

/**
 * ============================================================================
 * ADMIN AUTHORIZATION
 * ============================================================================
 */

function requireAdmin(
  req,
  res,
  next,
) {
  if (
    typeof verifyToken !==
    'function'
  ) {
    return res.status(
      500,
    ).json({
      success:
        false,

      code:
        'HELP_CENTER_AUTHENTICATION_UNAVAILABLE',

      message:
        'Help Center authentication infrastructure is unavailable.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    typeof requireRole !==
    'function'
  ) {
    return res.status(
      500,
    ).json({
      success:
        false,

      code:
        'HELP_CENTER_AUTHORIZATION_UNAVAILABLE',

      message:
        'Help Center administrative authorization is unavailable.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

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
 * PUBLIC HELP CENTER ENDPOINTS
 * ============================================================================
 */

/**
 * GET /api/help-center/categories
 */
router.get(
  '/categories',

  publicReadLimiter,

  asyncHandler(
    helpCenterController.getCategories,
  ),
);

/**
 * GET /api/help-center/category/:slug
 */
router.get(
  '/category/:slug',

  publicReadLimiter,

  validationMiddleware(
    categorySlugValidators,
  ),

  asyncHandler(
    helpCenterController.getArticlesByCategory,
  ),
);

/**
 * GET /api/help-center/article/:slug
 */
router.get(
  '/article/:slug',

  publicReadLimiter,

  validationMiddleware(
    articleSlugValidators,
  ),

  asyncHandler(
    helpCenterController.getArticle,
  ),
);

/**
 * GET /api/help-center/search
 */
router.get(
  '/search',

  searchLimiter,

  validationMiddleware(
    searchValidators,
  ),

  asyncHandler(
    helpCenterController.searchArticles,
  ),
);

/**
 * GET /api/help-center/featured
 */
router.get(
  '/featured',

  publicReadLimiter,

  asyncHandler(
    helpCenterController.getFeaturedArticles,
  ),
);

/**
 * GET /api/help-center/popular
 */
router.get(
  '/popular',

  publicReadLimiter,

  asyncHandler(
    helpCenterController.getPopularArticles,
  ),
);

/**
 * ============================================================================
 * PUBLIC FEEDBACK
 * ============================================================================
 *
 * Feedback remains publicly accessible for compatibility.
 *
 * The downstream service should:
 * - deduplicate repeated feedback
 * - track anonymous/client metadata safely
 * - apply abuse controls
 * - never trust a client-supplied userId as authoritative identity
 * ============================================================================
 */

router.post(
  '/article/:slug/feedback',

  feedbackLimiter,

  validationMiddleware(
    feedbackValidators,
  ),

  asyncHandler(
    helpCenterController.submitFeedback,
  ),
);

/**
 * ============================================================================
 * ADMIN INITIALIZATION
 * ============================================================================
 *
 * POST /api/help-center/init
 *
 * Initialization is a privileged state/configuration mutation and must not
 * remain publicly callable.
 * ============================================================================
 */

router.post(
  '/init',

  adminLimiter,

  verifyToken,

  requireAdmin,

  asyncHandler(
    helpCenterController.initializeHelpCenter,
  ),
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
  '/health',

  publicReadLimiter,

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

      status:
        'UP',

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
        'HELP_CENTER_ROUTE_NOT_FOUND',

      message:
        'Help Center endpoint not found.',

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
            ? 'HELP_CENTER_REQUEST_ERROR'
            : 'HELP_CENTER_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The Help Center request could not be completed.'
            )
          : 'The Help Center request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

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
 * ROUTER METADATA
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.serviceName =
  SERVICE_NAME;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;