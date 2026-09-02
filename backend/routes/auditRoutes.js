'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Audit Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/auditRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP boundary for unified transaction/audit timelines.
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 * GET /audit/timeline/:requestId
 *
 * Returns the unified timeline for one business/transaction request:
 *
 *   Transaction
 *        +
 *   LedgerEntry
 *        +
 *   AuditLog
 *
 * Security model
 * ----------------------------------------------------------------------------
 * Request
 *   ↓
 * Request metadata
 *   ↓
 * Authentication
 *   ↓
 * Trusted tenant context
 *   ↓
 * Authorization
 *   ↓
 * Request validation
 *   ↓
 * AuditService
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * tenantId is NEVER accepted from:
 *
 *   req.query.tenantId
 *   req.body.tenantId
 *   req.params.tenantId
 *
 * as the authoritative tenant boundary.
 *
 * It must come from trusted authenticated context.
 *
 * ============================================================================
 */

const express =
  require('express');

const router =
  express.Router();

const crypto =
  require('node:crypto');

const auditService =
  require('../services/auditService');

/**
 * ============================================================================
 * OPTIONAL CANONICAL ADMIN CONTEXT
 * ============================================================================
 */

let adminContext = null;

try {
  adminContext =
    require('../utils/admin/adminContext');
} catch {
  adminContext =
    null;
}

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechAuditRoutes';

