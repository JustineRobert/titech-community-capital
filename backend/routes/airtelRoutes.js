'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Airtel Money Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/airtelRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP routing boundary for Airtel Money integrations used by TITech
 * Community Capital.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 * POST /deposit
 * POST /withdraw
 * POST /repay-loan
 * POST /contribute-savings
 * POST /disburse
 * POST /bulk-disburse
 *
 * POST /webhook
 *
 * GET  /status/:reference
 * GET  /reconciliation/:date
 *
 * GET  /health
 * GET  /metrics
 *
 * Mounted example:
 *
 *   app.use(
 *     '/api/payments/airtel',
 *     airtelRoutes
 *   );
 *
 * ============================================================================
 *
 * Security Model
 * ----------------------------------------------------------------------------
 * Authenticated financial operations:
 *
 *   authentication
 *        ↓
 *   tenant context
 *        ↓
 *   role / permission
 *        ↓
 *   rate limiting
 *        ↓
 *   idempotency
 *        ↓
 *   request validation
 *        ↓
 *   controller
 *
 * Webhook:
 *
 *   transport hardening
 *        ↓
 *   provider verification middleware
 *        ↓
 *   controller
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This router MUST NOT silently disable security middleware in production.
 * Missing authentication, tenant enforcement, authorization, rate limiting or
 * idempotency middleware therefore fails router construction rather than
 * allowing financial endpoints to run unsecured.
 *
 * Business logic remains in controllers/services.
 *
 * This router does NOT:
 *   - mutate balances
 *   - post ledger entries
 *   - approve loans
 *   - perform reconciliation calculations
 *   - authorize tenant access by itself
 *
 * ============================================================================
 */

const express = require('express');

const router = express.Router();

const airtelController =
  require('../controllers/airtelController');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'AirtelMoneyRoutes';

const ROUTER_VERSION =
  '2026.1';

const PROVIDER =
  'airtel-money';

const APPLICATION_NAME =
  'TITech Community Capital';

/**
 * ============================================================================
 * ROLE / PERMISSION DEFINITIONS
 * ============================================================================
 *
 * Prefer explicit permissions where the project's authorization middleware
 * supports them. Legacy role names remain available for compatibility.
 * ============================================================================
 */

const ROLES = Object.freeze({
  ADMIN:
    'ADMIN',

  TREASURER:
    'TREASURER',

  MEMBER:
    'MEMBER',

  AUDITOR:
    'AUDITOR',
});

const PERMISSIONS = Object.freeze({
  DEPOSIT:
    'payments.airtel.deposit',

  WITHDRAW:
    'payments.airtel.withdraw',

  LOAN_REPAYMENT:
    'payments.airtel.loan.repayment',

  SAVINGS_CONTRIBUTION:
    'payments.airtel.savings.contribution',

  DISBURSE:
    'payments.airtel.disburse',

  BULK_DISBURSE:
    'payments.airtel.bulk-disburse',

  STATUS_READ:
    'payments.airtel.status.read',

  RECONCILIATION_READ:
    'payments.airtel.reconciliation.read',

  HEALTH_READ:
    'payments.airtel.health.read',

  METRICS_READ:
    'payments.airtel.metrics.read',
});

/**
 * ============================================================================
 * HTTP LIMITS
 * ============================================================================
 */

const LIMITS = Object.freeze({
  REFERENCE_MAX_LENGTH:
    160,

  DATE_LENGTH:
    10,

  BULK_DISBURSE_MAX_ITEMS:
    100,

  ROUTER_BODY_MAX_BYTES:
    1024 * 1024,
});

/**
 * ============================================================================
 * ROUTER ERROR
 * ============================================================================
 */

class AirtelRouteError extends Error {
  constructor(
    message,
    {
      code = 'AIRTEL_ROUTE_ERROR',
      statusCode = 500,
      details = null,
      cause = null,
    } = {},
  ) {
    super(message);

    this.name =
      'AirtelRouteError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;

    this.cause =
      cause;
  }
}

/**
 * ============================================================================
 * CONTROLLER METHOD VALIDATION
 * ============================================================================
 */

