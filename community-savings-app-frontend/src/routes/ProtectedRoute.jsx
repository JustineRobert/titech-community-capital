'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/ProtectedRoute.jsx
 *
 * Purpose:
 *   Canonical authenticated application route boundary.
 *
 * Responsibilities:
 *   - Verify authenticated session state
 *   - Redirect unauthenticated users
 *   - Preserve intended navigation
 *   - Validate tenant context when required
 *   - Validate roles when configured
 *   - Validate permissions when configured
 *   - Validate feature flags when configured
 *   - Track the last protected route for diagnostics
 *   - React to authentication-expiration events
 *   - Support nested <Outlet /> routing
 *   - Support children-based composition
 *
 * Non-responsibilities:
 *   - Authentication implementation
 *   - Token issuance
 *   - Token refresh implementation
 *   - Backend authorization
 *   - Financial business rules
 *   - Wallet/ledger authorization
 *   - API implementation
 *
 * IMPORTANT SECURITY PRINCIPLE:
 *
 *   Frontend route protection is not authoritative security.
 *
 *   TITech backend services must independently enforce authorization for every
 *   privileged operation, especially financial and administrative operations.
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useEffect,
} from 'react';

import {
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';

import {
  Loader2,
  ShieldAlert,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REDIRECT_PATH =
  '/login';

const LAST_PROTECTED_ROUTE_KEY =
  'titech:last-protected-route';

const SESSION_EXPIRED_EVENT =
  'auth:expired';

// ============================================================================
// Loading component
// ============================================================================

function RouteLoader() {
  return (
    <div
      className="route-loader-page"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="route-loader-card"
      >
        <Loader2
          size={32}
          aria-hidden="true"
          className="spin"
        />

        <p>
          Verifying session…
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Unauthorized component
// ============================================================================

function Unauthorized({
  title = 'Access Denied',
  message =
    'You do not have permission to access this page.',
}) {
  return (
    <div
      className="route-unauthorized-page"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="route-unauthorized-card"
      >
        <ShieldAlert
          size={48}
          aria-hidden="true"
        />

        <h2>
          {title}
        </h2>

        <p>
          {message}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Normalization helpers
// ============================================================================

function normalizeRole(role) {
  if (
    typeof role !==
    'string'
  ) {
    return null;
  }

  return role
    .trim()
    .toLowerCase();
}

function normalizeRoleList(
  roles
) {
  if (!Array.isArray(roles)) {
    return [];
  }

  return [
    ...new Set(
      roles
        .filter(
          (role) =>
            typeof role ===
            'string'
        )
        .map(normalizeRole)
        .filter(Boolean)
    ),
  ];
}

function normalizePermission(
  permission
) {
  if (
    typeof permission !==
    'string'
  ) {
    return null;
  }

  const normalized =
    permission.trim();

  return normalized || null;
}

function normalizePermissionList(
  permissions
) {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return [
    ...new Set(
      permissions
        .map(
          normalizePermission
        )
        .filter(Boolean)
    ),
  ];
}

// ============================================================================
// Permission check
// ============================================================================

function checkPermission(
  permission,
  userPermissions,
  checker
) {
  const normalized =
    normalizePermission(
      permission
    );

  if (!normalized) {
    return false;
  }

  if (
    typeof checker ===
    'function'
  ) {
    return Boolean(
      checker(normalized)
    );
  }

  if (
    !Array.isArray(
      userPermissions
    )
  ) {
    return false;
  }

  return userPermissions.some(
    (userPermission) =>
      normalizePermission(
        userPermission
      ) === normalized
  );
}

// ============================================================================
// Authorization evaluation
// ============================================================================

function evaluateAuthorization({
  user,
  tenant,
  authenticated,
  roles,
  permissions,
  userPermissions,
  hasPermission,
  featureFlag,
  hasFeature,
  requireTenant,
}) {
  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  if (
    !authenticated ||
    !user
  ) {
    return {
      allowed: false,
      reason: 'unauthenticated',
    };
  }

  // --------------------------------------------------------------------------
  // Tenant
  // --------------------------------------------------------------------------

  if (
    requireTenant &&
    !tenant
  ) {
    return {
      allowed: false,
      reason: 'tenant_required',
    };
  }

  // --------------------------------------------------------------------------
  // Roles
  // --------------------------------------------------------------------------

  const requiredRoles =
    normalizeRoleList(
      roles
    );

  if (
    requiredRoles.length >
    0
  ) {
    const currentRole =
      normalizeRole(
        user.role
      );

    if (
      !requiredRoles.includes(
        currentRole
      )
    ) {
      return {
        allowed: false,
        reason: 'role_denied',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

  const requiredPermissions =
    normalizePermissionList(
      permissions
    );

  if (
    requiredPermissions.length >
    0
  ) {
    const allowed =
      requiredPermissions.every(
        (permission) =>
          checkPermission(
            permission,
            userPermissions,
            hasPermission
          )
      );

    if (!allowed) {
      return {
        allowed: false,
        reason:
          'permission_denied',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Feature flag
  // --------------------------------------------------------------------------

  if (featureFlag) {
    /*
     * Fail closed.
     *
     * A missing feature authorization provider must never grant access
     * accidentally.
     */
    if (
      typeof hasFeature !==
      'function'
    ) {
      return {
        allowed: false,
        reason:
          'feature_unavailable',
      };
    }

    if (
      !hasFeature(
        featureFlag
      )
    ) {
      return {
        allowed: false,
        reason:
          'feature_disabled',
      };
    }
  }

  return {
    allowed: true,
    reason: null,
  };
}

// ============================================================================
// Unauthorized result
// ============================================================================

function renderUnauthorized(
  reason,
  customComponent
) {
  if (
    customComponent !==
      null &&
    customComponent !==
      undefined
  ) {
    return customComponent;
  }

  switch (reason) {
    case 'tenant_required':
      return (
        <Unauthorized
          title="Tenant Required"
          message={
            'No tenant is associated with your account.'
          }
        />
      );

    case 'role_denied':
      return (
        <Unauthorized
          title="Role Restricted"
          message={
            'Your role does not have access to this area.'
          }
        />
      );

    case 'permission_denied':
      return (
        <Unauthorized
          title="Insufficient Permissions"
          message={
            'Your account lacks the required permissions.'
          }
        />
      );

    case 'feature_disabled':
      return (
        <Unauthorized
          title="Feature Disabled"
          message={
            'This feature is not enabled for your account.'
          }
        />
      );

    case 'feature_unavailable':
      return (
        <Unauthorized
          title="Feature Unavailable"
          message={
            'Feature authorization is currently unavailable.'
          }
        />
      );

    default:
      return (
        <Unauthorized
          message={
            'You do not have permission to access this page.'
          }
        />
      );
  }
}

// ============================================================================
// Protected route
// ============================================================================

function ProtectedRoute({
  children,
  roles = [],
  permissions = [],
  featureFlag = null,
  requireTenant = false,
  redirectTo =
    DEFAULT_REDIRECT_PATH,
  unauthorizedComponent = null,
}) {
  const location =
    useLocation();

  const auth =
    useAuth() || {};

  const {
    user = null,
    loading = false,
    isAuthenticated,
    permissions:
      userPermissions = [],
    tenant = null,
    hasPermission,
    hasFeature,
    logout,
  } = auth;

  // --------------------------------------------------------------------------
  // Normalize authentication state
  // --------------------------------------------------------------------------

  const authenticated =
    typeof isAuthenticated ===
    'boolean'
      ? isAuthenticated
      : Boolean(user);

  // --------------------------------------------------------------------------
  // Compute authorization without conditional hooks
  // --------------------------------------------------------------------------

  const authorization =
    loading
      ? {
          allowed: false,
          reason: 'loading',
        }
      : evaluateAuthorization({
          user,
          tenant,
          authenticated,
          roles,
          permissions,
          userPermissions,
          hasPermission,
          featureFlag,
          hasFeature,
          requireTenant,
        });

  // --------------------------------------------------------------------------
  // Protected-route diagnostics
  // --------------------------------------------------------------------------
  //
  // This is diagnostic only. It never grants access.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (
      loading ||
      !authorization.allowed
    ) {
      return;
    }

    try {
      sessionStorage.setItem(
        LAST_PROTECTED_ROUTE_KEY,
        location.pathname
      );
    } catch {
      /*
       * Storage availability must never affect route authorization.
       */
    }
  }, [
    loading,
    authorization.allowed,
    location.pathname,
  ]);

  // --------------------------------------------------------------------------
  // Session expiration handling
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (
      typeof window ===
      'undefined'
    ) {
      return undefined;
    }

    const handleSessionExpired =
      async (event) => {
        if (
          event?.detail?.reason !==
          'session_expired'
        ) {
          return;
        }

        /*
         * Prevent multiple simultaneous expiration events from causing
         * repeated logout requests.
         */
        try {
          await logout?.();
        } catch (error) {
          /*
           * Logout failure must not create an infinite event loop.
           */
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              '[TITech] Session expiration logout failed.',
              error
            );
          }
        }
      };

    window.addEventListener(
      SESSION_EXPIRED_EVENT,
      handleSessionExpired
    );

    return () => {
      window.removeEventListener(
        SESSION_EXPIRED_EVENT,
        handleSessionExpired
      );
    };
  }, [logout]);

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <RouteLoader />
    );
  }

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  if (
    authorization.reason ===
    'unauthenticated'
  ) {
    return (
      <Navigate
        to={redirectTo}
        replace
        state={{
          from: {
            pathname:
              location.pathname,
            search:
              location.search,
            hash:
              location.hash,
          },
        }}
      />
    );
  }

  // --------------------------------------------------------------------------
  // Authorization failure
  // --------------------------------------------------------------------------

  if (
    !authorization.allowed
  ) {
    return renderUnauthorized(
      authorization.reason,
      unauthorizedComponent
    );
  }

  // --------------------------------------------------------------------------
  // Authorized content
  // --------------------------------------------------------------------------

  if (
    children !== null &&
    children !== undefined
  ) {
    return children;
  }

  return (
    <Outlet />
  );
}

// ============================================================================
// Authorization utilities
// ============================================================================

export function useAuthorization() {
  const auth =
    useAuth() || {};

  const {
    user = null,
    permissions = [],
    hasPermission,
    hasFeature,
    tenant = null,
  } = auth;

  const can =
    useCallback(
      (permission) =>
        checkPermission(
          permission,
          permissions,
          hasPermission
        ),
      [
        permissions,
        hasPermission,
      ]
    );

  const hasRole =
    useCallback(
      (role) =>
        normalizeRole(
          user?.role
        ) ===
        normalizeRole(
          role
        ),
      [user?.role]
    );

  const hasAnyRole =
    useCallback(
      (roles = []) => {
        const currentRole =
          normalizeRole(
            user?.role
          );

        return normalizeRoleList(
          roles
        ).includes(
          currentRole
        );
      },
      [user?.role]
    );

  const hasAllRoles =
    useCallback(
      (roles = []) => {
        /*
         * A user can only have one effective role in the current model.
         *
         * This helper is primarily useful for normalized capability checks.
         */
        const normalizedRoles =
          normalizeRoleList(
            roles
          );

        if (
          normalizedRoles.length ===
          0
        ) {
          return true;
        }

        const currentRole =
          normalizeRole(
            user?.role
          );

        return (
          normalizedRoles.length ===
            1 &&
          normalizedRoles[0] ===
            currentRole
        );
      },
      [user?.role]
    );

  const featureEnabled =
    useCallback(
      (flag) => {
        if (
          !flag ||
          typeof hasFeature !==
            'function'
        ) {
          return false;
        }

        return Boolean(
          hasFeature(flag)
        );
      },
      [hasFeature]
    );

  const canAny =
    useCallback(
      (required = []) =>
        normalizePermissionList(
          required
        ).some(
          (permission) =>
            can(permission)
        ),
      [can]
    );

  const canAll =
    useCallback(
      (required = []) =>
        normalizePermissionList(
          required
        ).every(
          (permission) =>
            can(permission)
        ),
      [can]
    );

  return {
    user,
    tenant,

    can,
    canAny,
    canAll,

    hasRole,
    hasAnyRole,
    hasAllRoles,

    featureEnabled,
  };
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  ProtectedRoute
);