const ROUTER_VERSION =
  '2026.1';

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AuditRouteError extends Error {
  constructor(
    message,
    {
      code =
        'AUDIT_ROUTE_ERROR',

      statusCode =
        500,

      details =
        null,

      cause =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AuditRouteError';

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
 * CONTROLLER / SERVICE VALIDATION
 * ============================================================================
 */

if (
  !auditService ||
  typeof auditService.getUnifiedTimeline !==
    'function'
) {
  throw new AuditRouteError(
    'auditService.getUnifiedTimeline is required.',
    {
      code:
        'AUDIT_SERVICE_UNAVAILABLE',

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

  /**
   * Audit timelines may contain financial/accounting information and should
   * never be served from an intermediary/browser cache.
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
}

router.use(
  requestMetadata,
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

let authenticate =
  null;

try {
  authenticate =
    require('../middleware/authMiddleware');
} catch {
  try {
    authenticate =
      require('../middleware/auth');
  } catch {
    authenticate =
      null;
  }
}

if (
  typeof authenticate !==
  'function'
) {
  throw new AuditRouteError(
    'Authentication middleware is required for audit routes.',
    {
      code:
        'AUDIT_AUTH_MIDDLEWARE_MISSING',

      statusCode:
        500,
    },
  );
}

router.use(
  authenticate,
);

/**
 * ============================================================================
 * ADMIN CONTEXT
 * ============================================================================
 *
 * The canonical adminContext establishes:
 * - actorId
 * - tenantId
 * - requestId
 * - correlationId
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
        'TITech Audit API',

      serviceVersion:
        ROUTER_VERSION,
    }),
  );
} else {
  router.use(
    fallbackTrustedContext,
  );
}

/**
 * ============================================================================
 * AUTHORIZATION
 * ============================================================================
 */

let authorizationModule =
  null;

try {
  authorizationModule =
    require('../middleware/authorize');
} catch {
  authorizationModule =
    null;
}

router.use(
  createAuditAuthorization(),
);

/**
 * ============================================================================
 * REQUEST VALIDATION
 * ============================================================================
 */

router.get(
  '/audit/timeline/:requestId',
  validateRequestId,
  asyncHandler(
    async (
      req,
      res,
    ) => {
      /**
       * NEVER use:
       *
       *   req.query.tenantId
       *
       * as the tenant boundary.
       */
      const tenantId =
        requireTrustedTenant(
          req,
        );

      const requestId =
        req.validatedRequestId;

      const timeline =
        await auditService.getUnifiedTimeline(
          tenantId,
          requestId,
        );

      return res.status(
        200,
      ).json({
        success:
          true,

        data:
          timeline,

        meta: {
          tenantId,
          requestId,
          correlationId:
            req.correlationId,

          generatedAt:
            new Date().toISOString(),
        },
      });
    },
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
        'AUDIT_ROUTE_NOT_FOUND',

      message:
        'Audit endpoint not found.',

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

    const response = {
      success:
        false,

      code:
        error?.code ||
        (
          clientError
            ? 'AUDIT_REQUEST_ERROR'
            : 'AUDIT_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The audit request could not be completed.'
            )
          : 'The audit request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

    /**
     * Only expose structured details for controlled client errors.
     * Never expose stack traces, database errors, or internal paths.
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
 * VALIDATION
 * ============================================================================
 */

function validateRequestId(
  req,
  res,
  next,
) {
  const requestId =
    normalizeString(
      req.params?.requestId,
    );

  if (
    !requestId
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'REQUEST_ID_REQUIRED',

      message:
        'requestId is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Prevent control characters and excessively large values.
   *
   * This deliberately supports UUIDs, business references and transaction
   * correlation identifiers rather than forcing MongoDB ObjectId semantics.
   */
  if (
    requestId.length >
    200
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'REQUEST_ID_TOO_LONG',

      message:
        'requestId exceeds the maximum supported length.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    /[\u0000-\u001F\u007F]/.test(
      requestId,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_REQUEST_ID',

      message:
        'requestId contains unsupported characters.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.validatedRequestId =
    requestId;

  next();
}

/**
 * ============================================================================
 * TRUSTED TENANT
 * ============================================================================
 */

function requireTrustedTenant(
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
    throw new AuditRouteError(
      'Trusted tenant context is required.',
      {
        code:
          'TENANT_CONTEXT_REQUIRED',

        statusCode:
          403,
      },
    );
  }

  return String(
    tenantId,
  );
}

function fallbackTrustedContext(
  req,
  res,
  next,
) {
  const tenantId =
    req.user?.tenantId ||
    req.auth?.tenantId;

  const actorId =
    req.user?._id ||
    req.user?.id ||
    req.auth?.userId;

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
        'Trusted tenant context is required.',

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
        'Authenticated actor context is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.adminContext =
    {
      tenantId:
        String(
          tenantId,
        ),

      actorId:
        String(
          actorId,
        ),

      userId:
        String(
          actorId,
        ),

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    };

  next();
}

/**
 * ============================================================================
 * AUTHORIZATION
 * ============================================================================
 */

function createAuditAuthorization() {
  /**
   * Prefer an explicit permission contract when available.
   */
  if (
    typeof authorizationModule?.requirePermission ===
    'function'
  ) {
    return authorizationModule.requirePermission(
      'admin.audit.read',
    );
  }

  if (
    typeof authorizationModule?.authorizePermission ===
    'function'
  ) {
    return authorizationModule.authorizePermission(
      'admin.audit.read',
    );
  }

  if (
    typeof authorizationModule ===
    'function'
  ) {
    return authorizationModule(
      'ADMIN',
      'AUDITOR',
    );
  }

  if (
    typeof authorizationModule?.authorize ===
    'function'
  ) {
    return authorizationModule.authorize(
      'ADMIN',
      'AUDITOR',
    );
  }

  /**
   * Conservative fallback.
   *
   * Audit timelines contain financial/accounting information, so MEMBER access
   * is deliberately not permitted here.
   */
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

    const roles =
      Array.isArray(
        req.user?.roles,
      )
        ? req.user.roles.map(
            (value) =>
              String(
                value,
              ).toLowerCase(),
          )
        : [];

    const authorized =
      role ===
        'admin' ||
      role ===
        'auditor' ||
      roles.includes(
        'admin',
      ) ||
      roles.includes(
        'auditor',
      );

    if (
      !authorized
    ) {
      return res.status(
        403,
      ).json({
        success:
          false,

        code:
          'AUDIT_PERMISSION_DENIED',

        message:
          'Audit access requires appropriate administrative authorization.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    next();
  };
}

/**
 * ============================================================================
 * ASYNC HANDLER
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
    Promise
      .resolve(
        handler(
          req,
          res,
          next,
        ),
      )
      .catch(
        next,
      );
  };
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
 * EXPORTS
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

module.exports =
  router;

module.exports.ROUTER_NAME =
  ROUTER_NAME;

module.exports.ROUTER_VERSION =
  ROUTER_VERSION;

module.exports.AuditRouteError =
  AuditRouteError;