function requireControllerMethod(
  controller,
  method,
) {
  if (
    !controller ||
    typeof controller[method] !==
      'function'
  ) {
    throw new AirtelRouteError(
      `Airtel controller method "${method}" is not implemented.`,
      {
        code:
          'AIRTEL_CONTROLLER_METHOD_MISSING',

        statusCode:
          500,
      },
    );
  }

  return controller[method].bind(
    controller,
  );
}

const controller = {
  deposit:
    requireControllerMethod(
      airtelController,
      'deposit',
    ),

  withdraw:
    requireControllerMethod(
      airtelController,
      'withdraw',
    ),

  repayLoan:
    requireControllerMethod(
      airtelController,
      'repayLoan',
    ),

  contributeSavings:
    requireControllerMethod(
      airtelController,
      'contributeSavings',
    ),

  disburse:
    requireControllerMethod(
      airtelController,
      'disburse',
    ),

  bulkDisburse:
    requireControllerMethod(
      airtelController,
      'bulkDisburse',
    ),

  webhook:
    requireControllerMethod(
      airtelController,
      'webhook',
    ),

  getStatus:
    requireControllerMethod(
      airtelController,
      'getStatus',
    ),

  getReconciliation:
    requireControllerMethod(
      airtelController,
      'getReconciliation',
    ),

  health:
    requireControllerMethod(
      airtelController,
      'health',
    ),

  metrics:
    requireControllerMethod(
      airtelController,
      'metrics',
    ),
};

/**
 * ============================================================================
 * MIDDLEWARE RESOLUTION
 * ============================================================================
 *
 * Production route policy:
 *
 * - authentication is mandatory
 * - authorization is mandatory
 * - tenant context is mandatory for authenticated financial operations
 * - rate limiting is mandatory
 * - idempotency is mandatory for financial mutations
 *
 * The router checks a few conventional project module paths for compatibility,
 * but never silently falls back to `next()` for security middleware.
 * ============================================================================
 */

function resolveRequiredMiddleware(
  candidates,
  name,
) {
  for (
    const candidate of candidates
  ) {
    if (
      typeof candidate ===
      'function'
    ) {
      return candidate;
    }
  }

  throw new AirtelRouteError(
    `${name} middleware is required but could not be resolved.`,
    {
      code:
        'AIRTEL_SECURITY_MIDDLEWARE_MISSING',

      statusCode:
        500,

      details: {
        middleware:
          name,
      },
    },
  );
}

