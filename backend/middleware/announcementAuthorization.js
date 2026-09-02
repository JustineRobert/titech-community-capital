/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Authorization Middleware
 * ============================================================================
 *
 * File:
 *   backend/middleware/announcementAuthorization.js
 *
 * Purpose:
 *   Central server-side authorization and trusted context establishment for
 *   TITech announcement APIs.
 *
 * Security Model:
 *   - Never trust tenant identifiers supplied by clients.
 *   - Never use x-tenant-id as authoritative tenant context.
 *   - Tenant context comes from the authenticated identity/session.
 *   - Platform-level roles may operate across tenants where permitted.
 *   - Tenant-scoped administrators are restricted to their own tenant.
 *   - Resource-level authorization must still be enforced by the service layer.
 *   - Audience eligibility must be evaluated server-side.
 *
 * Responsibilities:
 *   - Authentication enforcement.
 *   - Role normalization.
 *   - Tenant context normalization.
 *   - Group membership normalization.
 *   - Authorization context attachment.
 *   - Announcement-management authorization.
 *   - Audit access authorization.
 *   - Tenant/resource ownership checks.
 *
 * IMPORTANT:
 *   Middleware establishes authorization context. It must NOT be treated as
 *   a replacement for service-layer authorization.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const PLATFORM_ADMIN_ROLES = Object.freeze([
  'super_admin',
  'system_admin',
  'platform_admin',
]);

const ANNOUNCEMENT_ADMIN_ROLES = Object.freeze([
  ...PLATFORM_ADMIN_ROLES,
  'tenant_admin',
  'admin',
]);

const AUDITOR_ROLES = Object.freeze([
  ...PLATFORM_ADMIN_ROLES,
  'tenant_admin',
  'admin',
  'auditor',
  'compliance_officer',
]);

const SUPPORT_ROLES = Object.freeze([
  ...PLATFORM_ADMIN_ROLES,
  'tenant_admin',
  'admin',
  'support_staff',
]);

const TENANT_SCOPED_ADMIN_ROLES = Object.freeze([
  'tenant_admin',
  'admin',
]);

/* ============================================================================
 * RESPONSE HELPERS
 * ========================================================================== */

/**
 * Send a standardized authorization error response.
 *
 * @param {Object} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {Object}
 */
function authorizationError(
  res,
  status,
  code,
  message,
) {
  return res.status(status).json({
    success: false,
    code,
    message,
  });
}

/**
 * Authentication failure.
 *
 * @param {Object} res
 * @returns {Object}
 */
function unauthorized(res) {
  return authorizationError(
    res,
    401,
    'UNAUTHORIZED',
    'Authentication is required.',
  );
}

/**
 * Authorization failure.
 *
 * @param {Object} res
 * @param {string} message
 * @returns {Object}
 */
function forbidden(
  res,
  message = 'You are not authorized to perform this operation.',
) {
  return authorizationError(
    res,
    403,
    'FORBIDDEN',
    message,
  );
}

/* ============================================================================
 * IDENTITY HELPERS
 * ========================================================================== */

/**
 * Return the authenticated user attached by the authentication middleware.
 *
 * @param {Object} req
 * @returns {Object|null}
 */
function getAuthenticatedUser(req) {
  if (!req || !req.user) {
    return null;
  }

  return req.user;
}

/**
 * Resolve the authenticated user's canonical identifier.
 *
 * @param {Object|null} user
 * @returns {*|null}
 */
function getUserId(user) {
  if (!user) {
    return null;
  }

  return (
    user._id ||
    user.id ||
    null
  );
}

/**
 * Normalize one role.
 *
 * @param {*} role
 * @returns {string|null}
 */
function normalizeRole(role) {
  if (
    role === undefined ||
    role === null
  ) {
    return null;
  }

  const normalized =
    String(role)
      .trim()
      .toLowerCase();

  return normalized || null;
}

