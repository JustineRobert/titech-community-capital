'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Settings Page
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/Settings.jsx
 *
 * Purpose:
 *   Production-grade account, security, notification, preference and tenant
 *   settings workspace for TITech Community Capital.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ User profile management
 * ✓ Password management
 * ✓ Notification preferences
 * ✓ Application preferences
 * ✓ Theme management
 * ✓ Tenant information
 * ✓ Tenant-admin visibility
 * ✓ Form validation
 * ✓ Unsaved-change tracking
 * ✓ Independent section saves
 * ✓ Loading / error states
 * ✓ Accessibility
 * ✓ Responsive navigation
 * ✓ Safe API error handling
 * ✓ Defensive API response normalization
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * Frontend visibility of tenant/admin settings is NOT authorization.
 *
 * TITech backend services MUST independently enforce:
 *   - authentication
 *   - role/permission checks
 *   - tenant isolation
 *   - security policy
 *   - password policy
 *   - administrative privileges
 *
 * ============================================================================
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Bell,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Key,
  Languages,
  Lock,
  LogOut,
  Moon,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Shield,
  Smartphone,
  Sun,
  User,
  X,
} from 'lucide-react';

import {
  toast,
} from 'react-toastify';

import api from '../services/api';

import {
  useAuth,
} from '../context/AuthContext';

import './Settings.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const SETTINGS_TABS = [
  {
    id:
      'profile',

    label:
      'Profile',

    icon:
      User,

    description:
      'Manage your personal account information.',
  },

  {
    id:
      'security',

    label:
      'Security',

    icon:
      Lock,

    description:
      'Manage your password and account security.',
  },

  {
    id:
      'notifications',

    label:
      'Notifications',

    icon:
      Bell,

    description:
      'Control how TITech communicates with you.',
  },

  {
    id:
      'preferences',

    label:
      'Preferences',

    icon:
      SettingsIcon,

    description:
      'Configure your TITech experience.',
  },

  {
    id:
      'tenant',

    label:
      'Tenant',

    icon:
      Building2,

    description:
      'View organization and tenant configuration.',
    adminOnly:
      true,
  },
];


const DEFAULT_SETTINGS = {
  profile: {
    firstName:
      '',

    lastName:
      '',

    email:
      '',

    phoneNumber:
      '',
  },

  security: {
    currentPassword:
      '',

    newPassword:
      '',

    confirmPassword:
      '',

    twoFactorEnabled:
      false,
  },

  notifications: {
    email:
      true,

    sms:
      true,

    push:
      true,

    marketing:
      false,
  },

  preferences: {
    theme:
      'light',

    language:
      'en',

    timezone:
      'Africa/Kampala',
  },

  tenant: {
    id:
      null,

    name:
      '',

    plan:
      '',

    features:
      [],
  },
};


const DEFAULT_SAVE_STATE = {
  profile:
    false,

  security:
    false,

  notifications:
    false,

  preferences:
    false,

  tenant:
    false,
};


const DEFAULT_ERROR_STATE = {
  profile:
    '',

  security:
    '',

  notifications:
    '',

  preferences:
    '',

  tenant:
    '',
};


const ADMIN_ROLES = new Set([
  'admin',
  'administrator',
  'super_admin',
  'superadmin',
  'platform_admin',
  'system_admin',
  'tenant_admin',
]);


const PASSWORD_MIN_LENGTH =
  8;


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const safeString = (
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


const normalizeResponseData = (
  response,
) => {
  if (
    response?.data?.data !==
    undefined
  ) {
    return response.data.data;
  }

  return response?.data || {};
};


const getApiErrorMessage = (
  error,
  fallback,
) =>
  safeString(
    error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message,
    fallback,
  );


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
    user?.role
  ) {
    roles.push(
      user.role,
    );
  }

  if (
    user?.userRole
  ) {
    roles.push(
      user.userRole,
    );
  }

  return [
    ...new Set(
      roles
        .map(
          (
            role,
          ) =>
            safeString(
              role,
            ).toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];
};


const createInitialSettings = () => ({
  profile: {
    ...DEFAULT_SETTINGS.profile,
  },

  security: {
    ...DEFAULT_SETTINGS.security,
  },

  notifications: {
    ...DEFAULT_SETTINGS.notifications,
  },

  preferences: {
    ...DEFAULT_SETTINGS.preferences,
  },

  tenant: {
    ...DEFAULT_SETTINGS.tenant,

    features: [],
  },
});


const createInitialDirtyState = () => ({
  profile:
    false,

  security:
    false,

  notifications:
    false,

  preferences:
    false,

  tenant:
    false,
});


const createInitialSavingState = () => ({
  ...DEFAULT_SAVE_STATE,
});


const createInitialErrors = () => ({
  ...DEFAULT_ERROR_STATE,
});


const isEqual = (
  first,
  second,
) => {
  try {
    return (
      JSON.stringify(
        first,
      ) ===
      JSON.stringify(
        second,
      )
    );
  } catch {
    return false;
  }
};


const getDisplayName = (
  profile,
  user,
) => {
  const firstName =
    safeString(
      profile?.firstName ||
        user?.firstName,
    );

  const lastName =
    safeString(
      profile?.lastName ||
        user?.lastName,
    );

  const combined =
    `${firstName} ${lastName}`.trim();

  return (
    combined ||
    safeString(
      user?.name ||
        user?.displayName ||
        user?.username,
      'TITech User',
    )
  );
};


/* ============================================================================
 * Form field component
 * ========================================================================== */

function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
}) {
  return (
    <div className="settings-field">
      <label
        className="settings-label"
        htmlFor={htmlFor}
      >
        {label}

        {required ? (
          <span
            className="settings-required"
            aria-hidden="true"
          >
            *
          </span>
        ) : null}
      </label>

      {hint ? (
        <p className="settings-field-hint">
          {
            hint
          }
        </p>
      ) : null}

      {children}

      {error ? (
        <p
          className="settings-field-error"
          role="alert"
        >
          {
            error
          }
        </p>
      ) : null}
    </div>
  );
}


/* ============================================================================
 * Toggle component
 * ========================================================================== */