function resolveOptionalMiddleware(
  candidates,
) {
  for (
    const candidate of candidates
  ) {
    if (
      typeof candidate ===
      'function'
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Authentication.
 */
let authMiddleware = null;

try {
  authMiddleware =
    require('../middleware/authMiddleware');
} catch {
  try {
    authMiddleware =
      require('../middleware/auth');
  } catch {
    authMiddleware = null;
  }
}

authMiddleware =
  resolveRequiredMiddleware(
    [
      authMiddleware?.authenticate,
      authMiddleware,
      airtelController?.authenticate,
    ],
    'authentication',
  );

/**
 * Authorization.
 */
let authorizationModule =
  null;

try {
  authorizationModule =
    require('../middleware/authorize');
} catch {
  try {
    authorizationModule =
      require('../middleware/authorization');
  } catch {
    authorizationModule = null;
  }
}

/**
 * Normalize different project authorization contracts:
 *
 *   authorize('ADMIN', 'TREASURER')
 *
 * or:
 *
 *   requirePermission('payments.airtel.deposit')
 */
function createAuthorizationMiddleware(
  {
    permission,
    roles = [],
  },
) {
  if (
    typeof authorizationModule ===
    'function'
  ) {
    return authorizationModule(
      ...roles,
    );
  }

  if (
    typeof authorizationModule?.authorize ===
    'function'
  ) {
    return authorizationModule.authorize(
      ...roles,
    );
  }

  if (
    typeof authorizationModule?.requireRoles ===
    'function'
  ) {
    return authorizationModule.requireRoles(
      roles,
    );
  }

  if (
    typeof authorizationModule?.requirePermission ===
    'function'
  ) {
    return authorizationModule.requirePermission(
      permission,
    );
  }

  throw new AirtelRouteError(
    'Authorization middleware does not expose a supported authorization contract.',
    {
      code:
        'AIRTEL_AUTHORIZATION_CONTRACT_INVALID',

      statusCode:
        500,
    },
  );
}

/**
 * Tenant middleware.
 *
 * The project blueprint requires tenant isolation on every query. The router
 * therefore requires tenant middleware for authenticated Airtel operations.
 */
let tenantMiddleware =
  null;

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

tenantMiddleware =
  resolveRequiredMiddleware(
    [
      tenantMiddleware?.requireTenant,
      tenantMiddleware?.tenantMiddleware,
      tenantMiddleware,
    ],
    'tenant context',
  );

/**
 * Rate limiting.
 */
let rateLimiterModule =
  null;

try {
  rateLimiterModule =
    require('../middleware/rateLimiter');
} catch {
  try {
    rateLimiterModule =
      require('../middleware/rateLimit');
  } catch {
    rateLimiterModule = null;
  }
}

const rateLimiter =
  resolveRequiredMiddleware(
    [
      rateLimiterModule?.paymentLimiter,
      rateLimiterModule?.financialLimiter,
      rateLimiterModule,
    ],
    'rate limiter',
  );

/**
 * Idempotency.
 */
let idempotencyModule =
  null;

try {
  idempotencyModule =
    require('../middleware/idempotency');
} catch {
  idempotencyModule = null;
}

const idempotency =
  resolveRequiredMiddleware(
    [
      idempotencyModule?.middleware,
      idempotencyModule,
    ],
    'idempotency',
  );

/**
 * ============================================================================
 * OPTIONAL SUPPORTING MIDDLEWARE
 * ============================================================================
 */

/**
 * Admin context.
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
          'TITech Airtel Money API',

        serviceVersion:
          ROUTER_VERSION,
      });
  }
} catch {
  adminContextMiddleware =
    null;
}

/**
 * Request validation.
 */
let adminValidation =
  null;

try {
  adminValidation =
    require('../utils/admin/adminValidation');
} catch {
  adminValidation =
    null;
}

/**
 * Optional request rate limiter specifically for webhook traffic.
 *
 * Webhooks should still be protected against abuse, but provider verification
 * must happen before expensive business processing.
 */
let webhookRateLimiter =
  null;

if (
  rateLimiterModule &&
  typeof rateLimiterModule.webhookLimiter ===
    'function'
) {
  webhookRateLimiter =
    rateLimiterModule.webhookLimiter;
}

/**
 * Optional provider webhook verifier.
 *
 * The Airtel webhook MUST verify authenticity before invoking business logic.
 * Exact implementation belongs to the provider integration layer.
 */
let webhookVerificationMiddleware =
  null;

try {
  const airtelWebhookMiddleware =
    require('../middleware/airtelWebhook');

  webhookVerificationMiddleware =
    airtelWebhookMiddleware.verify ||
    airtelWebhookMiddleware.verifySignature ||
    airtelWebhookMiddleware;
} catch {
  try {
    const webhookMiddleware =
      require('../middleware/webhookVerification');

    webhookVerificationMiddleware =
      webhookMiddleware.verifyAirtel ||
      webhookMiddleware.airtel ||
      null;
  } catch {
    webhookVerificationMiddleware =
      null;
  }
}

if (
  typeof webhookVerificationMiddleware !==
  'function'
) {
  throw new AirtelRouteError(
    'Airtel webhook verification middleware is required.',
    {
      code:
        'AIRTEL_WEBHOOK_VERIFICATION_REQUIRED',

      statusCode:
        500,
    },
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
  const requestId =
    normalizeString(
      req.id,
    ) ||
    normalizeString(
      req.requestId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ],
    ) ||
    require('node:crypto').randomUUID();

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
 * SECURITY / RESPONSE HEADERS
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

    next();
  },
);

/**
 * ============================================================================
 * REQUEST VALIDATION HELPERS
 * ============================================================================
 */

function normalizeReference(
  reference,
) {
  const normalized =
    String(
      reference ||
        '',
    ).trim();

  if (
    !normalized
  ) {
    return null;
  }

  if (
    normalized.length >
    LIMITS.REFERENCE_MAX_LENGTH
  ) {
    return null;
  }

  /**
   * Provider/application references should not contain control characters.
   */
  if (
    /[\u0000-\u001F\u007F]/.test(
      normalized,
    )
  ) {
    return null;
  }

  return normalized;
}

function validateReference(
  req,
  res,
  next,
) {
  const reference =
    normalizeReference(
      req.params?.reference,
    );

  if (
    !reference
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_AIRTEL_REFERENCE',

      message:
        'A valid transaction reference is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.validatedReference =
    reference;

  next();
}

function validateISODate(
  value,
) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalized,
    )
  ) {
    return null;
  }

  /**
   * Check calendar validity rather than accepting e.g. 2026-02-31.
   */
  const [
    year,
    month,
    day,
  ] =
    normalized
      .split('-')
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    date.getUTCFullYear() !==
      year ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    return null;
  }

  return normalized;
}

