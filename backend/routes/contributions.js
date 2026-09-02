'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Contributions Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/contributions.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure routing boundary for member/group savings contributions.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /api/contributions
 * GET  /api/contributions/group/:groupId
 * GET  /api/contributions/group/:groupId/stats
 * GET  /api/contributions/user
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
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Object-Level Access
 *        ↓
 *   Controller
 *        ↓
 *   Contribution Service
 *        ↓
 *   Repository / Ledger
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router MUST NOT:
 *
 *   ✗ modify balances directly
 *   ✗ post ledger entries directly
 *   ✗ determine group ownership directly
 *   ✗ trust client-supplied tenantId
 *   ✗ implement financial business rules
 *
 * Financial calculations, ledger posting, duplicate detection, idempotency,
 * contribution authorization and transaction integrity belong in the service
 * and financial domain layers.
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

const {
  body,
  param,
  query,
} =
  require('express-validator');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

const asyncHandler =
  require('../utils/asyncHandler');

const {
  handleValidation,
} =
  require('../utils/validators');

const {
  addContribution,
  getGroupContributions,
  getUserContributions,
  getGroupStats,
} =
  require('../controllers/contributionController');

const {
  verifyToken,
} =
  require('../middleware/auth');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechContributionsRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech Contributions API';

const DEFAULT_PAGE =
  1;

const DEFAULT_LIMIT =
  50;

const MAX_LIMIT =
  200;

const MAX_NOTE_LENGTH =
  1000;

const MAX_AMOUNT =
  1_000_000_000_000_000;

const MAX_DATE_RANGE_DAYS =
  3660;

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
  Object.freeze({
    addContribution,
    getGroupContributions,
    getUserContributions,
    getGroupStats,
  });

for (
  const [
    name,
    handler,
  ] of Object.entries(
    REQUIRED_CONTROLLERS,
  )
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Missing controller export: ${name}`,
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
      req.id,
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
 * RESPONSE SECURITY HEADERS
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

    /**
     * Contribution data can contain private/financial information.
     */
    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    res.setHeader(
      'Pragma',
      'no-cache',
    );

    next();
  },
);

/**
 * ============================================================================
 * BODY PARSER
 * ============================================================================
 */

router.use(
  express.json({
    limit:
      process.env.TITECH_CONTRIBUTIONS_BODY_LIMIT ||
      '256kb',

    strict:
      true,
  }),
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

if (
  typeof verifyToken !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] verifyToken middleware is required.`,
  );
}

router.use(
  verifyToken,
);

/**
 * ============================================================================
 * TRUSTED TENANT CONTEXT
 * ============================================================================
 *
 * Tenant identity must come from authenticated context, never from:
 *
 *   req.query.tenantId
 *   req.body.tenantId
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
          SERVICE_NAME,

        serviceVersion:
          ROUTER_VERSION,
      });
  }
} catch {
  adminContextMiddleware =
    null;
}

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
        'A trusted tenant context is required for contribution operations.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    !actorId
  ) {
    return res.status(
      401,
    ).json({
      success:
        false,

      code:
        'ACTOR_CONTEXT_REQUIRED',

      message:
        'An authenticated actor context is required.',

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

router.use(
  adminContextMiddleware ||
    fallbackTenantContext,
);

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 */

const contributionWriteLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getIntegerEnv(
        'TITECH_CONTRIBUTION_WRITE_RATE_LIMIT',
        30,
      ),

    code:
      'CONTRIBUTION_WRITE_RATE_LIMITED',

    message:
      'Too many contribution requests. Please try again later.',
  });

const contributionReadLimiter =
  createLimiter({
    windowMs:
      60 * 1000,

    max:
      getIntegerEnv(
        'TITECH_CONTRIBUTION_READ_RATE_LIMIT',
        120,
      ),

    code:
      'CONTRIBUTION_READ_RATE_LIMITED',

    message:
      'Too many contribution queries. Please try again later.',
  });

