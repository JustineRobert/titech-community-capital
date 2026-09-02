// ============================================================================
// TITech Community Capital
// Enterprise Permission Gate
// File: frontend/src/components/PermissionGate.jsx
// Production Grade
// Multi-Tenant | RBAC | ABAC-Compatible | Authorization-Aware UI
// ============================================================================
//
// IMPORTANT SECURITY NOTICE
// ----------------------------------------------------------------------------
// PermissionGate is a FRONTEND PRESENTATION / AUTHORIZATION-AWARE UI helper.
//
// It is NOT a security boundary.
//
// Never rely on this component for:
//   ✓ Authentication
//   ✓ Backend authorization
//   ✓ Tenant isolation
//   ✓ Financial authorization
//   ✓ KYC / AML enforcement
//   ✓ Regulatory enforcement
//   ✓ Privileged API protection
//   ✓ Data protection
//
// Every protected operation MUST be independently authenticated,
// authorized, validated, audited, and tenant-scoped by the backend/API.
//
// ============================================================================

"use strict";

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Constants
// ============================================================================

export const MATCH_MODE = Object.freeze({
  ANY: "any",
  ALL: "all",
});

export const FALLBACK_MODE = Object.freeze({
  HIDDEN: "hidden",
  FALLBACK: "fallback",
  DISABLED: "disabled",
});

export const PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: "dashboard.view",
  MANAGE_DASHBOARD: "dashboard.manage",

  VIEW_MEMBERS: "members.view",
  CREATE_MEMBER: "members.create",
  UPDATE_MEMBER: "members.update",
  DELETE_MEMBER: "members.delete",

  VIEW_SAVINGS: "savings.view",
  CREATE_SAVINGS: "savings.create",
  APPROVE_SAVINGS: "savings.approve",

  VIEW_LOANS: "loans.view",
  CREATE_LOAN: "loans.create",
  APPROVE_LOAN: "loans.approve",
  DISBURSE_LOAN: "loans.disburse",

  VIEW_TRANSACTIONS: "transactions.view",
  CREATE_TRANSACTION: "transactions.create",
  REVERSE_TRANSACTION: "transactions.reverse",

  VIEW_REPORTS: "reports.view",
  EXPORT_REPORTS: "reports.export",

  VIEW_BILLING: "billing.view",
  MANAGE_BILLING: "billing.manage",

  VIEW_KYC: "kyc.view",
  APPROVE_KYC: "kyc.approve",

  VIEW_AML: "aml.view",
  MANAGE_AML: "aml.manage",

  VIEW_USSD: "ussd.view",
  MANAGE_USSD: "ussd.manage",

  VIEW_MOBILE_MONEY: "mobile_money.view",
  MANAGE_MOBILE_MONEY: "mobile_money.manage",

  VIEW_EXECUTIVE_DASHBOARD:
    "executive_dashboard.view",

  VIEW_FRAUD: "fraud_detection.view",
  MANAGE_FRAUD: "fraud_detection.manage",

  VIEW_REGULATORY_REPORTING:
    "regulatory_reporting.view",

  MANAGE_TENANTS:
    "tenant_management.manage",

  MANAGE_USERS:
    "users.manage",

  API_ACCESS: "api.access",

  SUPER_ADMIN: "*",
});

export const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  PLATFORM_ADMIN: "platform_admin",
  TENANT_ADMIN: "tenant_admin",
  MANAGER: "manager",
  TELLER: "teller",
  COMPLIANCE: "compliance",
  AUDITOR: "auditor",
  MEMBER: "member",
  EXECUTIVE: "executive",
});

const DEFAULT_PERMISSION_KEYS = Object.freeze({
  READ: "read",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  MANAGE: "manage",
  APPROVE: "approve",
  EXPORT: "export",
});

const DEFAULT_ROLE_KEYS = Object.freeze({
  ADMIN: "admin",
  MANAGER: "manager",
  MEMBER: "member",
  STAFF: "staff",
});

