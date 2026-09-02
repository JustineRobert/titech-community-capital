// ============================================================================
// TITech Community Capital
// Enterprise Permission Gate
// File: frontend/src/components/ui/PermissionGate.jsx
// Production Grade
// ============================================================================
//
// PURPOSE
// ----------------------------------------------------------------------------
// Centralized frontend authorization boundary for TITech Community Capital.
//
// DESIGN PRINCIPLES
// ----------------------------------------------------------------------------
// ✓ Deny-by-default authorization
// ✓ Permission-based access control
// ✓ Role-based access control
// ✓ Multi-permission checks
// ✓ Any/all permission strategies
// ✓ Any/all role strategies
// ✓ Tenant-aware authorization
// ✓ Optional resource ownership checks
// ✓ Super-admin support
// ✓ Explicit fallback rendering
// ✓ React 18 compatible
// ✓ Memoized authorization calculations
// ✓ No business logic inside protected components
// ✓ Safe handling of malformed authorization data
// ✓ Reusable hooks
// ✓ No ACFOS references
//
// SECURITY NOTE
// ----------------------------------------------------------------------------
// This component is a UX authorization boundary only.
//
// Backend authorization MUST remain authoritative.
//
// Never rely on this component to protect:
// - financial transactions
// - wallet operations
// - loans
// - savings
// - mobile-money operations
// - KYC/AML operations
// - administrative APIs
// - tenant isolation
// - privileged system operations
//
// The backend must independently enforce every authorization decision.
//
// ============================================================================

"use strict";

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Constants
// ============================================================================

export const PERMISSION_STRATEGIES = Object.freeze({
  ANY: "any",
  ALL: "all",
});

export const ROLE_STRATEGIES = Object.freeze({
  ANY: "any",
  ALL: "all",
});

export const AUTHORIZATION_DECISIONS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
});

// ============================================================================
// Authorization Context
// ============================================================================
//
// The context is intentionally lightweight.
//
// Applications may populate this context from their existing authentication
// provider without coupling this component to a particular authentication
// implementation.
//

const AuthorizationContext =
  createContext(null);

// ============================================================================
// Normalization Helpers
// ============================================================================

function normalizeString(value) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value.trim();
}

function normalizeArray(value) {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(normalizeString)
      .filter(Boolean);
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return [
      value.trim(),
    ];
  }

  return [];
}

function normalizeSet(value) {
  return new Set(
    normalizeArray(value)
  );
}

function normalizeBoolean(
  value,
  fallback = false
) {
  return typeof value === "boolean"
    ? value
    : fallback;
}

// ============================================================================
// Permission Matching
// ============================================================================

function hasPermission(
  permissions,
  requiredPermission
) {
  const normalizedRequired =
    normalizeString(
      requiredPermission
    );

  if (
    !normalizedRequired
  ) {
    return true;
  }

  const permissionSet =
    normalizeSet(
      permissions
    );

  if (
    permissionSet.has("*")
  ) {
    return true;
  }

  if (
    permissionSet.has(
      normalizedRequired
    )
  ) {
    return true;
  }

  /*
   * Optional wildcard support.
   *
   * Example:
   *   finance.*
   *
   * grants:
   *   finance.read
   *   finance.write
   *   finance.approve
   */

  const segments =
    normalizedRequired.split(
      "."
    );

  for (
    let index = segments.length;
    index > 0;
    index -= 1
  ) {
    const wildcard =
      `${segments
        .slice(0, index)
        .join(".")}.*`;

    if (
      permissionSet.has(
        wildcard
      )
    ) {
      return true;
    }
  }

  return false;
}

function evaluatePermissions(
  permissions,
  requiredPermissions,
  strategy
) {
  const required =
    normalizeArray(
      requiredPermissions
    );

  if (
    required.length === 0
  ) {
    return true;
  }

  if (
    strategy ===
    PERMISSION_STRATEGIES.ALL
  ) {
    return required.every(
      (permission) =>
        hasPermission(
          permissions,
          permission
        )
    );
  }

  return required.some(
    (permission) =>
      hasPermission(
        permissions,
        permission
      )
  );
}

// ============================================================================
// Role Matching
// ============================================================================

function hasRole(
  roles,
  requiredRole
) {
  const normalizedRequired =
    normalizeString(
      requiredRole
    );

  if (
    !normalizedRequired
  ) {
    return true;
  }

  const roleSet =
    normalizeSet(
      roles
    );

  return (
    roleSet.has("*") ||
    roleSet.has(
      normalizedRequired
    )
  );
}

