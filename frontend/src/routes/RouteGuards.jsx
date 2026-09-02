'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/RouteGuards.jsx
 *
 * Purpose:
 *   Canonical frontend route authorization engine.
 *
 * Responsibilities:
 *   - Authenticate route access
 *   - Evaluate roles
 *   - Evaluate permissions
 *   - Evaluate feature flags
 *   - Evaluate tenant requirements
 *   - Evaluate subscription-plan requirements
 *   - Evaluate branch requirements
 *   - Compose multiple authorization policies
 *   - Provide reusable authorization hooks
 *   - Provide reusable guard HOCs
 *
 * Non-responsibilities:
 *   - Token acquisition/refresh
 *   - API calls
 *   - Database access
 *   - Backend authorization
 *   - Financial business rules
 *   - Ledger/wallet authorization
 *
 * IMPORTANT SECURITY PRINCIPLE:
 *
 *   This module is a frontend policy engine.
 *
 *   It is NOT the authoritative security boundary.
 *
 *   Every privileged TITech backend operation must independently enforce
 *   authentication, tenant isolation, roles, permissions and business rules.
 *
 * ============================================================================
 */

import {
  useCallback,
  useMemo,
} from 'react';

import {
  useAuth,
} from '../context/AuthContext';

// ============================================================================
// Guard result constants
// ============================================================================

export const GuardResult = Object.freeze({
  ALLOWED:
    'allowed',

  UNAUTHENTICATED:
    'unauthenticated',

  UNAUTHORIZED:
    'unauthorized',

  ROLE_DENIED:
    'role_denied',

  PERMISSION_DENIED:
    'permission_denied',

  FEATURE_DISABLED:
    'feature_disabled',

  FEATURE_UNAVAILABLE:
    'feature_unavailable',

  TENANT_REQUIRED:
    'tenant_required',

  TENANT_INACTIVE:
    'tenant_inactive',

  SUBSCRIPTION_REQUIRED:
    'subscription_required',

  SUBSCRIPTION_UNAVAILABLE:
    'subscription_unavailable',

  BRANCH_REQUIRED:
    'branch_required',

  BRANCH_DENIED:
    'branch_denied',

  SESSION_EXPIRED:
    'session_expired',
});

// ============================================================================
// Permission modes
// ============================================================================

export const PermissionMode = Object.freeze({
  ALL: 'all',
  ANY: 'any',
  NONE: 'none',
});

// ============================================================================
// Plan hierarchy
// ============================================================================
//
// Keep aligned with routeConfig.js:
//
//   free         = 0
//   starter      = 1
//   professional = 2
//   enterprise   = 3
//
// ============================================================================

const PLAN_LEVELS = Object.freeze({
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
});

// ============================================================================
// Normalization utilities
// ============================================================================

export function normalizeString(
  value
) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized || null;
}