const DEFAULT_TEST_ID = "titech-permission-gate";

const WILDCARD_PERMISSION = "*";

// ============================================================================
// Context
// ============================================================================

const PermissionContext = createContext({
  permissions: [],
  roles: [],
  user: null,
  tenantId: null,
  loading: false,
});

// ============================================================================
// Normalization Utilities
// ============================================================================

function normalizeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeKey(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeStringArray(value) {
  if (value === null || value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values
        .flatMap((item) => {
          if (
            item &&
            typeof item === "object" &&
            !Array.isArray(item)
          ) {
            return [
              item.name,
              item.code,
              item.key,
              item.permission,
              item.role,
            ];
          }

          return [item];
        })
        .map((item) => normalizeString(item))
        .filter(Boolean),
    ),
  ];
}

function normalizeBoolean(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeKey(value);

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeMatchMode(value) {
  const normalized = normalizeKey(value || MATCH_MODE.ANY);

  return Object.values(MATCH_MODE).includes(normalized)
    ? normalized
    : MATCH_MODE.ANY;
}

function normalizeFallbackMode(value) {
  const normalized = normalizeKey(
    value || FALLBACK_MODE.HIDDEN,
  );

  return Object.values(FALLBACK_MODE).includes(normalized)
    ? normalized
    : FALLBACK_MODE.HIDDEN;
}

// ============================================================================
// User Permission Extraction
// ============================================================================

function extractPermissions(user) {
  if (!user || typeof user !== "object") {
    return [];
  }

  const candidates = [
    user.permissions,
    user.permission,
    user.permissionCodes,
    user.permissionKeys,
    user.authorities,
    user.scopes,
  ];

  const values = [];

  candidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach((item) => {
        if (typeof item === "string") {
          values.push(item);
          return;
        }

        if (item && typeof item === "object") {
          values.push(
            item.name,
            item.code,
            item.key,
            item.permission,
          );
        }
      });

      return;
    }

    if (typeof candidate === "string") {
      values.push(candidate);
      return;
    }

    if (
      candidate &&
      typeof candidate === "object"
    ) {
      Object.entries(candidate).forEach(
        ([key, enabled]) => {
          if (enabled === true) {
            values.push(key);
          }
        },
      );
    }
  });

  return normalizeStringArray(values);
}

// ============================================================================
// User Role Extraction
// ============================================================================

function extractRoles(user) {
  if (!user || typeof user !== "object") {
    return [];
  }

  const candidates = [
    user.roles,
    user.role,
    user.roleNames,
    user.authorities,
  ];

  const values = [];

  candidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach((item) => {
        if (typeof item === "string") {
          values.push(item);
          return;
        }

        if (item && typeof item === "object") {
          values.push(
            item.name,
            item.code,
            item.key,
            item.role,
          );
        }
      });

      return;
    }

    if (typeof candidate === "string") {
      values.push(candidate);
      return;
    }

    if (
      candidate &&
      typeof candidate === "object"
    ) {
      values.push(
        candidate.name,
        candidate.code,
        candidate.key,
        candidate.role,
      );
    }
  });

  return normalizeStringArray(values);
}

// ============================================================================
// Generic Matching
// ============================================================================

function matchesValue(
  availableValues,
  requiredValue,
) {
  const required = normalizeKey(requiredValue);

  if (!required) {
    return false;
  }

  return availableValues.some(
    (availableValue) =>
      normalizeKey(availableValue) === required,
  );
}

// ============================================================================
// Permission Matching
// ============================================================================

function hasPermission(
  permission,
  permissions = [],
) {
  const requested = normalizeKey(permission);

  if (!requested) {
    return false;
  }

  const available = normalizeStringArray(permissions).map(
    normalizeKey,
  );

  if (available.includes(WILDCARD_PERMISSION)) {
    return true;
  }

  return available.includes(requested);
}

// ============================================================================
// Requirement Evaluation
// ============================================================================

