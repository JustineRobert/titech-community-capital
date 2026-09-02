'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/FeatureRoute.jsx
 *
 * Purpose:
 *   Canonical feature-gated route boundary.
 *
 * Responsibilities:
 *   - Authenticate users when required
 *   - Validate tenant context when required
 *   - Validate role requirements
 *   - Validate permission requirements
 *   - Validate feature flags
 *   - Apply deterministic percentage rollouts
 *   - Preserve intended navigation
 *   - Support nested <Outlet /> routes
 *   - Support children-based composition
 *   - Provide reusable feature access helpers
 *
 * Non-responsibilities:
 *   - Backend authorization
 *   - Financial business rules
 *   - API implementation
 *   - Feature flag persistence
 *   - Database access
 *   - Transaction authorization
 *
 * IMPORTANT SECURITY PRINCIPLE:
 *
 *   FeatureRoute is a frontend delivery/UX boundary.
 *
 *   It MUST NOT be treated as the authoritative authorization boundary for
 *   financial, administrative, KYC/AML, wallet, ledger, loan, savings,
 *   contribution, withdrawal, transfer, or mobile-money operations.
 *
 *   The backend must independently enforce authorization.
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
  FlaskConical,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REDIRECT_PATH =
  '/dashboard';

const LAST_FEATURE_ROUTE_KEY =
  'titech:last-feature-route';

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
          Loading feature…
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Feature unavailable component
// ============================================================================