function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}) {
  return (
    <label
      className={cn(
        'settings-toggle',
        disabled &&
          'settings-toggle--disabled',
      )}
      htmlFor={id}
    >
      <span className="settings-toggle__content">
        <span className="settings-toggle__label">
          {label}
        </span>

        {description ? (
          <span className="settings-toggle__description">
            {
              description
            }
          </span>
        ) : null}
      </span>

      <input
        id={id}
        type="checkbox"
        checked={
          Boolean(
            checked,
          )
        }
        onChange={
          onChange
        }
        disabled={
          disabled
        }
      />

      <span
        className="settings-toggle__switch"
        aria-hidden="true"
      >
        <span className="settings-toggle__thumb" />
      </span>
    </label>
  );
}


/* ============================================================================
 * Section header
 * ========================================================================== */

function SettingsSectionHeader({
  icon: Icon,
  title,
  description,
}) {
  return (
    <div className="settings-section-header">
      <div
        className="settings-section-header__icon"
        aria-hidden="true"
      >
        <Icon
          size={20}
        />
      </div>

      <div>
        <h2 className="settings-section-title">
          {
            title
          }
        </h2>

        {description ? (
          <p className="settings-section-description">
            {
              description
            }
          </p>
        ) : null}
      </div>
    </div>
  );
}


/* ============================================================================
 * Settings page
 * ========================================================================== */

