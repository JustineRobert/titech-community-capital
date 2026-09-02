'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/AdminRoute.jsx
 *
 * Purpose:
 *   Canonical administrative authentication and authorization boundary.
 *
 * Responsibilities:
 *   - Verify authentication
 *   - Verify administrative role
 *   - Verify tenant context when required
 *   - Verify permissions when configured
 *   - Verify feature flags when configured
 *   - Preserve intended navigation location
 *   - Expose reusable authorization helpers
 *   - Support nested React Router <Outlet /> routes
 *   - Support children-based composition
 *
 * Non-responsibilities:
 *   - Authentication implementation
 *   - Token refresh
 *   - API communication
 *   - Financial authorization inside backend services
 *   - Ledger/business-rule authorization
 *   - Database access
 *
 * IMPORTANT SECURITY PRINCIPLE:
 *
 *   Frontend authorization is a UX/security boundary, not the authoritative
 *   financial authorization boundary.
 *
 *   Every privileged TITech operation must still be authorized by the backend.
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
  Lock,
  ShieldAlert,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ADMIN_ROLES = Object.freeze([
  'admin',
  'super_admin',
]);

const LAST_ADMIN_ROUTE_KEY =
  'titech:last-admin-route';

const DEFAULT_REDIRECT_PATH =
  '/login';

// ============================================================================
// Role normalization
// ============================================================================

