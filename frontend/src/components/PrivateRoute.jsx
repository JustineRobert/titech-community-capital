// ============================================================================
// TITech Community Capital
// Enterprise Private Route
// File: frontend/src/components/PrivateRoute.jsx
// Production Grade
// Authentication | Session Protection | Multi-Tenant | RBAC-Compatible
// React Router v6+
// ============================================================================
//
// PURPOSE
// ----------------------------------------------------------------------------
// Enterprise route guard for authenticated TITech Community Capital users.
//
// RESPONSIBILITIES
// ----------------------------------------------------------------------------
// ✓ Protect authenticated routes
// ✓ Preserve intended destination after login
// ✓ Handle authentication loading state
// ✓ Handle unauthenticated users safely
// ✓ Handle authenticated-but-disabled users
// ✓ Support optional role checks
// ✓ Support optional permission checks
// ✓ Support custom authorization predicates
// ✓ Support tenant-aware route validation
// ✓ Prevent redirect loops
// ✓ Provide stable test selectors
// ✓ Provide accessible loading / denial states
// ✓ Avoid exposing sensitive authorization details
//
// SECURITY NOTICE
// ----------------------------------------------------------------------------
// This component is NOT a backend security boundary.
//
// The backend MUST independently enforce:
// ✓ Authentication
// ✓ Authorization
// ✓ Tenant isolation
// ✓ Financial permissions
// ✓ KYC / AML controls
// ✓ Regulatory controls
// ✓ Administrative privileges
// ✓ Data access restrictions
//
// Never rely on PrivateRoute to protect an API endpoint.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  Navigate,
  useLocation,
} from "react-router-dom";

import { useAuth } from "../context/AuthContext";

import PermissionGate, {
  evaluateRequirements,
  extractPermissions,
  extractRoles,
} from "./PermissionGate";

// ============================================================================
// Constants
// ============================================================================

export const PRIVATE_ROUTE_STATES =
  Object.freeze({
    LOADING: "loading",
    AUTHENTICATED: "authenticated",
    UNAUTHENTICATED: "unauthenticated",
    UNAUTHORIZED: "unauthorized",
    DISABLED: "disabled",
  });

export const DEFAULT_LOGIN_PATH =
  "/login";

export const DEFAULT_ACCESS_DENIED_PATH =
  "/403";

export const DEFAULT_ACCOUNT_DISABLED_PATH =
  "/account-disabled";

export const DEFAULT_TEST_ID =
  "titech-private-route";

// ============================================================================
// Safe Path Utilities
// ============================================================================

/**
 * Prevent open redirects by accepting only internal application paths.
 */
function isSafeInternalPath(path) {
  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    return false;
  }

  const normalized =
    path.trim();

  if (!normalized.startsWith("/")) {
    return false;
  }

  if (
    normalized.startsWith("//")
  ) {
    return false;
  }

  if (
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return false;
  }

  return true;
}

/**
 * Returns a safe fallback path.
 */
function resolveSafePath(
  path,
  fallback,
) {
  return isSafeInternalPath(path)
    ? path
    : fallback;
}

// ============================================================================
// User State Utilities
// ============================================================================

function resolveUserActiveState(
  user,
) {
  if (!user || typeof user !== "object") {
    return false;
  }

  /**
   * Explicit disabled flags take precedence.
   */
  if (
    user.disabled === true ||
    user.isDisabled === true ||
    user.accountDisabled === true ||
    user.suspended === true ||
    user.isSuspended === true
  ) {
    return false;
  }

  /**
   * Support common status representations.
   */
  const status =
    typeof user.status === "string"
      ? user.status
          .trim()
          .toLowerCase()
      : "";

  if (
    [
      "disabled",
      "suspended",
      "blocked",
      "deactivated",
      "inactive",
    ].includes(status)
  ) {
    return false;
  }

  return true;
}