export function evaluateRequirements({
  availablePermissions = [],
  availableRoles = [],
  requiredPermissions = [],
  requiredRoles = [],
  permissionMode = MATCH_MODE.ANY,
  roleMode = MATCH_MODE.ANY,
  requireAuthentication = false,
  user = null,
}) {
  const permissions = normalizeStringArray(
    requiredPermissions,
  );

  const roles = normalizeStringArray(requiredRoles);

  const normalizedPermissionMode =
    normalizeMatchMode(permissionMode);

  const normalizedRoleMode =
    normalizeMatchMode(roleMode);

  const authenticated = Boolean(user);

  if (requireAuthentication && !authenticated) {
    return {
      allowed: false,
      authenticated: false,
      permissionMatched: false,
      roleMatched: false,
      reason: "authentication-required",
    };
  }

  const normalizedAvailablePermissions =
    normalizeStringArray(availablePermissions);

  const normalizedAvailableRoles =
    normalizeStringArray(availableRoles);

  const permissionMatched =
    permissions.length === 0
      ? true
      : normalizedPermissionMode === MATCH_MODE.ALL
        ? permissions.every((permission) =>
            hasPermission(
              permission,
              normalizedAvailablePermissions,
            ),
          )
        : permissions.some((permission) =>
            hasPermission(
              permission,
              normalizedAvailablePermissions,
            ),
          );

  const roleMatched =
    roles.length === 0
      ? true
      : normalizedRoleMode === MATCH_MODE.ALL
        ? roles.every((role) =>
            matchesValue(
              normalizedAvailableRoles,
              role,
            ),
          )
        : roles.some((role) =>
            matchesValue(
              normalizedAvailableRoles,
              role,
            ),
          );

  const hasPermissionRequirements =
    permissions.length > 0;

  const hasRoleRequirements =
    roles.length > 0;

  const allowed =
    (!hasPermissionRequirements ||
      permissionMatched) &&
    (!hasRoleRequirements || roleMatched);

  return {
    allowed,
    authenticated,
    permissionMatched,
    roleMatched,
    reason: allowed
      ? "authorized"
      : "insufficient-permissions",
  };
}

// ============================================================================
// Permission Provider
// ============================================================================

