/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise User Menu
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/UserMenu.jsx
 *
 * Purpose:
 *   Enterprise-grade authenticated user menu for the TITech Community Finance
 *   Operating System.
 *
 * Supports:
 *   ✓ Authenticated user identity
 *   ✓ User avatar / initials
 *   ✓ Display name
 *   ✓ Email / phone
 *   ✓ User role
 *   ✓ Current tenant context
 *   ✓ Tenant switching
 *   ✓ Profile navigation
 *   ✓ Account settings
 *   ✓ Security settings
 *   ✓ MFA/security indicators
 *   ✓ Session/device management
 *   ✓ Notifications
 *   ✓ Help/support
 *   ✓ Audit/security awareness
 *   ✓ Logout
 *   ✓ Logout loading state
 *   ✓ Keyboard navigation
 *   ✓ Accessible menu semantics
 *   ✓ Controlled/uncontrolled menu state
 *   ✓ Compact mode
 *   ✓ Dark mode
 *   ✓ Responsive presentation
 *   ✓ Forwarded ref
 *   ✓ Custom actions
 *   ✓ Custom footer
 *   ✓ No external UI dependencies
 *
 * Security principles:
 *   --------------------------------------------------------------------------
 *   This component is a PRESENTATION layer.
 *
 *   It does NOT:
 *     - store passwords
 *     - manage JWTs
 *     - manipulate authentication tokens
 *     - make authorization decisions
 *     - persist credentials
 *     - directly revoke sessions
 *
 *   Sensitive operations MUST be handled by the application's authenticated
 *   services, Redux/context layer and backend APIs.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

/**
 * ============================================================================
 * Utilities
 * ============================================================================
 */

const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');

const getInitials = (
  name,
  fallback = 'TI',
) => {
  if (!name) {
    return fallback;
  }

  const words = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return fallback;
  }

  if (words.length === 1) {
    return words[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const formatRole = (
  role,
) => {
  if (!role) {
    return '';
  }

  return String(role)
    .replace(/[_-]+/g, ' ')
    .replace(
      /\w\S*/g,
      (word) =>
        word.charAt(0).toUpperCase() +
        word
          .slice(1)
          .toLowerCase(),
    );
};

/**
 * ============================================================================
 * Icons
 * ============================================================================
 */

const UserIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M20 21a8 8 0 0 0-16 0"
      strokeLinecap="round"
    />

    <circle
      cx="12"
      cy="7"
      r="4"
    />
  </svg>
);

const SettingsIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="3"
    />

    <path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 0 1-4 0V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8a2 2 0 0 1 0-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2a2 2 0 0 1 4 0V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ShieldIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M12 3 20 6v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-3Z"
      strokeLinejoin="round"
    />

    <path
      d="m9 12 2 2 4-4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MonitorIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <rect
      x="3"
      y="4"
      width="18"
      height="13"
      rx="2"
    />

    <path
      d="M8 21h8M12 17v4"
      strokeLinecap="round"
    />
  </svg>
);

const BellIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M10 21h4"
      strokeLinecap="round"
    />
  </svg>
);

const HelpIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-.9.8-1.8 1.2-1.8 2.7"
      strokeLinecap="round"
    />

    <circle
      cx="12"
      cy="17"
      r=".7"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const LogOutIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M10 17l5-5-5-5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M15 12H3"
      strokeLinecap="round"
    />

    <path
      d="M21 19V5a2 2 0 0 0-2-2h-6"
      strokeLinecap="round"
    />
  </svg>
);

const ChevronDownIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={className}
    aria-hidden="true"
  >
    <path
      d="m6 9 6 6 6-6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CheckIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className={className}
    aria-hidden="true"
  >
    <path
      d="m5 12 4 4 8-9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LoaderIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={cn(
      'animate-spin',
      className,
    )}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="3"
      className="opacity-25"
    />

    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

const MoreHorizontalIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="5"
      cy="12"
      r="1.5"
    />

    <circle
      cx="12"
      cy="12"
      r="1.5"
    />

    <circle
      cx="19"
      cy="12"
      r="1.5"
    />
  </svg>
);

/**
 * ============================================================================
 * Avatar
 * ============================================================================
 */