function resolveAuthentication(
  auth,
) {
  if (!auth || typeof auth !== "object") {
    return {
      user: null,
      isAuthenticated: false,
      loading: false,
    };
  }

  const user =
    auth.user ||
    auth.currentUser ||
    null;

  /**
   * Prefer explicit authentication state when supplied.
   */
  if (
    typeof auth.isAuthenticated ===
    "boolean"
  ) {
    return {
      user,
      isAuthenticated:
        auth.isAuthenticated,
      loading:
        Boolean(
          auth.loading ??
            auth.isLoading ??
            auth.authLoading,
        ),
    };
  }

  if (
    typeof auth.authenticated ===
    "boolean"
  ) {
    return {
      user,
      isAuthenticated:
        auth.authenticated,
      loading:
        Boolean(
          auth.loading ??
            auth.isLoading ??
            auth.authLoading,
        ),
    };
  }

  return {
    user,
    isAuthenticated:
      Boolean(user),
    loading:
      Boolean(
        auth.loading ??
          auth.isLoading ??
          auth.authLoading,
      ),
  };
}

// ============================================================================
// Loading UI
// ============================================================================

function DefaultLoadingFallback({
  label,
}) {
  return (
    <div
      className="titech-private-route__loading"
      data-component="titech-private-route"
      data-state={
        PRIVATE_ROUTE_STATES.LOADING
      }
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <div
        className="titech-private-route__spinner"
        aria-hidden="true"
      />

      <span>
        {label ||
          "Verifying your session…"}
      </span>
    </div>
  );
}

DefaultLoadingFallback.propTypes = {
  label: PropTypes.string,
};

// ============================================================================
// Unauthorized UI
// ============================================================================

function DefaultUnauthorizedFallback({
  title,
  message,
}) {
  return (
    <section
      className="titech-private-route__unauthorized"
      data-component="titech-private-route"
      data-state={
        PRIVATE_ROUTE_STATES.UNAUTHORIZED
      }
      role="alert"
      aria-labelledby="titech-private-route-title"
    >
      <h1 id="titech-private-route-title">
        {title ||
          "Access Restricted"}
      </h1>

      <p>
        {message ||
          "You do not have permission to access this area."}
      </p>
    </section>
  );
}

DefaultUnauthorizedFallback.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string,
};

// ============================================================================
// Account Disabled UI
// ============================================================================

function DefaultDisabledFallback({
  title,
  message,
}) {
  return (
    <section
      className="titech-private-route__disabled"
      data-component="titech-private-route"
      data-state={
        PRIVATE_ROUTE_STATES.DISABLED
      }
      role="alert"
      aria-labelledby="titech-private-route-disabled-title"
    >
      <h1 id="titech-private-route-disabled-title">
        {title ||
          "Account Unavailable"}
      </h1>

      <p>
        {message ||
          "Your account is currently unavailable. Please contact TITech support if you believe this is an error."}
      </p>
    </section>
  );
}

DefaultDisabledFallback.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string,
};

// ============================================================================
// Authorization Evaluation
// ============================================================================

function evaluateRouteAuthorization({
  user,
  requiredPermissions,
  requiredRoles,
  permissionMode,
  roleMode,
  requireAuthentication,
  authorize,
}) {
  const permissions =
    extractPermissions(user);

  const roles =
    extractRoles(user);

  const evaluation =
    evaluateRequirements({
      availablePermissions:
        permissions,
      availableRoles:
        roles,
      requiredPermissions,
      requiredRoles,
      permissionMode,
      roleMode,
      requireAuthentication,
      user,
    });

  /**
   * Optional enterprise policy hook.
   *
   * This can implement additional frontend presentation rules such as:
   * - tenant membership
   * - feature access
   * - account state
   * - onboarding completion
   *
   * The backend MUST still enforce the same policies.
   */
  if (
    typeof authorize ===
    "function"
  ) {
    try {
      const customResult =
        authorize({
          user,
          permissions,
          roles,
          evaluation,
        });

      if (
        typeof customResult ===
        "boolean"
      ) {
        return {
          ...evaluation,
          allowed:
            evaluation.allowed &&
            customResult,
          reason:
            evaluation.allowed &&
            customResult
              ? "authorized"
              : "custom-authorization-denied",
        };
      }
    } catch (error) {
      if (
        typeof console !==
          "undefined" &&
        typeof console.error ===
          "function"
      ) {
        console.error(
          "[TITech PrivateRoute] Authorization policy evaluation failed.",
          error,
        );
      }

      return {
        ...evaluation,
        allowed: false,
        reason:
          "authorization-evaluation-error",
      };
    }
  }

  return evaluation;
}