function Settings() {
  const {
    user,
  } = useAuth();

  const isMountedRef =
    useRef(true);

  const [
    loading,
    setLoading,
  ] = useState(
    true,
  );

  const [
    refreshing,
    setRefreshing,
  ] = useState(
    false,
  );

  const [
    settings,
    setSettings,
  ] = useState(
    createInitialSettings,
  );

  const [
    savedSettings,
    setSavedSettings,
  ] = useState(
    createInitialSettings,
  );

  const [
    activeTab,
    setActiveTab,
  ] = useState(
    'profile',
  );

  const [
    saving,
    setSaving,
  ] = useState(
    createInitialSavingState,
  );

  const [
    errors,
    setErrors,
  ] = useState(
    createInitialErrors,
  );

  const [
    globalError,
    setGlobalError,
  ] = useState(
    '',
  );


  /* ==========================================================================
   * Lifecycle
   * ======================================================================== */

  useEffect(
    () => {
      isMountedRef.current =
        true;

      return () => {
        isMountedRef.current =
          false;
      };
    },
    [],
  );


  /* ==========================================================================
   * Authorization
   * ======================================================================== */

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

  const isAdmin =
    useMemo(
      () =>
        userRoles.some(
          (
            role,
          ) =>
            ADMIN_ROLES.has(
              role,
            ),
        ) ||
        user?.isAdmin ===
          true,
      [
        user,
        userRoles,
      ],
    );


  /* ==========================================================================
   * Tenant context
   * ======================================================================== */

  const tenantId =
    user?.tenantId ??
    user?.tenant?.id ??
    user?.tenant?.tenantId ??
    null;


  /* ==========================================================================
   * Visible tabs
   * ======================================================================== */

  const visibleTabs =
    useMemo(
      () =>
        SETTINGS_TABS.filter(
          (
            tab,
          ) =>
            !tab.adminOnly ||
            isAdmin,
        ),
      [
        isAdmin,
      ],
    );


  /* ==========================================================================
   * Dirty state
   * ======================================================================== */

  const dirty =
    useMemo(
      () => {
        const result =
          createInitialDirtyState();

        Object.keys(
          result,
        ).forEach(
          (
            section,
          ) => {
            result[
              section
            ] =
              !isEqual(
                settings[
                  section
                ],
                savedSettings[
                  section
                ],
              );
          },
        );

        return result;
      },
      [
        savedSettings,
        settings,
      ],
    );

  const hasUnsavedChanges =
    Object.values(
      dirty,
    ).some(
      Boolean,
    );


  /* ==========================================================================
   * Active tab protection
   * ======================================================================== */

  useEffect(
    () => {
      if (
        !visibleTabs.some(
          (
            tab,
          ) =>
            tab.id ===
            activeTab,
        )
      ) {
        setActiveTab(
          'profile',
        );
      }
    },
    [
      activeTab,
      visibleTabs,
    ],
  );


  /* ==========================================================================
   * Theme application
   * ======================================================================== */

  useEffect(
    () => {
      if (
        typeof document ===
        'undefined'
      ) {
        return;
      }

      const theme =
        settings
          .preferences
          .theme ||
        'light';

      document.documentElement.dataset.theme =
        theme;

      document.documentElement.style.colorScheme =
        theme;

      return () => {
        /**
         * Do not remove an application-level theme here. The broader
         * application shell may own the final theme state.
         */
      };
    },
    [
      settings
        .preferences
        .theme,
    ],
  );


  /* ==========================================================================
   * Load settings
   * ======================================================================== */

  const loadSettings =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        try {
          if (
            silent
          ) {
            setRefreshing(
              true,
            );
          } else {
            setLoading(
              true,
            );
          }

          setGlobalError(
            '',
          );

          const [
            profileResponse,
            tenantResponse,
          ] =
            await Promise.all([
              api.get(
                '/api/users/me',
              ),

              isAdmin
                ? api.get(
                    '/api/tenant/settings',
                  )
                : Promise.resolve(
                    {
                      data: {},
                    },
                  ),
            ]);

          const profileData =
            normalizeResponseData(
              profileResponse,
            );

          const tenantData =
            normalizeResponseData(
              tenantResponse,
            );

          const nextSettings =
            {
              profile: {
                firstName:
                  safeString(
                    profileData.firstName,
                  ),

                lastName:
                  safeString(
                    profileData.lastName,
                  ),

                email:
                  safeString(
                    profileData.email,
                  ),

                phoneNumber:
                  safeString(
                    profileData.phoneNumber ||
                      profileData.phone ||
                      profileData.mobileNumber,
                  ),
              },

              security: {
                currentPassword:
                  '',

                newPassword:
                  '',

                confirmPassword:
                  '',

                twoFactorEnabled:
                  Boolean(
                    profileData.twoFactorEnabled ??
                      profileData.twoFactor?.enabled ??
                      false,
                  ),
              },

              notifications: {
                ...DEFAULT_SETTINGS.notifications,

                ...(profileData.notifications &&
                typeof profileData.notifications ===
                  'object'
                  ? profileData.notifications
                  : {}),
              },

              preferences: {
                ...DEFAULT_SETTINGS.preferences,

                ...(profileData.preferences &&
                typeof profileData.preferences ===
                  'object'
                  ? profileData.preferences
                  : {}),
              },

              tenant: {
                id:
                  tenantData.id ??
                  tenantData.tenantId ??
                  tenantId ??
                  null,

                name:
                  safeString(
                    tenantData.name ||
                      tenantData.tenantName,
                  ),

                plan:
                  safeString(
                    tenantData.plan ||
                      tenantData.subscriptionPlan,
                  ),

                features:
                  Array.isArray(
                    tenantData.features,
                  )
                    ? tenantData.features
                    : [],
              },
            };

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setSettings(
            nextSettings,
          );

          setSavedSettings(
            nextSettings,
          );

          setErrors(
            createInitialErrors(),
          );
        } catch (
          error
        ) {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          const message =
            getApiErrorMessage(
              error,
              'Failed to load TITech settings.',
            );

          setGlobalError(
            message,
          );

          toast.error(
            message,
          );
        } finally {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          if (
            silent
          ) {
            setRefreshing(
              false,
            );
          } else {
            setLoading(
              false,
            );
          }
        }
      },
      [
        isAdmin,
        tenantId,
      ],
    );


  useEffect(
    () => {
      loadSettings();
    },
    [
      loadSettings,
    ],
  );


  /* ==========================================================================
   * Update helpers
   * ======================================================================== */

  const updateSection =
    useCallback(
      (
        section,
        field,
        value,
      ) => {
        setSettings(
          previous => ({
            ...previous,

            [section]: {
              ...previous[
                section
              ],

              [field]:
                value,
            },
          }),
        );

        setErrors(
          previous => ({
            ...previous,

            [section]:
              '',
          }),
        );
      },
      [],
    );


  const updateNotification =
    useCallback(
      (
        field,
        value,
      ) => {
        updateSection(
          'notifications',
          field,
          Boolean(
            value,
          ),
        );
      },
      [
        updateSection,
      ],
    );


  const updatePreference =
    useCallback(
      (
        field,
        value,
      ) => {
        updateSection(
          'preferences',
          field,
          value,
        );
      },
      [
        updateSection,
      ],
    );


  /* ==========================================================================
   * Profile validation
   * ======================================================================== */

  const validateProfile =
    useCallback(
      () => {
        const nextErrors = {};

        if (
          !safeString(
            settings
              .profile
              .firstName,
          )
        ) {
          nextErrors.firstName =
            'First name is required.';
        }

        if (
          !safeString(
            settings
              .profile
              .lastName,
          )
        ) {
          nextErrors.lastName =
            'Last name is required.';
        }

        const email =
          safeString(
            settings
              .profile
              .email,
          );

        if (
          email &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email,
          )
        ) {
          nextErrors.email =
            'Enter a valid email address.';
        }

        setErrors(
          previous => ({
            ...previous,

            profile:
              Object.values(
                nextErrors,
              ).join(' '),
          }),
        );

        return (
          Object.keys(
            nextErrors,
          ).length ===
          0
        );
      },
      [
        settings
          .profile,
      ],
    );


  /* ==========================================================================
   * Password validation
   * ======================================================================== */

  const validatePassword =
    useCallback(
      () => {
        const {
          currentPassword,
          newPassword,
          confirmPassword,
        } =
          settings.security;

        let message =
          '';

        if (
          !currentPassword ||
          !newPassword ||
          !confirmPassword
        ) {
          message =
            'Current password, new password and confirmation are required.';
        } else if (
          newPassword.length <
          PASSWORD_MIN_LENGTH
        ) {
          message =
            `New password must contain at least ${PASSWORD_MIN_LENGTH} characters.`;
        } else if (
          newPassword ===
          currentPassword
        ) {
          message =
            'New password must be different from your current password.';
        } else if (
          newPassword !==
          confirmPassword
        ) {
          message =
            'New password and confirmation do not match.';
        }

        setErrors(
          previous => ({
            ...previous,

            security:
              message,
          }),
        );

        return !message;
      },
      [
        settings
          .security,
      ],
    );


  /* ==========================================================================
   * Save profile
   * ======================================================================== */

  const saveProfile =
    useCallback(
      async () => {
        if (
          !validateProfile()
        ) {
          toast.error(
            'Please correct the profile fields before saving.',
          );

          return false;
        }

        try {
          setSaving(
            previous => ({
              ...previous,

              profile:
                true,
            }),
          );

          await api.put(
            '/api/users/me',
            {
              ...settings.profile,

              notifications:
                settings.notifications,

              preferences:
                settings.preferences,
            },
          );

          if (
            !isMountedRef.current
          ) {
            return true;
          }

          setSavedSettings(
            previous => ({
              ...previous,

              profile: {
                ...settings.profile,
              },

              notifications: {
                ...settings.notifications,
              },

              preferences: {
                ...settings.preferences,
              },
            }),
          );

          toast.success(
            'TITech settings updated successfully.',
          );

          return true;
        } catch (
          error
        ) {
          const message =
            getApiErrorMessage(
              error,
              'Failed to save TITech profile settings.',
            );

          setErrors(
            previous => ({
              ...previous,

              profile:
                message,
            }),
          );

          toast.error(
            message,
          );

          return false;
        } finally {
          if (
            isMountedRef.current
          ) {
            setSaving(
              previous => ({
                ...previous,

                profile:
                  false,
              }),
            );
          }
        }
      },
      [
        settings
          .notifications,
        settings
          .preferences,
        settings.profile,
        validateProfile,
      ],
    );


  /* ==========================================================================
   * Save notifications/preferences
   * ======================================================================== */

  const savePreferences =
    useCallback(
      async () => {
        try {
          setSaving(
            previous => ({
              ...previous,

              preferences:
                true,

              notifications:
                true,
            }),
          );

          await api.put(
            '/api/users/me',
            {
              ...settings.profile,

              notifications:
                settings.notifications,

              preferences:
                settings.preferences,
            },
          );

          if (
            !isMountedRef.current
          ) {
            return true;
          }

          setSavedSettings(
            previous => ({
              ...previous,

              profile: {
                ...settings.profile,
              },

              notifications: {
                ...settings.notifications,
              },

              preferences: {
                ...settings.preferences,
              },
            }),
          );

          toast.success(
            'TITech communication and preference settings saved.',
          );

          return true;
        } catch (
          error
        ) {
          const message =
            getApiErrorMessage(
              error,
              'Failed to save TITech preferences.',
            );

          setErrors(
            previous => ({
              ...previous,

              preferences:
                message,

              notifications:
                message,
            }),
          );

          toast.error(
            message,
          );

          return false;
        } finally {
          if (
            isMountedRef.current
          ) {
            setSaving(
              previous => ({
                ...previous,

                preferences:
                  false,

                notifications:
                  false,
              }),
            );
          }
        }
      },
      [
        settings
          .notifications,
        settings
          .preferences,
        settings.profile,
      ],
    );


  /* ==========================================================================
   * Change password
   * ======================================================================== */

  const changePassword =
    useCallback(
      async () => {
        if (
          !validatePassword()
        ) {
          toast.error(
            'Please correct the password fields before continuing.',
          );

          return false;
        }

        const {
          currentPassword,
          newPassword,
        } =
          settings.security;

        try {
          setSaving(
            previous => ({
              ...previous,

              security:
                true,
            }),
          );

          await api.post(
            '/api/auth/change-password',
            {
              currentPassword,
              newPassword,
            },
          );

          if (
            !isMountedRef.current
          ) {
            return true;
          }

          setSettings(
            previous => ({
              ...previous,

              security:
                {
                  ...DEFAULT_SETTINGS.security,
                  twoFactorEnabled:
                    previous
                      .security
                      .twoFactorEnabled,
                },
            }),
          );

          setSavedSettings(
            previous => ({
              ...previous,

              security:
                {
                  ...DEFAULT_SETTINGS.security,
                  twoFactorEnabled:
                    previous
                      .security
                      .twoFactorEnabled,
                },
            }),
          );

          setErrors(
            previous => ({
              ...previous,

              security:
                '',
            }),
          );

          toast.success(
            'TITech password updated successfully.',
          );

          return true;
        } catch (
          error
        ) {
          const message =
            getApiErrorMessage(
              error,
              'Failed to change your password.',
            );

          setErrors(
            previous => ({
              ...previous,

              security:
                message,
            }),
          );

          toast.error(
            message,
          );

          return false;
        } finally {
          if (
            isMountedRef.current
          ) {
            setSaving(
              previous => ({
                ...previous,

                security:
                  false,
              }),
            );
          }
        }
      },
      [
        settings.security,
        validatePassword,
      ],
    );


  /* ==========================================================================
   * Two-factor placeholder handling
   * ======================================================================== */

  const handleTwoFactorChange =
    useCallback(
      value => {
        /**
         * The UI may reflect a locally selected value, but enabling/disabling
         * MFA must ultimately be implemented by a dedicated secure backend
         * endpoint. We therefore do not pretend this checkbox is authoritative.
         */
        updateSection(
          'security',
          'twoFactorEnabled',
          Boolean(
            value,
          ),
        );

        toast.info(
          'Two-factor authentication changes require TITech security verification.',
        );
      },
      [
        updateSection,
      ],
    );


  /* ==========================================================================
   * Unsaved changes handling
   * ======================================================================== */

  const handleResetSection =
    useCallback(
      section => {
        setSettings(
          previous => ({
            ...previous,

            [section]: {
              ...savedSettings[
                section
              ],
            },
          }),
        );

        setErrors(
          previous => ({
            ...previous,

            [section]:
              '',
          }),
        );
      },
      [
        savedSettings,
      ],
    );


  const handleRefresh =
    useCallback(
      async () => {
        if (
          hasUnsavedChanges
        ) {
          const shouldDiscard =
            typeof window ===
              'undefined' ||
            window.confirm(
              'You have unsaved changes. Refreshing will discard them. Continue?',
            );

          if (
            !shouldDiscard
          ) {
            return;
          }
        }

        await loadSettings({
          silent:
            true,
        });
      },
      [
        hasUnsavedChanges,
        loadSettings,
      ],
    );


  /* ==========================================================================
   * Keyboard handling
   * ======================================================================== */

  const handleTabKey =
    useCallback(
      event => {
        if (
          event.key ===
          'ArrowDown' ||
          event.key ===
          'ArrowRight'
        ) {
          event.preventDefault();

          const index =
            visibleTabs.findIndex(
              tab =>
                tab.id ===
                activeTab,
            );

          const next =
            visibleTabs[
              (
                index + 1
              ) %
                visibleTabs.length
            ];

          if (
            next
          ) {
            setActiveTab(
              next.id,
            );
          }
        }

        if (
          event.key ===
          'ArrowUp' ||
          event.key ===
          'ArrowLeft'
        ) {
          event.preventDefault();

          const index =
            visibleTabs.findIndex(
              tab =>
                tab.id ===
                activeTab,
            );

          const previous =
            visibleTabs[
              (
                index -
                  1 +
                  visibleTabs.length
              ) %
                visibleTabs.length
            ];

          if (
            previous
          ) {
            setActiveTab(
              previous.id,
            );
          }
        }
      },
      [
        activeTab,
        visibleTabs,
      ],
    );


  /* ==========================================================================
   * Active section helpers
   * ======================================================================== */

  const activeTabDefinition =
    useMemo(
      () =>
        visibleTabs.find(
          tab =>
            tab.id ===
            activeTab,
        ) ||
        visibleTabs[0],
      [
        activeTab,
        visibleTabs,
      ],
    );


  /* ==========================================================================
   * Loading
   * ======================================================================== */

  if (
    loading
  ) {
    return (
      <div
        className="settings-page settings-page--loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="settings-loading">

          <RefreshCw
            className="settings-loading__icon"
            size={28}
            aria-hidden="true"
          />

          <h1>
            Loading TITech settings
          </h1>

          <p>
            Retrieving your account and organization preferences…
          </p>

        </div>
      </div>
    );
  }


  /* ==========================================================================
   * Global error
   * ======================================================================== */

  if (
    globalError &&
    !settings.profile.email
  ) {
    return (
      <div className="settings-page">

        <div
          className="settings-error-state"
          role="alert"
        >
          <div className="settings-error-state__icon">
            <Shield
              size={36}
              aria-hidden="true"
            />
          </div>

          <h1>
            Unable to load settings
          </h1>

          <p>
            {
              globalError
            }
          </p>

          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={
              () =>
                loadSettings()
            }
          >
            <RefreshCw
              size={17}
            />
            Try Again
          </button>
        </div>

      </div>
    );
  }


  /* ==========================================================================
   * Render
   * ======================================================================== */

  return (
    <div
      className="settings-page"
      data-testid="titech-settings-page"
      data-tenant-id={
        tenantId ||
        undefined
      }
    >

      {/* =====================================================================
          Header
          ===================================================================== */}

      <header className="settings-header">

        <div className="settings-header__copy">

          <div className="settings-header__eyebrow">
            TITech Community Capital
          </div>

          <h1>
            Settings
          </h1>

          <p>
            Manage your TITech account, security,
            communication preferences and organization settings.
          </p>

        </div>

        <div className="settings-header__actions">

          <button
            type="button"
            className="settings-btn settings-btn--secondary"
            onClick={
              handleRefresh
            }
            disabled={
              refreshing ||
              Object.values(
                saving,
              ).some(
                Boolean,
              )
            }
            title="Refresh settings"
          >
            <RefreshCw
              size={17}
              className={
                refreshing
                  ? 'settings-spinner'
                  : undefined
              }
            />

            <span className="settings-btn__label">
              Refresh
            </span>
          </button>

        </div>

      </header>


      {/* =====================================================================
          Unsaved changes banner
          ===================================================================== */}

      {hasUnsavedChanges ? (
        <div
          className="settings-unsaved-banner"
          role="status"
          aria-live="polite"
        >
          <div className="settings-unsaved-banner__content">

            <span className="settings-unsaved-banner__dot" />

            <span>
              You have unsaved changes.
            </span>

          </div>

          <button
            type="button"
            className="settings-unsaved-banner__reset"
            onClick={() => {
              if (
                typeof window !==
                  'undefined' &&
                window.confirm(
                  'Discard all unsaved settings changes?',
                )
              ) {
                setSettings(
                  savedSettings,
                );

                setErrors(
                  createInitialErrors(),
                );
              }
            }}
          >
            Discard
          </button>
        </div>
      ) : null}


      {/* =====================================================================
          Main layout
          ===================================================================== */}

      <div className="settings-layout">

        {/* ===================================================================
            Sidebar
            =================================================================== */}

        <aside
          className="settings-sidebar"
          aria-label="Settings sections"
        >

          <div className="settings-sidebar__mobile-title">
            Settings sections
          </div>

          <nav
            className="settings-nav"
            aria-label="Settings navigation"
            role="tablist"
            aria-orientation="vertical"
            onKeyDown={
              handleTabKey
            }
          >
            {visibleTabs.map(
              ({
                id,
                label,
                icon: Icon,
                description,
              }) => {
                const active =
                  activeTab ===
                  id;

                const tabPanelId =
                  `settings-panel-${id}`;

                return (
                  <button
                    key={
                      id
                    }
                    type="button"
                    role="tab"
                    aria-selected={
                      active
                    }
                    aria-controls={
                      tabPanelId
                    }
                    tabIndex={
                      active
                        ? 0
                        : -1
                    }
                    className={cn(
                      'settings-nav__item',
                      active &&
                        'settings-nav__item--active',
                      dirty[id] &&
                        'settings-nav__item--dirty',
                    )}
                    onClick={() =>
                      setActiveTab(
                        id,
                      )
                    }
                  >

                    <span
                      className="settings-nav__icon"
                      aria-hidden="true"
                    >
                      <Icon
                        size={18}
                      />
                    </span>

                    <span className="settings-nav__copy">
                      <span className="settings-nav__label">
                        {
                          label
                        }
                      </span>

                      <span className="settings-nav__description">
                        {
                          description
                        }
                      </span>
                    </span>

                    {dirty[id] ? (
                      <span
                        className="settings-nav__dirty"
                        aria-label="Unsaved changes"
                        title="Unsaved changes"
                      />
                    ) : null}

                    <ChevronRight
                      size={15}
                      className="settings-nav__chevron"
                      aria-hidden="true"
                    />

                  </button>
                );
              },
            )}
          </nav>

          <div className="settings-sidebar__account">

            <div className="settings-sidebar__account-avatar">
              {
                getDisplayName(
                  settings.profile,
                  user,
                )
                  .slice(
                    0,
                    1,
                  )
                  .toUpperCase()
              }
            </div>

            <div className="settings-sidebar__account-copy">
              <strong>
                {
                  getDisplayName(
                    settings.profile,
                    user,
                  )
                }
              </strong>

              <span>
                {
                  settings
                    .profile
                    .email ||
                  'TITech account'
                }
              </span>
            </div>

          </div>

        </aside>


        {/* ===================================================================
            Content
            =================================================================== */}

        <main className="settings-content">

          {/* ================================================================
              Mobile section navigation
              ================================================================ */}

          <div className="settings-mobile-nav">
            <button
              type="button"
              className="settings-mobile-nav__button"
              onClick={() => {
                const currentIndex =
                  visibleTabs.findIndex(
                    tab =>
                      tab.id ===
                      activeTab,
                  );

                const previous =
                  visibleTabs[
                    Math.max(
                      0,
                      currentIndex -
                        1,
                    )
                  ];

                if (
                  previous
                ) {
                  setActiveTab(
                    previous.id,
                  );
                }
              }}
              disabled={
                activeTab ===
                visibleTabs[0]?.id
              }
              aria-label="Previous settings section"
            >
              <ChevronLeft
                size={17}
              />
            </button>

            <div>
              <strong>
                {
                  activeTabDefinition
                    ?.label
                }
              </strong>

              <span>
                {
                  activeTabDefinition
                    ?.description
                }
              </span>
            </div>

            <button
              type="button"
              className="settings-mobile-nav__button"
              onClick={() => {
                const currentIndex =
                  visibleTabs.findIndex(
                    tab =>
                      tab.id ===
                      activeTab,
                  );

                const next =
                  visibleTabs[
                    Math.min(
                      visibleTabs.length -
                        1,
                      currentIndex +
                        1,
                    )
                  ];

                if (
                  next
                ) {
                  setActiveTab(
                    next.id,
                  );
                }
              }}
              disabled={
                activeTab ===
                visibleTabs[
                  visibleTabs.length -
                    1
                ]?.id
              }
              aria-label="Next settings section"
            >
              <ChevronRight
                size={17}
              />
            </button>
          </div>


          {/* ================================================================
              Profile
              ================================================================ */}

          {activeTab ===
          'profile' ? (
            <section
              id="settings-panel-profile"
              role="tabpanel"
              aria-label="Profile settings"
              className="settings-panel"
            >
              <SettingsSectionHeader
                icon={
                  User
                }
                title="Profile"
                description="Keep your TITech account information accurate and up to date."
              />

              <div className="settings-panel__body">

                <div className="settings-grid settings-grid--two">

                  <Field
                    label="First name"
                    htmlFor="settings-first-name"
                    required
                    error={
                      errors.profile &&
                      errors.profile.includes(
                        'First name',
                      )
                        ? errors.profile
                        : ''
                    }
                  >
                    <input
                      id="settings-first-name"
                      className="settings-input"
                      type="text"
                      autoComplete="given-name"
                      value={
                        settings
                          .profile
                          .firstName
                      }
                      onChange={e =>
                        updateSection(
                          'profile',
                          'firstName',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>


                  <Field
                    label="Last name"
                    htmlFor="settings-last-name"
                    required
                    error={
                      errors.profile &&
                      errors.profile.includes(
                        'Last name',
                      )
                        ? errors.profile
                        : ''
                    }
                  >
                    <input
                      id="settings-last-name"
                      className="settings-input"
                      type="text"
                      autoComplete="family-name"
                      value={
                        settings
                          .profile
                          .lastName
                      }
                      onChange={e =>
                        updateSection(
                          'profile',
                          'lastName',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>

                </div>


                <div className="settings-grid settings-grid--two">

                  <Field
                    label="Email address"
                    htmlFor="settings-email"
                    required
                    hint="Use an email address you actively monitor."
                    error={
                      errors.profile &&
                      errors.profile.includes(
                        'email',
                      )
                        ? errors.profile
                        : ''
                    }
                  >
                    <input
                      id="settings-email"
                      className="settings-input"
                      type="email"
                      autoComplete="email"
                      value={
                        settings
                          .profile
                          .email
                      }
                      onChange={e =>
                        updateSection(
                          'profile',
                          'email',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>


                  <Field
                    label="Phone number"
                    htmlFor="settings-phone"
                    hint="Use a number that can receive security and account notifications."
                  >
                    <div className="settings-input-with-icon">

                      <Smartphone
                        size={17}
                        aria-hidden="true"
                      />

                      <input
                        id="settings-phone"
                        className="settings-input"
                        type="tel"
                        autoComplete="tel"
                        value={
                          settings
                            .profile
                            .phoneNumber
                        }
                        onChange={e =>
                          updateSection(
                            'profile',
                            'phoneNumber',
                            e.target
                              .value,
                          )
                        }
                      />

                    </div>
                  </Field>

                </div>


                {errors.profile ? (
                  <div
                    className="settings-inline-error"
                    role="alert"
                  >
                    {
                      errors.profile
                    }
                  </div>
                ) : null}


                <div className="settings-panel__footer">

                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={
                      saveProfile
                    }
                    disabled={
                      saving.profile
                    }
                  >
                    {saving.profile ? (
                      <RefreshCw
                        size={17}
                        className="settings-spinner"
                      />
                    ) : (
                      <Save
                        size={17}
                      />
                    )}

                    {saving.profile
                      ? 'Saving…'
                      : 'Save Profile'}
                  </button>

                  {dirty.profile ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() =>
                        handleResetSection(
                          'profile',
                        )
                      }
                      disabled={
                        saving.profile
                      }
                    >
                      <X
                        size={17}
                      />
                      Discard
                    </button>
                  ) : null}

                </div>

              </div>
            </section>
          ) : null}


          {/* ================================================================
              Security
              ================================================================ */}

          {activeTab ===
          'security' ? (
            <section
              id="settings-panel-security"
              role="tabpanel"
              aria-label="Security settings"
              className="settings-panel"
            >
              <SettingsSectionHeader
                icon={
                  Lock
                }
                title="Security"
                description="Protect your TITech account with strong credentials and security controls."
              />

              <div className="settings-panel__body">

                <div className="settings-security-card">

                  <div className="settings-security-card__icon">
                    <Key
                      size={21}
                    />
                  </div>

                  <div className="settings-security-card__content">

                    <h3>
                      Change password
                    </h3>

                    <p>
                      Use a strong, unique password that you do not reuse elsewhere.
                    </p>

                  </div>

                </div>


                <div className="settings-grid settings-grid--one">

                  <Field
                    label="Current password"
                    htmlFor="settings-current-password"
                    required
                  >
                    <input
                      id="settings-current-password"
                      className="settings-input"
                      type="password"
                      autoComplete="current-password"
                      value={
                        settings
                          .security
                          .currentPassword
                      }
                      onChange={e =>
                        updateSection(
                          'security',
                          'currentPassword',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>


                  <Field
                    label="New password"
                    htmlFor="settings-new-password"
                    required
                    hint={`Minimum ${PASSWORD_MIN_LENGTH} characters.`}
                  >
                    <input
                      id="settings-new-password"
                      className="settings-input"
                      type="password"
                      autoComplete="new-password"
                      value={
                        settings
                          .security
                          .newPassword
                      }
                      onChange={e =>
                        updateSection(
                          'security',
                          'newPassword',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>


                  <Field
                    label="Confirm new password"
                    htmlFor="settings-confirm-password"
                    required
                  >
                    <input
                      id="settings-confirm-password"
                      className="settings-input"
                      type="password"
                      autoComplete="new-password"
                      value={
                        settings
                          .security
                          .confirmPassword
                      }
                      onChange={e =>
                        updateSection(
                          'security',
                          'confirmPassword',
                          e.target
                            .value,
                        )
                      }
                    />
                  </Field>

                </div>


                {errors.security ? (
                  <div
                    className="settings-inline-error"
                    role="alert"
                  >
                    {
                      errors.security
                    }
                  </div>
                ) : null}


                <div className="settings-security-mfa">

                  <Toggle
                    id="settings-two-factor"
                    checked={
                      settings
                        .security
                        .twoFactorEnabled
                    }
                    onChange={e =>
                      handleTwoFactorChange(
                        e.target
                          .checked,
                      )
                    }
                    label="Two-factor authentication"
                    description="Add an additional authentication factor to your TITech account."
                    disabled={
                      saving.security
                    }
                  />

                  <span className="settings-security-mfa__status">
                    {settings
                      .security
                      .twoFactorEnabled ? (
                      <>
                        <Check
                          size={15}
                        />
                        Enabled
                      </>
                    ) : (
                      'Not enabled'
                    )}
                  </span>

                </div>


                <div className="settings-panel__footer">

                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={
                      changePassword
                    }
                    disabled={
                      saving.security
                    }
                  >
                    {saving.security ? (
                      <RefreshCw
                        size={17}
                        className="settings-spinner"
                      />
                    ) : (
                      <Key
                        size={17}
                      />
                    )}

                    {saving.security
                      ? 'Updating…'
                      : 'Change Password'}
                  </button>

                  {dirty.security ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() =>
                        handleResetSection(
                          'security',
                        )
                      }
                      disabled={
                        saving.security
                      }
                    >
                      <X
                        size={17}
                      />
                      Reset
                    </button>
                  ) : null}

                </div>

              </div>
            </section>
          ) : null}


          {/* ================================================================
              Notifications
              ================================================================ */}

          {activeTab ===
          'notifications' ? (
            <section
              id="settings-panel-notifications"
              role="tabpanel"
              aria-label="Notification settings"
              className="settings-panel"
            >
              <SettingsSectionHeader
                icon={
                  Bell
                }
                title="Notifications"
                description="Choose how TITech communicates account, activity and service information."
              />

              <div className="settings-panel__body">

                <div className="settings-options-card">

                  <Toggle
                    id="settings-notification-email"
                    checked={
                      settings
                        .notifications
                        .email
                    }
                    onChange={e =>
                      updateNotification(
                        'email',
                        e.target
                          .checked,
                      )
                    }
                    label="Email notifications"
                    description="Receive account alerts and important TITech updates by email."
                  />

                  <Toggle
                    id="settings-notification-sms"
                    checked={
                      settings
                        .notifications
                        .sms
                    }
                    onChange={e =>
                      updateNotification(
                        'sms',
                        e.target
                          .checked,
                      )
                    }
                    label="SMS notifications"
                    description="Receive critical alerts and supported account notifications by SMS."
                  />

                  <Toggle
                    id="settings-notification-push"
                    checked={
                      settings
                        .notifications
                        .push
                    }
                    onChange={e =>
                      updateNotification(
                        'push',
                        e.target
                          .checked,
                      )
                    }
                    label="Push notifications"
                    description="Receive timely notifications from TITech-supported devices."
                  />

                  <Toggle
                    id="settings-notification-marketing"
                    checked={
                      settings
                        .notifications
                        .marketing
                    }
                    onChange={e =>
                      updateNotification(
                        'marketing',
                        e.target
                          .checked,
                      )
                    }
                    label="Product and service updates"
                    description="Receive optional TITech product, service and feature communications."
                  />

                </div>


                {errors.notifications ? (
                  <div
                    className="settings-inline-error"
                    role="alert"
                  >
                    {
                      errors.notifications
                    }
                  </div>
                ) : null}


                <div className="settings-panel__footer">

                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={
                      savePreferences
                    }
                    disabled={
                      saving.notifications ||
                      saving.preferences
                    }
                  >
                    {saving.notifications ? (
                      <RefreshCw
                        size={17}
                        className="settings-spinner"
                      />
                    ) : (
                      <Save
                        size={17}
                      />
                    )}

                    {saving.notifications
                      ? 'Saving…'
                      : 'Save Notifications'}
                  </button>

                  {dirty.notifications ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() =>
                        handleResetSection(
                          'notifications',
                        )
                      }
                    >
                      <X
                        size={17}
                      />
                      Discard
                    </button>
                  ) : null}

                </div>

              </div>
            </section>
          ) : null}


          {/* ================================================================
              Preferences
              ================================================================ */}

          {activeTab ===
          'preferences' ? (
            <section
              id="settings-panel-preferences"
              role="tabpanel"
              aria-label="Preference settings"
              className="settings-panel"
            >
              <SettingsSectionHeader
                icon={
                  SettingsIcon
                }
                title="Preferences"
                description="Customize the way TITech looks and behaves for your account."
              />

              <div className="settings-panel__body">

                <div className="settings-grid settings-grid--three">

                  <Field
                    label="Theme"
                    htmlFor="settings-theme"
                    hint="Controls the appearance of the TITech application."
                  >
                    <div className="settings-select-with-icon">

                      {settings
                        .preferences
                        .theme ===
                      'dark' ? (
                        <Moon
                          size={17}
                          aria-hidden="true"
                        />
                      ) : (
                        <Sun
                          size={17}
                          aria-hidden="true"
                        />
                      )}

                      <select
                        id="settings-theme"
                        className="settings-select"
                        value={
                          settings
                            .preferences
                            .theme
                        }
                        onChange={e =>
                          updatePreference(
                            'theme',
                            e.target
                              .value,
                          )
                        }
                      >
                        <option value="light">
                          Light
                        </option>

                        <option value="dark">
                          Dark
                        </option>

                        <option value="system">
                          System
                        </option>
                      </select>

                    </div>
                  </Field>


                  <Field
                    label="Language"
                    htmlFor="settings-language"
                  >
                    <div className="settings-select-with-icon">

                      <Languages
                        size={17}
                        aria-hidden="true"
                      />

                      <select
                        id="settings-language"
                        className="settings-select"
                        value={
                          settings
                            .preferences
                            .language
                        }
                        onChange={e =>
                          updatePreference(
                            'language',
                            e.target
                              .value,
                          )
                        }
                      >
                        <option value="en">
                          English
                        </option>

                        <option value="sw">
                          Kiswahili
                        </option>

                        <option value="lg">
                          Luganda
                        </option>
                      </select>

                    </div>
                  </Field>


                  <Field
                    label="Timezone"
                    htmlFor="settings-timezone"
                  >
                    <div className="settings-select-with-icon">

                      <Globe2
                        size={17}
                        aria-hidden="true"
                      />

                      <select
                        id="settings-timezone"
                        className="settings-select"
                        value={
                          settings
                            .preferences
                            .timezone
                        }
                        onChange={e =>
                          updatePreference(
                            'timezone',
                            e.target
                              .value,
                          )
                        }
                      >
                        <option value="Africa/Kampala">
                          Africa/Kampala
                        </option>

                        <option value="Africa/Nairobi">
                          Africa/Nairobi
                        </option>

                        <option value="Africa/Dar_es_Salaam">
                          Africa/Dar_es_Salaam
                        </option>

                        <option value="UTC">
                          UTC
                        </option>
                      </select>

                    </div>
                  </Field>

                </div>


                {errors.preferences ? (
                  <div
                    className="settings-inline-error"
                    role="alert"
                  >
                    {
                      errors.preferences
                    }
                  </div>
                ) : null}


                <div className="settings-panel__footer">

                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={
                      savePreferences
                    }
                    disabled={
                      saving.preferences
                    }
                  >
                    {saving.preferences ? (
                      <RefreshCw
                        size={17}
                        className="settings-spinner"
                      />
                    ) : (
                      <Save
                        size={17}
                      />
                    )}

                    {saving.preferences
                      ? 'Saving…'
                      : 'Save Preferences'}
                  </button>

                  {dirty.preferences ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--secondary"
                      onClick={() =>
                        handleResetSection(
                          'preferences',
                        )
                      }
                    >
                      <X
                        size={17}
                      />
                      Discard
                    </button>
                  ) : null}

                </div>

              </div>
            </section>
          ) : null}


          {/* ================================================================
              Tenant
              ================================================================ */}

          {activeTab ===
            'tenant' &&
          isAdmin ? (
            <section
              id="settings-panel-tenant"
              role="tabpanel"
              aria-label="Tenant settings"
              className="settings-panel"
            >
              <SettingsSectionHeader
                icon={
                  Building2
                }
                title="Tenant"
                description="Review your organization's TITech subscription and enabled platform capabilities."
              />

              <div className="settings-panel__body">

                <div className="settings-tenant-summary">

                  <div className="settings-tenant-summary__icon">
                    <Building2
                      size={24}
                    />
                  </div>

                  <div className="settings-tenant-summary__content">

                    <span className="settings-tenant-summary__label">
                      Organization
                    </span>

                    <strong>
                      {
                        settings
                          .tenant
                          .name ||
                        'Unnamed tenant'
                      }
                    </strong>

                    <span>
                      {
                        settings
                          .tenant
                          .plan ||
                        'Plan information unavailable'
                      }
                    </span>

                  </div>

                </div>


                <div className="settings-feature-header">

                  <div>
                    <h3>
                      Enabled features
                    </h3>

                    <p>
                      Features currently made available to this TITech tenant.
                    </p>
                  </div>

                  <span className="settings-feature-count">
                    {
                      settings
                        .tenant
                        .features
                        .length
                    }
                  </span>

                </div>


                {settings
                  .tenant
                  .features
                  .length >
                0 ? (
                  <div className="settings-feature-grid">
                    {settings
                      .tenant
                      .features.map(
                        (
                          feature,
                        ) => (
                          <div
                            key={
                              String(
                                feature,
                              )
                            }
                            className="settings-feature-card"
                          >
                            <Shield
                              size={17}
                              aria-hidden="true"
                            />

                            <span>
                              {
                                feature
                              }
                            </span>

                          </div>
                        ),
                      )}
                  </div>
                ) : (
                  <div className="settings-empty">
                    <Building2
                      size={30}
                      aria-hidden="true"
                    />

                    <h3>
                      No feature information
                    </h3>

                    <p>
                      Tenant feature information is currently unavailable.
                    </p>
                  </div>
                )}

              </div>
            </section>
          ) : null}


          {/* ================================================================
              Section footer status
              ================================================================ */}

          <footer className="settings-content-footer">

            <div className="settings-content-footer__status">

              {Object.values(
                saving,
              ).some(
                Boolean,
              ) ? (
                <>
                  <RefreshCw
                    size={14}
                    className="settings-spinner"
                    aria-hidden="true"
                  />
                  Saving TITech settings…
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <span className="settings-status-dot" />
                  Unsaved changes
                </>
              ) : (
                <>
                  <Check
                    size={14}
                    aria-hidden="true"
                  />
                  All changes saved
                </>
              )}

            </div>

            <div className="settings-content-footer__tenant">
              {tenantId
                ? `Tenant: ${tenantId}`
                : 'TITech Community Capital'}
            </div>

          </footer>

        </main>
      </div>
    </div>
  );
}


/* ============================================================================
 * Metadata
 * ========================================================================== */

Settings.displayName =
  'TITechSettings';


/* ============================================================================
 * Export
 * ========================================================================== */

export default Settings;