export function normalizeRole(
  role
) {
  const normalized =
    normalizeString(role);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

export function normalizePermission(
  permission
) {
  return normalizeString(
    permission
  );
}

export function normalizePlan(
  plan
) {
  const normalized =
    normalizeString(plan);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

export function normalizeIdentifier(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}

export function normalizeArray(
  value
) {
  if (
    Array.isArray(value)
  ) {
    return value.filter(
      (
        item
      ) =>
        item !== null &&
        item !== undefined
    );
  }

  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  return [value];
}

function uniqueNormalized(
  values,
  normalizer
) {
  return [
    ...new Set(
      normalizeArray(
        values
      )
        .map(normalizer)
        .filter(Boolean)
    ),
  ];
}

// ============================================================================
// Authentication guard
// ============================================================================

export function canAccessAuthenticated(
  auth
) {
  if (
    !auth?.isAuthenticated ||
    !auth?.user
  ) {
    return {
      allowed: false,
      reason:
        GuardResult.UNAUTHENTICATED,
    };
  }

  /*
   * If AuthContext exposes a known session-expired state, preserve that
   * reason instead of reporting generic unauthenticated access.
   */
  if (
    auth?.sessionExpired ===
    true
  ) {
    return {
      allowed: false,
      reason:
        GuardResult.SESSION_EXPIRED,
    };
  }

  return {
    allowed: true,
    reason:
      GuardResult.ALLOWED,
  };
}

// ============================================================================
// Role guard
// ============================================================================

export function canAccessRoles(
  auth,
  roles = []
) {
  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  const requiredRoles =
    uniqueNormalized(
      roles,
      normalizeRole
    );

  if (
    requiredRoles.length ===
    0
  ) {
    return {
      allowed: true,
      reason:
        GuardResult.ALLOWED,
    };
  }

  const currentRole =
    normalizeRole(
      auth?.user?.role
    );

  const allowed =
    requiredRoles.includes(
      currentRole
    );

  return {
    allowed,
    reason: allowed
      ? GuardResult.ALLOWED
      : GuardResult.ROLE_DENIED,
  };
}

// ============================================================================
// Permission evaluation
// ============================================================================

function checkPermission(
  auth,
  permission
) {
  const normalized =
    normalizePermission(
      permission
    );

  if (!normalized) {
    return false;
  }

  if (
    typeof auth?.hasPermission ===
    'function'
  ) {
    return Boolean(
      auth.hasPermission(
        normalized
      )
    );
  }

  const userPermissions =
    uniqueNormalized(
      auth?.permissions,
      normalizePermission
    );

  return userPermissions.includes(
    normalized
  );
}

// ============================================================================
// Permission guard
// ============================================================================

export function canAccessPermissions(
  auth,
  permissions = [],
  mode = PermissionMode.ALL
) {
  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  const required =
    uniqueNormalized(
      permissions,
      normalizePermission
    );

  if (
    required.length ===
    0
  ) {
    return {
      allowed: true,
      reason:
        GuardResult.ALLOWED,
    };
  }

  const normalizedMode =
    Object.values(
      PermissionMode
    ).includes(mode)
      ? mode
      : PermissionMode.ALL;

  let allowed;

  switch (
    normalizedMode
  ) {
    case PermissionMode.ANY:
      allowed =
        required.some(
          (permission) =>
            checkPermission(
              auth,
              permission
            )
        );
      break;

    case PermissionMode.NONE:
      allowed =
        required.every(
          (permission) =>
            !checkPermission(
              auth,
              permission
            )
        );
      break;

    case PermissionMode.ALL:
    default:
      allowed =
        required.every(
          (permission) =>
            checkPermission(
              auth,
              permission
            )
        );
      break;
  }

  return {
    allowed,
    reason: allowed
      ? GuardResult.ALLOWED
      : GuardResult.PERMISSION_DENIED,
  };
}

// ============================================================================
// Tenant guard
// ============================================================================

export function canAccessTenant(
  auth,
  options = {}
) {
  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  const {
    requireActive = true,
  } = options;

  const tenant =
    auth?.tenant;

  if (!tenant) {
    return {
      allowed: false,
      reason:
        GuardResult.TENANT_REQUIRED,
    };
  }

  if (
    requireActive &&
    tenant.status
  ) {
    const status =
      normalizeString(
        tenant.status
      )?.toLowerCase();

    if (
      status &&
      status !== 'active'
    ) {
      return {
        allowed: false,
        reason:
          GuardResult.TENANT_INACTIVE,
      };
    }
  }

  return {
    allowed: true,
    reason:
      GuardResult.ALLOWED,
  };
}

// ============================================================================
// Feature guard
// ============================================================================

export function canAccessFeature(
  auth,
  feature
) {
  if (!feature) {
    return {
      allowed: true,
      reason:
        GuardResult.ALLOWED,
    };
  }

  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  /*
   * Fail closed when feature authorization is unavailable.
   */
  if (
    typeof auth?.hasFeature !==
    'function'
  ) {
    return {
      allowed: false,
      reason:
        GuardResult.FEATURE_UNAVAILABLE,
    };
  }

  const enabled =
    Boolean(
      auth.hasFeature(
        feature
      )
    );

  return {
    allowed: enabled,
    reason: enabled
      ? GuardResult.ALLOWED
      : GuardResult.FEATURE_DISABLED,
  };
}

// ============================================================================
// Subscription guard
// ============================================================================

export function canAccessSubscription(
  auth,
  requiredPlans = []
) {
  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  const required =
    uniqueNormalized(
      requiredPlans,
      normalizePlan
    );

  if (
    required.length ===
    0
  ) {
    return {
      allowed: true,
      reason:
        GuardResult.ALLOWED,
    };
  }

  const currentPlan =
    normalizePlan(
      auth?.tenant?.plan ||
        auth?.subscription?.plan ||
        auth?.subscription
    );

  if (!currentPlan) {
    return {
      allowed: false,
      reason:
        GuardResult.SUBSCRIPTION_UNAVAILABLE,
    };
  }

  const currentLevel =
    PLAN_LEVELS[
      currentPlan
    ];

  if (
    typeof currentLevel !==
    'number'
  ) {
    return {
      allowed: false,
      reason:
        GuardResult.SUBSCRIPTION_UNAVAILABLE,
    };
  }

  const requiredLevels =
    required
      .map(
        (plan) =>
          PLAN_LEVELS[
            plan
          ]
      )
      .filter(
        (level) =>
          typeof level ===
          'number'
      );

  if (
    requiredLevels.length ===
    0
  ) {
    return {
      allowed: false,
      reason:
        GuardResult.SUBSCRIPTION_UNAVAILABLE,
    };
  }

  /*
   * Treat routeConfig.plan as a minimum supported tier.
   *
   * Example:
   *   [professional, enterprise]
   *
   * means professional and above.
   */
  const minimumRequiredLevel =
    Math.min(
      ...requiredLevels
    );

  const allowed =
    currentLevel >=
    minimumRequiredLevel;

  return {
    allowed,

    reason: allowed
      ? GuardResult.ALLOWED
      : GuardResult.SUBSCRIPTION_REQUIRED,
  };
}

// ============================================================================
// Branch guard
// ============================================================================

function resolveBranchId(
  branch
) {
  return normalizeIdentifier(
    branch?.id ??
      branch?._id
  );
}

export function canAccessBranch(
  auth,
  branchId
) {
  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  const requestedBranchId =
    normalizeIdentifier(
      branchId
    );

  if (!requestedBranchId) {
    return {
      allowed: true,
      reason:
        GuardResult.ALLOWED,
    };
  }

  const branches =
    normalizeArray(
      auth?.user?.branches
    );

  const allowed =
    branches.some(
      (branch) =>
        resolveBranchId(
          branch
        ) ===
        requestedBranchId
    );

  return {
    allowed,
    reason: allowed
      ? GuardResult.ALLOWED
      : GuardResult.BRANCH_DENIED,
  };
}

// ============================================================================
// Composite route evaluator
// ============================================================================
//
// The evaluator intentionally evaluates authentication first so every
// downstream check has a valid security context.
//
// Failure order:
//
//   authentication
//   tenant
//   roles
//   permissions
//   feature
//   subscription
//   branch
//
// ============================================================================

export function evaluateRouteAccess(
  auth,
  options = {}
) {
  const {
    roles = [],
    permissions = [],
    permissionMode =
      PermissionMode.ALL,
    feature = null,
    tenant = false,
    tenantOptions = {},
    subscription = [],
    branchId = null,
  } = options;

  const authenticated =
    canAccessAuthenticated(
      auth
    );

  if (
    !authenticated.allowed
  ) {
    return authenticated;
  }

  // --------------------------------------------------------------------------
  // Tenant
  // --------------------------------------------------------------------------

  if (tenant) {
    const tenantResult =
      canAccessTenant(
        auth,
        tenantOptions
      );

    if (
      !tenantResult.allowed
    ) {
      return tenantResult;
    }
  }

  // --------------------------------------------------------------------------
  // Roles
  // --------------------------------------------------------------------------

  const roleResult =
    canAccessRoles(
      auth,
      roles
    );

  if (
    !roleResult.allowed
  ) {
    return roleResult;
  }

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

  const permissionResult =
    canAccessPermissions(
      auth,
      permissions,
      permissionMode
    );

  if (
    !permissionResult.allowed
  ) {
    return permissionResult;
  }

  // --------------------------------------------------------------------------
  // Feature
  // --------------------------------------------------------------------------

  const featureResult =
    canAccessFeature(
      auth,
      feature
    );

  if (
    !featureResult.allowed
  ) {
    return featureResult;
  }

  // --------------------------------------------------------------------------
  // Subscription
  // --------------------------------------------------------------------------

  const subscriptionResult =
    canAccessSubscription(
      auth,
      subscription
    );

  if (
    !subscriptionResult.allowed
  ) {
    return subscriptionResult;
  }

  // --------------------------------------------------------------------------
  // Branch
  // --------------------------------------------------------------------------

  const branchResult =
    canAccessBranch(
      auth,
      branchId
    );

  if (
    !branchResult.allowed
  ) {
    return branchResult;
  }

  return {
    allowed: true,
    reason:
      GuardResult.ALLOWED,
  };
}

// ============================================================================
// Hook
// ============================================================================

export function useRouteGuards() {
  const auth =
    useAuth() || {};

  const canAccessAuthenticated =
    useCallback(
      () =>
        canAccessAuthenticated(
          auth
        ),
      [auth]
    );

  const canAccessRoles =
    useCallback(
      (roles) =>
        canAccessRoles(
          auth,
          roles
        ),
      [auth]
    );

  const canAccessPermissions =
    useCallback(
      (
        permissions,
        mode
      ) =>
        canAccessPermissions(
          auth,
          permissions,
          mode
        ),
      [auth]
    );

  const canAccessFeature =
    useCallback(
      (feature) =>
        canAccessFeature(
          auth,
          feature
        ),
      [auth]
    );

  const canAccessTenant =
    useCallback(
      (options) =>
        canAccessTenant(
          auth,
          options
        ),
      [auth]
    );

  const canAccessSubscription =
    useCallback(
      (plans) =>
        canAccessSubscription(
          auth,
          plans
        ),
      [auth]
    );

  const canAccessBranch =
    useCallback(
      (branchId) =>
        canAccessBranch(
          auth,
          branchId
        ),
      [auth]
    );

  const evaluate =
    useCallback(
      (options) =>
        evaluateRouteAccess(
          auth,
          options
        ),
      [auth]
    );

  return useMemo(
    () => ({
      auth,

      canAccessAuthenticated,

      canAccessRoles,

      canAccessPermissions,

      canAccessFeature,

      canAccessTenant,

      canAccessSubscription,

      canAccessBranch,

      evaluate,
    }),
    [
      auth,

      canAccessAuthenticated,

      canAccessRoles,

      canAccessPermissions,

      canAccessFeature,

      canAccessTenant,

      canAccessSubscription,

      canAccessBranch,

      evaluate,
    ]
  );
}

// ============================================================================
// Simple capability helpers
// ============================================================================

export function useAuthorizationCapabilities() {
  const auth =
    useAuth() || {};

  const can =
    useCallback(
      (permission) =>
        checkPermission(
          auth,
          permission
        ),
      [auth]
    );

  const canAny =
    useCallback(
      (permissions = []) =>
        uniqueNormalized(
          permissions,
          normalizePermission
        ).some(
          (permission) =>
            checkPermission(
              auth,
              permission
            )
        ),
      [auth]
    );

  const canAll =
    useCallback(
      (permissions = []) =>
        uniqueNormalized(
          permissions,
          normalizePermission
        ).every(
          (permission) =>
            checkPermission(
              auth,
              permission
            )
        ),
      [auth]
    );

  const cannot =
    useCallback(
      (permission) =>
        !checkPermission(
          auth,
          permission
        ),
      [auth]
    );

  const hasRole =
    useCallback(
      (role) =>
        normalizeRole(
          auth?.user?.role
        ) ===
        normalizeRole(role),
      [auth?.user?.role]
    );

  const featureEnabled =
    useCallback(
      (feature) =>
        canAccessFeature(
          auth,
          feature
        ).allowed,
      [auth]
    );

  return {
    can,
    canAny,
    canAll,
    cannot,
    hasRole,
    featureEnabled,
  };
}

// ============================================================================
// Higher-order component
// ============================================================================
//
// This HOC intentionally renders a fallback component when denied instead of
// returning null. Silent null rendering makes authorization failures hard to
// diagnose and harms accessibility.
//
// ============================================================================

export function withRouteGuard(
  Component,
  evaluator,
  {
    Fallback = null,
    fallbackProps = {},
  } = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withRouteGuard requires a valid React component.'
    );
  }

  if (
    typeof evaluator !==
    'function'
  ) {
    throw new TypeError(
      'withRouteGuard requires a valid evaluator function.'
    );
  }

  function Guarded(
    props
  ) {
    const auth =
      useAuth() || {};

    const result =
      evaluator(
        auth,
        props
      );

    if (
      !result?.allowed
    ) {
      if (
        Fallback
      ) {
        return (
          <Fallback
            result={result}
            {...fallbackProps}
          />
        );
      }

      return null;
    }

    return (
      <Component
        {...props}
      />
    );
  }

  Guarded.displayName =
    `withRouteGuard(${
      Component.displayName ||
      Component.name ||
      'Component'
    })`;

  return Guarded;
}

// ============================================================================
// Default export
// ============================================================================

export default Object.freeze({
  GuardResult,
  PermissionMode,

  normalizeString,
  normalizeRole,
  normalizePermission,
  normalizePlan,
  normalizeIdentifier,
  normalizeArray,

  canAccessAuthenticated,
  canAccessRoles,
  canAccessPermissions,
  canAccessTenant,
  canAccessFeature,
  canAccessSubscription,
  canAccessBranch,

  evaluateRouteAccess,

  useRouteGuards,
  useAuthorizationCapabilities,

  withRouteGuard,
});