/**
 * Return normalized authenticated-user roles.
 *
 * Supports both:
 *
 *   user.roles = ['admin', 'auditor']
 *
 * and:
 *
 *   user.role = 'admin'
 *
 * @param {Object|null} user
 * @returns {string[]}
 */
function getUserRoles(user) {
  if (!user) {
    return [];
  }

  const roles = [];

  if (Array.isArray(user.roles)) {
    roles.push(...user.roles);
  }

  if (
    user.role !== undefined &&
    user.role !== null
  ) {
    roles.push(user.role);
  }

  return [
    ...new Set(
      roles
        .map(normalizeRole)
        .filter(Boolean),
    ),
  ];
}

/**
 * Resolve the authoritative tenant identifier.
 *
 * Priority:
 *   1. user.tenantId
 *   2. user.tenant._id
 *
 * NEVER reads:
 *   req.headers['x-tenant-id']
 *   req.body.tenantId
 *   req.query.tenantId
 *
 * Those values are client-controlled.
 *
 * @param {Object|null} user
 * @returns {*|null}
 */
function getTenantId(user) {
  if (!user) {
    return null;
  }

  return (
    user.tenantId ||
    user.tenant?._id ||
    null
  );
}

/**
 * Normalize group membership identifiers.
 *
 * @param {Object|null} user
 * @returns {Array}
 */
function getUserGroupIds(user) {
  if (!user) {
    return [];
  }

  if (!Array.isArray(user.groupIds)) {
    return [];
  }

  return [
    ...new Set(
      user.groupIds
        .filter(
          (groupId) =>
            groupId !== undefined &&
            groupId !== null &&
            String(groupId).trim() !== '',
        )
        .map(
          (groupId) =>
            String(groupId),
        ),
    ),
  ];
}

/* ============================================================================
 * ROLE HELPERS
 * ========================================================================== */

/**
 * Determine whether the user has at least one allowed role.
 *
 * @param {Object|null} user
 * @param {string[]} allowedRoles
 * @returns {boolean}
 */
function hasAnyRole(
  user,
  allowedRoles = [],
) {
  if (
    !user ||
    !Array.isArray(allowedRoles) ||
    allowedRoles.length === 0
  ) {
    return false;
  }

  const roles =
    getUserRoles(user);

  const normalizedAllowedRoles =
    allowedRoles
      .map(normalizeRole)
      .filter(Boolean);

  return normalizedAllowedRoles.some(
    (role) =>
      roles.includes(role),
  );
}

/**
 * Determine whether the user has a platform-wide administrative role.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
function isPlatformAdmin(user) {
  return hasAnyRole(
    user,
    PLATFORM_ADMIN_ROLES,
  );
}

/**
 * Determine whether the user has an announcement-management role.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
function isAnnouncementAdmin(user) {
  return hasAnyRole(
    user,
    ANNOUNCEMENT_ADMIN_ROLES,
  );
}

/**
 * Determine whether the user has an audit-access role.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
function isAnnouncementAuditor(user) {
  return hasAnyRole(
    user,
    AUDITOR_ROLES,
  );
}

/**
 * Determine whether the user has support authorization.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
function isAnnouncementSupport(user) {
  return hasAnyRole(
    user,
    SUPPORT_ROLES,
  );
}

/**
 * Determine whether the user is a tenant-scoped administrator.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
function isTenantScopedAdmin(user) {
  return hasAnyRole(
    user,
    TENANT_SCOPED_ADMIN_ROLES,
  );
}

/* ============================================================================
 * CONTEXT
 * ========================================================================== */

/**
 * Build a trusted immutable authorization context.
 *
 * This object is intentionally derived exclusively from authenticated
 * server-side identity data.
 *
 * @param {Object} user
 * @returns {Object}
 */