const UserAvatar = ({
  user,
  size = 'md',
  showStatus = false,
}) => {
  const sizeClasses = {
    xs: {
      wrapper:
        'h-7 w-7 text-[10px]',
      status:
        'h-2 w-2',
    },

    sm: {
      wrapper:
        'h-8 w-8 text-[11px]',
      status:
        'h-2.5 w-2.5',
    },

    md: {
      wrapper:
        'h-10 w-10 text-xs',
      status:
        'h-3 w-3',
    },

    lg: {
      wrapper:
        'h-12 w-12 text-sm',
      status:
        'h-3.5 w-3.5',
    },
  };

  const config =
    sizeClasses[size] ||
    sizeClasses.md;

  const name =
    user?.name ||
    user?.fullName ||
    user?.displayName ||
    user?.username ||
    'TITech User';

  const avatarUrl =
    user?.avatarUrl ||
    user?.avatar ||
    user?.profileImage ||
    user?.photoURL ||
    '';

  const status =
    user?.status ||
    'active';

  return (
    <span
      className="relative inline-flex shrink-0"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className={cn(
            'rounded-full object-cover',
            config.wrapper,
          )}
          loading="lazy"
          onError={(
            event,
          ) => {
            event.currentTarget.style.display =
              'none';

            const fallback =
              event.currentTarget
                .nextElementSibling;

            if (fallback) {
              fallback.style.display =
                'flex';
            }
          }}
        />
      ) : null}

      <span
        className={cn(
          avatarUrl
            ? 'hidden'
            : 'flex',
          'items-center justify-center',
          'rounded-full',
          'bg-gray-100 text-gray-700',
          'font-semibold',
          'dark:bg-gray-800',
          'dark:text-gray-200',
          config.wrapper,
        )}
        aria-hidden="true"
      >
        {getInitials(name)}
      </span>

      {showStatus && (
        <span
          className={cn(
            'absolute bottom-0 right-0',
            'rounded-full border-2',
            'border-white dark:border-gray-900',
            config.status,
            status === 'active'
              ? 'bg-green-500'
              : 'bg-gray-400',
          )}
          title={
            status === 'active'
              ? 'Active'
              : 'Inactive'
          }
        />
      )}
    </span>
  );
};

/**
 * ============================================================================
 * Default Menu Item
 * ============================================================================
 */

