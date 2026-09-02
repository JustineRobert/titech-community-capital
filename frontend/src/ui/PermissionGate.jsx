// ============================================================================
// TITech Community Capital
// Enterprise PermissionGate Component
// File: src/components/ui/PermissionGate.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Permission Helpers
// ============================================================================

function normalizeArray(
  value
) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

function hasAnyPermission(
  userPermissions = [],
  requiredPermissions = []
) {
  if (
    requiredPermissions.length ===
    0
  ) {
    return true;
  }

  return requiredPermissions.some(
    (permission) =>
      userPermissions.includes(
        permission
      )
  );
}

function hasAllPermissions(
  userPermissions = [],
  requiredPermissions = []
) {
  if (
    requiredPermissions.length ===
    0
  ) {
    return true;
  }

  return requiredPermissions.every(
    (permission) =>
      userPermissions.includes(
        permission
      )
  );
}

function hasRole(
  userRoles = [],
  allowedRoles = []
) {
  if (
    allowedRoles.length === 0
  ) {
    return true;
  }

  return allowedRoles.some(
    (role) =>
      userRoles.includes(role)
  );
}

// ============================================================================
// Component
// ============================================================================

function PermissionGate({
  user,
  permissions,
  roles,
  requireAll = false,
  requireAuthenticated = true,
  fallback = null,
  children,
}) {
  const authorized =
    useMemo(() => {
      // --------------------------------------------------------
      // Public access
      // --------------------------------------------------------

      if (
        !requireAuthenticated
      ) {
        return true;
      }

      if (!user) {
        return false;
      }

      const userPermissions =
        normalizeArray(
          user.permissions
        );

      const userRoles =
        normalizeArray(
          user.roles ||
            user.role
        );

      const requiredPermissions =
        normalizeArray(
          permissions
        );

      const requiredRoles =
        normalizeArray(
          roles
        );

      const permissionCheck =
        requireAll
          ? hasAllPermissions(
              userPermissions,
              requiredPermissions
            )
          : hasAnyPermission(
              userPermissions,
              requiredPermissions
            );

      const roleCheck =
        hasRole(
          userRoles,
          requiredRoles
        );

      return (
        permissionCheck &&
        roleCheck
      );
    }, [
      user,
      permissions,
      roles,
      requireAll,
      requireAuthenticated,
    ]);

  if (!authorized) {
    return fallback;
  }

  return children;
}

// ============================================================================
// PropTypes
// ============================================================================

PermissionGate.propTypes =
  {
    user:
      PropTypes.object,

    permissions:
      PropTypes.oneOfType(
        [
          PropTypes.string,
          PropTypes.arrayOf(
            PropTypes.string
          ),
        ]
      ),

    roles:
      PropTypes.oneOfType(
        [
          PropTypes.string,
          PropTypes.arrayOf(
            PropTypes.string
          ),
        ]
      ),

    requireAll:
      PropTypes.bool,

    requireAuthenticated:
      PropTypes.bool,

    fallback:
      PropTypes.node,

    children:
      PropTypes.node
        .isRequired,
  };

// ============================================================================
// Permission Hook
// ============================================================================

export function usePermission(
  user,
  permissions = [],
  options = {}
) {
  const {
    requireAll = false,
  } = options;

  const userPermissions =
    normalizeArray(
      user?.permissions
    );

  const required =
    normalizeArray(
      permissions
    );

  if (
    requireAll
  ) {
    return hasAllPermissions(
      userPermissions,
      required
    );
  }

  return hasAnyPermission(
    userPermissions,
    required
  );
}

// ============================================================================
// Role Hook
// ============================================================================

export function useRole(
  user,
  roles = []
) {
  const userRoles =
    normalizeArray(
      user?.roles ||
        user?.role
    );

  const required =
    normalizeArray(
      roles
    );

  return hasRole(
    userRoles,
    required
  );
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  PermissionGate
);