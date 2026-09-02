// ============================================================================
// TITech Community Capital
// Enterprise Feature Gate
// File: frontend/src/components/ui/FeatureGate.jsx
// Production Grade
// ============================================================================
//
// PURPOSE
// ----------------------------------------------------------------------------
// Centralized UI authorization and feature-availability boundary.
//
// Supports
// ----------------------------------------------------------------------------
// ✓ Feature flags
// ✓ Tenant capabilities
// ✓ Role-based access
// ✓ Permission-based access
// ✓ Multiple requirements
// ✓ Any/all requirement strategies
// ✓ Loading states
// ✓ Fallback rendering
// ✓ Disabled rendering
// ✓ Safe production defaults
// ✓ React 18 compatible
// ✓ Pure presentation/orchestration layer
//
// IMPORTANT
// ----------------------------------------------------------------------------
// FeatureGate is a UI visibility/interaction control.
// It MUST NOT be treated as the authoritative security boundary.
//
// Backend APIs must independently enforce:
// ✓ authentication
// ✓ authorization
// ✓ tenant isolation
// ✓ financial permissions
// ✓ regulatory permissions
// ✓ administrative privileges
//
// ============================================================================

"use strict";

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Constants
// ============================================================================

export const FEATURE_REQUIREMENT_STRATEGIES = {
  ALL: "all",
  ANY: "any",
};

export const FEATURE_GATE_MODES = {
  HIDE: "hide",
  DISABLE: "disable",
  FALLBACK: "fallback",
};

const DEFAULT_STRATEGY =
  FEATURE_REQUIREMENT_STRATEGIES.ALL;

const DEFAULT_MODE =
  FEATURE_GATE_MODES.HIDE;

// ============================================================================
// Helpers
// ============================================================================

function normalizeString(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value.trim();
}

function normalizeArray(
  value
) {
  if (
    Array.isArray(value)
  ) {
    return value.filter(
      Boolean
    );
  }

  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  return [value].filter(
    Boolean
  );
}