function validateDate(
  req,
  res,
  next,
) {
  const date =
    validateISODate(
      req.params?.date,
    );

  if (
    !date
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_RECONCILIATION_DATE',

      message:
        'Date must be a valid ISO calendar date in YYYY-MM-DD format.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.validatedDate =
    date;

  next();
}

/**
 * ============================================================================
 * BODY SHAPE VALIDATION
 * ============================================================================
 */

function validateObjectBody(
  req,
  res,
  next,
) {
  if (
    req.body ===
      undefined ||
    req.body ===
      null
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'REQUEST_BODY_REQUIRED',

      message:
        'Request body is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    typeof req.body !==
      'object' ||
    Array.isArray(
      req.body,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_REQUEST_BODY',

      message:
        'Request body must be a JSON object.',

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
 * BULK DISBURSE VALIDATION
 * ============================================================================
 */

function validateBulkDisbursement(
  req,
  res,
  next,
) {
  const body =
    req.body || {};

  const items =
    body.items ||
    body.disbursements ||
    body.transactions;

  if (
    !Array.isArray(
      items,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'BULK_ITEMS_REQUIRED',

      message:
        'Bulk disbursement requires an items array.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    items.length ===
      0 ||
    items.length >
      LIMITS.BULK_DISBURSE_MAX_ITEMS
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_BULK_DISBURSEMENT_SIZE',

      message:
        `Bulk disbursement must contain between 1 and ${LIMITS.BULK_DISBURSE_MAX_ITEMS} items.`,

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
 * OPTIONAL ADMIN VALIDATION ADAPTER
 * ============================================================================
 *
 * We use the canonical adminValidation utility when available, but do not
 * require its full domain schema for provider-specific financial payloads.
 * Domain validation remains in the Airtel controller/service.
 * ============================================================================
 */

function runAdminValidationIfAvailable(
  validator,
  source =
    'body',
) {
  if (
    !adminValidation ||
    typeof adminValidation.middleware !==
      'function' ||
    typeof adminValidation[
      validator
    ] !==
      'function'
  ) {
    return null;
  }

  return adminValidation.middleware(
    adminValidation[
      validator
    ],
    {
      source,
      target:
        'validated',
    },
  );
}

/**
 * ============================================================================
 * TENANT + ADMIN CONTEXT PIPELINE
 * ============================================================================
 */

/**
 * Authenticated financial endpoints receive:
 *
 * request metadata
 *   ↓
 * authentication
 *   ↓
 * admin context (when available)
 *   ↓
 * tenant middleware
 */
router.use(
  authMiddleware,
);

if (
  adminContextMiddleware
) {
  router.use(
    adminContextMiddleware,
  );
}

router.use(
  tenantMiddleware,
);

/**
 * ============================================================================
 * FINANCIAL COLLECTIONS
 * ============================================================================
 */

router.post(
  '/deposit',
  authorizeDeposit(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  runAdminValidationIfAvailable(
    'validateAdminLoanMutation',
    'body',
  ),
  controller.deposit,
);

router.post(
  '/repay-loan',
  authorizeLoanRepayment(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  controller.repayLoan,
);

router.post(
  '/contribute-savings',
  authorizeSavingsContribution(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  controller.contributeSavings,
);

/**
 * ============================================================================
 * DISBURSEMENTS
 * ============================================================================
 *
 * Member access is intentionally excluded.
 *
 * A loan disbursement is a privileged financial operation and should only
 * execute after the domain service validates the loan lifecycle, authorization,
 * account state, limits and ledger requirements.
 */

router.post(
  '/withdraw',
  authorizePrivilegedFinance(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  controller.withdraw,
);

router.post(
  '/disburse',
  authorizePrivilegedFinance(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  controller.disburse,
);

router.post(
  '/bulk-disburse',
  authorizePrivilegedFinance(),
  rateLimiter,
  idempotency,
  validateObjectBody,
  validateBulkDisbursement,
  controller.bulkDisburse,
);

/**
 * ============================================================================
 * AIRTEL WEBHOOK
 * ============================================================================
 *
 * NO JWT authentication here.
 *
 * Provider callbacks must instead pass provider-specific authenticity
 * verification.
 *
 * Important:
 * - Do not trust tenantId from the incoming payload.
 * - Do not trust transaction status from an unsigned callback.
 * - Webhook processing must be idempotent.
 * - Duplicate callbacks must be safely ignored.
 */

const webhookMiddleware = [
  requestMetadata,
];

if (
  webhookRateLimiter
) {
  webhookMiddleware.push(
    webhookRateLimiter,
  );
}

webhookMiddleware.push(
  webhookVerificationMiddleware,
  controller.webhook,
);

router.post(
  '/webhook',
  ...webhookMiddleware,
);

/**
 * ============================================================================
 * TRANSACTION STATUS
 * ============================================================================
 */

router.get(
  '/status/:reference',
  authorizeStatusRead(),
  validateReference,
  controller.getStatus,
);

/**
 * ============================================================================
 * RECONCILIATION
 * ============================================================================
 */

router.get(
  '/reconciliation/:date',
  authorizeReconciliationRead(),
  validateDate,
  controller.getReconciliation,
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 *
 * Operational health information is protected because these endpoints can
 * reveal integration/system information.
 */

router.get(
  '/health',
  authorizeOperationsRead(),
  controller.health,
);

/**
 * ============================================================================
 * METRICS
 * ============================================================================
 */

router.get(
  '/metrics',
  authorizeOperationsRead(),
  controller.metrics,
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
        'AIRTEL_ENDPOINT_NOT_FOUND',

      message:
        'Airtel Money endpoint not found.',

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

    const isClientError =
      statusCode >=
        400 &&
      statusCode <
        500;

    const response = {
      success:
        false,

      code:
        error?.code ||
        (
          isClientError
            ? 'AIRTEL_REQUEST_ERROR'
            : 'AIRTEL_INTERNAL_ERROR'
        ),

      message:
        isClientError
          ? (
              error?.message ||
              'The Airtel Money request could not be completed.'
            )
          : 'The Airtel Money request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

    if (
      isClientError &&
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
 * AUTHORIZATION FACTORIES
 * ============================================================================
 */

function authorizeDeposit() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.DEPOSIT,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.MEMBER,
    ],
  });
}

function authorizeLoanRepayment() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.LOAN_REPAYMENT,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.MEMBER,
    ],
  });
}

function authorizeSavingsContribution() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.SAVINGS_CONTRIBUTION,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.MEMBER,
    ],
  });
}

function authorizePrivilegedFinance() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.DISBURSE,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
    ],
  });
}

