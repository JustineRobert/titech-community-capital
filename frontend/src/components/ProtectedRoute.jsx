// ============================================================================
// TITech Community Capital
// Enterprise Protected Route
// File: frontend/src/components/ProtectedRoute.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Enterprise route-level authentication and authorization guard for TITech
// Community Capital.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Authentication-aware route protection
// ✓ React Router v6+ compatible
// ✓ Preserves requested destination during login redirects
// ✓ Authentication loading support
// ✓ Role-based route protection
// ✓ Permission-based route protection
// ✓ Any/all role matching
// ✓ Any/all permission matching
// ✓ Tenant-aware guard hooks
// ✓ Optional custom unauthorized route
// ✓ Optional custom authentication route
// ✓ Optional custom loading component
// ✓ Defensive AuthContext normalization
// ✓ Stable test selectors
// ✓ Accessibility-friendly loading/fallback states
// ✓ Development diagnostics
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// THIS COMPONENT IS NOT A SECURITY BOUNDARY.
//
// Frontend route protection is only a UX and navigation control.
//
// The backend/API MUST independently enforce:
//
// ✓ Authentication
// ✓ Authorization
// ✓ Tenant isolation
// ✓ RBAC / ABAC
// ✓ Financial permissions
// ✓ KYC / AML controls
// ✓ Transaction authorization
// ✓ Privileged operations
// ✓ Data access controls
// ✓ Audit requirements
//
// Never trust permissions, roles, tenant IDs, or authorization decisions
// supplied by the browser.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useMemo,
} from "react";