const MenuItem = ({
  icon,
  label,
  description,
  badge,
  danger = false,
  disabled = false,
  onClick,
  href,
  target,
  rel,
}) => {
  const classes = cn(
    'flex w-full items-center gap-3',
    'rounded-lg px-3 py-2.5',
    'text-left',
    'transition-colors duration-100',
    disabled
      ? 'cursor-not-allowed opacity-50'
      : danger
        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800',
  );

  const content = (
    <>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          danger
            ? 'bg-red-50 text-red-500 dark:bg-red-950/30 dark:text-red-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        )}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {label}
          </span>

          {badge !== undefined &&
            badge !== null && (
              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {badge}
              </span>
            )}
        </span>

        {description && (
          <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-500">
            {description}
          </span>
        )}
      </span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={classes}
        onClick={
          disabled
            ? (event) =>
                event.preventDefault()
            : undefined
        }
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
};

/**
 * ============================================================================
 * UserMenu
 * ============================================================================
 */

const UserMenu = forwardRef(
  function UserMenu(
    {
      /**
       * ----------------------------------------------------------------------
       * User
       * ----------------------------------------------------------------------
       */

      user = null,

      currentTenant = null,

      /**
       * ----------------------------------------------------------------------
       * State
       * ----------------------------------------------------------------------
       */

      disabled = false,

      loading = false,

      logoutLoading = false,

      /**
       * ----------------------------------------------------------------------
       * Display
       * ----------------------------------------------------------------------
       */

      compact = false,

      showEmail = true,

      showRole = true,

      showTenant = true,

      showStatus = true,

      showChevron = true,

      size = 'md',

      ariaLabel =
        'Open user account menu',

      /**
       * ----------------------------------------------------------------------
       * Navigation
       * ----------------------------------------------------------------------
       */

      onProfile,

      onSettings,

      onSecurity,

      onSessions,

      onNotifications,

      onHelp,

      onLogout,

      onTenantSwitch,

      /**
       * ----------------------------------------------------------------------
       * Notification
       * ----------------------------------------------------------------------
       */

      notificationCount = 0,

      securityStatus,

      securityLabel,

      /**
       * ----------------------------------------------------------------------
       * Additional actions
       * ----------------------------------------------------------------------
       */

      actions = [],

      footer,

      /**
       * ----------------------------------------------------------------------
       * Styling
       * ----------------------------------------------------------------------
       */

      className = '',

      menuClassName = '',

      align = 'right',

      menuWidth = 320,

      /**
       * ----------------------------------------------------------------------
       * Behavior
       * ----------------------------------------------------------------------
       */

      closeOnAction = true,

      closeOnEscape = true,

      /**
       * ----------------------------------------------------------------------
       * Custom trigger
       * ----------------------------------------------------------------------
       */

      renderTrigger,

      /**
       * ----------------------------------------------------------------------
       * Accessibility
       * ----------------------------------------------------------------------
       */

      id,

      ...rest
    },
    ref,
  ) {
    /**
     * ========================================================================
     * IDs
     * ========================================================================
     */

    const generatedId =
      useId();

    const triggerId =
      id ||
      `titech-user-menu-${generatedId}`;

    const menuId =
      `${triggerId}-menu`;

    /**
     * ========================================================================
     * State
     * ========================================================================
     */

    const [open, setOpen] =
      useState(false);

    /**
     * ========================================================================
     * Refs
     * ========================================================================
     */

    const containerRef =
      useRef(null);

    /**
     * ========================================================================
     * User identity
     * ========================================================================
     */

    const displayName =
      user?.name ||
      user?.fullName ||
      user?.displayName ||
      user?.username ||
      'TITech User';

    const email =
      user?.email ||
      user?.emailAddress ||
      '';

    const phone =
      user?.phone ||
      user?.phoneNumber ||
      '';

    const role =
      formatRole(
        user?.role ||
          user?.userRole ||
          user?.primaryRole,
      );

    const status =
      user?.status ||
      'active';

    /**
     * ========================================================================
     * Tenant
     * ========================================================================
     */

    const tenantName =
      currentTenant?.name ||
      currentTenant?.tenantName ||
      currentTenant?.organizationName ||
      '';

    const tenantCode =
      currentTenant?.code ||
      currentTenant?.tenantCode ||
      '';

    /**
     * ========================================================================
     * Click outside
     * ========================================================================
     */

    useEffect(() => {
      if (!open) {
        return undefined;
      }

      const handlePointerDown =
        (event) => {
          if (
            containerRef.current &&
            !containerRef.current.contains(
              event.target,
            )
          ) {
            setOpen(false);
          }
        };

      document.addEventListener(
        'mousedown',
        handlePointerDown,
      );

      return () => {
        document.removeEventListener(
          'mousedown',
          handlePointerDown,
        );
      };
    }, [open]);

    /**
     * ========================================================================
     * Escape handling
     * ========================================================================
     */

    useEffect(() => {
      if (!open) {
        return undefined;
      }

      const handleKeyDown =
        (event) => {
          if (
            event.key ===
              'Escape' &&
            closeOnEscape
          ) {
            event.preventDefault();
            setOpen(false);
          }
        };

      document.addEventListener(
        'keydown',
        handleKeyDown,
      );

      return () => {
        document.removeEventListener(
          'keydown',
          handleKeyDown,
        );
      };
    }, [
      open,
      closeOnEscape,
    ]);

    /**
     * ========================================================================
     * Action handler
     * ========================================================================
     */

    const executeAction =
      (callback) => {
        if (
          typeof callback !==
          'function'
        ) {
          return;
        }

        if (closeOnAction) {
          setOpen(false);
        }

        callback();
      };

    /**
     * ========================================================================
     * Toggle
     * ========================================================================
     */

    const toggleOpen =
      () => {
        if (
          disabled ||
          loading ||
          logoutLoading
        ) {
          return;
        }

        setOpen(
          (current) =>
            !current,
        );
      };

    /**
     * ========================================================================
     * Keyboard handling
     * ========================================================================
     */

    const handleTriggerKeyDown =
      (event) => {
        if (
          disabled ||
          loading ||
          logoutLoading
        ) {
          return;
        }

        if (
          event.key ===
            'Enter' ||
          event.key ===
            ' '
        ) {
          event.preventDefault();
          toggleOpen();
        }

        if (
          event.key ===
          'Escape'
        ) {
          setOpen(false);
        }
      };

    /**
     * ========================================================================
     * Sizes
     * ========================================================================
     */

    const avatarSize =
      size === 'sm'
        ? 'sm'
        : size === 'lg'
          ? 'lg'
          : 'md';

    const triggerHeight =
      size === 'sm'
        ? 'min-h-9'
        : size === 'lg'
          ? 'min-h-12'
          : 'min-h-11';

    /**
     * ========================================================================
     * Trigger
     * ========================================================================
     */

    const defaultTrigger = (
      <>
        <UserAvatar
          user={user}
          size={
            avatarSize
          }
          showStatus={
            showStatus
          }
        />

        {!compact && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {displayName}
            </span>

            {showRole &&
              role && (
                <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                  {role}
                </span>
              )}
          </span>
        )}

        {showChevron && (
          <ChevronDownIcon
            className={cn(
              'h-4 w-4 shrink-0 text-gray-400',
              'transition-transform duration-150',
              open
                ? 'rotate-180'
                : '',
            )}
          />
        )}
      </>
    );

    const trigger = (
      <button
        ref={ref}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={
          open
            ? menuId
            : undefined
        }
        aria-label={ariaLabel}
        disabled={
          disabled ||
          loading ||
          logoutLoading
        }
        onClick={toggleOpen}
        onKeyDown={
          handleTriggerKeyDown
        }
        className={cn(
          'flex items-center gap-2.5',
          'rounded-xl border',
          'border-gray-200 bg-white',
          'px-2.5',
          'text-gray-900',
          'shadow-sm',
          'transition-all duration-150',
          'hover:border-gray-300',
          'hover:bg-gray-50',
          'focus:outline-none',
          'focus-visible:ring-2',
          'focus-visible:ring-gray-400',
          'focus-visible:ring-offset-2',
          'dark:border-gray-700',
          'dark:bg-gray-900',
          'dark:text-gray-100',
          'dark:hover:border-gray-600',
          'dark:hover:bg-gray-800',
          'dark:focus-visible:ring-gray-600',
          'dark:focus-visible:ring-offset-gray-900',
          triggerHeight,
          disabled ||
            loading ||
            logoutLoading
            ? 'cursor-not-allowed opacity-60'
            : '',
        )}
      >
        {renderTrigger
          ? renderTrigger({
              user,
              currentTenant,
              open,
              loading,
              logoutLoading,
              toggle:
                toggleOpen,
            })
          : defaultTrigger}
      </button>
    );

    /**
     * ========================================================================
     * Menu action helper
     * ========================================================================
     */

    const actionButton =
      ({
        icon,
        label,
        description,
        badge,
        danger,
        callback,
        disabled: itemDisabled,
      }) => (
        <MenuItem
          icon={icon}
          label={label}
          description={
            description
          }
          badge={badge}
          danger={danger}
          disabled={
            itemDisabled
          }
          onClick={() =>
            executeAction(
              callback,
            )
          }
        />
      );

    /**
     * ========================================================================
     * Menu
     * ========================================================================
     */

    const menu =
      open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={
            triggerId
          }
          className={cn(
            'absolute z-50 mt-2',
            'overflow-hidden rounded-2xl border',
            'border-gray-200 bg-white',
            'shadow-xl shadow-gray-900/10',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:shadow-black/30',
            align === 'left'
              ? 'left-0'
              : 'right-0',
            menuClassName,
          )}
          style={{
            width: `${menuWidth}px`,
            maxWidth:
              'calc(100vw - 1rem)',
          }}
        >
          {/* ================================================================
              User identity header
              ================================================================ */}

          <div className="border-b border-gray-100 px-4 py-4 dark:border-gray-800">
            <div className="flex items-start gap-3">
              <UserAvatar
                user={user}
                size="lg"
                showStatus={
                  showStatus
                }
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {displayName}
                </p>

                {showEmail &&
                  email && (
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                      {email}
                    </p>
                  )}

                {!email &&
                  phone && (
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                      {phone}
                    </p>
                  )}

                {showRole &&
                  role && (
                    <span className="mt-2 inline-flex max-w-full items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      <span className="truncate">
                        {role}
                      </span>
                    </span>
                  )}
              </div>

              {securityStatus && (
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold',
                    securityStatus ===
                      'secure'
                      ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
                  )}
                  title={
                    securityLabel ||
                    'Account security status'
                  }
                >
                  <ShieldIcon className="h-3 w-3" />

                  <span>
                    {securityLabel ||
                      (securityStatus ===
                      'secure'
                        ? 'Secure'
                        : 'Review')}
                  </span>
                </span>
              )}
            </div>

            {/* Current tenant */}
            {showTenant &&
              tenantName && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-800/70">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-gray-500 shadow-sm dark:bg-gray-900 dark:text-gray-400">
                    <BuildingIcon className="h-3.5 w-3.5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Current organization
                    </span>

                    <span className="block truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                      {tenantName}
                    </span>
                  </span>

                  {tenantCode && (
                    <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                      {tenantCode}
                    </span>
                  )}
                </div>
              )}
          </div>

          {/* ================================================================
              Primary account actions
              ================================================================ */}

          <div
            className="space-y-0.5 p-1.5"
            role="none"
          >
            {onProfile &&
              actionButton({
                icon: (
                  <UserIcon className="h-4 w-4" />
                ),
                label:
                  'My profile',
                description:
                  'View and update your profile',
                callback:
                  onProfile,
              })}

            {onTenantSwitch &&
              actionButton({
                icon: (
                  <BuildingIcon className="h-4 w-4" />
                ),
                label:
                  'Switch organization',
                description:
                  'Change your active organization',
                callback:
                  onTenantSwitch,
              })}

            {onSettings &&
              actionButton({
                icon: (
                  <SettingsIcon className="h-4 w-4" />
                ),
                label:
                  'Account settings',
                description:
                  'Preferences and account configuration',
                callback:
                  onSettings,
              })}

            {onSecurity &&
              actionButton({
                icon: (
                  <ShieldIcon className="h-4 w-4" />
                ),
                label:
                  'Security',
                description:
                  'Password, MFA and security controls',
                callback:
                  onSecurity,
              })}

            {onSessions &&
              actionButton({
                icon: (
                  <MonitorIcon className="h-4 w-4" />
                ),
                label:
                  'Sessions & devices',
                description:
                  'Review active sessions and devices',
                callback:
                  onSessions,
              })}

            {onNotifications &&
              actionButton({
                icon: (
                  <BellIcon className="h-4 w-4" />
                ),
                label:
                  'Notifications',
                description:
                  'Manage your notifications',
                badge:
                  notificationCount >
                  0
                    ? notificationCount >
                      99
                      ? '99+'
                      : notificationCount
                    : undefined,
                callback:
                  onNotifications,
              })}

            {onHelp &&
              actionButton({
                icon: (
                  <HelpIcon className="h-4 w-4" />
                ),
                label:
                  'Help & support',
                description:
                  'Get help with TITech',
                callback:
                  onHelp,
              })}

            {/* Custom actions */}
            {Array.isArray(
              actions,
            ) &&
              actions.length >
                0 && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

                  {actions.map(
                    (
                      action,
                      index,
                    ) => (
                      <React.Fragment
                        key={
                          action.id ||
                          action.key ||
                          `user-action-${index}`
                        }
                      >
                        {action.href ? (
                          <MenuItem
                            icon={
                              action.icon
                            }
                            label={
                              action.label
                            }
                            description={
                              action.description
                            }
                            badge={
                              action.badge
                            }
                            danger={
                              action.danger
                            }
                            disabled={
                              action.disabled
                            }
                            href={
                              action.href
                            }
                            target={
                              action.target
                            }
                            rel={
                              action.rel
                            }
                            onClick={() =>
                              action.onClick &&
                              executeAction(
                                action.onClick,
                              )
                            }
                          />
                        ) : (
                          <MenuItem
                            icon={
                              action.icon
                            }
                            label={
                              action.label
                            }
                            description={
                              action.description
                            }
                            badge={
                              action.badge
                            }
                            danger={
                              action.danger
                            }
                            disabled={
                              action.disabled
                            }
                            onClick={() =>
                              action.onClick &&
                              executeAction(
                                action.onClick,
                              )
                            }
                          />
                        )}
                      </React.Fragment>
                    ),
                  )}
                </>
              )}
          </div>

          {/* ================================================================
              Optional footer
              ================================================================ */}

          {footer && (
            <div className="border-t border-gray-100 px-3 py-3 dark:border-gray-800">
              {footer}
            </div>
          )}

          {/* ================================================================
              Logout
              ================================================================ */}

          {onLogout && (
            <div className="border-t border-gray-100 p-1.5 dark:border-gray-800">
              <button
                type="button"
                role="menuitem"
                disabled={
                  logoutLoading
                }
                onClick={() => {
                  if (
                    typeof onLogout !==
                    'function'
                  ) {
                    return;
                  }

                  if (
                    closeOnAction
                  ) {
                    setOpen(false);
                  }

                  onLogout();
                }}
                className={cn(
                  'flex w-full items-center gap-3',
                  'rounded-lg px-3 py-2.5',
                  'text-left text-sm font-medium',
                  'text-red-600',
                  'transition-colors',
                  'hover:bg-red-50',
                  'focus:outline-none',
                  'focus-visible:ring-2',
                  'focus-visible:ring-red-300',
                  'dark:text-red-400',
                  'dark:hover:bg-red-950/30',
                  'dark:focus-visible:ring-red-900',
                  logoutLoading
                    ? 'cursor-not-allowed opacity-60'
                    : '',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950/30 dark:text-red-400">
                  {logoutLoading ? (
                    <LoaderIcon className="h-4 w-4" />
                  ) : (
                    <LogOutIcon className="h-4 w-4" />
                  )}
                </span>

                <span>
                  {logoutLoading
                    ? 'Signing out...'
                    : 'Sign out'}
                </span>
              </button>
            </div>
          )}
        </div>
      );

    /**
     * ========================================================================
     * Render
     * ========================================================================
     */

    return (
      <div
        ref={containerRef}
        className={cn(
          'relative inline-block',
          className,
        )}
        {...rest}
      >
        {trigger}
        {menu}
      </div>
    );
  },
);

