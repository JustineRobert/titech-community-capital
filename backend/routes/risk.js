'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Risk & Decisioning Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/risk.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * HTTP routing boundary for TITech Community Capital credit-risk and fraud-
 * decisioning operations.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * POST /score
 *     Run credit-risk / credit-score evaluation for the authenticated actor.
 *
 * POST /fraud-check
 *     Run fraud-risk evaluation for an explicitly authorized operational actor.
 *
 * Security architecture
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
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   RBAC
 *        ↓
 *   Request Validation
 *        ↓
 *   Risk Controller
 *        ↓
 *   Risk Service / Decision Engine
 *        ↓
 *   Audit / Decision Record
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ calculate risk directly
 *   ✗ modify loan balances directly
 *   ✗ approve or reject loans directly
 *   ✗ trust a client-supplied tenantId
 *   ✗ trust arbitrary transaction ownership
 *   ✗ accept arbitrary financial transaction objects as authoritative records
 *   ✗ expose model/provider internals
 *
 * Risk decisions belong to the risk/decisioning service layer.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
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
} =
  require('express-validator');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

const limiterModule =
  require('../middleware/limiter');

const authModule =
  require('../middleware/auth');

const validate =
  require('../middleware/validate');

const authenticate =
  authModule?.authenticate ||
  authModule?.verifyToken ||
  authModule?.verifyAccessToken;

const requireRole =
  authModule?.requireRole;

/**
 * ============================================================================
 * Controllers
 * ============================================================================
 */

const riskController =
  require('../controllers/riskController');

const {
  runCreditScore,
  runFraudCheck,
} =
  riskController;

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechRiskRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech Risk & Decisioning API';

const MAX_FEATURE_COUNT =
  100;

const MAX_STRING_LENGTH =
  500;

const MAX_NUMERIC_VALUE =
  1_000_000_000_000_000;

/**
 * ============================================================================
 * Dependency Contracts
 * ============================================================================
 */

if (
  typeof authenticate !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] Authentication middleware is required.`
  );
}

if (
  typeof requireRole !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] requireRole middleware is required.`
  );
}

if (
  typeof limiterModule !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] limiter middleware must be a function.`
  );
}

if (
  typeof validate !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] validate middleware must be a function.`
  );
}

if (
  typeof runCreditScore !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] riskController.runCreditScore must be a function.`
  );
}

if (
  typeof runFraudCheck !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] riskController.runFraudCheck must be a function.`
  );
}

/**
 * ============================================================================
 * Request / Correlation Metadata
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return (
    normalized ||
    fallback
  );
}

function requestMetadata(
  req,
  res,
  next
) {
  const requestId =
    normalizeString(
      req.requestId
    ) ||
    normalizeString(
      req.id
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ]
    ) ||
    crypto.randomUUID();

  const correlationId =
    normalizeString(
      req.correlationId
    ) ||
    normalizeString(
      req.headers?.[
        'x-correlation-id'
      ]
    ) ||
    requestId;

  req.requestId =
    requestId;

  req.correlationId =
    correlationId;

  res.setHeader(
    'X-Request-Id',
    requestId
  );

  res.setHeader(
    'X-Correlation-Id',
    correlationId
  );

  next();
}

router.use(
  requestMetadata
);

/**
 * ============================================================================
 * Security Headers
 * ============================================================================
 */

router.use(
  (
    req,
    res,
    next
  ) => {
    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );

    res.setHeader(
      'Referrer-Policy',
      'no-referrer'
    );

    next();
  }
);

/**
 * ============================================================================
 * JSON Body Parsing
 * ============================================================================
 */

router.use(
  express.json({
    limit:
      process.env.TITECH_RISK_BODY_LIMIT ||
      '256kb',

    strict:
      true,
  })
);

/**
 * ============================================================================
 * Trusted Tenant / Actor Context
 * ============================================================================
 */

let adminContextMiddleware =
  null;

