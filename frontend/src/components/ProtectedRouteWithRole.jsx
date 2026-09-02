// ============================================================================
// TITech Community Capital
// Enterprise Protected Route With Role
// File: frontend/src/components/ProtectedRouteWithRole.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Role-aware route wrapper for TITech Community Capital.
//
// This component builds on the canonical ProtectedRoute implementation and
// provides a concise API for routes that require one or more application roles.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Authentication-aware route protection
// ✓ Role-based route authorization
// ✓ Any/all role matching
// ✓ Permission + role composition
// ✓ Tenant-aware protection
// ✓ Login redirect preservation
// ✓ Unauthorized redirect support
// ✓ Loading-state support
// ✓ Custom fallback support
// ✓ React Router v6+ compatibility
// ✓ Stable test selectors
// ✓ Accessibility-friendly output
// ✓ Defensive normalization
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// THIS COMPONENT IS NOT A SECURITY BOUNDARY.
//
// Frontend route guards are UX/navigation controls only.
//
// The backend/API MUST independently enforce:
//
// ✓ Authentication
// ✓ Authorization
// ✓ RBAC / ABAC
// ✓ Tenant isolation
// ✓ Financial authorization
// ✓ KYC / AML controls
// ✓ Transaction authorization
// ✓ Privileged operations
// ✓ Audit requirements
// ✓ Data access controls
//
// Never trust browser-controlled roles or permissions.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import ProtectedRoute from "./ProtectedRoute";

// ============================================================================
// Constants
// ============================================================================

export const ROLE_MATCH_MODE =
  Object.freeze({
    ANY: "any",
    ALL: "all",
  });

export const DEFAULT_TEST_ID =
  "titech-protected-route-role";

export const DEFAULT_LOGIN_PATH =
  "/login";

export const DEFAULT_UNAUTHORIZED_PATH =
  "/unauthorized";

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
      ROLE_MATCH_MODE.ANY,
    ).toLowerCase();

  return Object.values(
    ROLE_MATCH_MODE,
  ).includes(normalized)
    ? normalized
    : ROLE_MATCH_MODE.ANY;
}

// ============================================================================
// ProtectedRouteWithRole
// ============================================================================

