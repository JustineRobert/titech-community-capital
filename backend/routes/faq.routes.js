'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise FAQ Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/faq.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for TITech Community Capital Frequently Asked
 * Questions (FAQ) content.
 *
 * Public endpoints
 * ----------------------------------------------------------------------------
 * GET  /categories
 * GET  /all
 * GET  /category/:slug
 * GET  /featured
 * GET  /popular
 * GET  /search
 * GET  /:id
 * POST /:id/feedback
 *
 * Administrative endpoints
 * ----------------------------------------------------------------------------
 * POST /init
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * Routes remain thin.
 *
 *   Request
 *      ↓
 *   Metadata / security headers
 *      ↓
 *   Rate limiting
 *      ↓
 *   Validation
 *      ↓
 *   Authentication / RBAC for protected operations
 *      ↓
 *   FAQ Controller
 *      ↓
 *   FAQ Service / Repository
 *
 * This router MUST NOT:
 *   ✗ access the database directly
 *   ✗ mutate FAQ state directly
 *   ✗ trust client-supplied tenant identity
 *   ✗ expose internal exception details
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

const faqController =
  require('../controllers/faqController');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * OPTIONAL AUTH / VALIDATION INFRASTRUCTURE
 * ============================================================================
 */

let verifyToken =
  null;

let requireRole =
  null;

let handleValidation =
  null;

try {
  const auth =
    require('../middleware/auth');

  verifyToken =
    auth.verifyToken ||
    auth.authenticate;

  requireRole =
    auth.requireRole;
} catch {
  verifyToken =
    null;

  requireRole =
    null;
}

