'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/admin.routes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP routing boundary for TITech Community Capital administrative
 * APIs.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * Request flow:
 *
 *   HTTP Request
 *       ↓
 *   request hardening
 *       ↓
 *   authentication
 *       ↓
 *   admin context
 *       ↓
 *   tenant enforcement
 *       ↓
 *   RBAC / permission enforcement
 *       ↓
 *   request validation
 *       ↓
 *   controller
 *       ↓
 *   admin service
 *       ↓
 *   repository
 *
 * This router intentionally contains NO:
 *
 *   ✗ business calculations
 *   ✗ financial mutation logic
 *   ✗ loan approval logic
 *   ✗ direct database access
 *   ✗ direct repository access
 *   ✗ tenant selection from untrusted query/body values
 *
 * It is the transport/security boundary only.
 *
 * Dependency injection
 * ----------------------------------------------------------------------------
 * The project currently does not expose a verified canonical set of admin
 * controller exports. This router therefore accepts:
 *
 *   createAdminRouter({
 *     authenticate,
 *     adminContext,
 *     requireAdmin,
 *     requirePermission,
 *     validate,
 *     controllers,
 *   });
 *
 * This avoids guessing production module names and prevents broken imports.
 *
 * Backward compatibility
 * ----------------------------------------------------------------------------
 * The router can also be created through:
 *
 *   module.exports.createAdminRouter(...)
 *
 * A default router is exported only when compatible dependencies have been
 * explicitly attached to `req.app.locals.titechAdmin`.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechAdminRouter';

const ROUTER_VERSION =
  '2026.1';

const ROUTE_PREFIX =
  '/admin';

const APPLICATION_NAME =
  'TITech Community Capital';

/**
 * ============================================================================
 * ADMIN ROLES
 * ============================================================================
 *
 * IMPORTANT:
 * The current User model defines:
 *
 *   user
 *   admin
 *   group_admin
 *
 * Do not silently introduce `super_admin` into authorization logic until the
 * User/RBAC model explicitly supports it.
 * ============================================================================
 */

const ADMIN_ROLES =
  Object.freeze([
    'admin',
    'group_admin',
  ]);

/**
 * ============================================================================
 * PERMISSIONS
 * ============================================================================
 *
 * These are stable route-level permission identifiers.
 *
 * Your actual permission middleware remains authoritative.
 * ============================================================================
 */

const PERMISSIONS =
  Object.freeze({
    DASHBOARD_READ:
      'admin.dashboard.read',

    USERS_READ:
      'admin.users.read',

    USERS_WRITE:
      'admin.users.write',

    GROUPS_READ:
      'admin.groups.read',

    GROUPS_WRITE:
      'admin.groups.write',

    LOANS_READ:
      'admin.loans.read',

    LOANS_WRITE:
      'admin.loans.write',

    AUDIT_READ:
      'admin.audit.read',

    REPORTS_READ:
      'admin.reports.read',

    SYSTEM_READ:
      'admin.system.read',

    SYSTEM_WRITE:
      'admin.system.write',
  });

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminRouteError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_ROUTE_ERROR',

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
      'AdminRouteError';

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
 * GENERAL HELPERS
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
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

function createRequestId(
  req,
) {
  return (
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
    crypto.randomUUID()
  );
}

function getCorrelationId(
  req,
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
    createRequestId(
      req,
    )
  );
}

/**
 * ============================================================================
 * ROUTER FACTORY
 * ============================================================================
 */