function normalizeKey(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

function hasValue(
  collection,
  expected
) {
  const expectedKey =
    normalizeKey(
      expected
    );

  if (!expectedKey) {
    return false;
  }

  return normalizeArray(
    collection
  ).some(
    (item) =>
      normalizeKey(
        item
      ) === expectedKey
  );
}

function hasPermission(
  permissions,
  permission
) {
  return hasValue(
    permissions,
    permission
  );
}

function hasRole(
  roles,
  role
) {
  return hasValue(
    roles,
    role
  );
}

function resolveFeature(
  features,
  feature
) {
  const key =
    normalizeString(
      feature
    );

  if (!key) {
    return false;
  }

  if (
    typeof features ===
    "function"
  ) {
    try {
      return Boolean(
        features(key)
      );
    } catch {
      return false;
    }
  }

  if (
    features &&
    typeof features ===
      "object"
  ) {
    return Boolean(
      features[key]
    );
  }

  return false;
}

function resolveCapability(
  capabilities,
  capability
) {
  const key =
    normalizeString(
      capability
    );

  if (!key) {
    return false;
  }

  if (
    typeof capabilities ===
    "function"
  ) {
    try {
      return Boolean(
        capabilities(key)
      );
    } catch {
      return false;
    }
  }

  if (
    capabilities &&
    typeof capabilities ===
      "object"
  ) {
    return Boolean(
      capabilities[key]
    );
  }

  return false;
}

function evaluateRequirements(
  results,
  strategy
) {
  if (!results.length) {
    return true;
  }

  if (
    strategy ===
    FEATURE_REQUIREMENT_STRATEGIES.ANY
  ) {
    return results.some(
      Boolean
    );
  }

  return results.every(
    Boolean
  );
}

// ============================================================================
// FeatureGate
// ============================================================================

function FeatureGate({
  children,

  feature,
  features,

  capability,
  capabilities,

  role,
  roles,

  permission,
  permissions,

  requireFeature,
  requireCapability,
  requireRole,
  requirePermission,

  strategy =
    DEFAULT_STRATEGY,

  mode =
    DEFAULT_MODE,

  enabled = true,
  loading = false,

  fallback = null,
  loadingFallback = null,

  disabledClassName = "",
  disabledProps = {},

  onDenied,
  onAllowed,

  as: Component,
}) {
  // ==========================================================================
  // Requirement Evaluation
  // ==========================================================================

  const evaluation =
    useMemo(() => {
      if (!enabled) {
        return {
          allowed: false,
          reason:
            "gate-disabled",
        };
      }

      if (loading) {
        return {
          allowed: false,
          loading: true,
          reason:
            "authorization-loading",
        };
      }

      const featureRequirements =
        [
          ...normalizeArray(
            feature
          ),
          ...normalizeArray(
            requireFeature
          ),
        ];

      const capabilityRequirements =
        [
          ...normalizeArray(
            capability
          ),
          ...normalizeArray(
            requireCapability
          ),
        ];

      const roleRequirements =
        [
          ...normalizeArray(
            role
          ),
          ...normalizeArray(
            roles
          ),
          ...normalizeArray(
            requireRole
          ),
        ];

      const permissionRequirements =
        [
          ...normalizeArray(
            permission
          ),
          ...normalizeArray(
            permissions
          ),
          ...normalizeArray(
            requirePermission
          ),
        ];

      const results = [];

      featureRequirements.forEach(
        (requiredFeature) => {
          results.push(
            resolveFeature(
              features,
              requiredFeature
            )
          );
        }
      );

      capabilityRequirements.forEach(
        (
          requiredCapability
        ) => {
          results.push(
            resolveCapability(
              capabilities,
              requiredCapability
            )
          );
        }
      );

      roleRequirements.forEach(
        (requiredRole) => {
          results.push(
            hasRole(
              roles,
              requiredRole
            )
          );
        }
      );

      permissionRequirements.forEach(
        (
          requiredPermission
        ) => {
          results.push(
            hasPermission(
              permissions,
              requiredPermission
            )
          );
        }
      );

      const allowed =
        evaluateRequirements(
          results,
          strategy
        );

      return {
        allowed,
        loading: false,
        reason: allowed
          ? "authorized"
          : "requirement-not-met",
      };
    }, [
      enabled,
      loading,

      feature,
      features,

      capability,
      capabilities,

      role,
      roles,

      permission,
      permissions,

      requireFeature,
      requireCapability,
      requireRole,
      requirePermission,

      strategy,
    ]);

  // ==========================================================================
  // Lifecycle Callbacks
  // ==========================================================================

  useMemo(() => {
    if (
      evaluation.loading
    ) {
      return;
    }

    try {
      if (
        evaluation.allowed
      ) {
        onAllowed?.(
          evaluation
        );
      } else {
        onDenied?.(
          evaluation
        );
      }
    } catch {
      // Callback failures must never break rendering.
    }
  }, [
    evaluation,
    onAllowed,
    onDenied,
  ]);

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (
    evaluation.loading
  ) {
    if (
      loadingFallback
    ) {
      return (
        <>
          {loadingFallback}
        </>
      );
    }

    return null;
  }

  // ==========================================================================
  // Authorized
  // ==========================================================================

  if (
    evaluation.allowed
  ) {
    if (Component) {
      return (
        <Component>
          {children}
        </Component>
      );
    }

    return (
      <>
        {children}
      </>
    );
  }

  // ==========================================================================
  // Denied — Fallback Mode
  // ==========================================================================

  if (
    mode ===
    FEATURE_GATE_MODES.FALLBACK
  ) {
    return (
      <>
        {fallback}
      </>
    );
  }

  // ==========================================================================
  // Denied — Disabled Mode
  // ==========================================================================

  if (
    mode ===
    FEATURE_GATE_MODES.DISABLE
  ) {
    return (
      <span
        className={
          disabledClassName
        }
        aria-disabled="true"
        data-feature-gate="disabled"
        {...disabledProps}
      >
        {children}
      </span>
    );
  }

  // ==========================================================================
  // Denied — Hide Mode
  // ==========================================================================

  return null;
}

// ============================================================================
// Prop Types
// ============================================================================

FeatureGate.propTypes = {
  children:
    PropTypes.node,

  feature:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  features:
    PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.func,
    ]),

  capability:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  capabilities:
    PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.func,
    ]),

  role:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  roles:
    PropTypes.arrayOf(
      PropTypes.string
    ),

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

  requireFeature:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  requireCapability:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  requireRole:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  requirePermission:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string
      ),
    ]),

  strategy:
    PropTypes.oneOf(
      Object.values(
        FEATURE_REQUIREMENT_STRATEGIES
      )
    ),

  mode:
    PropTypes.oneOf(
      Object.values(
        FEATURE_GATE_MODES
      )
    ),

  enabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  fallback:
    PropTypes.node,

  loadingFallback:
    PropTypes.node,

  disabledClassName:
    PropTypes.string,

  disabledProps:
    PropTypes.object,

  onDenied:
    PropTypes.func,

  onAllowed:
    PropTypes.func,

  as:
    PropTypes.elementType,
};

// ============================================================================
// Default Props
// ============================================================================

FeatureGate.defaultProps = {
  children: null,

  feature: null,
  features: null,

  capability: null,
  capabilities: null,

  role: null,
  roles: [],

  permission: null,
  permissions: [],

  requireFeature: null,
  requireCapability: null,
  requireRole: null,
  requirePermission: null,

  strategy:
    FEATURE_REQUIREMENT_STRATEGIES.ALL,

  mode:
    FEATURE_GATE_MODES.HIDE,

  enabled: true,
  loading: false,

  fallback: null,
  loadingFallback: null,

  disabledClassName: "",
  disabledProps: {},

  onDenied: null,
  onAllowed: null,

  as: null,
};

// ============================================================================
// Memoized Export
// ============================================================================

export default memo(
  FeatureGate
);