function buildAnnouncementContext(user) {
  const userId =
    getUserId(user);

  const tenantId =
    getTenantId(user);

  const roles =
    getUserRoles(user);

  const groupIds =
    getUserGroupIds(user);

  return Object.freeze({
    userId,

    tenantId,

    roles: Object.freeze([
      ...roles,
    ]),

    groupIds: Object.freeze([
      ...groupIds,
    ]),

    isPlatformAdmin:
      isPlatformAdmin(user),

    isTenantScopedAdmin:
      isTenantScopedAdmin(user),

    isAnnouncementAdmin:
      isAnnouncementAdmin(user),

    isAnnouncementAuditor:
      isAnnouncementAuditor(user),

    isAnnouncementSupport:
      isAnnouncementSupport(user),
  });
}

/* ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ========================================================================== */

/**
 * Require an authenticated identity.
 *
 * This middleware assumes the authentication layer has already populated
 * req.user.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireAuthenticatedAnnouncementUser(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  if (!getUserId(user)) {
    return unauthorized(res);
  }

  return next();
}

/* ============================================================================
 * ADMIN AUTHORIZATION
 * ========================================================================== */

/**
 * Require announcement-management authorization.
 *
 * Platform administrators are globally authorized.
 *
 * Tenant administrators are authorized to manage announcements only within
 * their authenticated tenant. Resource-level tenant ownership is enforced
 * separately by assertAnnouncementTenantAccess().
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireAnnouncementAdmin(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  if (!getUserId(user)) {
    return unauthorized(res);
  }

  if (
    !isAnnouncementAdmin(user)
  ) {
    return forbidden(
      res,
      'You are not authorized to manage announcements.',
    );
  }

  /**
   * Tenant-scoped administrators must have an authoritative tenant.
   */
  if (
    isTenantScopedAdmin(user) &&
    !isPlatformAdmin(user) &&
    !getTenantId(user)
  ) {
    return forbidden(
      res,
      'A tenant-scoped administrator must have an authenticated tenant context.',
    );
  }

  return next();
}

/* ============================================================================
 * AUDIT AUTHORIZATION
 * ========================================================================== */

/**
 * Require announcement-audit access.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireAnnouncementAuditor(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  if (!getUserId(user)) {
    return unauthorized(res);
  }

  if (
    !isAnnouncementAuditor(user)
  ) {
    return forbidden(
      res,
      'You are not authorized to access announcement audit records.',
    );
  }

  /**
   * Tenant-scoped audit users must have tenant context.
   */
  if (
    !isPlatformAdmin(user) &&
    !getTenantId(user)
  ) {
    return forbidden(
      res,
      'A tenant-scoped audit user must have an authenticated tenant context.',
    );
  }

  return next();
}

/* ============================================================================
 * SUPPORT AUTHORIZATION
 * ========================================================================== */

/**
 * Require announcement support authorization.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function requireAnnouncementSupport(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  if (
    !isAnnouncementSupport(user)
  ) {
    return forbidden(
      res,
      'You are not authorized to perform announcement support operations.',
    );
  }

  return next();
}

/* ============================================================================
 * CONTEXT ATTACHMENT
 * ========================================================================== */

/**
 * Attach trusted announcement authorization context.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function attachAnnouncementContext(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  const userId =
    getUserId(user);

  if (!userId) {
    return unauthorized(res);
  }

  req.announcementContext =
    buildAnnouncementContext(user);

  return next();
}

/* ============================================================================
 * TENANT AUTHORIZATION
 * ========================================================================== */

/**
 * Compare two tenant identifiers safely.
 *
 * Handles:
 *   ObjectId
 *   string
 *   populated identifiers
 *
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
function sameTenant(
  left,
  right,
) {
  if (
    left === undefined ||
    left === null ||
    right === undefined ||
    right === null
  ) {
    return false;
  }

  return String(left) === String(right);
}

/**
 * Assert that the authenticated user may access a tenant.
 *
 * Platform administrators may access any tenant.
 *
 * Tenant-scoped administrators may access only their own tenant.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {*} resourceTenantId
 * @returns {boolean}
 */