function getIntegerEnv(
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
 * CROSS-FIELD DATE VALIDATION
 * ============================================================================
 *
 * Uses ISO8601 parsing but also enforces:
 *
 *   from <= to
 *
 * and a bounded administrative reporting period.
 * ============================================================================
 */

const validateFromTo =
  [
    query('from')
      .optional()
      .isISO8601({
        strict:
          true,
      })
      .withMessage(
        '`from` must be a valid ISO8601 date.',
      )
      .toDate(),

    query('to')
      .optional()
      .isISO8601({
        strict:
          true,
      })
      .withMessage(
        '`to` must be a valid ISO8601 date.',
      )
      .toDate(),

    query('to')
      .optional()
      .custom(
        (
          to,
          {
            req,
          },
        ) => {
          if (
            !to ||
            !req.query.from
          ) {
            return true;
          }

          const from =
            new Date(
              req.query.from,
            );

          const toDate =
            new Date(
              to,
            );

          if (
            Number.isNaN(
              from.getTime(),
            ) ||
            Number.isNaN(
              toDate.getTime(),
            )
          ) {
            throw new Error(
              'Invalid date range.',
            );
          }

          if (
            from >
            toDate
          ) {
            throw new Error(
              '`from` must be earlier than or equal to `to`.',
            );
          }

          const rangeDays =
            (
              toDate.getTime() -
              from.getTime()
            ) /
            (
              24 *
              60 *
              60 *
              1000
            );

          if (
            rangeDays >
            MAX_DATE_RANGE_DAYS
          ) {
            throw new Error(
              `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`,
            );
          }

          return true;
        },
      ),
  ];

/**
 * ============================================================================
 * PAGINATION VALIDATION
 * ============================================================================
 */

const paginationValidators =
  [
    query('page')
      .optional()
      .default(
        DEFAULT_PAGE,
      )
      .toInt()
      .isInt({
        min:
          1,
      })
      .withMessage(
        'page must be an integer greater than or equal to 1.',
      ),

    query('limit')
      .optional()
      .default(
        DEFAULT_LIMIT,
      )
      .toInt()
      .isInt({
        min:
          1,

        max:
          MAX_LIMIT,
      })
      .withMessage(
        `limit must be between 1 and ${MAX_LIMIT}.`,
      ),
  ];

/**
 * ============================================================================
 * CONTRIBUTION PAYLOAD VALIDATION
 * ============================================================================
 *
 * Financial amount:
 * - finite
 * - greater than zero
 * - bounded
 *
 * Domain-level service must still perform:
 * - contribution limits
 * - member eligibility
 * - group membership
 * - balance/ledger rules
 * - duplicate/idempotency checks
 * - authorization
 * ============================================================================
 */

const addContributionValidators =
  [
    body('amount')
      .exists()
      .withMessage(
        'amount is required.',
      )
      .bail()
      .isFloat({
        gt:
          0,

        max:
          MAX_AMOUNT,
      })
      .withMessage(
        'amount must be greater than zero and within the supported limit.',
      )
      .toFloat(),

    body('groupId')
      .exists()
      .withMessage(
        'groupId is required.',
      )
      .bail()
      .isMongoId()
      .withMessage(
        'groupId must be a valid ObjectId.',
      )
      .trim(),

    body('note')
      .optional()
      .isString()
      .withMessage(
        'note must be a string.',
      )
      .trim()
      .isLength({
        max:
          MAX_NOTE_LENGTH,
      })
      .withMessage(
        `note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
      ),

    body('date')
      .optional()
      .isISO8601({
        strict:
          true,
      })
      .withMessage(
        'date must be a valid ISO8601 date.',
      ),

    /**
     * Explicitly reject a client-selected tenant boundary.
     *
     * The tenant comes from authenticated context.
     */
    body('tenantId')
      .not()
      .exists()
      .withMessage(
        'tenantId must not be supplied in the contribution payload.',
      ),
  ];

/**
 * ============================================================================
 * ROUTE PARAMETER VALIDATORS
 * ============================================================================
 */

const groupIdValidator =
  [
    param('groupId')
      .isMongoId()
      .withMessage(
        'groupId must be a valid ObjectId.',
      ),
  ];

/**
 * ============================================================================
 * USER CONTRIBUTIONS
 * ============================================================================
 *
 * The controller should derive the user from req.user/authenticated context.
 * No userId is accepted as a query override.
 * ============================================================================
 */

const userContributionQueryValidators =
  [
    ...paginationValidators,

    ...validateFromTo,

    query('userId')
      .not()
      .exists()
      .withMessage(
        'userId must not be supplied. The authenticated user determines the account.',
      ),
  ];

/**
 * ============================================================================
 * STATS QUERY
 * ============================================================================
 */

const groupStatsValidators =
  [
    ...validateFromTo,
  ];

/**
 * ============================================================================
 * WRITE ROUTE
 * ============================================================================
 */

router.post(
  '/',
  contributionWriteLimiter,

  addContributionValidators,

  handleValidation,

  asyncHandler(
    addContribution,
  ),
);

/**
 * ============================================================================
 * GROUP CONTRIBUTIONS
 * ============================================================================
 */

router.get(
  '/group/:groupId',
  contributionReadLimiter,

  groupIdValidator,

  [
    ...paginationValidators,
    ...validateFromTo,
  ],

  handleValidation,

  asyncHandler(
    getGroupContributions,
  ),
);

/**
 * ============================================================================
 * GROUP STATISTICS
 * ============================================================================
 *
 * The controller/service must enforce group membership/administrative access.
 */
router.get(
  '/group/:groupId/stats',
  contributionReadLimiter,

  groupIdValidator,

  groupStatsValidators,

  handleValidation,

  asyncHandler(
    getGroupStats,
  ),
);

/**
 * ============================================================================
 * CURRENT USER CONTRIBUTIONS
 * ============================================================================
 */

router.get(
  '/user',
  contributionReadLimiter,

  userContributionQueryValidators,

  handleValidation,

  asyncHandler(
    getUserContributions,
  ),
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
        'CONTRIBUTION_ROUTE_NOT_FOUND',

      message:
        'Contribution endpoint not found.',

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
            ? 'CONTRIBUTION_REQUEST_ERROR'
            : 'CONTRIBUTION_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The contribution request could not be completed.'
            )
          : 'The contribution request could not be completed.',

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