function createAdminRouter(
  options = {},
) {
  if (
    !options ||
    typeof options !==
      'object'
  ) {
    throw new AdminRouteError(
      'Admin router options must be an object.',
      {
        code:
          'INVALID_ROUTER_OPTIONS',
      },
    );
  }

  const router =
    express.Router({
      strict:
        false,

      caseSensitive:
        false,

      mergeParams:
        true,
    });

  /**
   * ==========================================================================
   * DEPENDENCY RESOLUTION
   * ==========================================================================
   */

  const dependencies =
    resolveDependencies(
      options,
    );

  /**
   * ==========================================================================
   * ROUTE METADATA
   * ==========================================================================
   */

  router.locals =
    {
      name:
        ROUTER_NAME,

      version:
        ROUTER_VERSION,

      application:
        APPLICATION_NAME,

      prefix:
        ROUTE_PREFIX,
    };

  /**
   * ==========================================================================
   * REQUEST CONTEXT / HARDENING
   * ==========================================================================
   */

  router.use(
    requestMetadataMiddleware,
  );

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   *
   * This endpoint deliberately remains lightweight. It proves that the admin
   * router is mounted. Deep dependency health belongs to adminSystem.service.
   */

  router.get(
    '/health',
    asyncHandler(
      async (
        req,
        res,
      ) => {
        const health =
          await executeHealth(
            dependencies,
            req,
          );

        return res.status(
          health.httpStatus,
        ).json(
          health.body,
        );
      },
    ),
  );

  /**
   * ==========================================================================
   * AUTHENTICATION
   * ==========================================================================
   */

  router.use(
    dependencies.authenticate,
  );

  /**
   * ==========================================================================
   * ADMIN CONTEXT
   * ==========================================================================
   */

  if (
    dependencies.adminContextMiddleware
  ) {
    router.use(
      dependencies.adminContextMiddleware,
    );
  } else {
    router.use(
      basicAdminContextMiddleware,
    );
  }

  /**
   * ==========================================================================
   * TENANT ENFORCEMENT
   * ==========================================================================
   */

  if (
    dependencies.tenantMiddleware
  ) {
    router.use(
      dependencies.tenantMiddleware,
    );
  } else {
    router.use(
      enforceTenantContext,
    );
  }

  /**
   * ==========================================================================
   * GLOBAL ADMIN ROLE / ACCESS
   * ==========================================================================
   */

  router.use(
    dependencies.requireAdmin,
  );

  /**
   * ==========================================================================
   * DASHBOARD
   * ==========================================================================
   */

  registerDashboardRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * USERS
   * ==========================================================================
   */

  registerUserRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * GROUPS
   * ==========================================================================
   */

  registerGroupRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * LOANS
   * ==========================================================================
   */

  registerLoanRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  registerAuditRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * REPORTS
   * ==========================================================================
   */

  registerReportRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * SYSTEM
   * ==========================================================================
   */

  registerSystemRoutes(
    router,
    dependencies,
  );

  /**
   * ==========================================================================
   * 404 WITHIN ADMIN AREA
   * ==========================================================================
   */

  router.use(
    (
      req,
      res,
    ) => {
      res.status(
        404,
      ).json({
        success:
          false,

        code:
          'ADMIN_ROUTE_NOT_FOUND',

        message:
          'The requested administrative endpoint does not exist.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    },
  );

  /**
   * ==========================================================================
   * CENTRAL ADMIN ERROR HANDLER
   * ==========================================================================
   *
   * Kept at router level so administrative errors are normalized without
   * leaking stacks, MongoDB errors or secrets.
   */

  router.use(
    adminErrorHandler,
  );

  return router;
}

/**
 * ============================================================================
 * DEPENDENCY RESOLUTION
 * ============================================================================
 */

function resolveDependencies(
  options,
) {
  const provided =
    options;

  const controllers =
    provided.controllers ||
    {};

  return {
    authenticate:
      requireMiddleware(
        provided.authenticate ||
          provided.authMiddleware,
        'authenticate',
      ),

    adminContextMiddleware:
      resolveMiddleware(
        provided.adminContextMiddleware ||
          provided.adminContext,
      ),

    tenantMiddleware:
      resolveMiddleware(
        provided.tenantMiddleware ||
          provided.tenantContextMiddleware,
      ),

    requireAdmin:
      resolveMiddleware(
        provided.requireAdmin ||
          provided.adminAuthorization ||
          createDefaultAdminAuthorization(),
      ),

    requirePermission:
      resolvePermissionMiddleware(
        provided,
      ),

    validate:
      resolveValidationMiddleware(
        provided,
      ),

    controllers: {
      dashboard:
        resolveController(
          controllers.dashboard ||
            provided.dashboardController,
          'dashboard',
        ),

      users:
        resolveController(
          controllers.users ||
            provided.userController,
          'users',
        ),

      groups:
        resolveController(
          controllers.groups ||
            provided.groupController,
          'groups',
        ),

      loans:
        resolveController(
          controllers.loans ||
            provided.loanController,
          'loans',
        ),

      audit:
        resolveController(
          controllers.audit ||
            provided.auditController,
          'audit',
        ),

      reports:
        resolveController(
          controllers.reports ||
            provided.reportsController,
          'reports',
        ),

      system:
        resolveController(
          controllers.system ||
            provided.systemController,
          'system',
        ),
    },

    health:
      provided.health ||
      null,

    routeRateLimiter:
      resolveMiddleware(
        provided.routeRateLimiter,
      ),

    writeRateLimiter:
      resolveMiddleware(
        provided.writeRateLimiter,
      ),

    errorHandler:
      resolveMiddleware(
        provided.errorHandler,
      ),
  };
}

function requireMiddleware(
  middleware,
  name,
) {
  if (
    typeof middleware !==
    'function'
  ) {
    throw new AdminRouteError(
      `${name} middleware is required when creating the TITech admin router.`,
      {
        code:
          'ADMIN_MIDDLEWARE_REQUIRED',

        details: {
          middleware:
            name,
        },
      },
    );
  }

  return middleware;
}

function resolveMiddleware(
  middleware,
) {
  return typeof middleware ===
    'function'
    ? middleware
    : null;
}

function resolveController(
  controller,
  name,
) {
  if (
    controller &&
    typeof controller ===
      'object'
  ) {
    return controller;
  }

  /**
   * Controllers are intentionally optional at router-construction time.
   * Missing endpoints return a deterministic 501 rather than breaking the
   * entire application during boot.
   */
  return {
    __missing:
      true,

    __name:
      name,
  };
}

function resolveValidationMiddleware(
  dependencies,
) {
  if (
    dependencies.adminValidation
      ?.middleware
  ) {
    return (
      validator,
      options,
    ) =>
      dependencies.adminValidation
        .middleware(
          validator,
          options,
        );
  }

  if (
    typeof dependencies.validate ===
    'function'
  ) {
    return dependencies.validate;
  }

  return null;
}

function resolvePermissionMiddleware(
  dependencies,
) {
  if (
    typeof dependencies.requirePermission ===
    'function'
  ) {
    return (
      permission,
    ) =>
      dependencies.requirePermission(
        permission,
      );
  }

  if (
    typeof dependencies.authorize ===
    'function'
  ) {
    return (
      permission,
    ) =>
      dependencies.authorize(
        permission,
      );
  }

  return (
    permission,
    options = {},
  ) =>
    defaultPermissionMiddleware(
      permission,
      options,
    );
}

function createDefaultAdminAuthorization() {
  return (
    req,
    res,
    next,
  ) => {
    const role =
      normalizeString(
        req.user?.role,
      )?.toLowerCase();

    const roles =
      Array.isArray(
        req.user?.roles,
      )
        ? req.user.roles.map(
            (value) =>
              normalizeString(
                value,
              )?.toLowerCase(),
          )
        : [];

    const authorized =
      ADMIN_ROLES.includes(
        role,
      ) ||
      ADMIN_ROLES.some(
        (adminRole) =>
          roles.includes(
            adminRole,
          ),
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
          'ADMIN_ACCESS_REQUIRED',

        message:
          'Administrative privileges are required.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    return next();
  };
}

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 */

function requestMetadataMiddleware(
  req,
  res,
  next,
) {
  req.requestId =
    createRequestId(
      req,
    );

  req.correlationId =
    getCorrelationId(
      req,
    );

  res.setHeader(
    'X-Request-Id',
    req.requestId,
  );

  res.setHeader(
    'X-Correlation-Id',
    req.correlationId,
  );

  next();
}

/**
 * ============================================================================
 * BASIC ADMIN CONTEXT FALLBACK
 * ============================================================================
 *
 * The canonical implementation is the previously created adminContext utility.
 * This fallback only ensures tenant/actor context is exposed when that
 * middleware has not yet been wired.
 * ============================================================================
 */

function basicAdminContextMiddleware(
  req,
  res,
  next,
) {
  const authenticatedUser =
    req.user ||
    req.auth ||
    {};

  req.adminContext =
    {
      tenantId:
        normalizeString(
          req.tenantId ||
            authenticatedUser.tenantId,
        ),

      actorId:
        normalizeString(
          authenticatedUser._id ||
            authenticatedUser.id ||
            authenticatedUser.userId,
        ),

      userId:
        normalizeString(
          authenticatedUser._id ||
            authenticatedUser.id ||
            authenticatedUser.userId,
        ),

      adminId:
        normalizeString(
          authenticatedUser._id ||
            authenticatedUser.id ||
            authenticatedUser.userId,
        ),

      role:
        normalizeString(
          authenticatedUser.role,
        ),

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      route:
        req.originalUrl ||
        req.url,

      method:
        req.method,
    };

  return next();
}

/**
 * ============================================================================
 * TENANT ENFORCEMENT FALLBACK
 * ============================================================================
 */

function enforceTenantContext(
  req,
  res,
  next,
) {
  const tenantId =
    normalizeString(
      req.adminContext
        ?.tenantId ||
        req.tenantId ||
        req.user?.tenantId ||
        req.auth?.tenantId,
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
        'A valid tenant context is required for administrative operations.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  /**
   * Always overwrite the operational request tenant with the trusted value.
   *
   * Do not accept:
   *
   *   req.query.tenantId
   *   req.body.tenantId
   *
   * as authoritative tenant context.
   */
  req.tenantId =
    tenantId;

  if (
    req.adminContext
  ) {
    req.adminContext =
      {
        ...req.adminContext,

        tenantId,
      };
  }

  return next();
}

/**
 * ============================================================================
 * PERMISSION MIDDLEWARE
 * ============================================================================
 */

function defaultPermissionMiddleware(
  permission,
) {
  return (
    req,
    res,
    next,
  ) => {
    const authenticatedUser =
      req.user ||
      req.auth ||
      {};

    const permissions =
      Array.isArray(
        authenticatedUser.permissions,
      )
        ? authenticatedUser.permissions
        : [];

    const roles =
      [
        ...(
          Array.isArray(
            authenticatedUser.roles,
          )
            ? authenticatedUser.roles
            : []
        ),

        authenticatedUser.role,
      ]
        .filter(Boolean)
        .map(
          (
            role,
          ) =>
            String(
              role,
            ).toLowerCase(),
        );

    /**
     * Until a dedicated permission service is injected, administrators are
     * allowed through only if they have the admin role. Actual production
     * installations should wire explicit permission middleware.
     */
    const hasPermission =
      permissions.includes(
        permission,
      );

    const isAdministrator =
      ADMIN_ROLES.some(
        (
          role,
        ) =>
          roles.includes(
            role,
          ),
      );

    if (
      hasPermission ||
      isAdministrator
    ) {
      return next();
    }

    return res.status(
      403,
    ).json({
      success:
        false,

      code:
        'ADMIN_PERMISSION_DENIED',

      message:
        'You do not have permission to perform this administrative operation.',

      permission,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  };
}

/**
 * ============================================================================
 * ROUTE REGISTRATION HELPERS
 * ============================================================================
 */

function registerDashboardRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .dashboard;

  registerGet(
    router,
    '/dashboard',
    {
      permission:
        PERMISSIONS.DASHBOARD_READ,

      controller,

      method:
        'getDashboard',

      aliases: [
        'dashboard',
        'index',
        'summary',
      ],
    },
    dependencies,
  );

  registerGet(
    router,
    '/dashboard/summary',
    {
      permission:
        PERMISSIONS.DASHBOARD_READ,

      controller,

      method:
        'getSummary',

      aliases: [
        'summary',
        'getDashboardSummary',
        'dashboard',
      ],
    },
    dependencies,
  );

  registerGet(
    router,
    '/dashboard/health',
    {
      permission:
        PERMISSIONS.SYSTEM_READ,

      controller:
        dependencies.controllers
          .system,

      method:
        'getHealth',

      aliases: [
        'health',
        'getSystemHealth',
      ],
    },
    dependencies,
  );
}

function registerUserRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .users;

  registerGet(
    router,
    '/users',
    {
      permission:
        PERMISSIONS.USERS_READ,

      controller,

      method:
        'list',

      aliases: [
        'findMany',
        'search',
        'getUsers',
        'index',
      ],

      validation:
        'userSearch',
    },
    dependencies,
  );

  registerGet(
    router,
    '/users/:userId',
    {
      permission:
        PERMISSIONS.USERS_READ,

      controller,

      method:
        'getById',

      aliases: [
        'findById',
        'show',
        'getUser',
      ],

      validation:
        'userId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/users/:userId/security',
    {
      permission:
        PERMISSIONS.USERS_READ,

      controller,

      method:
        'getSecurity',

      aliases: [
        'getSecurityProfile',
        'security',
      ],

      validation:
        'userId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/users/:userId/groups',
    {
      permission:
        PERMISSIONS.GROUPS_READ,

      controller:
        dependencies.controllers
          .groups,

      method:
        'findByUser',

      aliases: [
        'findByMember',
        'getUserGroups',
      ],

      validation:
        'userId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/users/:userId/loans',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller:
        dependencies.controllers
          .loans,

      method:
        'findByUser',

      aliases: [
        'findByMember',
        'getUserLoans',
      ],

      validation:
        'userId',
    },
    dependencies,
  );

  registerPatch(
    router,
    '/users/:userId',
    {
      permission:
        PERMISSIONS.USERS_WRITE,

      controller,

      method:
        'update',

      aliases: [
        'updateUser',
        'edit',
      ],

      validation:
        'userMutation',

      write:
        true,
    },
    dependencies,
  );
}

function registerGroupRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .groups;

  registerGet(
    router,
    '/groups',
    {
      permission:
        PERMISSIONS.GROUPS_READ,

      controller,

      method:
        'list',

      aliases: [
        'findMany',
        'search',
        'getGroups',
        'index',
      ],

      validation:
        'groupSearch',
    },
    dependencies,
  );

  registerGet(
    router,
    '/groups/:groupId',
    {
      permission:
        PERMISSIONS.GROUPS_READ,

      controller,

      method:
        'getById',

      aliases: [
        'findById',
        'show',
        'getGroup',
      ],

      validation:
        'groupId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/groups/:groupId/loans',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller:
        dependencies.controllers
          .loans,

      method:
        'findByGroup',

      aliases: [
        'getGroupLoans',
      ],

      validation:
        'groupId',
    },
    dependencies,
  );

  registerPatch(
    router,
    '/groups/:groupId',
    {
      permission:
        PERMISSIONS.GROUPS_WRITE,

      controller,

      method:
        'update',

      aliases: [
        'updateGroup',
        'edit',
      ],

      validation:
        'groupMutation',

      write:
        true,
    },
    dependencies,
  );
}

function registerLoanRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .loans;

  registerGet(
    router,
    '/loans',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'list',

      aliases: [
        'findMany',
        'search',
        'getLoans',
        'index',
      ],

      validation:
        'loanSearch',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/:loanId',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getById',

      aliases: [
        'findById',
        'show',
        'getLoan',
      ],

      validation:
        'loanId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/:loanId/risk',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getRisk',

      aliases: [
        'risk',
        'getRiskProfile',
      ],

      validation:
        'loanId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/:loanId/repayments',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getRepayments',

      aliases: [
        'repayments',
        'getLoanRepayments',
      ],

      validation:
        'loanId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/portfolio/summary',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getPortfolioSummary',

      aliases: [
        'portfolioSummary',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/portfolio/arrears',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getArrears',

      aliases: [
        'getArrearsSummary',
        'arrears',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/portfolio/risk',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getRiskDistribution',

      aliases: [
        'riskDistribution',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/loans/portfolio/growth',
    {
      permission:
        PERMISSIONS.LOANS_READ,

      controller,

      method:
        'getGrowth',

      aliases: [
        'growth',
        'getLoanGrowth',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );

  registerPatch(
    router,
    '/loans/:loanId',
    {
      permission:
        PERMISSIONS.LOANS_WRITE,

      controller,

      method:
        'update',

      aliases: [
        'updateLoan',
        'edit',
      ],

      validation:
        'loanMutation',

      write:
        true,
    },
    dependencies,
  );

  registerPost(
    router,
    '/loans/:loanId/actions',
    {
      permission:
        PERMISSIONS.LOANS_WRITE,

      controller,

      method:
        'executeAction',

      aliases: [
        'action',
        'transition',
        'performAction',
      ],

      write:
        true,
    },
    dependencies,
  );
}

function registerAuditRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .audit;

  registerGet(
    router,
    '/audit',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'list',

      aliases: [
        'findMany',
        'search',
        'getAuditLogs',
        'index',
      ],

      validation:
        'auditSearch',
    },
    dependencies,
  );

  registerGet(
    router,
    '/audit/:auditId',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'getById',

      aliases: [
        'findById',
        'show',
      ],

      validation:
        'auditId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/audit/users/:userId',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'findByUser',

      aliases: [
        'userTimeline',
        'getUserTimeline',
      ],

      validation:
        'userId',
    },
    dependencies,
  );

  registerGet(
    router,
    '/audit/entities/:entityType/:entityId',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'findByEntity',

      aliases: [
        'entityTimeline',
        'getEntityTimeline',
      ],

      validation:
        'entity',
    },
    dependencies,
  );

  registerGet(
    router,
    '/audit/statistics',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'getStatistics',

      aliases: [
        'statistics',
        'summary',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/audit/integrity',
    {
      permission:
        PERMISSIONS.AUDIT_READ,

      controller,

      method:
        'verifyIntegrity',

      aliases: [
        'verifyChain',
        'integrity',
        'verifyAuditChain',
      ],

      validation:
        'dashboardQuery',
    },
    dependencies,
  );
}

function registerReportRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .reports;

  registerGet(
    router,
    '/reports',
    {
      permission:
        PERMISSIONS.REPORTS_READ,

      controller,

      method:
        'list',

      aliases: [
        'getReports',
        'index',
      ],

      validation:
        'reportQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/reports/summary',
    {
      permission:
        PERMISSIONS.REPORTS_READ,

      controller,

      method:
        'summary',

      aliases: [
        'getSummary',
        'getReportSummary',
      ],

      validation:
        'reportQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/reports/:reportType',
    {
      permission:
        PERMISSIONS.REPORTS_READ,

      controller,

      method:
        'generate',

      aliases: [
        'getReport',
        'generateReport',
      ],

      validation:
        'reportQuery',
    },
    dependencies,
  );

  registerGet(
    router,
    '/reports/:reportType/export',
    {
      permission:
        PERMISSIONS.REPORTS_READ,

      controller,

      method:
        'export',

      aliases: [
        'exportReport',
        'generateExport',
      ],

      validation:
        'reportQuery',
    },
    dependencies,
  );
}

function registerSystemRoutes(
  router,
  dependencies,
) {
  const controller =
    dependencies.controllers
      .system;

  registerGet(
    router,
    '/system',
    {
      permission:
        PERMISSIONS.SYSTEM_READ,

      controller,

      method:
        'getSystemOverview',

      aliases: [
        'overview',
        'summary',
        'getOverview',
      ],
    },
    dependencies,
  );

  registerGet(
    router,
    '/system/health',
    {
      permission:
        PERMISSIONS.SYSTEM_READ,

      controller,

      method:
        'getHealth',

      aliases: [
        'health',
        'healthCheck',
      ],
    },
    dependencies,
  );

  registerGet(
    router,
    '/system/readiness',
    {
      permission:
        PERMISSIONS.SYSTEM_READ,

      controller,

      method:
        'getReadiness',

      aliases: [
        'readiness',
        'readinessCheck',
      ],
    },
    dependencies,
  );

  registerGet(
    router,
    '/system/metrics',
    {
      permission:
        PERMISSIONS.SYSTEM_READ,

      controller,

      method:
        'getMetrics',

      aliases: [
        'metrics',
        'getSystemMetrics',
      ],
    },
    dependencies,
  );

  registerPatch(
    router,
    '/system/settings',
    {
      permission:
        PERMISSIONS.SYSTEM_WRITE,

      controller,

      method:
        'updateSettings',

      aliases: [
        'updateSystemSettings',
      ],

      write:
        true,
    },
    dependencies,
  );
}

/**
 * ============================================================================
 * GENERIC ROUTE REGISTRATION
 * ============================================================================
 */

function registerGet(
  router,
  path,
  config,
  dependencies,
) {
  registerRoute(
    router,
    'get',
    path,
    config,
    dependencies,
  );
}

function registerPost(
  router,
  path,
  config,
  dependencies,
) {
  registerRoute(
    router,
    'post',
    path,
    config,
    dependencies,
  );
}

function registerPatch(
  router,
  path,
  config,
  dependencies,
) {
  registerRoute(
    router,
    'patch',
    path,
    config,
    dependencies,
  );
}

function registerRoute(
  router,
  method,
  path,
  config,
  dependencies,
) {
  const middleware = [];

  /**
   * Per-route rate limiting.
   */
  if (
    dependencies.routeRateLimiter
  ) {
    middleware.push(
      dependencies.routeRateLimiter,
    );
  }

  if (
    config.write &&
    dependencies.writeRateLimiter
  ) {
    middleware.push(
      dependencies.writeRateLimiter,
    );
  }

  /**
   * Permission boundary.
   */
  middleware.push(
    dependencies.requirePermission(
      config.permission,
    ),
  );

  /**
   * Route validation.
   */
  const validationMiddleware =
    resolveRouteValidation(
      config.validation,
      dependencies,
    );

  if (
    validationMiddleware
  ) {
    middleware.push(
      validationMiddleware,
    );
  }

  /**
   * Controller execution.
   */
  middleware.push(
    asyncHandler(
      async (
        req,
        res,
        next,
      ) => {
        const controller =
          resolveControllerMethod(
            config.controller,
            config.method,
            config.aliases,
          );

        if (
          !controller
        ) {
          return res.status(
            501,
          ).json({
            success:
              false,

            code:
              'ADMIN_CONTROLLER_NOT_IMPLEMENTED',

            message:
              `The TITech admin endpoint "${path}" is not yet connected to its controller.`,

            endpoint:
              path,

            requestId:
              req.requestId,

            correlationId:
              req.correlationId,
          });
        }

        return controller(
          req,
          res,
          next,
        );
      },
    ),
  );

  router[
    method
  ](
    path,
    ...middleware,
  );
}

/**
 * ============================================================================
 * VALIDATION ROUTER
 * ============================================================================
 */

function resolveRouteValidation(
  type,
  dependencies,
) {
  if (
    !type
  ) {
    return null;
  }

  const validation =
    dependencies.validate;

  if (
    !validation
  ) {
    return null;
  }

  const adminValidation =
    dependencies.adminValidation ||
    null;

  /**
   * If the injected validation utility exposes canonical validators, use them.
   */
  if (
    adminValidation
  ) {
    const validators =
      {
        userSearch:
          adminValidation
            .validateAdminUserSearch,

        loanSearch:
          adminValidation
            .validateAdminLoanSearch,

        groupSearch:
          adminValidation
            .validateAdminGroupSearch,

        auditSearch:
          adminValidation
            .validateAdminAuditSearch,

        dashboardQuery:
          adminValidation
            .validateDashboardQuery,

        reportQuery:
          adminValidation
            .validateReportQuery,

        userMutation:
          adminValidation
            .validateAdminUserMutation,

        loanMutation:
          adminValidation
            .validateAdminLoanMutation,

        userId:
          validateUserId,

        loanId:
          validateLoanId,

        groupId:
          validateGroupId,

        auditId:
          validateAuditId,

        entity:
          validateEntityRoute,
      };

    const validator =
      validators[
        type
      ];

    if (
      typeof validator ===
      'function'
    ) {
      return validation(
        validator,
        {
          source:
            type ===
            'userSearch' ||
            type ===
            'loanSearch' ||
            type ===
            'groupSearch' ||
            type ===
            'auditSearch' ||
            type ===
            'dashboardQuery' ||
            type ===
            'reportQuery'
              ? 'query'
              : 'params',

          target:
            `validated${capitalize(
              type,
            )}`,
        },
      );
    }
  }

  return null;
}

/**
 * ============================================================================
 * PARAM VALIDATORS
 * ============================================================================
 */

function validateUserId(
  params,
) {
  return validateObjectIdParam(
    params,
    'userId',
  );
}

function validateLoanId(
  params,
) {
  return validateObjectIdParam(
    params,
    'loanId',
  );
}

function validateGroupId(
  params,
) {
  return validateObjectIdParam(
    params,
    'groupId',
  );
}

function validateAuditId(
  params,
) {
  return validateObjectIdParam(
    params,
    'auditId',
  );
}

function validateEntityRoute(
  params,
) {
  return {
    entityType:
      normalizeString(
        params.entityType,
      ),

    entityId:
      normalizeString(
        params.entityId,
      ),
  };
}

function validateObjectIdParam(
  params,
  field,
) {
  const value =
    normalizeString(
      params?.[
        field
      ],
    );

  if (
    !value
  ) {
    const error =
      new Error(
        `${field} is required.`,
      );

    error.statusCode =
      400;

    error.code =
      'INVALID_ADMIN_ROUTE_PARAMETER';

    throw error;
  }

  /**
   * Avoid importing Mongoose into the routes file merely for parameter
   * validation. The canonical adminValidation utility should normally be
   * injected.
   */
  if (
    !/^[a-f\d]{24}$/i.test(
      value,
    )
  ) {
    const error =
      new Error(
        `${field} must be a valid identifier.`,
      );

    error.statusCode =
      400;

    error.code =
      'INVALID_ADMIN_ROUTE_PARAMETER';

    throw error;
  }

  return {
    [field]:
      value,
  };
}

/**
 * ============================================================================
 * CONTROLLER RESOLUTION
 * ============================================================================
 */

function resolveControllerMethod(
  controller,
  method,
  aliases = [],
) {
  if (
    !controller ||
    controller.__missing
  ) {
    return null;
  }

  const candidates =
    [
      method,

      ...(
        Array.isArray(
          aliases,
        )
          ? aliases
          : []
      ),
    ].filter(Boolean);

  for (
    const candidate of
    candidates
  ) {
    if (
      typeof controller[
        candidate
      ] ===
      'function'
    ) {
      return controller[
        candidate
      ].bind(
        controller,
      );
    }
  }

  /**
   * Some controllers are exported directly as functions.
   */
  if (
    typeof controller ===
    'function'
  ) {
    return controller;
  }

  return null;
}

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

async function executeHealth(
  dependencies,
  req,
) {
  try {
    if (
      dependencies.health
    ) {
      const result =
        typeof dependencies.health ===
        'function'
          ? await dependencies.health(
              req,
            )
          : await dependencies.health.health(
              req,
            );

      return {
        httpStatus:
          result?.healthy ===
          false
            ? 503
            : 200,

        body: {
          success:
            result?.healthy !==
            false,

          service:
            ROUTER_NAME,

          version:
            ROUTER_VERSION,

          ...(
            result &&
            typeof result ===
              'object'
              ? result
              : {
                  result,
                }
          ),

          requestId:
            req.requestId,

          correlationId:
            req.correlationId,

          timestamp:
            new Date(),
        },
      };
    }

    return {
      httpStatus:
        200,

      body: {
        success:
          true,

        service:
          ROUTER_NAME,

        version:
          ROUTER_VERSION,

        mounted:
          true,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date(),
      },
    };
  } catch (
    error
  ) {
    return {
      httpStatus:
        503,

      body: {
        success:
          false,

        code:
          'ADMIN_ROUTER_HEALTH_FAILED',

        message:
          'Administrative route health check failed.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      },
    };
  }
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
      .catch(next);
  };
}

/**
 * ============================================================================
 * ERROR HANDLER
 * ============================================================================
 */

function adminErrorHandler(
  error,
  req,
  res,
  next,
) {
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

  const isOperational =
    statusCode >=
      400 &&
    statusCode <
      500;

  const body = {
    success:
      false,

    code:
      normalizeString(
        error?.code,
      ) ||
      (
        statusCode ===
        500
          ? 'ADMIN_INTERNAL_ERROR'
          : 'ADMIN_REQUEST_ERROR'
      ),

    message:
      isOperational
        ? (
            error?.message ||
            'The administrative request could not be completed.'
          )
        : 'The administrative request could not be completed.',

    requestId:
      req.requestId,

    correlationId:
      req.correlationId,
  };

  if (
    error?.details &&
    isOperational
  ) {
    body.details =
      error.details;
  }

  /**
   * Never expose:
   *
   * - stack traces
   * - MongoDB connection errors
   * - tokens
   * - passwords
   * - internal filesystem paths
   */
  return res.status(
    statusCode,
  ).json(
    body,
  );
}

/**
 * ============================================================================
 * UTILITIES
 * ============================================================================
 */

function capitalize(
  value,
) {
  const normalized =
    String(
      value ||
        '',
    );

  return (
    normalized.charAt(
      0,
    ).toUpperCase() +
    normalized.slice(
      1,
    )
  );
}

/**
 * ============================================================================
 * ROUTER METADATA
 * ============================================================================
 */

createAdminRouter.ROUTE_PREFIX =
  ROUTE_PREFIX;

createAdminRouter.ROUTER_NAME =
  ROUTER_NAME;

createAdminRouter.ROUTER_VERSION =
  ROUTER_VERSION;

createAdminRouter.PERMISSIONS =
  PERMISSIONS;

createAdminRouter.ADMIN_ROLES =
  ADMIN_ROLES;

/**
 * ============================================================================
 * DEFAULT EXPORT
 * ============================================================================
 *
 * We intentionally do not automatically guess controller/module paths.
 *
 * Applications should mount:
 *
 *   const {
 *     createAdminRouter,
 *   } = require('./routes/admin.routes');
 *
 *   app.use(
 *     '/api/admin',
 *     createAdminRouter({
 *       authenticate,
 *       adminContextMiddleware,
 *       tenantMiddleware,
 *       requireAdmin,
 *       requirePermission,
 *       adminValidation,
 *       controllers: {
 *         dashboard: dashboardController,
 *         users: adminUserController,
 *         groups: adminGroupController,
 *         loans: adminLoanController,
 *         audit: adminAuditController,
 *         reports: adminReportsController,
 *         system: adminSystemController,
 *       },
 *     }),
 *   );
 *
 * ============================================================================
 */

module.exports =
  createAdminRouter;

module.exports.createAdminRouter =
  createAdminRouter;

module.exports.AdminRouteError =
  AdminRouteError;

module.exports.ROUTER_NAME =
  ROUTER_NAME;

module.exports.ROUTER_VERSION =
  ROUTER_VERSION;

module.exports.ROUTE_PREFIX =
  ROUTE_PREFIX;

module.exports.ADMIN_ROLES =
  ADMIN_ROLES;

module.exports.PERMISSIONS =
  PERMISSIONS;