function ProtectedRouteWithRole({
  children,

  // --------------------------------------------------------------------------
  // Role Requirements
  // --------------------------------------------------------------------------

  role,

  roles,

  requiredRole,

  requiredRoles,

  roleMode = ROLE_MATCH_MODE.ANY,

  requireAllRoles = false,

  // --------------------------------------------------------------------------
  // Optional Permission Requirements
  // --------------------------------------------------------------------------

  permissions = [],

  requiredPermissions,

  permissionMode = "any",

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  requireAuthentication = true,

  // --------------------------------------------------------------------------
  // Tenant Isolation Hints
  // --------------------------------------------------------------------------

  requiredTenantId = "",

  allowedTenantIds = [],

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  loginPath = DEFAULT_LOGIN_PATH,

  unauthorizedPath =
    DEFAULT_UNAUTHORIZED_PATH,

  replaceOnRedirect = true,

  preserveLocation = true,

  // --------------------------------------------------------------------------
  // Presentation
  // --------------------------------------------------------------------------

  loadingFallback = null,

  unauthorizedFallback = null,

  unauthenticatedFallback =
    null,

  disabled = false,

  disabledFallback = null,

  // --------------------------------------------------------------------------
  // Diagnostics
  // --------------------------------------------------------------------------

  debug = false,

  testId = DEFAULT_TEST_ID,

  className = "",

  ariaLabel = "",
}) {
  // ==========================================================================
  // Resolve Role Requirements
  // ==========================================================================

  const resolvedRoles =
    useMemo(() => {
      const candidates = [];

      candidates.push(
        ...normalizeStringArray(
          requiredRoles,
        ),
      );

      candidates.push(
        ...normalizeStringArray(
          requiredRole,
        ),
      );

      candidates.push(
        ...normalizeStringArray(
          roles,
        ),
      );

      candidates.push(
        ...normalizeStringArray(
          role,
        ),
      );

      return [
        ...new Set(
          candidates.filter(Boolean),
        ),
      ];
    }, [
      requiredRoles,
      requiredRole,
      roles,
      role,
    ]);

  // ==========================================================================
  // Resolve Role Matching Mode
  // ==========================================================================
//
// `requireAllRoles` is retained as a convenience compatibility option.
//
// Explicit `roleMode` takes precedence when supplied. The default remains
// `any`, while `requireAllRoles={true}` promotes matching to `all`.
//
// ==========================================================================

  const resolvedRoleMode =
    useMemo(() => {
      if (requireAllRoles) {
        return ROLE_MATCH_MODE.ALL;
      }

      return normalizeMatchMode(
        roleMode,
      );
    }, [
      roleMode,
      requireAllRoles,
    ]);

  // ==========================================================================
  // Resolve Permission Requirements
  // ==========================================================================

  const resolvedPermissions =
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
      "[TITech ProtectedRouteWithRole]",
      {
        requiredRoles:
          resolvedRoles,
        roleMode:
          resolvedRoleMode,
        requiredPermissions:
          resolvedPermissions,
        permissionMode,
        requiredTenantId,
        allowedTenantIds,
      },
    );
  }

  // ==========================================================================
  // Delegate to Canonical ProtectedRoute
  // ==========================================================================

  return (
    <ProtectedRoute
      requiredRoles={
        resolvedRoles
      }
      roleMode={
        resolvedRoleMode
      }
      requiredPermissions={
        resolvedPermissions
      }
      permissionMode={
        permissionMode
      }
      requireAuthentication={
        requireAuthentication
      }
      requiredTenantId={
        requiredTenantId
      }
      allowedTenantIds={
        allowedTenantIds
      }
      loginPath={
        loginPath
      }
      unauthorizedPath={
        unauthorizedPath
      }
      replaceOnRedirect={
        replaceOnRedirect
      }
      preserveLocation={
        preserveLocation
      }
      loadingFallback={
        loadingFallback
      }
      unauthorizedFallback={
        unauthorizedFallback
      }
      unauthenticatedFallback={
        unauthenticatedFallback
      }
      disabled={
        disabled
      }
      disabledFallback={
        disabledFallback
      }
      debug={
        debug
      }
      testId={
        testId
      }
      className={
        className
      }
      ariaLabel={
        ariaLabel
      }
    >
      {children}
    </ProtectedRoute>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

ProtectedRouteWithRole.propTypes = {
  children:
    PropTypes.node,

  // --------------------------------------------------------------------------
  // Roles
  // --------------------------------------------------------------------------

  role:
    PropTypes.string,

  roles:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  requiredRole:
    PropTypes.string,

  requiredRoles:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  roleMode:
    PropTypes.oneOf(
      Object.values(
        ROLE_MATCH_MODE,
      ),
    ),

  requireAllRoles:
    PropTypes.bool,

  // --------------------------------------------------------------------------
  // Permissions
  // --------------------------------------------------------------------------

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

  permissionMode:
    PropTypes.oneOf([
      "any",
      "all",
    ]),

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  requireAuthentication:
    PropTypes.bool,

  // --------------------------------------------------------------------------
  // Tenant
  // --------------------------------------------------------------------------

  requiredTenantId:
    PropTypes.string,

  allowedTenantIds:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  loginPath:
    PropTypes.string,

  unauthorizedPath:
    PropTypes.string,

  replaceOnRedirect:
    PropTypes.bool,

  preserveLocation:
    PropTypes.bool,

  // --------------------------------------------------------------------------
  // Presentation
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Diagnostics
  // --------------------------------------------------------------------------

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

ProtectedRouteWithRole.defaultProps = {
  children: null,

  role: "",

  roles: [],

  requiredRole: "",

  requiredRoles: [],

  roleMode:
    ROLE_MATCH_MODE.ANY,

  requireAllRoles: false,

  permissions: [],

  requiredPermissions:
    undefined,

  permissionMode: "any",

  requireAuthentication: true,

  requiredTenantId: "",

  allowedTenantIds: [],

  loginPath:
    DEFAULT_LOGIN_PATH,

  unauthorizedPath:
    DEFAULT_UNAUTHORIZED_PATH,

  replaceOnRedirect: true,

  preserveLocation: true,

  loadingFallback: null,

  unauthorizedFallback:
    null,

  unauthenticatedFallback:
    null,

  disabled: false,

  disabledFallback: null,

  debug: false,

  testId:
    DEFAULT_TEST_ID,

  className: "",

  ariaLabel: "",
};

// ============================================================================
// Static Metadata
// ============================================================================

ProtectedRouteWithRole.ROLE_MATCH_MODE =
  ROLE_MATCH_MODE;

ProtectedRouteWithRole.DEFAULT_LOGIN_PATH =
  DEFAULT_LOGIN_PATH;

ProtectedRouteWithRole.DEFAULT_UNAUTHORIZED_PATH =
  DEFAULT_UNAUTHORIZED_PATH;

// ============================================================================
// Static Utilities
// ============================================================================

ProtectedRouteWithRole.normalizeString =
  normalizeString;

ProtectedRouteWithRole.normalizeStringArray =
  normalizeStringArray;

ProtectedRouteWithRole.normalizeMatchMode =
  normalizeMatchMode;

// ============================================================================
// Display Name
// ============================================================================

ProtectedRouteWithRole.displayName =
  "TITechProtectedRouteWithRole";

// ============================================================================
// Export
// ============================================================================

export default memo(
  ProtectedRouteWithRole,
);