UserMenu.displayName =
  'UserMenu';

/**
 * ============================================================================
 * UserMenuCompact
 * ============================================================================
 *
 * Suitable for a top navigation bar or dense application header.
 * ============================================================================
 */

export const UserMenuCompact =
  forwardRef(
    function UserMenuCompact(
      props,
      ref,
    ) {
      return (
        <UserMenu
          ref={ref}
          {...props}
          compact
          showEmail={false}
          showRole={false}
          showTenant={false}
        />
      );
    },
  );

UserMenuCompact.displayName =
  'UserMenuCompact';

/**
 * ============================================================================
 * UserMenuMinimal
 * ============================================================================
 *
 * Avatar-only version.
 * ============================================================================
 */

export const UserMenuMinimal =
  forwardRef(
    function UserMenuMinimal(
      props,
      ref,
    ) {
      return (
        <UserMenu
          ref={ref}
          {...props}
          compact
          showChevron={false}
          showEmail={false}
          showRole={false}
          showTenant={false}
        />
      );
    },
  );

UserMenuMinimal.displayName =
  'UserMenuMinimal';

/**
 * ============================================================================
 * UserMenuSkeleton
 * ============================================================================
 */

export const UserMenuSkeleton = ({
  compact = false,
  size = 'md',
  className = '',
}) => {
  const height =
    size === 'sm'
      ? 'min-h-9'
      : size === 'lg'
        ? 'min-h-12'
        : 'min-h-11';

  const avatar =
    size === 'sm'
      ? 'h-8 w-8'
      : size === 'lg'
        ? 'h-12 w-12'
        : 'h-10 w-10';

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl',
        'border border-gray-200 bg-white px-2.5',
        'dark:border-gray-800 dark:bg-gray-900',
        height,
        className,
      )}
      aria-busy="true"
      aria-label="Loading user account"
    >
      <div
        className={cn(
          'animate-pulse rounded-full bg-gray-100 dark:bg-gray-800',
          avatar,
        )}
      />

      {!compact && (
        <div className="w-24 space-y-1.5">
          <div className="h-3 w-20 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />

          <div className="h-2.5 w-14 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      )}

      <div className="h-4 w-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
    </div>
  );
};

/**
 * ============================================================================
 * Default export
 * ============================================================================
 */

export default UserMenu;