function evaluateRoles(
  roles,
  requiredRoles,
  strategy
) {
  const required =
    normalizeArray(
      requiredRoles
    );

  if (
    required.length === 0
  ) {
    return true;
  }

  if (
    strategy ===
    ROLE_STRATEGIES.ALL
  ) {
    return required.every(
      (role) =>
        hasRole(
          roles,
          role
        )
    );
  }

  return required.some(
    (role) =>
      hasRole(
        roles,
        role
      )
  );
}

// ============================================================================
// Tenant Matching
// ============================================================================

function evaluateTenant(
  currentTenantId,
  requiredTenantId,
  allowGlobalAccess
) {
  const required =
    normalizeString(
      requiredTenantId
    );

  if (!required) {
    return true;
  }

  const current =
    normalizeString(
      currentTenantId
    );

  if (
    allowGlobalAccess &&
    current === "*"
  ) {
    return true;
  }

  return (
    Boolean(current) &&
    current === required
  );
}

// ============================================================================
// Ownership Matching
// ============================================================================

function evaluateOwnership({
  enabled,
  resourceOwnerId,
  currentUserId,
}) {
  if (!enabled) {
    return true;
  }

  const owner =
    normalizeString(
      resourceOwnerId
    );

  const user =
    normalizeString(
      currentUserId
    );

  if (
    !owner ||
    !user
  ) {
    return false;
  }

  return owner === user;
}

// ============================================================================
// Super Administrator Matching
// ============================================================================

function evaluateSuperAdmin({
  isSuperAdmin,
  allowSuperAdmin,
}) {
  if (
    !allowSuperAdmin
  ) {
    return false;
  }

  return (
    isSuperAdmin === true
  );
}

// ============================================================================
// Authorization Evaluation
// ============================================================================

export function evaluateAuthorization(
  {
    permissions = [],
    roles = [],
    currentTenantId = null,
    requiredTenantId = null,
    currentUserId = null,
    resourceOwnerId = null,
    requiredPermissions = [],
    requiredRoles = [],
    permissionStrategy =
      PERMISSION_STRATEGIES.ANY,
    roleStrategy =
      ROLE_STRATEGIES.ANY,
    isAuthenticated = false,
    isSuperAdmin = false,
    allowSuperAdmin = true,
    requireAuthentication = true,
    ownershipRequired = false,
    allowGlobalTenantAccess = true,
  } = {}
) {
  if (
    requireAuthentication &&
    !isAuthenticated
  ) {
    return {
      allowed: false,
      decision:
        AUTHORIZATION_DECISIONS.DENY,
      reason:
        "AUTHENTICATION_REQUIRED",
    };
  }

  if (
    evaluateSuperAdmin({
      isSuperAdmin,
      allowSuperAdmin,
    })
  ) {
    return {
      allowed: true,
      decision:
        AUTHORIZATION_DECISIONS.ALLOW,
      reason:
        "SUPER_ADMIN",
    };
  }

  const permissionsAllowed =
    evaluatePermissions(
      permissions,
      requiredPermissions,
      permissionStrategy
    );

  if (
    !permissionsAllowed
  ) {
    return {
      allowed: false,
      decision:
        AUTHORIZATION_DECISIONS.DENY,
      reason:
        "PERMISSION_DENIED",
    };
  }

  const rolesAllowed =
    evaluateRoles(
      roles,
      requiredRoles,
      roleStrategy
    );

  if (
    !rolesAllowed
  ) {
    return {
      allowed: false,
      decision:
        AUTHORIZATION_DECISIONS.DENY,
      reason:
        "ROLE_DENIED",
    };
  }

  const tenantAllowed =
    evaluateTenant(
      currentTenantId,
      requiredTenantId,
      allowGlobalTenantAccess
    );

  if (
    !tenantAllowed
  ) {
    return {
      allowed: false,
      decision:
        AUTHORIZATION_DECISIONS.DENY,
      reason:
        "TENANT_DENIED",
    };
  }

  const ownershipAllowed =
    evaluateOwnership({
      enabled:
        ownershipRequired,
      resourceOwnerId,
      currentUserId,
    });

  if (
    !ownershipAllowed
  ) {
    return {
      allowed: false,
      decision:
        AUTHORIZATION_DECISIONS.DENY,
      reason:
        "OWNERSHIP_DENIED",
    };
  }

  return {
    allowed: true,
    decision:
      AUTHORIZATION_DECISIONS.ALLOW,
    reason:
      "AUTHORIZED",
  };
}

// ============================================================================
// Authorization Provider
// ============================================================================