function assertTenantAccess(
  req,
  res,
  resourceTenantId,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    unauthorized(res);
    return false;
  }

  if (isPlatformAdmin(user)) {
    return true;
  }

  const authenticatedTenantId =
    getTenantId(user);

  if (
    !authenticatedTenantId ||
    !resourceTenantId
  ) {
    forbidden(
      res,
      'Tenant context is required for this operation.',
    );

    return false;
  }

  if (
    !sameTenant(
      authenticatedTenantId,
      resourceTenantId,
    )
  ) {
    forbidden(
      res,
      'You are not authorized to access this tenant resource.',
    );

    return false;
  }

  return true;
}

/**
 * Assert that an announcement belongs to the authenticated tenant.
 *
 * Platform-wide announcements with tenantId === null are intentionally
 * treated differently and should normally be restricted to platform
 * administrators.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} announcement
 * @returns {boolean}
 */
function assertAnnouncementTenantAccess(
  req,
  res,
  announcement,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    unauthorized(res);
    return false;
  }

  if (!announcement) {
    forbidden(
      res,
      'Announcement resource is unavailable.',
    );

    return false;
  }

  /**
   * Platform administrators may access platform and tenant announcements.
   */
  if (isPlatformAdmin(user)) {
    return true;
  }

  const announcementTenantId =
    announcement.tenantId || null;

  const authenticatedTenantId =
    getTenantId(user);

  /**
   * A tenant-scoped administrator/user must never mutate or administer a
   * platform-wide announcement.
   */
  if (!announcementTenantId) {
    forbidden(
      res,
      'Platform-wide announcements require platform-level authorization.',
    );

    return false;
  }

  if (!authenticatedTenantId) {
    forbidden(
      res,
      'Authenticated tenant context is required.',
    );

    return false;
  }

  if (
    !sameTenant(
      authenticatedTenantId,
      announcementTenantId,
    )
  ) {
    forbidden(
      res,
      'You are not authorized to access this announcement.',
    );

    return false;
  }

  return true;
}

/* ============================================================================
 * AUDIENCE AUTHORIZATION
 * ========================================================================== */

/**
 * Determine whether the user belongs to a specific group.
 *
 * @param {Object} user
 * @param {Array} groupIds
 * @returns {boolean}
 */
function isMemberOfAnyGroup(
  user,
  groupIds = [],
) {
  if (
    !user ||
    !Array.isArray(groupIds) ||
    groupIds.length === 0
  ) {
    return false;
  }

  const userGroupIds =
    getUserGroupIds(user);

  return groupIds.some(
    (groupId) =>
      userGroupIds.includes(
        String(groupId),
      ),
  );
}

/**
 * Determine whether the authenticated user is explicitly targeted.
 *
 * @param {Object} user
 * @param {Array} userIds
 * @returns {boolean}
 */
function isExplicitlyTargetedUser(
  user,
  userIds = [],
) {
  const userId =
    getUserId(user);

  if (
    !userId ||
    !Array.isArray(userIds)
  ) {
    return false;
  }

  return userIds.some(
    (targetUserId) =>
      sameTenant(
        userId,
        targetUserId,
      ),
  );
}

/**
 * Determine whether the user's role matches an audience role.
 *
 * @param {Object} user
 * @param {Array} audienceRoles
 * @returns {boolean}
 */
function hasAudienceRole(
  user,
  audienceRoles = [],
) {
  if (
    !Array.isArray(audienceRoles) ||
    audienceRoles.length === 0
  ) {
    return false;
  }

  return hasAnyRole(
    user,
    audienceRoles,
  );
}

/**
 * Determine whether an authenticated user is eligible for an announcement
 * audience.
 *
 * NOTE:
 * Domain-specific membership checks such as "loan_users" and "savings_users"
 * should ultimately be resolved by the appropriate domain service. This
 * middleware only handles identity, role, tenant, group, and explicit-user
 * dimensions that are available on req.user.
 *
 * @param {Object} user
 * @param {Object} audience
 * @returns {boolean}
 */