function normalizeRole(role) {
  if (typeof role !== 'string') {
    return null;
  }

  return role
    .trim()
    .toLowerCase();
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) {
    return new Set(
      DEFAULT_ADMIN_ROLES
    );
  }

  return new Set(
    roles
      .filter(
        (role) =>
          typeof role === 'string'
      )
      .map(normalizeRole)
      .filter(Boolean)
  );
}

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
          size={36}
          aria-hidden="true"
          className="spin"
        />

        <p>
          Verifying access…
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
    'You do not have permission to access this area.',
  icon = 'lock',
}) {
  const Icon =
    icon === 'shield'
      ? ShieldAlert
      : Lock;

  return (
    <div
      className="route-unauthorized-page"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="route-unauthorized-card"
      >
        <Icon
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
// Authorization decision helper
// ============================================================================
//
// Centralizes authorization logic so AdminRoute and useAdminAuthorization
// evaluate permissions consistently.
// ============================================================================

function evaluateAuthorization({
  user,
  userPermissions,
  tenant,
  hasPermission,
  hasFeature,
  roles,
  permissions,
  featureFlag,
  requireTenant,
}) {
  const normalizedAllowedRoles =
    normalizeRoles(roles);

  const normalizedUserRole =
    normalizeRole(user?.role);

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  if (!user) {
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
  // Role
  // --------------------------------------------------------------------------

  if (
    !normalizedAllowedRoles.has(
      normalizedUserRole
    )
  ) {
    return {
      allowed: false,
      reason: 'role_denied',
    };
  }

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

  const requiredPermissions =
    Array.isArray(permissions)
      ? permissions.filter(
          Boolean
        )
      : [];

  if (
    requiredPermissions.length > 0
  ) {
    const hasRequiredPermissions =
      requiredPermissions.every(
        (permission) => {
          if (
            typeof hasPermission ===
            'function'
          ) {
            return Boolean(
              hasPermission(
                permission
              )
            );
          }

          return Array.isArray(
            userPermissions
          )
            ? userPermissions.includes(
                permission
              )
            : false;
        }
      );

    if (
      !hasRequiredPermissions
    ) {
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
     * Fail closed when feature capability is unavailable.
     *
     * This prevents accidentally exposing an administrative feature merely
     * because the AuthContext does not yet expose hasFeature().
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
      !hasFeature(featureFlag)
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
// Unauthorized response resolver
// ============================================================================

function renderUnauthorized(
  reason,
  customComponent
) {
  if (customComponent) {
    return customComponent;
  }

  switch (reason) {
    case 'tenant_required':
      return (
        <Unauthorized
          icon="shield"
          title="Tenant Required"
          message={
            'No tenant context is available for your account.'
          }
        />
      );

    case 'permission_denied':
      return (
        <Unauthorized
          icon="shield"
          title="Insufficient Permissions"
          message={
            'Your administrator account lacks the required permissions.'
          }
        />
      );

    case 'feature_disabled':
      return (
        <Unauthorized
          icon="shield"
          title="Feature Disabled"
          message={
            'This feature is not enabled for your tenant.'
          }
        />
      );

    case 'feature_unavailable':
      return (
        <Unauthorized
          icon="shield"
          title="Feature Unavailable"
          message={
            'The required feature authorization capability is unavailable.'
          }
        />
      );

    case 'role_denied':
    default:
      return (
        <Unauthorized
          icon="lock"
          title="Administrator Access Required"
          message={
            'Administrator privileges are required to access this area.'
          }
        />
      );
  }
}

// ============================================================================
// Admin Route
// ============================================================================

function AdminRoute({
  children,
  roles = DEFAULT_ADMIN_ROLES,
  permissions = [],
  featureFlag = null,
  requireTenant = false,
  redirectTo = DEFAULT_REDIRECT_PATH,
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
  } = auth;

  // --------------------------------------------------------------------------
  // Authentication state
  // --------------------------------------------------------------------------

  const authenticated =
    typeof isAuthenticated ===
    'boolean'
      ? isAuthenticated
      : Boolean(user);

  // --------------------------------------------------------------------------
  // Authorization decision
  // --------------------------------------------------------------------------
  //
  // This is calculated on every render rather than conditionally invoking
  // hooks. That keeps hook ordering deterministic.
  // --------------------------------------------------------------------------

  const authorization =
    !loading &&
    authenticated &&
    user
      ? evaluateAuthorization({
          user,
          userPermissions,
          tenant,
          hasPermission,
          hasFeature,
          roles,
          permissions,
          featureFlag,
          requireTenant,
        })
      : {
          allowed: false,
          reason: 'loading',
        };

  // --------------------------------------------------------------------------
  // Admin route diagnostics
  // --------------------------------------------------------------------------
  //
  // IMPORTANT:
  // This is diagnostic convenience only. It has no authorization effect.
  //
  // The stored route is not used to grant access.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (loading) {
      return;
    }

    if (
      !authenticated ||
      !user ||
      !authorization.allowed
    ) {
      return;
    }

    try {
      sessionStorage.setItem(
        LAST_ADMIN_ROUTE_KEY,
        location.pathname
      );
    } catch {
      /*
       * Storage may be unavailable in private/restricted browser contexts.
       * Authorization must continue normally.
       */
    }
  }, [
    loading,
    authenticated,
    user,
    authorization.allowed,
    location.pathname,
  ]);

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
    !authenticated ||
    !user
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
  // Authorization
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
  // Render protected content
  // --------------------------------------------------------------------------

  if (
    children !== undefined &&
    children !== null
  ) {
    return children;
  }

  return (
    <Outlet />
  );
}

// ============================================================================
// Authorization hook
// ============================================================================

export function useAdminAuthorization() {
  const auth =
    useAuth() || {};

  const {
    user = null,
    permissions = [],
    tenant = null,
    hasPermission,
    hasFeature,
  } = auth;

  const normalizedRole =
    normalizeRole(
      user?.role
    );

  const isAdmin =
    normalizeRoles(
      DEFAULT_ADMIN_ROLES
    ).has(
      normalizedRole
    );

  const can =
    useCallback(
      (permission) => {
        if (
          !permission
        ) {
          return false;
        }

        if (
          typeof hasPermission ===
          'function'
        ) {
          return Boolean(
            hasPermission(
              permission
            )
          );
        }

        return (
          Array.isArray(
            permissions
          ) &&
          permissions.includes(
            permission
          )
        );
      },
      [
        hasPermission,
        permissions,
      ]
    );

  const featureEnabled =
    useCallback(
      (flag) => {
        if (!flag) {
          return false;
        }

        /*
         * Fail closed when feature authorization is unavailable.
         */
        if (
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

  return {
    user,
    tenant,
    isAdmin,
    can,
    featureEnabled,
  };
}

// ============================================================================
// Higher Order Component
// ============================================================================

export function withAdminRoute(
  Component,
  options = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withAdminRoute requires a valid React component.'
    );
  }

  function WrappedComponent(
    props
  ) {
    return (
      <AdminRoute
        {...options}
      >
        <Component
          {...props}
        />
      </AdminRoute>
    );
  }

  WrappedComponent.displayName =
    `withAdminRoute(${
      Component.displayName ||
      Component.name ||
      'Component'
    })`;

  return WrappedComponent;
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  AdminRoute
);