export function AuthorizationProvider({
  children,
  value,
}) {
  const normalizedValue =
    useMemo(() => {
      const source =
        value || {};

      const user =
        source.user || {};

      return {
        ...source,

        user,

        permissions:
          normalizeArray(
            source.permissions ??
              user.permissions
          ),

        roles:
          normalizeArray(
            source.roles ??
              user.roles ??
              user.role
          ),

        currentTenantId:
          source.currentTenantId ??
          user.tenantId ??
          user.tenant?.id ??
          null,

        currentUserId:
          source.currentUserId ??
          user._id ??
          user.id ??
          null,

        isAuthenticated:
          normalizeBoolean(
            source.isAuthenticated,
            Boolean(
              source.user
            )
          ),

        isSuperAdmin:
          normalizeBoolean(
            source.isSuperAdmin,
            Boolean(
              user.isSuperAdmin
            )
          ),
      };
    }, [value]);

  return (
    <AuthorizationContext.Provider
      value={
        normalizedValue
      }
    >
      {children}
    </AuthorizationContext.Provider>
  );
}

AuthorizationProvider.propTypes = {
  children:
    PropTypes.node.isRequired,

  value:
    PropTypes.shape({
      user:
        PropTypes.object,

      permissions:
        PropTypes.arrayOf(
          PropTypes.string
        ),

      roles:
        PropTypes.arrayOf(
          PropTypes.string
        ),

      currentTenantId:
        PropTypes.string,

      currentUserId:
        PropTypes.string,

      isAuthenticated:
        PropTypes.bool,

      isSuperAdmin:
        PropTypes.bool,
    }).isRequired,
};

// ============================================================================
// Authorization Context Hook
// ============================================================================

export function useAuthorization() {
  return (
    useContext(
      AuthorizationContext
    ) || {
      user: null,
      permissions: [],
      roles: [],
      currentTenantId: null,
      currentUserId: null,
      isAuthenticated: false,
      isSuperAdmin: false,
    }
  );
}

// ============================================================================
// usePermission
// ============================================================================

export function usePermission(
  permission,
  options = {}
) {
  const authorization =
    useAuthorization();

  const {
    requireAuthentication = true,
    allowSuperAdmin = true,
  } = options;

  return useMemo(
    () =>
      evaluateAuthorization({
        ...authorization,
        requiredPermissions:
          permission,
        requireAuthentication,
        allowSuperAdmin,
      }).allowed,
    [
      authorization,
      permission,
      requireAuthentication,
      allowSuperAdmin,
    ]
  );
}

// ============================================================================
// usePermissions
// ============================================================================

export function usePermissions(
  permissions = [],
  options = {}
) {
  const authorization =
    useAuthorization();

  const {
    strategy =
      PERMISSION_STRATEGIES.ANY,
    requireAuthentication = true,
    allowSuperAdmin = true,
  } = options;

  return useMemo(
    () =>
      evaluateAuthorization({
        ...authorization,
        requiredPermissions:
          permissions,
        permissionStrategy:
          strategy,
        requireAuthentication,
        allowSuperAdmin,
      }).allowed,
    [
      authorization,
      permissions,
      strategy,
      requireAuthentication,
      allowSuperAdmin,
    ]
  );
}

// ============================================================================
// useRole
// ============================================================================

export function useRole(
  role,
  options = {}
) {
  const authorization =
    useAuthorization();

  const {
    requireAuthentication = true,
    allowSuperAdmin = true,
  } = options;

  return useMemo(
    () =>
      evaluateAuthorization({
        ...authorization,
        requiredRoles: role,
        requireAuthentication,
        allowSuperAdmin,
      }).allowed,
    [
      authorization,
      role,
      requireAuthentication,
      allowSuperAdmin,
    ]
  );
}

// ============================================================================
// Permission Gate
// ============================================================================