import {
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";

import PropTypes from "prop-types";

import { useAuth } from "../context/AuthContext";

// ============================================================================
// Constants
// ============================================================================

export const PROTECTED_ROUTE_STATES =
  Object.freeze({
    LOADING: "loading",
    AUTHENTICATED: "authenticated",
    UNAUTHENTICATED: "unauthenticated",
    UNAUTHORIZED: "unauthorized",
    DISABLED: "disabled",
  });

export const DEFAULT_LOGIN_PATH =
  "/login";

export const DEFAULT_UNAUTHORIZED_PATH =
  "/unauthorized";

export const DEFAULT_TEST_ID =
  "titech-protected-route";

const MATCH_MODE = Object.freeze({
  ANY: "any",
  ALL: "all",
});

// ============================================================================
// Normalization Helpers
// ============================================================================

function normalizeString(
  value,
  fallback = "",
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return normalized || fallback;
}

function normalizeStringArray(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  const values = Array.isArray(value)
    ? value
    : [value];

  return [
    ...new Set(
      values
        .map((item) =>
          normalizeString(item),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeMatchMode(
  value,
) {
  const normalized =
    normalizeString(
      value,
      MATCH_MODE.ANY,
    ).toLowerCase();

  return Object.values(
    MATCH_MODE,
  ).includes(normalized)
    ? normalized
    : MATCH_MODE.ANY;
}

// ============================================================================
// AuthContext Normalization
// ============================================================================
//
// AuthContext implementations evolve over time. These helpers intentionally
// support common enterprise shapes without requiring ProtectedRoute to know
// the exact internal implementation of the authentication provider.
//
// Supported examples:
//
// {
//   user,
//   isAuthenticated,
//   loading,
//   roles,
//   permissions,
//   tenantId
// }
//
// or:
//
// {
//   user,
//   authenticated,
//   isLoading
// }
//
// or:
//
// {
//   user: {
//     roles,
//     permissions
//   }
// }
//
// ============================================================================

function resolveAuthenticated(
  auth,
) {
  if (!auth) {
    return false;
  }

  if (
    typeof auth.isAuthenticated ===
    "boolean"
  ) {
    return auth.isAuthenticated;
  }

  if (
    typeof auth.authenticated ===
    "boolean"
  ) {
    return auth.authenticated;
  }

  if (
    typeof auth.isLoggedIn ===
    "boolean"
  ) {
    return auth.isLoggedIn;
  }

  return Boolean(auth.user);
}

function resolveLoading(
  auth,
) {
  if (!auth) {
    return false;
  }

  if (
    typeof auth.loading ===
    "boolean"
  ) {
    return auth.loading;
  }

  if (
    typeof auth.isLoading ===
    "boolean"
  ) {
    return auth.isLoading;
  }

  if (
    typeof auth.authLoading ===
    "boolean"
  ) {
    return auth.authLoading;
  }

  return false;
}

// ============================================================================
// User Permission Extraction
// ============================================================================

function extractPermissions(
  user,
  auth,
) {
  const values = [];

  const candidates = [
    auth?.permissions,
    auth?.permissionCodes,
    auth?.permissionKeys,

    user?.permissions,
    user?.permission,
    user?.permissionCodes,
    user?.permissionKeys,
    user?.authorities,
    user?.scopes,
  ];

  candidates.forEach(
    (candidate) => {
      if (!candidate) {
        return;
      }

      if (Array.isArray(candidate)) {
        candidate.forEach(
          (item) => {
            if (
              typeof item ===
              "string"
            ) {
              values.push(item);
              return;
            }

            if (
              item &&
              typeof item ===
                "object"
            ) {
              values.push(
                item.name,
                item.code,
                item.key,
                item.permission,
                item.scope,
              );
            }
          },
        );

        return;
      }

      if (
        typeof candidate ===
        "string"
      ) {
        values.push(candidate);
        return;
      }

      if (
        typeof candidate ===
        "object"
      ) {
        Object.entries(
          candidate,
        ).forEach(
          ([key, enabled]) => {
            if (
              enabled === true
            ) {
              values.push(key);
            }
          },
        );
      }
    },
  );

  return normalizeStringArray(
    values,
  );
}

// ============================================================================
// User Role Extraction
// ============================================================================

function extractRoles(
  user,
  auth,
) {
  const values = [];

  const candidates = [
    auth?.roles,
    auth?.role,
    auth?.roleNames,

    user?.roles,
    user?.role,
    user?.roleNames,
    user?.authorities,
  ];

  candidates.forEach(
    (candidate) => {
      if (!candidate) {
        return;
      }

      if (Array.isArray(candidate)) {
        candidate.forEach(
          (item) => {
            if (
              typeof item ===
              "string"
            ) {
              values.push(item);
              return;
            }

            if (
              item &&
              typeof item ===
                "object"
            ) {
              values.push(
                item.name,
                item.code,
                item.key,
                item.role,
              );
            }
          },
        );

        return;
      }

      if (
        typeof candidate ===
        "string"
      ) {
        values.push(candidate);
        return;
      }

      if (
        typeof candidate ===
        "object"
      ) {
        values.push(
          candidate.name,
          candidate.code,
          candidate.key,
          candidate.role,
        );
      }
    },
  );

  return normalizeStringArray(
    values,
  );
}

// ============================================================================
// Tenant Resolution
// ============================================================================

function resolveTenantId(
  auth,
  user,
) {
  return normalizeString(
    auth?.tenantId ??
      auth?.tenant?.id ??
      user?.tenantId ??
      user?.tenant?.id ??
      null,
    "",
  );
}

// ============================================================================
// Case-Insensitive Matching
// ============================================================================

function matchesValue(
  availableValues,
  requiredValue,
) {
  const normalizedRequired =
    normalizeString(
      requiredValue,
    ).toLowerCase();

  if (!normalizedRequired) {
    return false;
  }

  return availableValues.some(
    (availableValue) =>
      normalizeString(
        availableValue,
      ).toLowerCase() ===
      normalizedRequired,
  );
}

function matchesRequirements(
  availableValues,
  requiredValues,
  mode,
) {
  const required =
    normalizeStringArray(
      requiredValues,
    );

  if (required.length === 0) {
    return true;
  }

  if (mode === MATCH_MODE.ALL) {
    return required.every(
      (requiredValue) =>
        matchesValue(
          availableValues,
          requiredValue,
        ),
    );
  }

  return required.some(
    (requiredValue) =>
      matchesValue(
        availableValues,
        requiredValue,
      ),
  );
}

// ============================================================================
// Tenant Requirement Matching
// ============================================================================

function matchesTenantRequirement({
  tenantId,
  requiredTenantId,
  allowedTenantIds,
}) {
  const normalizedTenant =
    normalizeString(
      tenantId,
    ).toLowerCase();

  const normalizedRequired =
    normalizeString(
      requiredTenantId,
    ).toLowerCase();

  const allowedTenants =
    normalizeStringArray(
      allowedTenantIds,
    ).map((value) =>
      value.toLowerCase(),
    );

  if (
    !normalizedRequired &&
    allowedTenants.length === 0
  ) {
    return true;
  }

  if (!normalizedTenant) {
    return false;
  }

  if (
    normalizedRequired &&
    normalizedTenant ===
      normalizedRequired
  ) {
    return true;
  }

  if (
    allowedTenants.length > 0 &&
    allowedTenants.includes(
      normalizedTenant,
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Authorization Evaluation
// ============================================================================

export function evaluateProtectedRoute({
  auth,
  user,
  requiredPermissions = [],
  requiredRoles = [],
  permissionMode = MATCH_MODE.ANY,
  roleMode = MATCH_MODE.ANY,
  requireAuthentication = true,
  requiredTenantId = "",
  allowedTenantIds = [],
}) {
  const authenticated =
    resolveAuthenticated(auth);

  const loading =
    resolveLoading(auth);

  const permissions =
    extractPermissions(
      user,
      auth,
    );

  const roles =
    extractRoles(
      user,
      auth,
    );

  const tenantId =
    resolveTenantId(
      auth,
      user,
    );

  if (loading) {
    return {
      allowed: false,
      authenticated,
      loading: true,
      authorized: false,
      reason:
        PROTECTED_ROUTE_STATES.LOADING,
      permissions,
      roles,
      tenantId,
    };
  }

  if (
    requireAuthentication &&
    !authenticated
  ) {
    return {
      allowed: false,
      authenticated: false,
      loading: false,
      authorized: false,
      reason:
        PROTECTED_ROUTE_STATES.UNAUTHENTICATED,
      permissions,
      roles,
      tenantId,
    };
  }

  const permissionMatched =
    matchesRequirements(
      permissions,
      requiredPermissions,
      permissionMode,
    );

  const roleMatched =
    matchesRequirements(
      roles,
      requiredRoles,
      roleMode,
    );

  const tenantMatched =
    matchesTenantRequirement({
      tenantId,
      requiredTenantId,
      allowedTenantIds,
    });

  const hasPermissionRequirements =
    normalizeStringArray(
      requiredPermissions,
    ).length > 0;

  const hasRoleRequirements =
    normalizeStringArray(
      requiredRoles,
    ).length > 0;

  const hasTenantRequirements =
    Boolean(
      normalizeString(
        requiredTenantId,
      ),
    ) ||
    normalizeStringArray(
      allowedTenantIds,
    ).length > 0;

  let authorized = true;

  if (
    hasPermissionRequirements
  ) {
    authorized =
      authorized &&
      permissionMatched;
  }

  if (hasRoleRequirements) {
    authorized =
      authorized &&
      roleMatched;
  }

  if (hasTenantRequirements) {
    authorized =
      authorized &&
      tenantMatched;
  }

  return {
    allowed: authorized,
    authenticated,
    loading: false,
    authorized,
    permissionMatched,
    roleMatched,
    tenantMatched,
    permissions,
    roles,
    tenantId,
    reason: authorized
      ? PROTECTED_ROUTE_STATES.AUTHENTICATED
      : PROTECTED_ROUTE_STATES.UNAUTHORIZED,
  };
}

// ============================================================================
// Default Loading UI
// ============================================================================

function DefaultLoadingFallback({
  testId,
  label,
}) {
  return (
    <div
      data-testid={`${testId}-loading`}
      data-component="titech-protected-route"
      data-state={
        PROTECTED_ROUTE_STATES.LOADING
      }
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: "160px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <span>
        {label ||
          "Verifying your session…"}
      </span>
    </div>
  );
}

// ============================================================================
// Protected Route
// ============================================================================

function ProtectedRoute({
  children,

  permissions = [],
  requiredPermissions,

  roles = [],
  requiredRoles,

  permissionMode = MATCH_MODE.ANY,
  roleMode = MATCH_MODE.ANY,

  requireAuthentication = true,

  requiredTenantId = "",
  allowedTenantIds = [],

  loginPath = DEFAULT_LOGIN_PATH,
  unauthorizedPath =
    DEFAULT_UNAUTHORIZED_PATH,

  replaceOnRedirect = true,

  loadingFallback = null,

  unauthorizedFallback = null,

  unauthenticatedFallback = null,

  disabled = false,

  disabledFallback = null,

  preserveLocation = true,

  debug = false,

  testId = DEFAULT_TEST_ID,

  className = "",

  ariaLabel = "",
}) {
  const auth = useAuth();

  const location =
    useLocation();

  // ==========================================================================

  // Resolve Auth State
  // ==========================================================================

  const user =
    auth?.user ?? null;

  const resolvedLoading =
    resolveLoading(auth);

  const resolvedAuthenticated =
    resolveAuthenticated(auth);

  // ==========================================================================

  // Resolve Requirements
  // ==========================================================================

  const resolvedRequiredPermissions =
    useMemo(
      () =>
        normalizeStringArray(
          requiredPermissions ??
            permissions,
        ),
      [
        requiredPermissions,
        permissions,
      ],
    );

  const resolvedRequiredRoles =
    useMemo(
      () =>
        normalizeStringArray(
          requiredRoles ?? roles,
        ),
      [
        requiredRoles,
        roles,
      ],
    );

  const resolvedPermissionMode =
    normalizeMatchMode(
      permissionMode,
    );

  const resolvedRoleMode =
    normalizeMatchMode(
      roleMode,
    );

  // ==========================================================================

  // Evaluate Route Access
  // ==========================================================================

  const evaluation = useMemo(
    () =>
      evaluateProtectedRoute({
        auth: {
          ...auth,
          user,
          loading:
            resolvedLoading,
          isAuthenticated:
            resolvedAuthenticated,
        },
        user,
        requiredPermissions:
          resolvedRequiredPermissions,
        requiredRoles:
          resolvedRequiredRoles,
        permissionMode:
          resolvedPermissionMode,
        roleMode:
          resolvedRoleMode,
        requireAuthentication,
        requiredTenantId,
        allowedTenantIds,
      }),
    [
      auth,
      user,
      resolvedLoading,
      resolvedAuthenticated,
      resolvedRequiredPermissions,
      resolvedRequiredRoles,
      resolvedPermissionMode,
      resolvedRoleMode,
      requireAuthentication,
      requiredTenantId,
      allowedTenantIds,
    ],
  );

  // ==========================================================================

  // Development Diagnostics
  // ==========================================================================

  if (
    debug &&
    import.meta?.env?.DEV &&
    typeof console !==
      "undefined" &&
    typeof console.debug ===
      "function"
  ) {
    console.debug(
      "[TITech ProtectedRoute]",
      {
        state:
          evaluation.reason,
        authenticated:
          evaluation.authenticated,
        authorized:
          evaluation.authorized,
        permissionMatched:
          evaluation.permissionMatched,
        roleMatched:
          evaluation.roleMatched,
        tenantMatched:
          evaluation.tenantMatched,
        requiredPermissions:
          resolvedRequiredPermissions,
        requiredRoles:
          resolvedRequiredRoles,
        tenantId:
          evaluation.tenantId,
        requiredTenantId,
        path:
          location.pathname,
      },
    );
  }

  // ==========================================================================

  // Disabled
  // ==========================================================================

  if (disabled) {
    if (disabledFallback) {
      return (
        <div
          className={className}
          data-testid={testId}
          data-component="titech-protected-route"
          data-state={
            PROTECTED_ROUTE_STATES.DISABLED
          }
          aria-disabled="true"
          aria-label={
            ariaLabel ||
            "Route unavailable"
          }
        >
          {disabledFallback}
        </div>
      );
    }

    return null;
  }

  // ==========================================================================

  // Loading
  // ==========================================================================

  if (
    resolvedLoading ||
    evaluation.loading
  ) {
    if (loadingFallback) {
      return (
        <div
          className={className}
          data-testid={testId}
          data-component="titech-protected-route"
          data-state={
            PROTECTED_ROUTE_STATES.LOADING
          }
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={
            ariaLabel ||
            "Verifying authentication"
          }
        >
          {loadingFallback}
        </div>
      );
    }

    return (
      <DefaultLoadingFallback
        testId={testId}
        label="Verifying your session…"
      />
    );
  }

  // ==========================================================================

  // Authentication Failure
  // ==========================================================================

  if (
    requireAuthentication &&
    !evaluation.authenticated
  ) {
    if (
      unauthenticatedFallback
    ) {
      return (
        <div
          className={className}
          data-testid={testId}
          data-component="titech-protected-route"
          data-state={
            PROTECTED_ROUTE_STATES.UNAUTHENTICATED
          }
          aria-label={
            ariaLabel ||
            "Authentication required"
          }
        >
          {unauthenticatedFallback}
        </div>
      );
    }

    const redirectState =
      preserveLocation
        ? {
            from: {
              pathname:
                location.pathname,
              search:
                location.search,
              hash:
                location.hash,
            },
          }
        : undefined;

    return (
      <Navigate
        to={loginPath}
        replace={
          replaceOnRedirect
        }
        state={redirectState}
      />
    );
  }

  // ==========================================================================

  // Authorization Failure
  // ==========================================================================

  if (!evaluation.authorized) {
    if (
      unauthorizedFallback
    ) {
      return (
        <div
          className={className}
          data-testid={testId}
          data-component="titech-protected-route"
          data-state={
            PROTECTED_ROUTE_STATES.UNAUTHORIZED
          }
          data-reason={
            evaluation.reason
          }
          aria-label={
            ariaLabel ||
            "Access restricted"
          }
        >
          {unauthorizedFallback}
        </div>
      );
    }

    return (
      <Navigate
        to={unauthorizedPath}
        replace={
          replaceOnRedirect
        }
        state={{
          from: {
            pathname:
              location.pathname,
            search:
              location.search,
            hash:
              location.hash,
          },
          reason:
            evaluation.reason,
        }}
      />
    );
  }

  // ==========================================================================

  // Authorized Content
  // ==========================================================================

  return (
    <div
      className={className}
      data-testid={testId}
      data-component="titech-protected-route"
      data-state={
        PROTECTED_ROUTE_STATES.AUTHENTICATED
      }
      data-authorized="true"
      aria-label={
        ariaLabel || undefined
      }
    >
      {children ?? <Outlet />}
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

ProtectedRoute.propTypes = {
  children:
    PropTypes.node,

  permissions:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  requiredPermissions:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  roles:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  requiredRoles:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  permissionMode:
    PropTypes.oneOf(
      Object.values(
        MATCH_MODE,
      ),
    ),

  roleMode:
    PropTypes.oneOf(
      Object.values(
        MATCH_MODE,
      ),
    ),

  requireAuthentication:
    PropTypes.bool,

  requiredTenantId:
    PropTypes.string,

  allowedTenantIds:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  loginPath:
    PropTypes.string,

  unauthorizedPath:
    PropTypes.string,

  replaceOnRedirect:
    PropTypes.bool,

  loadingFallback:
    PropTypes.node,

  unauthorizedFallback:
    PropTypes.node,

  unauthenticatedFallback:
    PropTypes.node,

  disabled:
    PropTypes.bool,

  disabledFallback:
    PropTypes.node,

  preserveLocation:
    PropTypes.bool,

  debug:
    PropTypes.bool,

  testId:
    PropTypes.string,

  className:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,
};

// ============================================================================
// Default Props
// ============================================================================

ProtectedRoute.defaultProps = {
  children: null,

  permissions: [],

  requiredPermissions:
    undefined,

  roles: [],

  requiredRoles:
    undefined,

  permissionMode:
    MATCH_MODE.ANY,

  roleMode:
    MATCH_MODE.ANY,

  requireAuthentication:
    true,

  requiredTenantId: "",

  allowedTenantIds: [],

  loginPath:
    DEFAULT_LOGIN_PATH,

  unauthorizedPath:
    DEFAULT_UNAUTHORIZED_PATH,

  replaceOnRedirect:
    true,

  loadingFallback: null,

  unauthorizedFallback:
    null,

  unauthenticatedFallback:
    null,

  disabled: false,

  disabledFallback: null,

  preserveLocation: true,

  debug: false,

  testId:
    DEFAULT_TEST_ID,

  className: "",

  ariaLabel: "",
};

// ============================================================================
// Static Metadata
// ============================================================================

ProtectedRoute.MATCH_MODE =
  MATCH_MODE;

ProtectedRoute.STATES =
  PROTECTED_ROUTE_STATES;

ProtectedRoute.DEFAULT_LOGIN_PATH =
  DEFAULT_LOGIN_PATH;

ProtectedRoute.DEFAULT_UNAUTHORIZED_PATH =
  DEFAULT_UNAUTHORIZED_PATH;

// ============================================================================
// Static Utilities
// ============================================================================

ProtectedRoute.normalizeString =
  normalizeString;

ProtectedRoute.normalizeStringArray =
  normalizeStringArray;

ProtectedRoute.extractPermissions =
  extractPermissions;

ProtectedRoute.extractRoles =
  extractRoles;

ProtectedRoute.evaluate =
  evaluateProtectedRoute;

// ============================================================================
// Display Name
// ============================================================================

ProtectedRoute.displayName =
  "TITechProtectedRoute";

// ============================================================================
// Export
// ============================================================================

export default memo(
  ProtectedRoute,
);