function authorizeStatusRead() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.STATUS_READ,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.MEMBER,
    ],
  });
}

function authorizeReconciliationRead() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.RECONCILIATION_READ,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.AUDITOR,
    ],
  });
}

function authorizeOperationsRead() {
  return createAuthorizationMiddleware({
    permission:
      PERMISSIONS.HEALTH_READ,

    roles: [
      ROLES.ADMIN,
      ROLES.TREASURER,
      ROLES.AUDITOR,
    ],
  });
}

/**
 * ============================================================================
 * EXPRESS BODY-SIZE NOTE
 * ============================================================================
 *
 * Body-size enforcement normally belongs in the application's JSON parser:
 *
 *   app.use(express.json({ limit: '1mb' }));
 *
 * Do not dynamically re-parse request bodies here because Airtel webhook
 * signature verification may require access to the original raw request bytes.
 * ============================================================================
 */

/**
 * ============================================================================
 * METADATA EXPORTS
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.provider =
  PROVIDER;

router.application =
  APPLICATION_NAME;

router.permissions =
  PERMISSIONS;

module.exports =
  router;

module.exports.router =
  router;

module.exports.ROUTER_NAME =
  ROUTER_NAME;

module.exports.ROUTER_VERSION =
  ROUTER_VERSION;

module.exports.PROVIDER =
  PROVIDER;

module.exports.PERMISSIONS =
  PERMISSIONS;

module.exports.AirtelRouteError =
  AirtelRouteError;