export function PermissionProvider({
  children,
  permissions = [],
  roles = [],
  user = null,
  tenantId = null,
  loading = false,
}) {
  const normalizedPermissions = useMemo(
    () => normalizeStringArray(permissions),
    [permissions],
  );

  const normalizedRoles = useMemo(
    () => normalizeStringArray(roles),
    [roles],
  );

  const value = useMemo(
    () => ({
      permissions: normalizedPermissions,
      roles: normalizedRoles,
      user,
      tenantId,
      loading: Boolean(loading),
    }),
    [
      normalizedPermissions,
      normalizedRoles,
      user,
      tenantId,
      loading,
    ],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

PermissionProvider.propTypes = {
  children: PropTypes.node.isRequired,
  permissions: PropTypes.arrayOf(PropTypes.string),
  roles: PropTypes.arrayOf(PropTypes.string),
  user: PropTypes.object,
  tenantId: PropTypes.string,
  loading: PropTypes.bool,
};

// ============================================================================
// Context Hook
// ============================================================================

export function usePermissionContext() {
  return useContext(PermissionContext);
}

// ============================================================================
// Permission Hooks
// ============================================================================

export function usePermission(
  permission,
  permissions,
) {
  const context = usePermissionContext();

  const available =
    permissions !== undefined
      ? permissions
      : context.permissions;

  return useMemo(
    () => hasPermission(permission, available),
    [permission, available],
  );
}

export function usePermissions(
  permissions,
  availablePermissions,
  options = {},
) {
  const context = usePermissionContext();

  const available =
    availablePermissions !== undefined &&
    availablePermissions !== null
      ? availablePermissions
      : context.permissions;

  const requireAll =
    options.requireAll === true ||
    options.mode === MATCH_MODE.ALL;

  return useMemo(() => {
    const requested =
      normalizeStringArray(permissions);

    if (requested.length === 0) {
      return true;
    }

    if (
      normalizeStringArray(available).some(
        (permission) =>
          normalizeKey(permission) ===
          WILDCARD_PERMISSION,
      )
    ) {
      return true;
    }

    return requireAll
      ? requested.every((permission) =>
          hasPermission(permission, available),
        )
      : requested.some((permission) =>
          hasPermission(permission, available),
        );
  }, [permissions, available, requireAll]);
}

// ============================================================================
// Role Hooks
// ============================================================================

export function useRole(role, roles) {
  const context = usePermissionContext();

  const available =
    roles !== undefined
      ? roles
      : context.roles;

  return useMemo(
    () => matchesValue(available, role),
    [role, available],
  );
}

export function useRoles(
  roles,
  availableRoles,
  options = {},
) {
  const context = usePermissionContext();

  const available =
    availableRoles !== undefined &&
    availableRoles !== null
      ? availableRoles
      : context.roles;

  const requireAll =
    options.requireAll === true ||
    options.mode === MATCH_MODE.ALL;

  return useMemo(() => {
    const requested =
      normalizeStringArray(roles);

    if (requested.length === 0) {
      return true;
    }

    return requireAll
      ? requested.every((role) =>
          matchesValue(available, role),
        )
      : requested.some((role) =>
          matchesValue(available, role),
        );
  }, [roles, available, requireAll]);
}

// ============================================================================
// Combined Authorization Hook
// ============================================================================

export function useAuthorization({
  user,
  permissions,
  requiredPermissions,
  roles,
  requiredRoles,
  permissionMode = MATCH_MODE.ANY,
  roleMode = MATCH_MODE.ANY,
  requireAuthentication = false,
} = {}) {
  const context = usePermissionContext();

  const resolvedUser =
    user !== undefined
      ? user
      : context.user;

  const availablePermissions =
    permissions !== undefined
      ? permissions
      : context.permissions.length > 0
        ? context.permissions
        : extractPermissions(resolvedUser);

  const availableRoles =
    roles !== undefined
      ? roles
      : context.roles.length > 0
        ? context.roles
        : extractRoles(resolvedUser);

  return useMemo(
    () =>
      evaluateRequirements({
        availablePermissions,
        availableRoles,
        requiredPermissions,
        requiredRoles,
        permissionMode,
        roleMode,
        requireAuthentication,
        user: resolvedUser,
      }),
    [
      availablePermissions,
      availableRoles,
      requiredPermissions,
      requiredRoles,
      permissionMode,
      roleMode,
      requireAuthentication,
      resolvedUser,
    ],
  );
}

// ============================================================================
// Disabled Content
// ============================================================================

function DisabledContent({
  children,
  testId,
  reason,
  className,
  ariaLabel,
}) {
  return (
    <div
      className={[
        "permission-gate--disabled",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      data-component="titech-permission-gate"
      data-state="disabled"
      data-reason={reason}
      aria-disabled="true"
      aria-label={ariaLabel || undefined}
    >
      {children}
    </div>
  );
}

DisabledContent.propTypes = {
  children: PropTypes.node,
  testId: PropTypes.string.isRequired,
  reason: PropTypes.string.isRequired,
  className: PropTypes.string,
  ariaLabel: PropTypes.string,
};

// ============================================================================
// Permission Gate
// ============================================================================

function PermissionGate({
  children,

  user,

  permissions = [],
  requiredPermissions,

  roles = [],
  requiredRoles,

  permissionMode = MATCH_MODE.ANY,
  roleMode = MATCH_MODE.ANY,

  requireAll = false,
  requireAuthentication = false,

  fallback = null,
  fallbackMode = FALLBACK_MODE.HIDDEN,

  loading = false,
  loadingComponent = null,
  loadingFallback = null,

  disabled = false,
  disabledFallback = null,

  invert = false,

  className = "",
  ariaLabel = "",

  testId = DEFAULT_TEST_ID,

  debug = false,
  audit = false,

  onAllow,
  onDeny,
}) {
  const context = usePermissionContext();

  const resolvedUser =
    user !== undefined
      ? user
      : context.user;

  const resolvedAvailablePermissions =
    context.permissions.length > 0
      ? context.permissions
      : extractPermissions(resolvedUser);

  const resolvedAvailableRoles =
    context.roles.length > 0
      ? context.roles
      : extractRoles(resolvedUser);

  const resolvedRequiredPermissions =
    useMemo(
      () =>
        normalizeStringArray(
          requiredPermissions !== undefined
            ? requiredPermissions
            : permissions,
        ),
      [requiredPermissions, permissions],
    );

  const resolvedRequiredRoles =
    useMemo(
      () =>
        normalizeStringArray(
          requiredRoles !== undefined
            ? requiredRoles
            : roles,
        ),
      [requiredRoles, roles],
    );

  const normalizedPermissionMode =
    useMemo(
      () =>
        requireAll
          ? MATCH_MODE.ALL
          : normalizeMatchMode(
              permissionMode,
            ),
      [permissionMode, requireAll],
    );

  const normalizedRoleMode =
    useMemo(
      () =>
        requireAll
          ? MATCH_MODE.ALL
          : normalizeMatchMode(roleMode),
      [roleMode, requireAll],
    );

  const normalizedFallbackMode =
    normalizeFallbackMode(fallbackMode);

  const normalizedRequireAuthentication =
    normalizeBoolean(
      requireAuthentication,
      false,
    );

  const evaluation = useMemo(
    () =>
      evaluateRequirements({
        availablePermissions:
          resolvedAvailablePermissions,
        availableRoles:
          resolvedAvailableRoles,
        requiredPermissions:
          resolvedRequiredPermissions,
        requiredRoles:
          resolvedRequiredRoles,
        permissionMode:
          normalizedPermissionMode,
        roleMode:
          normalizedRoleMode,
        requireAuthentication:
          normalizedRequireAuthentication,
        user: resolvedUser,
      }),
    [
      resolvedAvailablePermissions,
      resolvedAvailableRoles,
      resolvedRequiredPermissions,
      resolvedRequiredRoles,
      normalizedPermissionMode,
      normalizedRoleMode,
      normalizedRequireAuthentication,
      resolvedUser,
    ],
  );

  const finalAllowed = invert
    ? !evaluation.allowed
    : evaluation.allowed;

  const previousResultRef = useRef(null);

  const emitAuthorizationEvent = useCallback(
    (allowed) => {
      if (
        previousResultRef.current === allowed
      ) {
        return;
      }

      previousResultRef.current = allowed;

      if (allowed) {
        onAllow?.();
      } else {
        onDeny?.();
      }

      if (
        (debug || audit) &&
        typeof console !== "undefined" &&
        typeof console.debug === "function"
      ) {
        console.debug(
          "[TITech PermissionGate]",
          {
            component: "PermissionGate",
            tenantId:
              context.tenantId || null,
            allowed,
            inverted: invert,
            reason: evaluation.reason,
            authenticated:
              evaluation.authenticated,
            permissionMatched:
              evaluation.permissionMatched,
            roleMatched:
              evaluation.roleMatched,
            requiredPermissions:
              resolvedRequiredPermissions,
            requiredRoles:
              resolvedRequiredRoles,
            permissionMode:
              normalizedPermissionMode,
            roleMode:
              normalizedRoleMode,
          },
        );
      }
    },
    [
      audit,
      context.tenantId,
      debug,
      evaluation,
      invert,
      normalizedPermissionMode,
      normalizedRoleMode,
      onAllow,
      onDeny,
      resolvedRequiredPermissions,
      resolvedRequiredRoles,
    ],
  );

  useEffect(() => {
    emitAuthorizationEvent(finalAllowed);
  }, [
    emitAuthorizationEvent,
    finalAllowed,
  ]);

  // ==========================================================================
  // Loading
  // ==========================================================================

  if (loading || context.loading) {
    const resolvedLoading =
      loadingFallback ??
      loadingComponent;

    if (!resolvedLoading) {
      return null;
    }

    return (
      <div
        className={className}
        data-testid={testId}
        data-component="titech-permission-gate"
        data-state="loading"
        aria-busy="true"
        aria-live="polite"
        aria-label={
          ariaLabel ||
          "Checking permissions"
        }
      >
        {resolvedLoading}
      </div>
    );
  }

  // ==========================================================================
  // Explicit Disabled State
  // ==========================================================================

  if (disabled && disabledFallback) {
    return (
      <DisabledContent
        testId={testId}
        reason="disabled"
        className={className}
        ariaLabel={ariaLabel}
      >
        {disabledFallback}
      </DisabledContent>
    );
  }

  // ==========================================================================
  // Unauthorized State
  // ==========================================================================

  if (!finalAllowed) {
    if (
      normalizedFallbackMode ===
      FALLBACK_MODE.FALLBACK
    ) {
      if (!fallback) {
        return null;
      }

      return (
        <div
          className={className}
          data-testid={testId}
          data-component="titech-permission-gate"
          data-state="fallback"
          data-authorized="false"
          data-reason={evaluation.reason}
          aria-label={
            ariaLabel ||
            "Access restricted"
          }
        >
          {fallback}
        </div>
      );
    }

    if (
      normalizedFallbackMode ===
      FALLBACK_MODE.DISABLED
    ) {
      if (!children) {
        return null;
      }

      return (
        <DisabledContent
          testId={testId}
          reason={evaluation.reason}
          className={className}
          ariaLabel={ariaLabel}
        >
          {children}
        </DisabledContent>
      );
    }

    return null;
  }

  // ==========================================================================
  // Authorized but Explicitly Disabled
  // ==========================================================================

  if (disabled) {
    return (
      <DisabledContent
        testId={testId}
        reason="disabled"
        className={className}
        ariaLabel={ariaLabel}
      >
        {children}
      </DisabledContent>
    );
  }

  // ==========================================================================
  // Authorized
  // ==========================================================================
  //
  // Avoid wrapping children unnecessarily. This is important for:
  //   - Flex/grid layouts
  //   - Tables
  //   - Lists
  //   - Form controls
  //   - Existing component CSS
  //
  // ==========================================================================

  return (
    <React.Fragment>
      {children}
    </React.Fragment>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

PermissionGate.propTypes = {
  children: PropTypes.node,

  user: PropTypes.object,

  permissions: PropTypes.oneOfType([
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

  roles: PropTypes.oneOfType([
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

  permissionMode: PropTypes.oneOf(
    Object.values(MATCH_MODE),
  ),

  roleMode: PropTypes.oneOf(
    Object.values(MATCH_MODE),
  ),

  requireAll: PropTypes.bool,

  requireAuthentication:
    PropTypes.bool,

  fallback: PropTypes.node,

  fallbackMode: PropTypes.oneOf(
    Object.values(FALLBACK_MODE),
  ),

  loading: PropTypes.bool,

  loadingComponent:
    PropTypes.node,

  loadingFallback:
    PropTypes.node,

  disabled: PropTypes.bool,

  disabledFallback:
    PropTypes.node,

  invert: PropTypes.bool,

  className: PropTypes.string,

  ariaLabel: PropTypes.string,

  testId: PropTypes.string,

  debug: PropTypes.bool,

  audit: PropTypes.bool,

  onAllow: PropTypes.func,

  onDeny: PropTypes.func,
};

// ============================================================================
// Static Metadata
// ============================================================================

PermissionGate.displayName =
  "TITechPermissionGate";

PermissionGate.MATCH_MODE =
  MATCH_MODE;

PermissionGate.FALLBACK_MODE =
  FALLBACK_MODE;

PermissionGate.PERMISSIONS =
  PERMISSIONS;

PermissionGate.ROLES =
  ROLES;

PermissionGate.PERMISSION =
  DEFAULT_PERMISSION_KEYS;

PermissionGate.ROLE =
  DEFAULT_ROLE_KEYS;

// ============================================================================
// Static Utility API
// ============================================================================

PermissionGate.normalizeString =
  normalizeString;

PermissionGate.normalizeStringArray =
  normalizeStringArray;

PermissionGate.extractPermissions =
  extractPermissions;

PermissionGate.extractRoles =
  extractRoles;

PermissionGate.evaluateRequirements =
  evaluateRequirements;

PermissionGate.hasPermission =
  hasPermission;

PermissionGate.hasRole = (
  role,
  roles = [],
) =>
  matchesValue(
    normalizeStringArray(roles),
    role,
  );

PermissionGate.hasAnyPermission = (
  permissions,
  userPermissions = [],
) =>
  normalizeStringArray(
    permissions,
  ).some((permission) =>
    hasPermission(
      permission,
      userPermissions,
    ),
  );

PermissionGate.hasAllPermissions = (
  permissions,
  userPermissions = [],
) =>
  normalizeStringArray(
    permissions,
  ).every((permission) =>
    hasPermission(
      permission,
      userPermissions,
    ),
  );

PermissionGate.hasAnyRole = (
  roles,
  userRoles = [],
) =>
  normalizeStringArray(roles).some(
    (role) =>
      matchesValue(
        normalizeStringArray(userRoles),
        role,
      ),
  );

PermissionGate.hasAllRoles = (
  roles,
  userRoles = [],
) =>
  normalizeStringArray(roles).every(
    (role) =>
      matchesValue(
        normalizeStringArray(userRoles),
        role,
      ),
  );

PermissionGate.filter = (
  items = [],
  key = "permission",
  permissions = [],
) =>
  items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    if (!item[key]) {
      return true;
    }

    return hasPermission(
      item[key],
      permissions,
    );
  });

PermissionGate.filterByRole = (
  items = [],
  key = "role",
  roles = [],
) =>
  items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    if (!item[key]) {
      return true;
    }

    return matchesValue(
      normalizeStringArray(roles),
      item[key],
    );
  });

// ============================================================================
// Higher-Order Component
// ============================================================================

export function withPermission(
  WrappedComponent,
  options = {},
) {
  if (
    typeof WrappedComponent !==
    "function"
  ) {
    throw new TypeError(
      "withPermission requires a valid React component.",
    );
  }

  function WithPermission(props) {
    return (
      <PermissionGate
        permissions={
          options.permissions
        }
        requiredPermissions={
          options.requiredPermissions
        }
        roles={options.roles}
        requiredRoles={
          options.requiredRoles
        }
        permissionMode={
          options.permissionMode
        }
        roleMode={
          options.roleMode
        }
        requireAll={
          options.requireAll
        }
        requireAuthentication={
          options.requireAuthentication
        }
        fallback={
          options.fallback
        }
        fallbackMode={
          options.fallbackMode
        }
        loading={
          options.loading
        }
        loadingFallback={
          options.loadingFallback
        }
        disabled={
          options.disabled
        }
        disabledFallback={
          options.disabledFallback
        }
        debug={
          options.debug
        }
        audit={
          options.audit
        }
        testId={
          options.testId
        }
      >
        <WrappedComponent {...props} />
      </PermissionGate>
    );
  }

  const componentName =
    WrappedComponent.displayName ||
    WrappedComponent.name ||
    "Component";

  WithPermission.displayName =
    `withPermission(${componentName})`;

  return memo(WithPermission);
}

// ============================================================================
// Exported Helpers
// ============================================================================

export {
  extractPermissions,
  extractRoles,
  hasPermission,
  matchesValue,
  normalizeKey,
  normalizeString,
  normalizeStringArray,
};

// ============================================================================
// Export
// ============================================================================

export default memo(PermissionGate);