function isAnnouncementAudienceEligible(
  user,
  audience,
) {
  if (!user || !audience) {
    return false;
  }

  const scope =
    String(
      audience.scope ||
        'authenticated_users',
    )
      .trim()
      .toLowerCase();

  switch (scope) {
    case 'all_users':
    case 'authenticated_users':
      return true;

    case 'members':
      return (
        user.isMember === true ||
        hasAnyRole(user, [
          'member',
          'user',
        ])
      );

    case 'admins':
      return hasAnyRole(
        user,
        ANNOUNCEMENT_ADMIN_ROLES,
      );

    case 'tenant_admins':
      return hasAnyRole(
        user,
        [
          ...TENANT_SCOPED_ADMIN_ROLES,
          ...PLATFORM_ADMIN_ROLES,
        ],
      );

    case 'support_staff':
      return isAnnouncementSupport(
        user,
      );

    case 'specific_tenant':
      return (
        Array.isArray(
          audience.tenantIds,
        ) &&
        audience.tenantIds.some(
          (tenantId) =>
            sameTenant(
              getTenantId(user),
              tenantId,
            ),
        )
      );

    case 'specific_group':
      return isMemberOfAnyGroup(
        user,
        audience.groupIds,
      );

    case 'specific_user':
      return isExplicitlyTargetedUser(
        user,
        audience.userIds,
      );

    default:
      /**
       * Unknown audience scopes must fail closed.
       */
      return false;
  }
}

/* ============================================================================
 * REQUEST SAFETY
 * ========================================================================== */

/**
 * Reject attempts to override server-derived tenant context.
 *
 * This does not mean clients may never send a tenantId. It means the value
 * must not silently replace the authenticated tenant context.
 *
 * Controllers/services may inspect these values for explicit platform-admin
 * workflows where cross-tenant administration is intentionally supported.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function protectTenantContext(
  req,
  res,
  next,
) {
  const user =
    getAuthenticatedUser(req);

  if (!user) {
    return unauthorized(res);
  }

  /**
   * Platform administrators may intentionally specify a target tenant,
   * provided the service layer validates the target tenant and operation.
   */
  if (isPlatformAdmin(user)) {
    return next();
  }

  const authenticatedTenantId =
    getTenantId(user);

  const suppliedTenantId =
    req.body?.tenantId ||
    req.query?.tenantId ||
    req.params?.tenantId ||
    null;

  /**
   * No supplied tenant is perfectly valid.
   */
  if (!suppliedTenantId) {
    return next();
  }

  /**
   * A tenant-scoped identity may only refer to its own tenant.
   */
  if (
    !authenticatedTenantId ||
    !sameTenant(
      authenticatedTenantId,
      suppliedTenantId,
    )
  ) {
    return forbidden(
      res,
      'The supplied tenant context does not match the authenticated tenant.',
    );
  }

  return next();
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

module.exports = Object.freeze({
  getAuthenticatedUser,
  getUserId,
  getUserRoles,
  getTenantId,
  getUserGroupIds,

  hasAnyRole,
  isPlatformAdmin,
  isAnnouncementAdmin,
  isAnnouncementAuditor,
  isAnnouncementSupport,
  isTenantScopedAdmin,

  buildAnnouncementContext,

  requireAuthenticatedAnnouncementUser,
  requireAnnouncementAdmin,
  requireAnnouncementAuditor,
  requireAnnouncementSupport,

  attachAnnouncementContext,

  sameTenant,
  assertTenantAccess,
  assertAnnouncementTenantAccess,

  isMemberOfAnyGroup,
  isExplicitlyTargetedUser,
  hasAudienceRole,
  isAnnouncementAudienceEligible,

  protectTenantContext,
});