// ============================================================================
// Private Route
// ============================================================================

function PrivateRoute({
  children,

  redirectTo =
    DEFAULT_LOGIN_PATH,

  accessDeniedPath =
    DEFAULT_ACCESS_DENIED_PATH,

  accountDisabledPath =
    DEFAULT_ACCOUNT_DISABLED_PATH,

  requiredPermissions = [],
  requiredRoles = [],

  permissionMode = "any",
  roleMode = "any",

  requireAuthentication = true,

  authorize = null,

  loadingFallback = null,

  unauthorizedFallback = null,

  disabledFallback = null,

  disabledRedirect = true,

  preserveLocation = true,

  replace = true,

  testId =
    DEFAULT_TEST_ID,

  debug = false,

  onUnauthorized = null,

  onDisabled = null,
}) {
  // ==========================================================================
  // Authentication Context
  // ==========================================================================

  const auth =
    useAuth();

  const location =
    useLocation();

  const {
    user,
    isAuthenticated,
    loading,
  } =
    resolveAuthentication(auth);

  // ==========================================================================
  // Safe Navigation Paths
  // ==========================================================================

  const safeLoginPath =
    resolveSafePath(
      redirectTo,
      DEFAULT_LOGIN_PATH,
    );

  const safeAccessDeniedPath =
    resolveSafePath(
      accessDeniedPath,
      DEFAULT_ACCESS_DENIED_PATH,
    );

  const safeAccountDisabledPath =
    resolveSafePath(
      accountDisabledPath,
      DEFAULT_ACCOUNT_DISABLED_PATH,
    );

  // ==========================================================================
  // Session State
  // ==========================================================================

  const accountActive =
    useMemo(
      () =>
        resolveUserActiveState(
          user,
        ),
      [user],
    );

  // ==========================================================================
  // Authorization
  // ==========================================================================

  const authorization =
    useMemo(
      () =>
        evaluateRouteAuthorization({
          user,
          requiredPermissions,
          requiredRoles,
          permissionMode,
          roleMode,
          requireAuthentication,
          authorize,
        }),
      [
        user,
        requiredPermissions,
        requiredRoles,
        permissionMode,
        roleMode,
        requireAuthentication,
        authorize,
      ],
    );

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  if (
    debug &&
    typeof console !==
      "undefined" &&
    typeof console.debug ===
      "function"
  ) {
    console.debug(
      "[TITech PrivateRoute]",
      {
        authenticated:
          isAuthenticated,
        loading,
        accountActive,
        authorized:
          authorization.allowed,
        reason:
          authorization.reason,
        path:
          location.pathname,
        requiredPermissions,
        requiredRoles,
        tenantId:
          user?.tenantId ||
          user?.tenant?.id ||
          null,
      },
    );
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  if (loading) {
    return (
      <div
        className="titech-private-route"
        data-testid={testId}
        data-component="titech-private-route"
        data-state={
          PRIVATE_ROUTE_STATES.LOADING
        }
        aria-busy="true"
      >
        {loadingFallback || (
          <DefaultLoadingFallback />
        )}
      </div>
    );
  }

  // ==========================================================================
  // Unauthenticated
  // ==========================================================================

  if (
    requireAuthentication &&
    !isAuthenticated
  ) {
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
        to={safeLoginPath}
        replace={replace}
        state={redirectState}
      />
    );
  }

  // ==========================================================================
  // Account Disabled / Suspended
  // ==========================================================================

  if (
    isAuthenticated &&
    !accountActive
  ) {
    onDisabled?.({
      user,
      location,
    });

    if (disabledRedirect) {
      return (
        <Navigate
          to={
            safeAccountDisabledPath
          }
          replace={replace}
          state={{
            from: {
              pathname:
                location.pathname,
              search:
                location.search,
            },
          }}
        />
      );
    }

    return (
      <div
        className="titech-private-route"
        data-testid={testId}
        data-component="titech-private-route"
        data-state={
          PRIVATE_ROUTE_STATES.DISABLED
        }
      >
        {disabledFallback || (
          <DefaultDisabledFallback />
        )}
      </div>
    );
  }

  // ==========================================================================
  // Unauthorized
  // ==========================================================================

  if (
    requireAuthentication &&
    !authorization.allowed
  ) {
    onUnauthorized?.({
      user,
      location,
      authorization,
    });

    if (
      safeAccessDeniedPath &&
      !location.pathname.startsWith(
        safeAccessDeniedPath,
      )
    ) {
      return (
        <Navigate
          to={
            safeAccessDeniedPath
          }
          replace={replace}
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
              authorization.reason,
          }}
        />
      );
    }

    return (
      <div
        className="titech-private-route"
        data-testid={testId}
        data-component="titech-private-route"
        data-state={
          PRIVATE_ROUTE_STATES.UNAUTHORIZED
        }
      >
        {unauthorizedFallback || (
          <DefaultUnauthorizedFallback />
        )}
      </div>
    );
  }

  // ==========================================================================
  // Authorized
  // ==========================================================================

  return (
    <div
      className="titech-private-route"
      data-testid={testId}
      data-component="titech-private-route"
      data-state={
        PRIVATE_ROUTE_STATES.AUTHENTICATED
      }
      data-authenticated="true"
      data-authorized="true"
    >
      {children}
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

PrivateRoute.propTypes = {
  children:
    PropTypes.node.isRequired,

  redirectTo:
    PropTypes.string,

  accessDeniedPath:
    PropTypes.string,

  accountDisabledPath:
    PropTypes.string,

  requiredPermissions:
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
    PropTypes.oneOf([
      "any",
      "all",
    ]),

  roleMode:
    PropTypes.oneOf([
      "any",
      "all",
    ]),

  requireAuthentication:
    PropTypes.bool,

  authorize:
    PropTypes.func,

  loadingFallback:
    PropTypes.node,

  unauthorizedFallback:
    PropTypes.node,

  disabledFallback:
    PropTypes.node,

  disabledRedirect:
    PropTypes.bool,

  preserveLocation:
    PropTypes.bool,

  replace:
    PropTypes.bool,

  testId:
    PropTypes.string,

  debug:
    PropTypes.bool,

  onUnauthorized:
    PropTypes.func,

  onDisabled:
    PropTypes.func,
};

// ============================================================================
// Static Metadata
// ============================================================================

PrivateRoute.displayName =
  "TITechPrivateRoute";

PrivateRoute.STATES =
  PRIVATE_ROUTE_STATES;

PrivateRoute.DEFAULT_LOGIN_PATH =
  DEFAULT_LOGIN_PATH;

PrivateRoute.DEFAULT_ACCESS_DENIED_PATH =
  DEFAULT_ACCESS_DENIED_PATH;

PrivateRoute.DEFAULT_ACCOUNT_DISABLED_PATH =
  DEFAULT_ACCOUNT_DISABLED_PATH;

// ============================================================================
// Export
// ============================================================================

export default memo(
  PrivateRoute,
);