try {
  const adminContext =
    require(
      '../utils/admin/adminContext'
    );

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

function fallbackRiskContext(
  req,
  res,
  next
) {
  const tenantId =
    normalizeString(
      req.adminContext?.tenantId ||
      req.tenantId ||
      req.user?.tenantId ||
      req.auth?.tenantId
    );

  const actorId =
    normalizeString(
      req.adminContext?.actorId ||
      req.user?.id ||
      req.user?._id ||
      req.user?.userId ||
      req.auth?.userId
    );

  if (!tenantId) {
    return res
      .status(403)
      .json({
        success: false,
        code:
          'RISK_TENANT_CONTEXT_REQUIRED',
        message:
          'A trusted tenant context is required for risk operations.',
        requestId:
          req.requestId,
        correlationId:
          req.correlationId,
      });
  }

  if (!actorId) {
    return res
      .status(401)
      .json({
        success: false,
        code:
          'RISK_ACTOR_CONTEXT_REQUIRED',
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

  req.riskActorId =
    actorId;

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
 * Authentication + Tenant Context
 * ============================================================================
 */

router.use(
  authenticate
);

router.use(
  adminContextMiddleware ||
  fallbackRiskContext
);

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 *
 * Risk engines can be computationally expensive and may call additional
 * services/models. Keep them more tightly controlled than ordinary reads.
 * ============================================================================
 */

const riskLimiter =
  createRiskLimiter({
    windowMs:
      60 *
      1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_RISK_RATE_LIMIT',
        30
      ),

    code:
      'RISK_RATE_LIMITED',

    message:
      'Too many risk evaluation requests. Please try again later.',
  });

const fraudLimiter =
  createRiskLimiter({
    windowMs:
      60 *
      1000,

    max:
      getPositiveIntegerEnv(
        'TITECH_FRAUD_RATE_LIMIT',
        20
      ),

    code:
      'FRAUD_RATE_LIMITED',

    message:
      'Too many fraud evaluation requests. Please try again later.',
  });

function createRiskLimiter({
  windowMs,
  max,
  code,
  message,
}) {
  /**
   * Use the project's limiter where possible, but keep this route locally
   * protected even if the generic limiter has a different contract.
   */
  const externalLimiter =
    limiterModule;

  try {
    const result =
      externalLimiter({
        windowMs,
        max,
        standardHeaders:
          true,
        legacyHeaders:
          false,
      });

    if (
      typeof result ===
      'function'
    ) {
      return result;
    }
  } catch {
    // Fall back to the local enterprise limiter below.
  }

  return rateLimit({
    windowMs,
    max,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    keyGenerator(
      req
    ) {
      return (
        normalizeString(
          req.riskActorId
        ) ||
        normalizeString(
          req.user?.id ||
          req.user?._id ||
          req.user?.userId
        ) ||
        normalizeString(
          req.tenantId
        ) ||
        normalizeString(
          req.ip
        ) ||
        'unknown'
      );
    },

    handler(
      req,
      res
    ) {
      return res
        .status(429)
        .json({
          success:
            false,

          code,

          message,

          retryAfter:
            Math.ceil(
              windowMs /
              1000
            ),

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
 * Credit Score Validation
 * ============================================================================
 */

const creditScoreValidation =
  [
    body('features')
      .exists()
      .withMessage(
        'features is required.'
      )
      .bail()
      .isObject()
      .withMessage(
        'features must be an object.'
      ),

    body('features.contributions')
      .optional()
      .isFloat({
        min:
          0,
        max:
          MAX_NUMERIC_VALUE,
      })
      .withMessage(
        'features.contributions must be a non-negative number.'
      )
      .toFloat(),

    body('features.loanRepaymentsOnTime')
      .optional()
      .isBoolean()
      .withMessage(
        'features.loanRepaymentsOnTime must be boolean.'
      )
      .toBoolean(),

    body('features.missedPayments')
      .optional()
      .isInt({
        min:
          0,
        max:
          1_000_000,
      })
      .withMessage(
        'features.missedPayments must be a non-negative integer.'
      )
      .toInt(),

    body('features.momoInflows')
      .optional()
      .isFloat({
        min:
          0,
        max:
          MAX_NUMERIC_VALUE,
      })
      .withMessage(
        'features.momoInflows must be a non-negative number.'
      )
      .toFloat(),

    body('features.momoOutflows')
      .optional()
      .isFloat({
        min:
          0,
        max:
          MAX_NUMERIC_VALUE,
      })
      .withMessage(
        'features.momoOutflows must be a non-negative number.'
      )
      .toFloat(),

    body('features.savingsConsistency')
      .optional()
      .isBoolean()
      .withMessage(
        'features.savingsConsistency must be boolean.'
      )
      .toBoolean(),

    body('features.groupParticipation')
      .optional()
      .isBoolean()
      .withMessage(
        'features.groupParticipation must be boolean.'
      )
      .toBoolean(),

    body('features.guarantorStrength')
      .optional()
      .isString()
      .trim()
      .isLength({
        max:
          MAX_STRING_LENGTH,
      })
      .withMessage(
        'features.guarantorStrength is too long.'
      ),

    /**
     * Risk ownership is determined by trusted authentication context.
     */
    body('userId')
      .not()
      .exists()
      .withMessage(
        'userId must not be supplied. The authenticated user is authoritative.'
      ),

    body('tenantId')
      .not()
      .exists()
      .withMessage(
        'tenantId must not be supplied. Trusted tenant context is authoritative.'
      ),
  ];

/**
 * ============================================================================
 * Fraud Validation
 * ============================================================================
 *
 * The request may identify a transaction, but the service should resolve the
 * authoritative transaction from the database using trusted tenant scope.
 *
 * A full arbitrary transaction object is deliberately not accepted as
 * authoritative financial data.
 * ============================================================================
 */

const fraudValidation =
  [
    body('transactionId')
      .optional()
      .isMongoId()
      .withMessage(
        'transactionId must be a valid identifier.'
      ),

    body('transaction')
      .optional()
      .isObject()
      .withMessage(
        'transaction must be an object when supplied.'
      ),

    body('transaction._id')
      .optional()
      .isMongoId()
      .withMessage(
        'transaction._id must be a valid identifier.'
      ),

    body('transaction.type')
      .optional()
      .isString()
      .trim()
      .isLength({
        max:
          100,
      })
      .withMessage(
        'transaction.type is invalid.'
      ),

    body('transaction.amount')
      .optional()
      .isFloat({
        gt:
          0,
        max:
          MAX_NUMERIC_VALUE,
      })
      .withMessage(
        'transaction.amount must be positive.'
      )
      .toFloat(),

    /**
     * Never permit arbitrary user/tenant impersonation in a fraud request.
     */
    body('transaction.userId')
      .not()
      .exists()
      .withMessage(
        'transaction.userId must not be supplied as an authority.'
      ),

    body('transaction.tenantId')
      .not()
      .exists()
      .withMessage(
        'transaction.tenantId must not be supplied as an authority.'
      ),

    body('userId')
      .not()
      .exists()
      .withMessage(
        'userId must not be supplied as an authority.'
      ),

    body('tenantId')
      .not()
      .exists()
      .withMessage(
        'tenantId must not be supplied as an authority.'
      ),
  ];

/**
 * ============================================================================
 * Credit Score Route
 * ============================================================================
 *
 * USER and ADMIN are retained for compatibility with the supplied contract.
 * However, the controller/service should derive the subject from the
 * authenticated actor unless an explicitly authorized on-behalf workflow is
 * introduced.
 * ============================================================================
 */

router.post(
  '/score',

  riskLimiter,

  requireRole(
    'USER',
    'ADMIN'
  ),

  validate(
    creditScoreValidation
  ),

  asyncHandler(
    async (
      req,
      res,
      next
    ) => {
      /**
       * Make trusted decisioning context explicit to the controller.
       */
      req.riskContext =
        {
          tenantId:
            req.tenantId,

          actorId:
            req.riskActorId,

          requestId:
            req.requestId,

          correlationId:
            req.correlationId,
        };

      return runCreditScore(
        req,
        res,
        next
      );
    }
  )
);

/**
 * ============================================================================
 * Fraud Check Route
 * ============================================================================
 *
 * Restricted to administrators/authorized risk operators.
 *
 * The controller/service is expected to resolve an authoritative transaction
 * using tenantId + transactionId/reference rather than trusting an arbitrary
 * financial object posted by the caller.
 * ============================================================================
 */

router.post(
  '/fraud-check',

  fraudLimiter,

  requireRole(
    'ADMIN'
  ),

  validate(
    fraudValidation
  ),

  asyncHandler(
    async (
      req,
      res,
      next
    ) => {
      req.riskContext =
        {
          tenantId:
            req.tenantId,

          actorId:
            req.riskActorId,

          requestId:
            req.requestId,

          correlationId:
            req.correlationId,
        };

      return runFraudCheck(
        req,
        res,
        next
      );
    }
  )
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 */

router.get(
  '/health',
  (
    req,
    res
  ) => {
    return res
      .status(200)
      .json({
        success:
          true,

        service:
          SERVICE_NAME,

        version:
          ROUTER_VERSION,

        status:
          'UP',

        tenantScoped:
          true,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
  }
);

/**
 * ============================================================================
 * 404
 * ============================================================================
 */

router.use(
  (
    req,
    res
  ) => {
    return res
      .status(404)
      .json({
        success:
          false,

        code:
          'RISK_ROUTE_NOT_FOUND',

        message:
          'Risk endpoint not found.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
  }
);

/**
 * ============================================================================
 * Centralized Error Handler
 * ============================================================================
 */

router.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    const statusCode =
      Number(
        error?.statusCode
      ) >=
        400 &&
      Number(
        error?.statusCode
      ) <
        600
        ? Number(
            error.statusCode
          )
        : 500;

    const clientError =
      statusCode >=
        400 &&
      statusCode <
        500;

    return res
      .status(
        statusCode
      )
      .json({
        success:
          false,

        code:
          normalizeString(
            error?.code
          ) ||
          (
            clientError
              ? 'RISK_REQUEST_ERROR'
              : 'RISK_INTERNAL_ERROR'
          ),

        message:
          clientError
            ? (
                error?.message ||
                'The risk request could not be completed.'
              )
            : 'The risk request could not be completed.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
  }
);

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function getPositiveIntegerEnv(
  name,
  fallback
) {
  const value =
    Number(
      process.env[
        name
      ]
    );

  return (
    Number.isInteger(
      value
    ) &&
    value > 0
  )
    ? value
    : fallback;
}

/**
 * ============================================================================
 * Router Metadata
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
 * Export
 * ============================================================================
 */

module.exports =
  router;