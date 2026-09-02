'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/TenantRoute.jsx
 *
 * Purpose:
 *   Canonical tenant-context route boundary.
 *
 * Responsibilities:
 *   - Verify authentication
 *   - Verify an active tenant context
 *   - Verify tenant membership
 *   - Validate URL tenant identifiers
 *   - Switch tenant context when a valid URL tenant is requested
 *   - Preserve intended navigation
 *   - Provide nested <Outlet /> routing
 *   - Provide reusable tenant access helpers
 *   - Record safe route diagnostics
 *
 * Non-responsibilities:
 *   - Tenant creation
 *   - Tenant deletion
 *   - Tenant membership mutation
 *   - Backend tenant authorization
 *   - Database access
 *   - Financial business authorization
 *
 * IMPORTANT SECURITY PRINCIPLE:
 *
 *   The frontend tenant guard is not the authoritative tenant-isolation
 *   boundary. Every backend request must enforce tenant ownership/isolation
 *   independently.
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
  useParams,
} from 'react-router-dom';

import {
  Building2,
  Loader2,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REDIRECT_PATH =
  '/dashboard';

const LAST_TENANT_ROUTE_KEY =
  'titech:last-tenant-route';

const ACTIVE_TENANT_STATUS =
  'active';

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
          Loading tenant…
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Tenant unavailable component
// ============================================================================

function TenantUnavailable({
  title = 'Tenant Unavailable',
  message =
    'No tenant is available for this resource.',
}) {
  return (
    <div
      className="route-tenant-page"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="route-tenant-card"
      >
        <Building2
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
// Tenant identity helpers
// ============================================================================

function normalizeTenantId(
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

function getTenantId(
  tenant
) {
  if (!tenant) {
    return null;
  }

  return normalizeTenantId(
    tenant.id ??
      tenant._id
  );
}

function getTenantStatus(
  tenant
) {
  if (!tenant) {
    return null;
  }

  if (
    typeof tenant.status !==
    'string'
  ) {
    return null;
  }

  return tenant.status
    .trim()
    .toLowerCase();
}

function getTenantById(
  tenants,
  tenantId
) {
  const normalizedId =
    normalizeTenantId(
      tenantId
    );

  if (
    !normalizedId ||
    !Array.isArray(
      tenants
    )
  ) {
    return null;
  }

  return (
    tenants.find(
      (candidate) =>
        getTenantId(
          candidate
        ) === normalizedId
    ) || null
  );
}

// ============================================================================
// Tenant membership
// ============================================================================

function isTenantMember(
  tenants,
  tenantId
) {
  const normalizedId =
    normalizeTenantId(
      tenantId
    );

  if (
    !normalizedId
  ) {
    return false;
  }

  if (
    !Array.isArray(
      tenants
    )
  ) {
    return false;
  }

  return Boolean(
    getTenantById(
      tenants,
      normalizedId
    )
  );
}

// ============================================================================
// Tenant Route
// ============================================================================

function TenantRoute({
  children,
  redirectTo =
    DEFAULT_REDIRECT_PATH,
  requireMembership = true,
  requireActiveTenant = true,
  fallback = null,
}) {
  const location =
    useLocation();

  const params =
    useParams();

  const auth =
    useAuth() || {};

  const {
    user = null,
    loading = false,
    isAuthenticated,
    tenant = null,
    tenants = [],
    switchTenant,
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
  // Current tenant identity
  // --------------------------------------------------------------------------

  const currentTenantId =
    getTenantId(
      tenant
    );

  const routeTenantId =
    normalizeTenantId(
      params?.tenantId
    );

  const currentTenantStatus =
    getTenantStatus(
      tenant
    );

  // --------------------------------------------------------------------------
  // URL tenant resolution
  // --------------------------------------------------------------------------

  const requestedRouteTenant =
    routeTenantId
      ? getTenantById(
          tenants,
          routeTenantId
        )
      : null;

  const routeTenantExists =
    Boolean(
      requestedRouteTenant
    );

  const routeTenantMatchesCurrent =
    Boolean(
      routeTenantId &&
        currentTenantId &&
        routeTenantId ===
          currentTenantId
    );

  const tenantMembershipAvailable =
    Array.isArray(
      tenants
    );

  const tenantBelongsToUser =
    currentTenantId
      ? isTenantMember(
          tenants,
          currentTenantId
        )
      : false;

  // --------------------------------------------------------------------------
  // Authorization state
  // --------------------------------------------------------------------------

  let access = {
    allowed: true,
    reason: null,
  };

  if (loading) {
    access = {
      allowed: false,
      reason: 'loading',
    };
  } else if (
    !authenticated ||
    !user
  ) {
    access = {
      allowed: false,
      reason: 'unauthenticated',
    };
  } else if (
    !tenant
  ) {
    access = {
      allowed: false,
      reason: 'tenant_required',
    };
  } else if (
    requireActiveTenant &&
    currentTenantStatus &&
    currentTenantStatus !==
      ACTIVE_TENANT_STATUS
  ) {
    access = {
      allowed: false,
      reason:
        'tenant_inactive',
    };
  } else if (
    requireMembership &&
    tenantMembershipAvailable &&
    !tenantBelongsToUser
  ) {
    access = {
      allowed: false,
      reason:
        'membership_required',
    };
  } else if (
    routeTenantId &&
    !routeTenantExists
  ) {
    access = {
      allowed: false,
      reason:
        'tenant_not_found',
    };
  }

  // --------------------------------------------------------------------------
  // Tenant switching effect
  // --------------------------------------------------------------------------
  //
  // NEVER mutate tenant context during render.
  //
  // A valid URL tenant is switched in an effect after rendering.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (
      loading ||
      !authenticated ||
      !user ||
      !routeTenantId ||
      !requestedRouteTenant ||
      routeTenantMatchesCurrent
    ) {
      return;
    }

    if (
      typeof switchTenant !==
      'function'
    ) {
      return;
    }

    let cancelled = false;

    const performSwitch =
      async () => {
        try {
          if (cancelled) {
            return;
          }

          await switchTenant(
            routeTenantId
          );
        } catch (error) {
          /*
           * Tenant switching failure must not create an unhandled rejection.
           *
           * The AuthContext remains responsible for exposing the resulting
           * tenant/session state to the application.
           */
          if (
            import.meta.env.DEV
          ) {
            console.error(
              '[TITech] Failed to switch tenant from route.',
              error
            );
          }
        }
      };

    void performSwitch();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    authenticated,
    user,
    routeTenantId,
    requestedRouteTenant,
    routeTenantMatchesCurrent,
    switchTenant,
  ]);

  // --------------------------------------------------------------------------
  // Safe tenant route diagnostics
  // --------------------------------------------------------------------------
  //
  // Store only the tenant identifier, never the tenant object.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (
      loading ||
      !access.allowed ||
      !currentTenantId
    ) {
      return;
    }

    try {
      sessionStorage.setItem(
        LAST_TENANT_ROUTE_KEY,
        JSON.stringify({
          path:
            location.pathname,
          tenantId:
            currentTenantId,
          timestamp:
            Date.now(),
        })
      );
    } catch {
      /*
       * Storage failures must never affect tenant authorization.
       */
    }
  }, [
    loading,
    access.allowed,
    location.pathname,
    currentTenantId,
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
  // Tenant missing
  // --------------------------------------------------------------------------

  if (
    access.reason ===
    'tenant_required'
  ) {
    return (
      fallback || (
        <TenantUnavailable
          title="No Tenant"
          message={
            'Your account is not associated with an active tenant.'
          }
        />
      )
    );
  }

  // --------------------------------------------------------------------------
  // Tenant inactive
  // --------------------------------------------------------------------------

  if (
    access.reason ===
    'tenant_inactive'
  ) {
    return (
      fallback || (
        <TenantUnavailable
          title="Tenant Disabled"
          message={
            'This tenant is currently inactive.'
          }
        />
      )
    );
  }

  // --------------------------------------------------------------------------
  // Membership denied
  // --------------------------------------------------------------------------

  if (
    access.reason ===
    'membership_required'
  ) {
    return (
      fallback || (
        <TenantUnavailable
          title="Membership Required"
          message={
            'You do not belong to the selected tenant.'
          }
        />
      )
    );
  }

  // --------------------------------------------------------------------------
  // URL tenant does not exist
  // --------------------------------------------------------------------------

  if (
    access.reason ===
    'tenant_not_found'
  ) {
    return (
      <Navigate
        to={redirectTo}
        replace
      />
    );
  }

  // --------------------------------------------------------------------------
  // While switching to a valid URL tenant
  // --------------------------------------------------------------------------
  //
  // If the URL requests a different valid tenant, do not render tenant-bound
  // content under the wrong current tenant while the switch is in progress.
  // --------------------------------------------------------------------------

  if (
    routeTenantId &&
    routeTenantExists &&
    !routeTenantMatchesCurrent
  ) {
    return (
      <RouteLoader />
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
// Tenant access hook
// ============================================================================

export function useTenantAccess() {
  const auth =
    useAuth() || {};

  const {
    tenant = null,
    tenants = [],
    switchTenant,
  } = auth;

  const currentTenantId =
    getTenantId(
      tenant
    );

  const hasTenant =
    Boolean(
      currentTenantId
    );

  const status =
    getTenantStatus(
      tenant
    );

  const isActive =
    hasTenant &&
    (
      !status ||
      status ===
        ACTIVE_TENANT_STATUS
    );

  const belongsToTenant =
    useCallback(
      (tenantId) =>
        isTenantMember(
          tenants,
          tenantId
        ),
      [tenants]
    );

  const getTenant =
    useCallback(
      (tenantId) =>
        getTenantById(
          tenants,
          tenantId
        ),
      [tenants]
    );

  const switchToTenant =
    useCallback(
      async (tenantId) => {
        if (
          typeof switchTenant !==
          'function'
        ) {
          return false;
        }

        const normalizedId =
          normalizeTenantId(
            tenantId
          );

        if (!normalizedId) {
          return false;
        }

        if (
          !isTenantMember(
            tenants,
            normalizedId
          )
        ) {
          return false;
        }

        await switchTenant(
          normalizedId
        );

        return true;
      },
      [
        switchTenant,
        tenants,
      ]
    );

  return {
    tenant,
    tenants,

    tenantId:
      currentTenantId,

    hasTenant,

    isActive,

    belongsToTenant,

    getTenant,

    switchTenant:
      switchToTenant,
  };
}

// ============================================================================
// Higher-order component
// ============================================================================

export function withTenantRoute(
  Component,
  options = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withTenantRoute requires a valid React component.'
    );
  }

  function WrappedComponent(
    props
  ) {
    return (
      <TenantRoute
        {...options}
      >
        <Component
          {...props}
        />
      </TenantRoute>
    );
  }

  WrappedComponent.displayName =
    `withTenantRoute(${
      Component.displayName ||
      Component.name ||
      'Component'
    })`;

  return WrappedComponent;
}

// ============================================================================
// Export
// ============================================================================

export {
  getTenantId,
  getTenantStatus,
  getTenantById,
  isTenantMember,
};

export default memo(
  TenantRoute
);