function FeatureUnavailable({
  title = 'Feature Unavailable',
  message =
    'This feature is not enabled for your account.',
  icon = 'feature',
}) {
  const Icon =
    icon === 'security'
      ? ShieldAlert
      : FlaskConical;

  return (
    <div
      className="route-unavailable-page"
      role="status"
      aria-live="polite"
    >
      <div
        className="route-unavailable-card"
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
// Role normalization
// ============================================================================

function normalizeRole(role) {
  if (
    typeof role !== 'string'
  ) {
    return null;
  }

  return role
    .trim()
    .toLowerCase();
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) {
    return new Set();
  }

  return new Set(
    roles
      .filter(
        (role) =>
          typeof role ===
          'string'
      )
      .map(normalizeRole)
      .filter(Boolean)
  );
}

// ============================================================================
// Stable identifier
// ============================================================================

function resolveRolloutSeed({
  user,
  tenant,
}) {
  return (
    user?.id ||
    user?._id ||
    tenant?.id ||
    tenant?._id ||
    null
  );
}

// ============================================================================
// Deterministic string hash
// ============================================================================
//
// Produces a stable unsigned 32-bit hash.
//
// This is not cryptographic and must never be used for security decisions.
// It is only used to make percentage rollouts deterministic.
// ============================================================================

function hashString(value) {
  const input =
    String(value ?? '');

  let hash = 2166136261;

  for (
    let index = 0;
    index < input.length;
    index += 1
  ) {
    hash ^= input.charCodeAt(
      index
    );

    hash =
      Math.imul(
        hash,
        16777619
      );
  }

  return hash >>> 0;
}

// ============================================================================
// Percentage normalization
// ============================================================================

function normalizeRolloutPercentage(
  percentage
) {
  if (
    typeof percentage !==
      'number' ||
    Number.isNaN(percentage)
  ) {
    return 100;
  }

  return Math.min(
    100,
    Math.max(
      0,
      percentage
    )
  );
}

// ============================================================================
// Percentage rollout evaluation
// ============================================================================

function isWithinRollout(
  seed,
  percentage
) {
  const normalizedPercentage =
    normalizeRolloutPercentage(
      percentage
    );

  /*
   * Explicit 0 means nobody gets the feature.
   */
  if (
    normalizedPercentage <=
    0
  ) {
    return false;
  }

  /*
   * Explicit 100 means everybody eligible gets the feature.
   */
  if (
    normalizedPercentage >=
    100
  ) {
    return true;
  }

  /*
   * A percentage rollout without an identity is unsafe to evaluate because
   * access would become unstable/non-deterministic.
   *
   * Fail closed.
   */
  if (
    seed === null ||
    seed === undefined ||
    seed === ''
  ) {
    return false;
  }

  const hash =
    hashString(seed);

  const bucket =
    hash % 100;

  return (
    bucket <
    normalizedPercentage
  );
}

// ============================================================================
// Authorization evaluation
// ============================================================================

function evaluateFeatureAccess({
  user,
  tenant,
  authenticated,
  requireAuth,
  requireTenant,
  roles,
  permissions,
  userPermissions,
  hasPermission,
  feature,
  hasFeature,
  rolloutPercentage,
}) {
  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  if (
    requireAuth &&
    (!authenticated || !user)
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
    normalizeRoles(roles);

  if (
    requiredRoles.size >
    0
  ) {
    const currentRole =
      normalizeRole(
        user?.role
      );

    if (
      !requiredRoles.has(
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
    Array.isArray(
      permissions
    )
      ? permissions.filter(
          Boolean
        )
      : [];

  if (
    requiredPermissions.length >
    0
  ) {
    const permissionsAllowed =
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

          return (
            Array.isArray(
              userPermissions
            ) &&
            userPermissions.includes(
              permission
            )
          );
        }
      );

    if (
      !permissionsAllowed
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

  if (feature) {
    /*
     * Fail closed if the feature authorization mechanism is unavailable.
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
      !hasFeature(feature)
    ) {
      return {
        allowed: false,
        reason:
          'feature_disabled',
      };
    }
  }

  // --------------------------------------------------------------------------
  // Percentage rollout
  // --------------------------------------------------------------------------

  const rolloutSeed =
    resolveRolloutSeed({
      user,
      tenant,
    });

  if (
    !isWithinRollout(
      rolloutSeed,
      rolloutPercentage
    )
  ) {
    return {
      allowed: false,
      reason:
        'rollout_excluded',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

// ============================================================================
// Fallback renderer
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
        <FeatureUnavailable
          icon="security"
          title="Tenant Required"
          message={
            'This feature requires an active tenant context.'
          }
        />
      );

    case 'feature_unavailable':
      return (
        <FeatureUnavailable
          icon="security"
          title="Feature Unavailable"
          message={
            'Feature authorization is currently unavailable.'
          }
        />
      );

    case 'feature_disabled':
      return (
        <FeatureUnavailable
          title="Feature Disabled"
          message={
            'This feature is not enabled for your account or tenant.'
          }
        />
      );

    case 'role_denied':
      return (
        <FeatureUnavailable
          icon="security"
          title="Access Restricted"
          message={
            'Your role does not have access to this feature.'
          }
        />
      );

    case 'permission_denied':
      return (
        <FeatureUnavailable
          icon="security"
          title="Insufficient Permissions"
          message={
            'Your account does not have the required permission.'
          }
        />
      );

    case 'rollout_excluded':
      return (
        <FeatureUnavailable
          title="Coming Soon"
          message={
            'This feature is being gradually rolled out.'
          }
        />
      );

    default:
      return (
        <FeatureUnavailable />
      );
  }
}

// ============================================================================
// Feature route
// ============================================================================

function FeatureRoute({
  children,
  feature,
  fallback = null,
  redirectTo =
    DEFAULT_REDIRECT_PATH,
  requireAuth = true,
  requireTenant = false,
  roles = [],
  permissions = [],
  rolloutPercentage = 100,
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
  // Always evaluate this without conditionally invoking hooks.
  // --------------------------------------------------------------------------

  const access =
    loading
      ? {
          allowed: false,
          reason: 'loading',
        }
      : evaluateFeatureAccess({
          user,
          tenant,
          authenticated,
          requireAuth,
          requireTenant,
          roles,
          permissions,
          userPermissions,
          hasPermission,
          feature,
          hasFeature,
          rolloutPercentage,
        });

  // --------------------------------------------------------------------------
  // Route diagnostic
  // --------------------------------------------------------------------------
  //
  // Diagnostic only.
  // It must never be used to grant access.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (
      loading ||
      !access.allowed
    ) {
      return;
    }

    try {
      sessionStorage.setItem(
        LAST_FEATURE_ROUTE_KEY,
        JSON.stringify({
          path:
            location.pathname,
          feature:
            feature || null,
          timestamp:
            Date.now(),
        })
      );
    } catch {
      /*
       * Storage failure must never affect feature access.
       */
    }
  }, [
    loading,
    access.allowed,
    location.pathname,
    feature,
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
  // Authentication redirect
  // --------------------------------------------------------------------------

  if (
    access.reason ===
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
  // Role / permission redirect
  // --------------------------------------------------------------------------

  if (
    access.reason ===
      'role_denied' ||
    access.reason ===
      'permission_denied'
  ) {
    return (
      <Navigate
        to={redirectTo}
        replace
      />
    );
  }

  // --------------------------------------------------------------------------
  // Feature / tenant / rollout fallback
  // --------------------------------------------------------------------------

  if (
    !access.allowed
  ) {
    return renderFallback(
      access.reason,
      fallback
    );
  }

  // --------------------------------------------------------------------------
  // Render protected feature
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
// Feature access hook
// ============================================================================

export function useFeatureAccess(
  feature
) {
  const auth =
    useAuth() || {};

  const {
    hasFeature,
  } = auth;

  return {
    enabled:
      Boolean(
        feature &&
        typeof hasFeature ===
          'function' &&
        hasFeature(feature)
      ),

    checking:
      false,

    feature:
      feature || null,
  };
}

// ============================================================================
// More general access helper
// ============================================================================

export function useFeatureAuthorization(
  {
    feature = null,
    roles = [],
    permissions = [],
  } = {}
) {
  const auth =
    useAuth() || {};

  const {
    user = null,
    tenant = null,
    loading = false,
    isAuthenticated,
    permissions:
      userPermissions = [],
    hasPermission,
    hasFeature,
  } = auth;

  const authenticated =
    typeof isAuthenticated ===
    'boolean'
      ? isAuthenticated
      : Boolean(user);

  const access =
    loading
      ? {
          allowed: false,
          reason: 'loading',
        }
      : evaluateFeatureAccess({
          user,
          tenant,
          authenticated,
          requireAuth: true,
          requireTenant: false,
          roles,
          permissions,
          userPermissions,
          hasPermission,
          feature,
          hasFeature,
          rolloutPercentage: 100,
        });

  return {
    loading,
    allowed:
      access.allowed,
    reason:
      access.reason,
    user,
    tenant,
  };
}

// ============================================================================
// Higher-order component
// ============================================================================

export function withFeatureRoute(
  Component,
  options = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withFeatureRoute requires a valid React component.'
    );
  }

  function WrappedComponent(
    props
  ) {
    return (
      <FeatureRoute
        {...options}
      >
        <Component
          {...props}
        />
      </FeatureRoute>
    );
  }

  WrappedComponent.displayName =
    `withFeatureRoute(${
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
  FeatureRoute
);