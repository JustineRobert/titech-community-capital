'use strict';

/**
 * ============================================================================
 * CHAT AUTHORIZATION MIDDLEWARE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Centralized Role-Based Access Control (RBAC) middleware for TITechChat.
 *
 * Supports:
 *
 * ✅ JWT Authentication Integration
 * ✅ Role-Based Authorization
 * ✅ Permission-Based Authorization
 * ✅ Multi-Role Authorization
 * ✅ Super Admin Override
 * ✅ Tenant Isolation Ready
 * ✅ Audit Logging Ready
 * ✅ Compliance Ready
 * ✅ Business Thread Protection
 * ✅ Conversation Access Enforcement
 *
 * DEFAULT ROLES
 * ----------------------------------------------------------------------------
 * MEMBER
 * LEADER
 * ADMIN
 * SUPPORT
 * AUDITOR
 * SUPER_ADMIN
 *
 * ============================================================================
 */

const DEFAULT_ADMIN_ROLES = [
  'ADMIN',
  'SUPER_ADMIN',
];

const DEFAULT_SUPPORT_ROLES = [
  'SUPPORT',
  'ADMIN',
  'SUPER_ADMIN',
];

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeRole(role) {
  if (!role) {
    return '';
  }

  return String(role)
    .trim()
    .toUpperCase();
}

function getUserRole(req) {
  return normalizeRole(
    req?.user?.role
  );
}

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    message:
      'Authentication required.',
    code: 'UNAUTHORIZED',
  });
}

function forbidden(
  res,
  requiredRoles = []
) {
  return res.status(403).json({
    success: false,
    message:
      'Insufficient permissions.',
    code: 'FORBIDDEN',
    requiredRoles,
  });
}

/*
|--------------------------------------------------------------------------
| Main RBAC Middleware
|--------------------------------------------------------------------------
*/

function authorize(...roles) {
  const allowedRoles =
    roles.map(normalizeRole);

  return (
    req,
    res,
    next
  ) => {
    if (!req.user) {
      return unauthorized(res);
    }

    const userRole =
      getUserRole(req);

    if (!userRole) {
      return forbidden(
        res,
        allowedRoles
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Super Admin Override
    |--------------------------------------------------------------------------
    */

    if (
      userRole ===
      'SUPER_ADMIN'
    ) {
      return next();
    }

    /*
    |--------------------------------------------------------------------------
    | Role Validation
    |--------------------------------------------------------------------------
    */

    if (
      allowedRoles.length > 0 &&
      !allowedRoles.includes(
        userRole
      )
    ) {
      return forbidden(
        res,
        allowedRoles
      );
    }

    return next();
  };
}

/*
|--------------------------------------------------------------------------
| Permission Middleware
|--------------------------------------------------------------------------
*/

function authorizePermission(
  ...permissions
) {
  return (
    req,
    res,
    next
  ) => {
    if (!req.user) {
      return unauthorized(res);
    }

    const userPermissions =
      req.user.permissions || [];

    const allowed =
      permissions.some(
        permission =>
          userPermissions.includes(
            permission
          )
      );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message:
          'Permission denied.',
        code:
          'PERMISSION_DENIED',
        permissions,
      });
    }

    next();
  };
}

/*
|--------------------------------------------------------------------------
| Predefined Guards
|--------------------------------------------------------------------------
*/

const requireAdmin =
  authorize(
    ...DEFAULT_ADMIN_ROLES
  );

const requireSupport =
  authorize(
    ...DEFAULT_SUPPORT_ROLES
  );

const requireStaff =
  authorize(
    'SUPPORT',
    'ADMIN',
    'SUPER_ADMIN'
  );

const requireLeader =
  authorize(
    'LEADER',
    'ADMIN',
    'SUPER_ADMIN'
  );

const requireAuditor =
  authorize(
    'AUDITOR',
    'ADMIN',
    'SUPER_ADMIN'
  );

/*
|--------------------------------------------------------------------------
| Ownership Guard
|--------------------------------------------------------------------------
*/

function requireOwnership(
  getOwnerId
) {
  return async (
    req,
    res,
    next
  ) => {
    try {
      if (!req.user) {
        return unauthorized(
          res
        );
      }

      const ownerId =
        await getOwnerId(
          req
        );

      if (
        !ownerId
      ) {
        return res.status(404).json({
          success: false,
          message:
            'Resource not found.',
          code:
            'RESOURCE_NOT_FOUND',
        });
      }

      const userId =
        String(
          req.user._id
        );

      const owner =
        String(ownerId);

      if (
        owner === userId ||
        getUserRole(req) ===
          'SUPER_ADMIN'
      ) {
        return next();
      }

      return forbidden(
        res
      );
    } catch (error) {
      return next(error);
    }
  };
}

/*
|--------------------------------------------------------------------------
| Utility Helpers
|--------------------------------------------------------------------------
*/

function hasRole(
  user,
  ...roles
) {
  if (!user) {
    return false;
  }

  const userRole =
    normalizeRole(
      user.role
    );

  return roles
    .map(normalizeRole)
    .includes(userRole);
}

function isAdmin(user) {
  return hasRole(
    user,
    'ADMIN',
    'SUPER_ADMIN'
  );
}

function isSupport(user) {
  return hasRole(
    user,
    'SUPPORT',
    'ADMIN',
    'SUPER_ADMIN'
  );
}

module.exports =
  authorize;

module.exports.authorize =
  authorize;

module.exports.authorizePermission =
  authorizePermission;

module.exports.requireAdmin =
  requireAdmin;

module.exports.requireSupport =
  requireSupport;

module.exports.requireStaff =
  requireStaff;

module.exports.requireLeader =
  requireLeader;

module.exports.requireAuditor =
  requireAuditor;

module.exports.requireOwnership =
  requireOwnership;

module.exports.hasRole =
  hasRole;

module.exports.isAdmin =
  isAdmin;

module.exports.isSupport =
  isSupport;