'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Administrative Route Guard
 * ============================================================================
 *
 * File:
 *   frontend/src/components/AdminRoute.jsx
 *
 * Purpose:
 *   Production-grade frontend authorization boundary for TITech administrative
 *   and privileged application routes.
 *
 * Compatible with:
 *   React Router v6+
 *
 * Responsibilities:
 *   - Authentication protection
 *   - Administrative role authorization
 *   - Multi-role authorization
 *   - Permission authorization
 *   - Tenant-aware authorization
 *   - Account status validation
 *   - Authentication/authorization loading states
 *   - Login / forbidden / tenant redirects
 *   - Return-location preservation
 *   - Child-component support
 *   - React Router <Outlet /> support
 *   - Custom state presentation
 *   - Imperative ref API
 *   - Defensive user/permission normalization
 *   - Stable test selectors
 *   - Accessibility
 *
 * IMPORTANT SECURITY BOUNDARY
 * ----------------------------------------------------------------------------
 * This component is a frontend navigation/UX authorization layer.
 *
 * It is NOT a security boundary.
 *
 * TITech backend/API services MUST independently enforce:
 *   - authentication
 *   - authorization
 *   - tenant isolation
 *   - role permissions
 *   - privileged operation controls
 *   - financial authorization
 *   - audit requirements
 *
 * Never trust this component to secure an API or financial operation.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import {
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_LOGIN_PATH = '/login';

const DEFAULT_UNAUTHORIZED_PATH = '/unauthorized';

const DEFAULT_FORBIDDEN_PATH = '/forbidden';

const DEFAULT_TENANT_MISMATCH_PATH =
  '/tenant-access-denied';

const DEFAULT_ADMIN_ROLES = Object.freeze([
  'admin',
  'administrator',
  'super_admin',
  'superadmin',
  'tenant_admin',
  'platform_admin',
  'system_admin',
]);

const DEFAULT_ACTIVE_ACCOUNT_STATUSES = Object.freeze([
  'active',
  'verified',
  'enabled',
]);

const DEFAULT_DENIED_ACCOUNT_STATUSES = Object.freeze([
  'suspended',
  'disabled',
  'blocked',
  'deactivated',
  'locked',
]);

const DEFAULT_TEST_ID =
  'titech-admin-route';

const MAX_RETURN_LOCATION_LENGTH = 2048;

/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');

const safeText = (
  value,
  fallback = '',
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    return (
      String(value).trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
};

const normalizeStringList = (
  value,
) => {
  if (
    Array.isArray(value)
  ) {
    return [
      ...new Set(
        value
          .map(
            (item) =>
              safeText(
                item,
              ).toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];
  }

  if (
    typeof value === 'string'
  ) {
    return [
      ...new Set(
        value
          .split(',')
          .map(
            (item) =>
              safeText(
                item,
              ).toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];
  }

  return [];
};

const getUserId = (
  user,
) =>
  user?.id ??
  user?.userId ??
  user?.uuid ??
  null;

const getUserRoles = (
  user,
) => {
  const roles = [];

  if (
    Array.isArray(
      user?.roles,
    )
  ) {
    roles.push(
      ...user.roles,
    );
  }

  if (
    user?.role !==
    undefined &&
    user?.role !==
    null
  ) {
    roles.push(
      user.role,
    );
  }

  if (
    user?.userRole !==
    undefined &&
    user?.userRole !==
    null
  ) {
    roles.push(
      user.userRole,
    );
  }

  return normalizeStringList(
    roles,
  );
};

const getUserPermissions = (
  user,
) => {
  const permissions = [];

  if (
    Array.isArray(
      user?.permissions,
    )
  ) {
    permissions.push(
      ...user.permissions,
    );
  }

  if (
    Array.isArray(
      user?.permissionCodes,
    )
  ) {
    permissions.push(
      ...user.permissionCodes,
    );
  }

  return normalizeStringList(
    permissions,
  );
};

const getUserTenantIds = (
  user,
) => {
  const tenantIds = [];

  if (
    user?.tenantId !==
    undefined &&
    user?.tenantId !==
    null
  ) {
    tenantIds.push(
      user.tenantId,
    );
  }

  if (
    Array.isArray(
      user?.tenantIds,
    )
  ) {
    tenantIds.push(
      ...user.tenantIds,
    );
  }

  if (
    Array.isArray(
      user?.tenants,
    )
  ) {
    user.tenants.forEach(
      (tenant) => {
        if (
          tenant?.id !==
            undefined &&
          tenant?.id !==
            null
        ) {
          tenantIds.push(
            tenant.id,
          );
        }

        if (
          tenant?.tenantId !==
            undefined &&
          tenant?.tenantId !==
            null
        ) {
          tenantIds.push(
            tenant.tenantId,
          );
        }
      },
    );
  }

  return [
    ...new Set(
      tenantIds
        .filter(
          (id) =>
            id !==
              null &&
            id !==
              undefined &&
            String(
              id,
            ).trim() !==
              '',
        )
        .map(
          (id) =>
            String(
              id,
            ),
        ),
    ),
  ];
};

const getTenantId = (
  tenant,
) =>
  tenant?.id ??
  tenant?.tenantId ??
  tenant?.uuid ??
  null;

const normalizeStatus = (
  value,
) =>
  safeText(
    value,
  ).toLowerCase();

const getAccountStatus = (
  user,
) =>
  normalizeStatus(
    user?.status ??
      user?.accountStatus ??
      user?.state ??
      'active',
  );

const hasRequiredRole = ({
  userRoles,
  requiredRoles,
  requireAllRoles,
}) => {
  if (
    requiredRoles.length ===
    0
  ) {
    return true;
  }

  if (
    requireAllRoles
  ) {
    return requiredRoles.every(
      (role) =>
        userRoles.includes(
          role,
        ),
    );
  }

  return requiredRoles.some(
    (role) =>
      userRoles.includes(
        role,
      ),
  );
};

const hasRequiredPermissions = ({
  userPermissions,
  requiredPermissions,
  requireAllPermissions,
}) => {
  if (
    requiredPermissions.length ===
    0
  ) {
    return true;
  }

  if (
    requireAllPermissions
  ) {
    return requiredPermissions.every(
      (permission) =>
        userPermissions.includes(
          permission,
        ),
    );
  }

  return requiredPermissions.some(
    (permission) =>
      userPermissions.includes(
        permission,
      ),
  );
};

const resolveTenantAuthorization = ({
  user,
  tenant,
  allowedTenantIds,
  requiredTenantId,
  requireTenant,
}) => {
  if (
    !requireTenant
  ) {
    return {
      valid: true,
      reason:
        'tenant-not-required',
    };
  }

  const activeTenantId =
    getTenantId(
      tenant,
    );

  if (
    activeTenantId ===
      null ||
    activeTenantId ===
      undefined ||
    String(
      activeTenantId,
    ).trim() ===
      ''
  ) {
    return {
      valid: false,
      reason:
        'missing-tenant',
    };
  }

  const normalizedAllowedTenantIds = [
    ...new Set([
      ...normalizeStringList(
        allowedTenantIds,
      ),
      ...getUserTenantIds(
        user,
      ),
    ]),
  ];

  if (
    requiredTenantId !==
      null &&
    requiredTenantId !==
      undefined
  ) {
    if (
      String(
        requiredTenantId,
      ) !==
      String(
        activeTenantId,
      )
    ) {
      return {
        valid: false,
        reason:
          'required-tenant-mismatch',
      };
    }
  }

  if (
    normalizedAllowedTenantIds.length ===
    0
  ) {
    return {
      valid: true,
      reason:
        'no-tenant-list',
    };
  }

  const valid =
    normalizedAllowedTenantIds.includes(
      String(
        activeTenantId,
      ),
    );

  return {
    valid,
    reason:
      valid
        ? 'tenant-authorized'
        : 'tenant-mismatch',
  };
};

const buildReturnLocation = ({
  location,
  enabled,
  includeSearch,
  includeHash,
}) => {
  if (
    !enabled
  ) {
    return null;
  }

  const pathname =
    safeText(
      location?.pathname,
      '/',
    );

  const search =
    includeSearch
      ? safeText(
          location?.search,
        )
      : '';

  const hash =
    includeHash
      ? safeText(
          location?.hash,
        )
      : '';

  const result =
    `${pathname}${search}${hash}`;

  return result.length >
    MAX_RETURN_LOCATION_LENGTH
    ? result.slice(
        0,
        MAX_RETURN_LOCATION_LENGTH,
      )
    : result;
};

/* ============================================================================
 * Built-in icons
 * ========================================================================== */

const Spinner = ({
  size = 24,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 2v4" />
    <path d="m16.24 3.76-2.83 2.83" />
    <path d="M22 12h-4" />
    <path d="m20.24 16.24-2.83-2.83" />
    <path d="M12 22v-4" />
    <path d="m7.76 20.24 2.83-2.83" />
    <path d="M2 12H6" />
    <path d="m3.76 7.76 2.83 2.83" />
  </svg>
);

Spinner.propTypes = {
  size:
    PropTypes.number,
};

const ShieldIcon = ({
  size = 48,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3 5 6v5c0 4.8 2.9 8.6 7 10 4.1-1.4 7-5.2 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

ShieldIcon.propTypes = {
  size:
    PropTypes.number,
};

const LockIcon = ({
  size = 48,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect
      x="4"
      y="10"
      width="16"
      height="11"
      rx="2"
    />

    <path d="M8 10V7a4 4 0 0 1 8 0v3" />

    <path d="M12 14v3" />
  </svg>
);

LockIcon.propTypes = {
  size:
    PropTypes.number,
};

const BuildingIcon = ({
  size = 48,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" />
    <path d="M2 21h20" />
    <path d="M8 7h2" />
    <path d="M14 7h2" />
    <path d="M8 11h2" />
    <path d="M14 11h2" />
    <path d="M8 15h2" />
    <path d="M14 15h2" />
  </svg>
);

BuildingIcon.propTypes = {
  size:
    PropTypes.number,
};

/* ============================================================================
 * Built-in state presentation
 * ========================================================================== */

const GuardState = ({
  type,
  title,
  message,
  actionLabel,
  onAction,
  testId,
}) => {
  let icon;

  switch (
    type
  ) {
    case 'loading':
      icon = (
        <Spinner
          size={30}
        />
      );
      break;

    case 'tenant':
    case 'account-disabled':
      icon = (
        <BuildingIcon />
      );
      break;

    case 'unauthenticated':
      icon = (
        <LockIcon />
      );
      break;

    default:
      icon = (
        <ShieldIcon />
      );
  }

  return (
    <section
      className={cn(
        'titech-admin-route-state',
        `titech-admin-route-state--${type}`,
      )}
      role={
        type ===
        'loading'
          ? 'status'
          : 'alert'
      }
      aria-live={
        type ===
        'loading'
          ? 'polite'
          : 'assertive'
      }
      aria-label={
        title
      }
      data-testid={
        testId
      }
    >
      <div className="titech-admin-route-state__content">

        <div
          className="titech-admin-route-state__icon"
          aria-hidden="true"
        >
          {icon}
        </div>

        <h1 className="titech-admin-route-state__title">
          {title}
        </h1>

        <p className="titech-admin-route-state__message">
          {message}
        </p>

        {actionLabel &&
        typeof onAction ===
          'function' ? (
          <button
            type="button"
            className="titech-admin-route-state__action"
            onClick={
              onAction
            }
          >
            {actionLabel}
          </button>
        ) : null}

      </div>
    </section>
  );
};

GuardState.propTypes = {
  type:
    PropTypes.string.isRequired,

  title:
    PropTypes.string.isRequired,

  message:
    PropTypes.string.isRequired,

  actionLabel:
    PropTypes.string,

  onAction:
    PropTypes.func,

  testId:
    PropTypes.string.isRequired,
};

/* ============================================================================
 * AdminRoute
 * ========================================================================== */

const AdminRoute =
  forwardRef(
    function AdminRoute(
      props,
      forwardedRef,
    ) {
      const {
        children,

        user,

        isAuthenticated,

        authLoading =
          false,

        authorizationLoading =
          false,

        loading,

        requiredRoles =
          DEFAULT_ADMIN_ROLES,

        roles,

        requiredPermissions =
          [],

        permissions,

        requireAllRoles =
          false,

        requireAllPermissions =
          false,

        requireAuthenticated =
          true,

        requireTenant =
          false,

        tenant =
          null,

        allowedTenantIds =
          [],

        requiredTenantId,

        tenantValidator,

        accountStatuses =
          DEFAULT_ACTIVE_ACCOUNT_STATUSES,

        deniedAccountStatuses =
          DEFAULT_DENIED_ACCOUNT_STATUSES,

        allowPrivilegedClaim =
          false,

        privilegedClaimKeys =
          [
            'isAdmin',
            'isAdministrator',
            'isSuperAdmin',
            'isPlatformAdmin',
          ],

        loginPath =
          DEFAULT_LOGIN_PATH,

        unauthorizedPath =
          DEFAULT_UNAUTHORIZED_PATH,

        forbiddenPath =
          DEFAULT_FORBIDDEN_PATH,

        tenantMismatchPath =
          DEFAULT_TENANT_MISMATCH_PATH,

        preserveReturnLocation =
          true,

        replaceNavigation =
          true,

        includeSearchInReturnLocation =
          true,

        includeHashInReturnLocation =
          true,

        redirectState = {},

        onUnauthorized,

        onForbidden,

        onTenantMismatch,

        onAuthenticated,

        onAuthorizationDenied,

        onLoading,

        loadingComponent,

        unauthorizedComponent,

        forbiddenComponent,

        tenantMismatchComponent,

        accountDisabledComponent,

        className =
          '',

        testId =
          DEFAULT_TEST_ID,

        /**
         * IMPORTANT:
         * false is the compatibility default because your existing
         * AdminLayout passes protected content as children.
         *
         * Set true only when AdminRoute is used as a nested route layout
         * containing React Router <Outlet />.
         */
        renderOutlet =
          false,

        ...rest
      } = props;

      const generatedId =
        useId();

      const rootRef =
        useRef(null);

      const location =
        useLocation();

      /* ======================================================================
       * Authentication state
       * ==================================================================== */

      const resolvedAuthLoading =
        Boolean(
          authLoading ||
            authorizationLoading ||
            loading,
        );

      const resolvedIsAuthenticated =
        Boolean(
          isAuthenticated ??
            (
              user !==
                null &&
              user !==
                undefined
            ),
        );

      /* ======================================================================
       * Normalize authorization inputs
       * ==================================================================== */

      const resolvedRequiredRoles =
        useMemo(
          () =>
            normalizeStringList(
              roles ??
                requiredRoles,
            ),
          [
            requiredRoles,
            roles,
          ],
        );

      const resolvedRequiredPermissions =
        useMemo(
          () =>
            normalizeStringList(
              permissions ??
                requiredPermissions,
            ),
          [
            permissions,
            requiredPermissions,
          ],
        );

      const resolvedAccountStatuses =
        useMemo(
          () =>
            normalizeStringList(
              accountStatuses,
            ),
          [
            accountStatuses,
          ],
        );

      const resolvedDeniedAccountStatuses =
        useMemo(
          () =>
            normalizeStringList(
              deniedAccountStatuses,
            ),
          [
            deniedAccountStatuses,
          ],
        );

      const userRoles =
        useMemo(
          () =>
            getUserRoles(
              user,
            ),
          [
            user,
          ],
        );

      const userPermissions =
        useMemo(
          () =>
            getUserPermissions(
              user,
            ),
          [
            user,
          ],
        );

      const userTenantIds =
        useMemo(
          () =>
            getUserTenantIds(
              user,
            ),
          [
            user,
          ],
        );

      const accountStatus =
        getAccountStatus(
          user,
        );

      const activeTenantId =
        getTenantId(
          tenant,
        );

      /* ======================================================================
       * Account authorization
       * ==================================================================== */

      const explicitlyDeniedAccount =
        resolvedDeniedAccountStatuses.includes(
          accountStatus,
        );

      const accountStatusAllowed =
        !explicitlyDeniedAccount &&
        (
          resolvedAccountStatuses.length ===
            0 ||
          resolvedAccountStatuses.includes(
            accountStatus,
          )
        );

      /* ======================================================================
       * Role authorization
       * ==================================================================== */

      const roleAuthorized =
        hasRequiredRole({
          userRoles,
          requiredRoles:
            resolvedRequiredRoles,
          requireAllRoles,
        });

      /* ======================================================================
       * Permission authorization
       * ==================================================================== */

      const permissionAuthorized =
        hasRequiredPermissions({
          userPermissions,
          requiredPermissions:
            resolvedRequiredPermissions,
          requireAllPermissions,
        });

      /* ======================================================================
       * Optional privileged claim authorization
       * ==================================================================== */

      const privilegedClaimAuthorized =
        Boolean(
          allowPrivilegedClaim &&
            privilegedClaimKeys.some(
              (key) =>
                user?.[key] ===
                true,
            ),
        );

      const authorizationSatisfied =
        privilegedClaimAuthorized ||
        (
          roleAuthorized &&
          permissionAuthorized
        );

      /* ======================================================================
       * Tenant authorization
       * ==================================================================== */

      const tenantAuthorization =
        useMemo(
          () =>
            resolveTenantAuthorization({
              user,
              tenant,
              allowedTenantIds,
              requiredTenantId,
              requireTenant,
            }),
          [
            allowedTenantIds,
            requiredTenantId,
            requireTenant,
            tenant,
            user,
          ],
        );

      const customTenantAuthorization =
        useMemo(
          () => {
            if (
              typeof tenantValidator !==
              'function'
            ) {
              return true;
            }

            try {
              return tenantValidator({
                user,
                tenant,
                tenantId:
                  activeTenantId,
                userTenantIds,
                location,
              }) !== false;
            } catch (
              validatorError
            ) {
              if (
                process.env?.NODE_ENV ===
                'development'
              ) {
                // eslint-disable-next-line no-console
                console.error(
                  '[TITech AdminRoute] tenantValidator failed:',
                  validatorError,
                );
              }

              /**
               * Fail closed if the custom validator itself fails.
               */
              return false;
            }
          },
          [
            activeTenantId,
            location,
            tenant,
            tenantValidator,
            user,
            userTenantIds,
          ],
        );

      const tenantAuthorized =
        tenantAuthorization.valid &&
        customTenantAuthorization;

      /* ======================================================================
       * Determine final access state
       * ==================================================================== */

      let accessState =
        'loading';

      if (
        !resolvedAuthLoading
      ) {
        if (
          requireAuthenticated &&
          !resolvedIsAuthenticated
        ) {
          accessState =
            'unauthenticated';
        } else if (
          !accountStatusAllowed
        ) {
          accessState =
            'account-disabled';
        } else if (
          requireTenant &&
          !tenantAuthorized
        ) {
          accessState =
            'tenant-mismatch';
        } else if (
          !authorizationSatisfied
        ) {
          accessState =
            'forbidden';
        } else {
          accessState =
            'authorized';
        }
      }

      /* ======================================================================
       * Stable return location
       * ==================================================================== */

      const returnLocation =
        useMemo(
          () =>
            buildReturnLocation({
              location,

              enabled:
                preserveReturnLocation,

              includeSearch:
                includeSearchInReturnLocation,

              includeHash:
                includeHashInReturnLocation,
            }),
          [
            includeHashInReturnLocation,
            includeSearchInReturnLocation,
            location.hash,
            location.pathname,
            location.search,
            preserveReturnLocation,
          ],
        );

      /* ======================================================================
       * Navigation state
       * ==================================================================== */

      const loginNavigationState =
        useMemo(
          () => ({
            ...redirectState,

            returnTo:
              returnLocation,

            from:
              returnLocation,

            reason:
              'authentication-required',
          }),
          [
            redirectState,
            returnLocation,
          ],
        );

      const forbiddenNavigationState =
        useMemo(
          () => ({
            ...redirectState,

            from:
              returnLocation,

            reason:
              'insufficient-privileges',
          }),
          [
            redirectState,
            returnLocation,
          ],
        );

      const tenantNavigationState =
        useMemo(
          () => ({
            ...redirectState,

            from:
              returnLocation,

            tenantId:
              activeTenantId ??
              null,

            requiredTenantId:
              requiredTenantId ??
              null,

            reason:
              'tenant-mismatch',
          }),
          [
            activeTenantId,
            redirectState,
            requiredTenantId,
            returnLocation,
          ],
        );

      /* ======================================================================
       * Imperative API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          getAccessState:
            () =>
              accessState,

          isAuthorized:
            () =>
              accessState ===
              'authorized',

          isAuthenticated:
            () =>
              resolvedIsAuthenticated,

          getUserId:
            () =>
              getUserId(
                user,
              ),

          getUserRoles:
            () =>
              [...userRoles],

          getUserPermissions:
            () =>
              [...userPermissions],

          getTenantId:
            () =>
              activeTenantId,

          getLocation:
            () => ({
              pathname:
                location.pathname,

              search:
                location.search,

              hash:
                location.hash,
            }),

          focus:
            () =>
              rootRef.current?.focus(),

          getAuthorizationSnapshot:
            () => ({
              accessState,

              authenticated:
                resolvedIsAuthenticated,

              accountStatus,

              tenantAuthorized,

              roleAuthorized,

              permissionAuthorized,

              userId:
                getUserId(
                  user,
                ),

              tenantId:
                activeTenantId,

              generatedId,
            }),
        }),
        [
          accessState,
          accountStatus,
          activeTenantId,
          generatedId,
          location.hash,
          location.pathname,
          location.search,
          permissionAuthorized,
          resolvedIsAuthenticated,
          roleAuthorized,
          tenantAuthorized,
          user,
          userPermissions,
          userRoles,
        ],
      );

      /* ======================================================================
       * Authorization lifecycle callbacks
       *
       * IMPORTANT:
       * Never perform external callbacks during render.
       * ==================================================================== */

      const previousAccessStateRef =
        useRef(
          null,
        );

      useEffect(
        () => {
          if (
            previousAccessStateRef.current ===
            accessState
          ) {
            return;
          }

          previousAccessStateRef.current =
            accessState;

          const payload = {
            accessState,

            user,

            tenant,

            location,

            userId:
              getUserId(
                user,
              ),

            tenantId:
              activeTenantId,
          };

          try {
            switch (
              accessState
            ) {
              case 'authorized':
                onAuthenticated?.(
                  payload,
                );
                break;

              case 'unauthenticated':
                onUnauthorized?.(
                  payload,
                );

                onAuthorizationDenied?.({
                  ...payload,
                  reason:
                    'authentication-required',
                });
                break;

              case 'forbidden':
                onForbidden?.(
                  payload,
                );

                onAuthorizationDenied?.({
                  ...payload,
                  reason:
                    'insufficient-privileges',
                });
                break;

              case 'tenant-mismatch':
                onTenantMismatch?.(
                  payload,
                );

                onAuthorizationDenied?.({
                  ...payload,
                  reason:
                    'tenant-mismatch',
                });
                break;

              case 'account-disabled':
                onAuthorizationDenied?.({
                  ...payload,
                  reason:
                    'account-disabled',
                });
                break;

              case 'loading':
                onLoading?.(
                  payload,
                );
                break;

              default:
                break;
            }
          } catch (
            callbackError
          ) {
            if (
              process.env?.NODE_ENV ===
              'development'
            ) {
              // eslint-disable-next-line no-console
              console.error(
                '[TITech AdminRoute] authorization callback failed:',
                callbackError,
              );
            }
          }
        },
        [
          accessState,
          activeTenantId,
          location,
          onAuthenticated,
          onAuthorizationDenied,
          onForbidden,
          onLoading,
          onTenantMismatch,
          onUnauthorized,
          tenant,
          user,
        ],
      );

      /* ======================================================================
       * Common root properties
       * ==================================================================== */

      const rootClassName =
        cn(
          'titech-admin-route',
          `titech-admin-route--${accessState}`,
          className,
        );

      const rootProps = {
        ...rest,

        ref:
          rootRef,

        className:
          rootClassName,

        tabIndex:
          -1,

        'data-testid':
          testId,

        'data-authorization-state':
          accessState,

        'data-route-instance':
          generatedId,
      };

      /* ======================================================================
       * Loading
       * ==================================================================== */

      if (
        accessState ===
        'loading'
      ) {
        if (
          loadingComponent !==
          undefined &&
          loadingComponent !==
          null
        ) {
          return (
            <div
              {...rootProps}
            >
              {typeof loadingComponent ===
              'function'
                ? loadingComponent({
                    user,
                    tenant,
                    location,
                  })
                : loadingComponent}
            </div>
          );
        }

        return (
          <div
            {...rootProps}
          >
            <GuardState
              type="loading"
              title="Checking TITech access"
              message="Verifying your authenticated administrative session…"
              testId={`${testId}-loading`}
            />
          </div>
        );
      }

      /* ======================================================================
       * Unauthenticated
       * ==================================================================== */

      if (
        accessState ===
        'unauthenticated'
      ) {
        if (
          unauthorizedComponent !==
          undefined &&
          unauthorizedComponent !==
          null
        ) {
          return (
            <div
              {...rootProps}
            >
              {typeof unauthorizedComponent ===
              'function'
                ? unauthorizedComponent({
                    user,
                    tenant,
                    location,
                  })
                : unauthorizedComponent}
            </div>
          );
        }

        return (
          <Navigate
            to={
              loginPath
            }
            replace={
              replaceNavigation
            }
            state={
              loginNavigationState
            }
          />
        );
      }

      /* ======================================================================
       * Account disabled / suspended
       * ==================================================================== */

      if (
        accessState ===
        'account-disabled'
      ) {
        if (
          accountDisabledComponent !==
          undefined &&
          accountDisabledComponent !==
          null
        ) {
          return (
            <div
              {...rootProps}
            >
              {typeof accountDisabledComponent ===
              'function'
                ? accountDisabledComponent({
                    user,
                    tenant,
                    location,
                  })
                : accountDisabledComponent}
            </div>
          );
        }

        return (
          <div
            {...rootProps}
          >
            <GuardState
              type="account-disabled"
              title="TITech account unavailable"
              message="Your account is currently unavailable for administrative access. Please contact an authorized TITech administrator."
              testId={`${testId}-account-disabled`}
            />
          </div>
        );
      }

      /* ======================================================================
       * Tenant mismatch
       * ==================================================================== */

      if (
        accessState ===
        'tenant-mismatch'
      ) {
        if (
          tenantMismatchComponent !==
          undefined &&
          tenantMismatchComponent !==
          null
        ) {
          return (
            <div
              {...rootProps}
            >
              {typeof tenantMismatchComponent ===
              'function'
                ? tenantMismatchComponent({
                    user,
                    tenant,
                    location,
                  })
                : tenantMismatchComponent}
            </div>
          );
        }

        if (
          tenantMismatchPath
        ) {
          return (
            <Navigate
              to={
                tenantMismatchPath
              }
              replace={
                replaceNavigation
              }
              state={
                tenantNavigationState
              }
            />
          );
        }

        return (
          <div
            {...rootProps}
          >
            <GuardState
              type="tenant"
              title="Tenant access denied"
              message="Your current TITech tenant context does not permit access to this administrative area."
              testId={`${testId}-tenant-mismatch`}
            />
          </div>
        );
      }

      /* ======================================================================
       * Forbidden
       * ==================================================================== */

      if (
        accessState ===
        'forbidden'
      ) {
        if (
          forbiddenComponent !==
          undefined &&
          forbiddenComponent !==
          null
        ) {
          return (
            <div
              {...rootProps}
            >
              {typeof forbiddenComponent ===
              'function'
                ? forbiddenComponent({
                    user,
                    tenant,
                    location,
                  })
                : forbiddenComponent}
            </div>
          );
        }

        if (
          forbiddenPath
        ) {
          return (
            <Navigate
              to={
                forbiddenPath
              }
              replace={
                replaceNavigation
              }
              state={
                forbiddenNavigationState
              }
            />
          );
        }

        return (
          <div
            {...rootProps}
          >
            <GuardState
              type="forbidden"
              title="Administrative access denied"
              message="Your TITech account does not have the required administrative role or permission for this area."
              testId={`${testId}-forbidden`}
            />
          </div>
        );
      }

      /* ======================================================================
       * Authorized
       * ==================================================================== */

      if (
        renderOutlet
      ) {
        return (
          <div
            {...rootProps}
            data-authorized="true"
            data-user-id={
              getUserId(
                user,
              ) ??
              undefined
            }
            data-tenant-id={
              activeTenantId ??
              undefined
            }
          >
            <Outlet />
          </div>
        );
      }

      return (
        <div
          {...rootProps}
          data-authorized="true"
          data-user-id={
            getUserId(
              user,
            ) ??
            undefined
          }
          data-tenant-id={
            activeTenantId ??
            undefined
          }
        >
          {children}
        </div>
      );
    },
  );

/* ============================================================================
 * Component metadata
 * ========================================================================== */

AdminRoute.displayName =
  'TITechAdminRoute';

/* ============================================================================
 * PropTypes
 * ========================================================================== */

AdminRoute.propTypes = {
  children:
    PropTypes.node,

  user:
    PropTypes.object,

  isAuthenticated:
    PropTypes.bool,

  authLoading:
    PropTypes.bool,

  authorizationLoading:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  requiredRoles:
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

  requiredPermissions:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  permissions:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  requireAllRoles:
    PropTypes.bool,

  requireAllPermissions:
    PropTypes.bool,

  requireAuthenticated:
    PropTypes.bool,

  requireTenant:
    PropTypes.bool,

  tenant:
    PropTypes.object,

  allowedTenantIds:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
      ),
    ]),

  requiredTenantId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  tenantValidator:
    PropTypes.func,

  accountStatuses:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  deniedAccountStatuses:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  allowPrivilegedClaim:
    PropTypes.bool,

  privilegedClaimKeys:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  loginPath:
    PropTypes.string,

  unauthorizedPath:
    PropTypes.string,

  forbiddenPath:
    PropTypes.string,

  tenantMismatchPath:
    PropTypes.string,

  preserveReturnLocation:
    PropTypes.bool,

  replaceNavigation:
    PropTypes.bool,

  includeSearchInReturnLocation:
    PropTypes.bool,

  includeHashInReturnLocation:
    PropTypes.bool,

  redirectState:
    PropTypes.object,

  onUnauthorized:
    PropTypes.func,

  onForbidden:
    PropTypes.func,

  onTenantMismatch:
    PropTypes.func,

  onAuthenticated:
    PropTypes.func,

  onAuthorizationDenied:
    PropTypes.func,

  onLoading:
    PropTypes.func,

  loadingComponent:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  unauthorizedComponent:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  forbiddenComponent:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  tenantMismatchComponent:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  accountDisabledComponent:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  renderOutlet:
    PropTypes.bool,
};

/* ============================================================================
 * Defaults
 * ========================================================================== */

AdminRoute.defaultProps = {
  children:
    undefined,

  user:
    null,

  isAuthenticated:
    undefined,

  authLoading:
    false,

  authorizationLoading:
    false,

  loading:
    false,

  requiredRoles:
    DEFAULT_ADMIN_ROLES,

  roles:
    undefined,

  requiredPermissions:
    [],

  permissions:
    undefined,

  requireAllRoles:
    false,

  requireAllPermissions:
    false,

  requireAuthenticated:
    true,

  requireTenant:
    false,

  tenant:
    null,

  allowedTenantIds:
    [],

  requiredTenantId:
    undefined,

  tenantValidator:
    undefined,

  accountStatuses:
    DEFAULT_ACTIVE_ACCOUNT_STATUSES,

  deniedAccountStatuses:
    DEFAULT_DENIED_ACCOUNT_STATUSES,

  allowPrivilegedClaim:
    false,

  privilegedClaimKeys:
    [
      'isAdmin',
      'isAdministrator',
      'isSuperAdmin',
      'isPlatformAdmin',
    ],

  loginPath:
    DEFAULT_LOGIN_PATH,

  unauthorizedPath:
    DEFAULT_UNAUTHORIZED_PATH,

  forbiddenPath:
    DEFAULT_FORBIDDEN_PATH,

  tenantMismatchPath:
    DEFAULT_TENANT_MISMATCH_PATH,

  preserveReturnLocation:
    true,

  replaceNavigation:
    true,

  includeSearchInReturnLocation:
    true,

  includeHashInReturnLocation:
    true,

  redirectState:
    {},

  onUnauthorized:
    undefined,

  onForbidden:
    undefined,

  onTenantMismatch:
    undefined,

  onAuthenticated:
    undefined,

  onAuthorizationDenied:
    undefined,

  onLoading:
    undefined,

  loadingComponent:
    undefined,

  unauthorizedComponent:
    undefined,

  forbiddenComponent:
    undefined,

  tenantMismatchComponent:
    undefined,

  accountDisabledComponent:
    undefined,

  className:
    '',

  testId:
    DEFAULT_TEST_ID,

  renderOutlet:
    false,
};

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_ACTIVE_ACCOUNT_STATUSES,
  DEFAULT_ADMIN_ROLES,
  DEFAULT_DENIED_ACCOUNT_STATUSES,
  DEFAULT_FORBIDDEN_PATH,
  DEFAULT_LOGIN_PATH,
  DEFAULT_TENANT_MISMATCH_PATH,
  DEFAULT_TEST_ID,
  DEFAULT_UNAUTHORIZED_PATH,

  GuardState,

  buildReturnLocation,
  getAccountStatus,
  getTenantId,
  getUserId,
  getUserPermissions,
  getUserRoles,
  getUserTenantIds,

  hasRequiredPermissions,
  hasRequiredRole,

  normalizeStatus,
  normalizeStringList,

  resolveTenantAuthorization,
  safeText,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default AdminRoute;