try {
  const validators =
    require('../utils/validators');

  handleValidation =
    validators.handleValidation ||
    validators.handleValidationErrors;
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
  'TITechFAQRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech FAQ';

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
  Object.freeze([
    'getCategories',
    'getAllFAQs',
    'getFAQsByCategory',
    'getFeaturedFAQs',
    'getPopularFAQs',
    'searchFAQs',
    'getFAQ',
    'submitFeedback',
    'initializeFAQ',
  ]);

for (
  const name of
    REQUIRED_CONTROLLERS
) {
  if (
    typeof faqController?.[
      name
    ] !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Missing faqController.${name} export.`,
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
      'strict-origin-when-cross-origin',
    );

    /**
     * FAQ pages are public but should not be cached if feedback or personalized
     * information is ever introduced by downstream services.
     */
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300',
    );

    next();
  },
);

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 */

const readLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_FAQ_READ_RATE_LIMIT',
        180,
      ),

    code:
      'FAQ_READ_RATE_LIMITED',

    message:
      'Too many FAQ requests. Please try again later.',
  });

const searchLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_FAQ_SEARCH_RATE_LIMIT',
        60,
      ),

    code:
      'FAQ_SEARCH_RATE_LIMITED',

    message:
      'Too many FAQ search requests. Please try again later.',
  });

const feedbackLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_FAQ_FEEDBACK_RATE_LIMIT',
        15,
      ),

    code:
      'FAQ_FEEDBACK_RATE_LIMITED',

    message:
      'Too many FAQ feedback submissions. Please try again later.',
  });

const adminLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_FAQ_ADMIN_RATE_LIMIT',
        20,
      ),

    code:
      'FAQ_ADMIN_RATE_LIMITED',

    message:
      'Too many administrative FAQ requests. Please try again later.',
  });

function getPositiveIntegerEnv(
  name,
  fallback,
) {
  const value =
    Number(
      process.env[name],
    );

  return Number.isInteger(
    value,
  ) &&
    value > 0
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

const faqIdValidator =
  param('id')
    .trim()
    .notEmpty()
    .withMessage(
      'FAQ ID is required.',
    )
    .isLength({
      max:
        128,
    })
    .withMessage(
      'FAQ ID is too long.',
    )
    .custom(
      (
        value,
      ) => {
        if (
          /[\u0000-\u001F\u007F]/.test(
            value,
          )
        ) {
          throw new Error(
            'FAQ ID contains unsupported characters.',
          );
        }

        return true;
      },
    );

const categorySlugValidator =
  param('slug')
    .trim()
    .notEmpty()
    .withMessage(
      'Category slug is required.',
    )
    .isLength({
      max:
        120,
    })
    .withMessage(
      'Category slug is too long.',
    )
    .matches(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/i,
    )
    .withMessage(
      'Category slug contains invalid characters.',
    );

const searchValidators =
  [
    query('q')
      .optional()
      .trim()
      .isLength({
        min:
          1,

        max:
          200,
      })
      .withMessage(
        'Search query must be between 1 and 200 characters.',
      )
      .custom(
        (
          value,
        ) => {
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

    query('search')
      .optional()
      .trim()
      .isLength({
        min:
          1,

        max:
          200,
      })
      .withMessage(
        'Search query must be between 1 and 200 characters.',
      ),
  ];

const feedbackValidators =
  [
    faqIdValidator,

    /**
     * Flexible enough to support common controller contracts such as:
     *
     *   helpful: true
     *   helpful: false
     *
     * or:
     *
     *   helpful: "yes"
     *
     * The controller remains responsible for domain interpretation.
     */
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
          1000,
      })
      .withMessage(
        'Feedback comment cannot exceed 1000 characters.',
      ),
  ];

/**
 * ============================================================================
 * VALIDATION ADAPTER
 * ============================================================================
 */

function validate(
  rules,
) {
  return [
    ...rules,

    ...(typeof handleValidation ===
    'function'
      ? [
          handleValidation,
        ]
      : []),
  ];
}

/**
 * ============================================================================
 * AUTHORIZATION
 * ============================================================================
 */

function adminOnly(
  req,
  res,
  next,
) {
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
        'FAQ_AUTHORIZATION_UNAVAILABLE',

      message:
        'FAQ administrative authorization is unavailable.',

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
 * PUBLIC FAQ ENDPOINTS
 * ============================================================================
 */

/**
 * GET /api/faq/categories
 */
router.get(
  '/categories',

  readLimiter,

  asyncHandler(
    faqController.getCategories,
  ),
);

/**
 * GET /api/faq/all
 */
router.get(
  '/all',

  readLimiter,

  asyncHandler(
    faqController.getAllFAQs,
  ),
);

/**
 * GET /api/faq/category/:slug
 */
router.get(
  '/category/:slug',

  readLimiter,

  validate(
    [
      categorySlugValidator,
    ],
  ),

  asyncHandler(
    faqController.getFAQsByCategory,
  ),
);

/**
 * GET /api/faq/featured
 */
router.get(
  '/featured',

  readLimiter,

  asyncHandler(
    faqController.getFeaturedFAQs,
  ),
);

/**
 * GET /api/faq/popular
 */
router.get(
  '/popular',

  readLimiter,

  asyncHandler(
    faqController.getPopularFAQs,
  ),
);

/**
 * GET /api/faq/search
 */
router.get(
  '/search',

  searchLimiter,

  validate(
    searchValidators,
  ),

  asyncHandler(
    faqController.searchFAQs,
  ),
);

/**
 * IMPORTANT:
 * `/:id` remains after `/search`, `/popular`, `/featured`, etc. so those
 * static routes are matched first.
 */
router.get(
  '/:id',

  readLimiter,

  validate(
    [
      faqIdValidator,
    ],
  ),

  asyncHandler(
    faqController.getFAQ,
  ),
);

/**
 * ============================================================================
 * FEEDBACK
 * ============================================================================
 *
 * Public submission is retained for compatibility.
 *
 * The controller/service should:
 * - rate-limit or deduplicate at domain level
 * - prevent automated abuse
 * - avoid trusting user identity from the body
 * - record anonymous/actor metadata appropriately
 */
router.post(
  '/:id/feedback',

  feedbackLimiter,

  validate(
    feedbackValidators,
  ),

  asyncHandler(
    faqController.submitFeedback,
  ),
);

/**
 * ============================================================================
 * ADMIN INITIALIZATION
 * ============================================================================
 *
 * Initialization is a privileged mutation and MUST NOT remain publicly
 * accessible.
 *
 * POST /api/faq/init
 */
router.post(
  '/init',

  adminLimiter,

  typeof verifyToken ===
    'function'
    ? verifyToken
    : (
        req,
        res,
        next,
      ) =>
        res.status(
          500,
        ).json({
          success:
            false,

          code:
            'FAQ_AUTHENTICATION_UNAVAILABLE',

          message:
            'FAQ administrative authentication is unavailable.',

          requestId:
            req.requestId,

          correlationId:
            req.correlationId,
        }),

  adminOnly,

  asyncHandler(
    faqController.initializeFAQ,
  ),
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
  '/health',

  readLimiter,

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
 * ROUTE NOT FOUND
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
        'FAQ_ROUTE_NOT_FOUND',

      message:
        'FAQ endpoint not found.',

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
            ? 'FAQ_REQUEST_ERROR'
            : 'FAQ_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The FAQ request could not be completed.'
            )
          : 'The FAQ request could not be completed.',

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