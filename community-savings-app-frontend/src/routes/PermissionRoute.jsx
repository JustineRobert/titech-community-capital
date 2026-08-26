'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/PermissionRoute.jsx
 *
 * Purpose:
 *   Canonical permission-based route authorization boundary.
 *
 * Responsibilities:
 *   - Verify authentication
 *   - Verify tenant context when required
 *   - Verify feature flags when configured
 *   - Evaluate permissions using ALL / ANY / NONE semantics
 *   - Preserve intended navigation
 *   - Support nested React Router <Outlet /> routes
 *   - Support children-based composition
 *   - Provide reusable permission hooks
 *   - Provide HOC-based route protection
 *
 * Non-responsibilities:
 *   - Authentication implementation
 *   - Token refresh
 *   - API communication
 *   - Backend authorization
 *   - Financial business rules
 *   - Ledger / wallet authorization
 *   - Database access
 *
 * SECURITY PRINCIPLE:
 *
 *   This is a frontend authorization boundary.
 *
 *   It improves UX and limits access to protected UI routes, but it is NOT
 *   authoritative security. Every privileged backend operation must enforce
 *   authorization independently.
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
  ShieldX,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

export const PERMISSION_MODE =
  Object.freeze({
    ALL: 'all',
    ANY: 'any',
    NONE: 'none',
  });

const DEFAULT_REDIRECT_PATH =
  '/dashboard';

const LAST_PERMISSION_ROUTE_KEY =
  'titech:last-permission-route';

// ============================================================================
// Loader
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
          Verifying permissions…
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Unauthorized
// ============================================================================

function Unauthorized({
  title = 'Permission Denied',
  message =
    'You do not have the required permissions to access this resource.',
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
        <ShieldX
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
// Permission normalization
// ============================================================================

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
// Permission evaluator
// ============================================================================

function evaluatePermissions({
  permissions,
  mode,
  userPermissions,
  checker,
}) {
  const required =
    normalizePermissionList(
      permissions
    );

  /*
   * No required permissions means there is no permission restriction at this
   * layer.
   */
  if (
    required.length === 0
  ) {
    return true;
  }

  const normalizedMode =
    Object.values(
      PERMISSION_MODE
    ).includes(mode)
      ? mode
      : PERMISSION_MODE.ALL;

  switch (
    normalizedMode
  ) {
    case PERMISSION_MODE.ANY:
      return required.some(
        (permission) =>
          checkPermission(
            permission,
            userPermissions,
            checker
          )
      );

    case PERMISSION_MODE.NONE:
      return required.every(
        (permission) =>
          !checkPermission(
            permission,
            userPermissions,
            checker
          )
      );

    case PERMISSION_MODE.ALL:
    default:
      return required.every(
        (permission) =>
          checkPermission(
            permission,
            userPermissions,
            checker
          )
      );
  }
}

// ============================================================================
// Authorization evaluation
// ============================================================================

function evaluateAuthorization({
  user,
  tenant,
  isAuthenticated,
  permissions,
  mode,
  userPermissions,
  permissionChecker,
  featureFlag,
  hasFeature,
  requireTenant,
}) {
  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  if (
    !isAuthenticated ||
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
  // Feature flag
  // --------------------------------------------------------------------------

  if (featureFlag) {
    /*
     * Fail closed if feature authorization is not available.
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

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

  const authorized =
    evaluatePermissions({
      permissions,
      mode,
      userPermissions,
      checker:
        permissionChecker,
    });

  if (!authorized) {
    return {
      allowed: false,
      reason:
        'permission_denied',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

// ============================================================================
// Fallback resolver
// ============================================================================

function renderFallback(
  reason,
  fallback
) {
  if (
    fallback !== null &&
    fallback !== undefined
  ) {
    return fallback;
  }

  switch (reason) {
    case 'tenant_required':
      return (
        <Unauthorized
          title="Tenant Required"
          message={
            'This resource requires an active tenant context.'
          }
        />
      );

    case 'feature_disabled':
      return (
        <Unauthorized
          title="Feature Disabled"
          message={
            'This feature is not enabled for your account or tenant.'
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

    case 'permission_denied':
    default:
      return (
        <Unauthorized />
      );
  }
}

// ============================================================================
// Permission Route
// ============================================================================

function PermissionRoute({
  children,
  permissions = [],
  mode =
    PERMISSION_MODE.ALL,
  requireTenant = false,
  featureFlag = null,
  redirectTo =
    DEFAULT_REDIRECT_PATH,
  fallback = null,
}) {
  const location =
    useLocation();

  const auth =
    useAuth() || {};

  const {
    user = null,
    loading = false,
    tenant = null,
    isAuthenticated,
    permissions:
      userPermissions = [],
    hasPermission:
      permissionChecker,
    hasFeature,
  } = auth;

  // --------------------------------------------------------------------------
  // Authentication normalization
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
  // This is ordinary computation, not a conditional hook.
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
          isAuthenticated:
            authenticated,
          permissions,
          mode,
          userPermissions,
          permissionChecker,
          featureFlag,
          hasFeature,
          requireTenant,
        });

  // --------------------------------------------------------------------------
  // Diagnostic audit hook
  // --------------------------------------------------------------------------
  //
  // This effect is always registered, regardless of authorization outcome,
  // which preserves React's Rules of Hooks.
  //
  // The stored route is diagnostic only and never grants access.
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
        LAST_PERMISSION_ROUTE_KEY,
        JSON.stringify({
          path:
            location.pathname,

          permissions:
            normalizePermissionList(
              permissions
            ),

          mode,

          timestamp:
            Date.now(),
        })
      );
    } catch {
      /*
       * Storage failures must never impact authorization.
       */
    }
  }, [
    loading,
    authorization.allowed,
    location.pathname,
    permissions,
    mode,
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
    authorization.reason ===
    'unauthenticated'
  ) {
    return (
      <Navigate
        to="/login"
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
  // Tenant / feature / permission denial
  // --------------------------------------------------------------------------

  if (
    !authorization.allowed
  ) {
    return renderFallback(
      authorization.reason,
      fallback
    );
  }

  // --------------------------------------------------------------------------
  // Render authorized content
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
// Permission hook
// ============================================================================

export function usePermissions() {
  const auth =
    useAuth() || {};

  const {
    permissions = [],
    hasPermission:
      permissionChecker,
  } = auth;

  const can =
    useCallback(
      (permission) =>
        checkPermission(
          permission,
          permissions,
          permissionChecker
        ),
      [
        permissions,
        permissionChecker,
      ]
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

  const cannot =
    useCallback(
      (permission) =>
        !can(permission),
      [can]
    );

  const canNone =
    useCallback(
      (required = []) =>
        normalizePermissionList(
          required
        ).every(
          (permission) =>
            !can(permission)
        ),
      [can]
    );

  return {
    permissions,

    can,
    canAny,
    canAll,
    canNone,
    cannot,
  };
}

// ============================================================================
// HOC
// ============================================================================

export function withPermissionRoute(
  Component,
  options = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withPermissionRoute requires a valid React component.'
    );
  }

  function WrappedComponent(
    props
  ) {
    return (
      <PermissionRoute
        {...options}
      >
        <Component
          {...props}
        />
      </PermissionRoute>
    );
  }

  WrappedComponent.displayName =
    `withPermissionRoute(${
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
  PermissionRoute
);