const PermissionGate =
  memo(function PermissionGate({
    children,

    permission,

    permissions = [],

    roles = [],

    permissionStrategy =
      PERMISSION_STRATEGIES.ANY,

    roleStrategy =
      ROLE_STRATEGIES.ANY,

    tenantId = null,

    ownerId = null,

    ownershipRequired = false,

    requireAuthentication = true,

    allowSuperAdmin = true,

    allowGlobalTenantAccess = true,

    fallback = null,

    loadingFallback = null,

    loading = false,

    user = null,

    currentUserId = null,

    currentTenantId = null,

    isAuthenticated = null,

    isSuperAdmin = null,

    authorization = null,

    renderFallback = null,
  }) {
    const context =
      useAuthorization();

    const resolvedUser =
      user ??
      authorization?.user ??
      context.user;

    const resolvedPermissions =
      permissions.length > 0
        ? permissions
        : authorization?.permissions ??
          context.permissions ??
          resolvedUser?.permissions ??
          [];

    const resolvedRoles =
      roles.length > 0
        ? roles
        : authorization?.roles ??
          context.roles ??
          resolvedUser?.roles ??
          resolvedUser?.role ??
          [];

    const resolvedTenantId =
      currentTenantId ??
      authorization?.currentTenantId ??
      context.currentTenantId ??
      resolvedUser?.tenantId ??
      resolvedUser?.tenant?.id ??
      null;

    const resolvedUserId =
      currentUserId ??
      authorization?.currentUserId ??
      context.currentUserId ??
      resolvedUser?._id ??
      resolvedUser?.id ??
      null;

    const resolvedAuthenticated =
      isAuthenticated !== null
        ? isAuthenticated
        : authorization?.isAuthenticated ??
          context.isAuthenticated ??
          Boolean(
            resolvedUser
          );

    const resolvedSuperAdmin =
      isSuperAdmin !== null
        ? isSuperAdmin
        : authorization?.isSuperAdmin ??
          context.isSuperAdmin ??
          Boolean(
            resolvedUser?.isSuperAdmin
          );

    const decision =
      useMemo(
        () =>
          evaluateAuthorization({
            permissions:
              resolvedPermissions,
            roles:
              resolvedRoles,
            currentTenantId:
              resolvedTenantId,
            requiredTenantId:
              tenantId,
            currentUserId:
              resolvedUserId,
            resourceOwnerId:
              ownerId,
            requiredPermissions:
              [
                ...normalizeArray(
                  permission
                ),
                ...normalizeArray(
                  permissions
                ),
              ],
            requiredRoles:
              roles,
            permissionStrategy,
            roleStrategy,
            isAuthenticated:
              resolvedAuthenticated,
            isSuperAdmin:
              resolvedSuperAdmin,
            allowSuperAdmin,
            requireAuthentication,
            ownershipRequired,
            allowGlobalTenantAccess,
          }),
        [
          resolvedPermissions,
          resolvedRoles,
          resolvedTenantId,
          tenantId,
          resolvedUserId,
          ownerId,
          permission,
          permissions,
          roles,
          permissionStrategy,
          roleStrategy,
          resolvedAuthenticated,
          resolvedSuperAdmin,
          allowSuperAdmin,
          requireAuthentication,
          ownershipRequired,
          allowGlobalTenantAccess,
        ]
      );

    // ------------------------------------------------------------------------
    // Loading State
    // ------------------------------------------------------------------------

    if (loading) {
      return (
        <>
          {loadingFallback}
        </>
      );
    }

    // ------------------------------------------------------------------------
    // Authorized
    // ------------------------------------------------------------------------

    if (
      decision.allowed
    ) {
      return (
        <>
          {children}
        </>
      );
    }

    // ------------------------------------------------------------------------
    // Custom Fallback Renderer
    // ------------------------------------------------------------------------

    if (
      typeof renderFallback ===
      "function"
    ) {
      return renderFallback(
        decision
      );
    }

    // ------------------------------------------------------------------------
    // Denied
    // ------------------------------------------------------------------------

    return (
      <>
        {fallback}
      </>
    );
  });

// ============================================================================
// Prop Types
// ============================================================================

PermissionGate.propTypes = {
  children:
    PropTypes.node,

  permission:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  permissions:
    PropTypes.arrayOf(
      PropTypes.string
    ),

  roles:
    PropTypes.arrayOf(
      PropTypes.string
    ),

  permissionStrategy:
    PropTypes.oneOf(
      Object.values(
        PERMISSION_STRATEGIES
      )
    ),

  roleStrategy:
    PropTypes.oneOf(
      Object.values(
        ROLE_STRATEGIES
      )
    ),

  tenantId:
    PropTypes.string,

  ownerId:
    PropTypes.string,

  ownershipRequired:
    PropTypes.bool,

  requireAuthentication:
    PropTypes.bool,

  allowSuperAdmin:
    PropTypes.bool,

  allowGlobalTenantAccess:
    PropTypes.bool,

  fallback:
    PropTypes.node,

  loadingFallback:
    PropTypes.node,

  loading:
    PropTypes.bool,

  user:
    PropTypes.object,

  currentUserId:
    PropTypes.string,

  currentTenantId:
    PropTypes.string,

  isAuthenticated:
    PropTypes.bool,

  isSuperAdmin:
    PropTypes.bool,

  authorization:
    PropTypes.object,

  renderFallback:
    PropTypes.func,
};

// ============================================================================
// Display Name
// ============================================================================

PermissionGate.displayName =
  "PermissionGate";

// ============================================================================
// Exports
// ============================================================================

export {
  PermissionGate,
};

export default PermissionGate;