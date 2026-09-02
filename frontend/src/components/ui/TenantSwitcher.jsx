/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenant Switcher
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/TenantSwitcher.jsx
 *
 * Purpose:
 *   Enterprise-grade multi-tenant organization/tenant selector for TITech.
 *
 * Designed for:
 *   - SACCOs
 *   - VSLA groups
 *   - Savings groups
 *   - Cooperatives
 *   - Microfinance institutions
 *   - Community development organizations
 *   - Branches
 *   - Regional organizations
 *   - Multi-organization users
 *
 * Features:
 *   ✓ Controlled and uncontrolled modes
 *   ✓ Multi-tenant organization selection
 *   ✓ Tenant search
 *   ✓ Keyboard navigation
 *   ✓ Accessible combobox/listbox semantics
 *   ✓ Loading state
 *   ✓ Switching state
 *   ✓ Disabled tenants
 *   ✓ Tenant status
 *   ✓ Tenant type
 *   ✓ Tenant code
 *   ✓ Tenant logo / avatar
 *   ✓ Tenant initials fallback
 *   ✓ Role display
 *   ✓ Branch display
 *   ✓ Active tenant indicator
 *   ✓ Optional tenant metadata
 *   ✓ Optional "Manage organizations" action
 *   ✓ Optional "Add organization" action
 *   ✓ Compact mode
 *   ✓ Full mode
 *   ✓ Dark mode
 *   ✓ Responsive UI
 *   ✓ Forwarded refs
 *   ✓ No external UI dependencies
 *   ✓ No automatic localStorage persistence
 *   ✓ No business logic hidden inside the component
 *
 * Security architecture:
 *   This component NEVER treats the selected tenant as an authorization
 *   boundary. Tenant authorization MUST be enforced by the backend/API and
 *   the authenticated user's tenant membership/permissions.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * ============================================================================
 * Utility
 * ============================================================================
 */

const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');

/**
 * ============================================================================
 * Icons
 * ============================================================================
 */

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
      d="m5 12 4 4L19 6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = ({
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
    <circle
      cx="11"
      cy="11"
      r="7"
    />

    <path
      d="m20 20-4-4"
      strokeLinecap="round"
    />
  </svg>
);

const BuildingIcon = ({
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
      d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M2 21h20"
      strokeLinecap="round"
    />

    <path
      d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"
      strokeLinecap="round"
    />
  </svg>
);

const PlusIcon = ({
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
      d="M12 5v14M5 12h14"
      strokeLinecap="round"
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
    <path
      d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
    />

    <path
      d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 3.6 12a2 2 0 0 0-.6-1.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.2 6.4h.2a2 2 0 0 0 1.4-.6 2 2 0 0 0 .6-1.4v-.2a2 2 0 1 1 4 0v.2a2 2 0 0 0 1.4 1.4h.2a2 2 0 0 0 1.4-.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0-.6 1.4v.2a2 2 0 0 0 .6 1.4l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-1.4-.6 2 2 0 0 0-1.4.6Z"
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

const XIcon = ({
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
      d="m7 7 10 10M17 7 7 17"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * ============================================================================
 * Avatar
 * ============================================================================
 */

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

const TenantAvatar = ({
  tenant,
  size = 'md',
}) => {
  const sizeClasses = {
    sm: 'h-7 w-7 text-[10px]',
    md: 'h-9 w-9 text-xs',
    lg: 'h-10 w-10 text-sm',
  };

  const classes =
    sizeClasses[size] ||
    sizeClasses.md;

  const name =
    tenant?.name ||
    tenant?.tenantName ||
    tenant?.organizationName ||
    'TITech';

  const logo =
    tenant?.logoUrl ||
    tenant?.logo ||
    tenant?.avatarUrl;

  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(
          'shrink-0 rounded-lg object-cover',
          classes,
        )}
        loading="lazy"
        onError={(event) => {
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
    );
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        'rounded-lg bg-gray-100 font-semibold',
        'text-gray-700',
        'dark:bg-gray-800 dark:text-gray-200',
        classes,
      )}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
};

/**
 * ============================================================================
 * Tenant Normalization
 * ============================================================================
 *
 * Allows APIs with slightly different property names to feed the component
 * without forcing presentation-specific transformation throughout the app.
 * ============================================================================
 */

const normalizeTenant = (
  tenant,
) => {
  if (
    !tenant ||
    typeof tenant !== 'object'
  ) {
    return null;
  }

  const id =
    tenant.id ??
    tenant.tenantId ??
    tenant.organizationId ??
    tenant.uuid;

  const name =
    tenant.name ??
    tenant.tenantName ??
    tenant.organizationName ??
    tenant.displayName ??
    'Unnamed organization';

  return {
    ...tenant,

    id:
      id === null ||
      id === undefined
        ? ''
        : String(id),

    name: String(name),

    code:
      tenant.code ??
      tenant.tenantCode ??
      tenant.organizationCode ??
      '',

    type:
      tenant.type ??
      tenant.tenantType ??
      tenant.organizationType ??
      '',

    role:
      tenant.role ??
      tenant.userRole ??
      tenant.membershipRole ??
      '',

    branch:
      tenant.branch ??
      tenant.branchName ??
      '',

    status:
      tenant.status ??
      'active',

    disabled:
      Boolean(
        tenant.disabled ||
          tenant.isDisabled,
      ),

    logoUrl:
      tenant.logoUrl ??
      tenant.logo ??
      tenant.avatarUrl ??
      '',
  };
};

/**
 * ============================================================================
 * Search matching
 * ============================================================================
 */

const tenantMatchesSearch = (
  tenant,
  query,
) => {
  const normalizedQuery =
    String(query)
      .trim()
      .toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    tenant.name,
    tenant.code,
    tenant.type,
    tenant.role,
    tenant.branch,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(
    normalizedQuery,
  );
};

/**
 * ============================================================================
 * TenantSwitcher
 * ============================================================================
 */

const TenantSwitcher = forwardRef(
  function TenantSwitcher(
    {
      /**
       * ----------------------------------------------------------------------
       * Tenant data
       * ----------------------------------------------------------------------
       */

      tenants = [],

      value,

      defaultTenantId,

      onTenantChange,

      /**
       * ----------------------------------------------------------------------
       * State
       * ----------------------------------------------------------------------
       */

      loading = false,

      switching = false,

      disabled = false,

      /**
       * ----------------------------------------------------------------------
       * Search
       * ----------------------------------------------------------------------
       */

      searchable = true,

      searchPlaceholder =
        'Search organizations...',

      emptyMessage =
        'No organizations found',

      /**
       * ----------------------------------------------------------------------
       * Display
       * ----------------------------------------------------------------------
       */

      placeholder =
        'Select organization',

      showTenantType = true,

      showRole = true,

      showCode = true,

      showBranch = false,

      showStatus = false,

      showChevron = true,

      showSelectedCheck = true,

      showSearchIcon = true,

      /**
       * ----------------------------------------------------------------------
       * Layout
       * ----------------------------------------------------------------------
       */

      size = 'md',

      fullWidth = false,

      compact = false,

      align = 'left',

      maxHeight = 360,

      /**
       * ----------------------------------------------------------------------
       * Actions
       * ----------------------------------------------------------------------
       */

      showManage = false,

      manageLabel =
        'Manage organizations',

      onManage,

      showAdd = false,

      addLabel =
        'Add organization',

      onAdd,

      /**
       * ----------------------------------------------------------------------
       * Accessibility
       * ----------------------------------------------------------------------
       */

      ariaLabel =
        'Select organization',

      id,

      /**
       * ----------------------------------------------------------------------
       * Styling
       * ----------------------------------------------------------------------
       */

      className = '',

      triggerClassName = '',

      menuClassName = '',

      tenantClassName = '',

      /**
       * ----------------------------------------------------------------------
       * Custom rendering
       * ----------------------------------------------------------------------
       */

      renderTenant,

      renderTrigger,

      /**
       * ----------------------------------------------------------------------
       * Events
       * ----------------------------------------------------------------------
       */

      closeOnSelect = true,

      closeOnEscape = true,

      /**
       * ----------------------------------------------------------------------
       * Other
       * ----------------------------------------------------------------------
       */

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
      `titech-tenant-switcher-${generatedId}`;

    const listboxId =
      `${triggerId}-listbox`;

    /**
     * ========================================================================
     * State
     * ========================================================================
     */

    const [open, setOpen] =
      useState(false);

    const [
      internalTenantId,
      setInternalTenantId,
    ] = useState(
      defaultTenantId ??
        null,
    );

    const [
      search,
      setSearch,
    ] = useState('');

    const [
      highlightedIndex,
      setHighlightedIndex,
    ] = useState(0);

    /**
     * ========================================================================
     * Refs
     * ========================================================================
     */

    const containerRef =
      useRef(null);

    const searchInputRef =
      useRef(null);

    const optionRefs =
      useRef([]);

    /**
     * ========================================================================
     * Normalize tenants
     * ========================================================================
     */

    const normalizedTenants =
      useMemo(
        () =>
          Array.isArray(tenants)
            ? tenants
                .map(
                  normalizeTenant,
                )
                .filter(Boolean)
            : [],
        [tenants],
      );

    /**
     * ========================================================================
     * Controlled / uncontrolled value
     * ========================================================================
     */

    const isControlled =
      value !== undefined;

    const selectedTenantId =
      isControlled
        ? value
        : internalTenantId;

    /**
     * ========================================================================
     * Selected tenant
     * ========================================================================
     */

    const selectedTenant =
      useMemo(() => {
        if (
          selectedTenantId ===
            null ||
          selectedTenantId ===
            undefined
        ) {
          return (
            normalizedTenants.find(
              (tenant) =>
                tenant.selected ===
                true,
            ) || null
          );
        }

        return (
          normalizedTenants.find(
            (tenant) =>
              String(
                tenant.id,
              ) ===
              String(
                selectedTenantId,
              ),
          ) || null
        );
      }, [
        normalizedTenants,
        selectedTenantId,
      ]);

    /**
     * ========================================================================
     * Filtered tenants
     * ========================================================================
     */

    const filteredTenants =
      useMemo(
        () =>
          normalizedTenants.filter(
            (tenant) =>
              tenantMatchesSearch(
                tenant,
                search,
              ),
          ),
        [
          normalizedTenants,
          search,
        ],
      );

    /**
     * ========================================================================
     * Selectable tenants
     * ========================================================================
     */

    const selectableTenants =
      useMemo(
        () =>
          filteredTenants.filter(
            (tenant) =>
              !tenant.disabled,
          ),
        [filteredTenants],
      );

    /**
     * ========================================================================
     * Keep highlighted index valid
     * ========================================================================
     */

    useEffect(() => {
      if (
        highlightedIndex >=
        selectableTenants.length
      ) {
        setHighlightedIndex(
          Math.max(
            0,
            selectableTenants.length -
              1,
          ),
        );
      }
    }, [
      selectableTenants.length,
      highlightedIndex,
    ]);

    /**
     * ========================================================================
     * Close when clicking outside
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
            setSearch('');
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
     * Focus search when opened
     * ========================================================================
     */

    useEffect(() => {
      if (
        open &&
        searchable &&
        searchInputRef.current
      ) {
        const timer =
          window.setTimeout(
            () => {
              searchInputRef.current?.focus();
            },
            0,
          );

        return () =>
          window.clearTimeout(
            timer,
          );
      }

      return undefined;
    }, [
      open,
      searchable,
    ]);

    /**
     * ========================================================================
     * Reset search on close
     * ========================================================================
     */

    useEffect(() => {
      if (!open) {
        setSearch('');
        setHighlightedIndex(0);
      }
    }, [open]);

    /**
     * ========================================================================
     * Keyboard navigation
     * ========================================================================
     */

    const handleKeyDown =
      (event) => {
        if (
          disabled ||
          loading ||
          switching
        ) {
          return;
        }

        if (
          event.key ===
          'Escape'
        ) {
          if (
            open &&
            closeOnEscape
          ) {
            event.preventDefault();
            setOpen(false);
            setSearch('');
          }

          return;
        }

        if (
          event.key ===
            'Enter' &&
          !open
        ) {
          event.preventDefault();
          setOpen(true);
          return;
        }

        if (
          event.key ===
            ' ' &&
          !open
        ) {
          event.preventDefault();
          setOpen(true);
          return;
        }

        if (
          !open ||
          !selectableTenants.length
        ) {
          return;
        }

        if (
          event.key ===
          'ArrowDown'
        ) {
          event.preventDefault();

          setHighlightedIndex(
            (
              current,
            ) =>
              current <
              selectableTenants.length -
                1
                ? current + 1
                : 0,
          );

          return;
        }

        if (
          event.key ===
          'ArrowUp'
        ) {
          event.preventDefault();

          setHighlightedIndex(
            (
              current,
            ) =>
              current > 0
                ? current - 1
                : selectableTenants.length -
                  1,
          );

          return;
        }

        if (
          event.key ===
          'Home'
        ) {
          event.preventDefault();
          setHighlightedIndex(0);
          return;
        }

        if (
          event.key ===
          'End'
        ) {
          event.preventDefault();

          setHighlightedIndex(
            selectableTenants.length -
              1,
          );

          return;
        }

        if (
          event.key ===
            'Enter' ||
          event.key ===
            ' '
        ) {
          event.preventDefault();

          const tenant =
            selectableTenants[
              highlightedIndex
            ];

          if (tenant) {
            handleTenantSelect(
              tenant,
            );
          }
        }
      };

    /**
     * ========================================================================
     * Tenant selection
     * ========================================================================
     */

    const handleTenantSelect =
      async (tenant) => {
        if (
          !tenant ||
          tenant.disabled ||
          disabled ||
          loading ||
          switching
        ) {
          return;
        }

        const tenantId =
          tenant.id;

        /**
         * Update uncontrolled state immediately.
         *
         * In controlled mode the parent owns the selected tenant.
         */
        if (!isControlled) {
          setInternalTenantId(
            tenantId,
          );
        }

        /**
         * Close the menu before invoking the external operation.
         * This prevents duplicate clicks while the application performs
         * tenant/session switching.
         */
        if (closeOnSelect) {
          setOpen(false);
          setSearch('');
        }

        if (
          typeof onTenantChange ===
          'function'
        ) {
          await onTenantChange(
            tenant,
          );
        }
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
          switching
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
     * Size configuration
     * ========================================================================
     */

    const sizeConfig = {
      sm: {
        trigger:
          'min-h-9 px-2.5',
        avatar:
          'sm',
        name:
          'text-xs',
        meta:
          'text-[10px]',
      },

      md: {
        trigger:
          'min-h-11 px-3',
        avatar:
          'md',
        name:
          'text-sm',
        meta:
          'text-xs',
      },

      lg: {
        trigger:
          'min-h-12 px-3.5',
        avatar:
          'lg',
        name:
          'text-sm',
        meta:
          'text-xs',
      },
    };

    const selectedSize =
      sizeConfig[size] ||
      sizeConfig.md;

    /**
     * ========================================================================
     * Alignment
     * ========================================================================
     */

    const alignmentClass =
      align === 'right'
        ? 'right-0'
        : 'left-0';

    /**
     * ========================================================================
     * Trigger label
     * ========================================================================
     */

    const triggerName =
      selectedTenant?.name ||
      placeholder;

    const triggerMeta =
      selectedTenant
        ? [
            showTenantType &&
            selectedTenant.type,
            showCode &&
            selectedTenant.code,
          ]
            .filter(Boolean)
            .join(' • ')
        : '';

    /**
     * ========================================================================
     * Loading / empty state
     * ========================================================================
     */

    const isEmpty =
      !loading &&
      normalizedTenants.length ===
        0;

    /**
     * ========================================================================
     * Trigger content
     * ========================================================================
     */

    const defaultTrigger =
      (
        <>
          <TenantAvatar
            tenant={
              selectedTenant || {
                name: 'TITech',
              }
            }
            size={
              selectedSize.avatar
            }
          />

          {!compact && (
            <span className="min-w-0 flex-1 text-left">
              <span
                className={cn(
                  'block truncate font-medium',
                  'text-gray-900',
                  'dark:text-gray-100',
                  selectedSize.name,
                )}
              >
                {loading
                  ? 'Loading organizations...'
                  : switching
                    ? 'Switching organization...'
                    : triggerName}
              </span>

              {triggerMeta && (
                <span
                  className={cn(
                    'mt-0.5 block truncate',
                    'text-gray-500',
                    'dark:text-gray-400',
                    selectedSize.meta,
                  )}
                >
                  {triggerMeta}
                </span>
              )}
            </span>
          )}

          {switching ? (
            <LoaderIcon className="h-4 w-4 shrink-0" />
          ) : (
            showChevron && (
              <ChevronDownIcon
                className={cn(
                  'h-4 w-4 shrink-0',
                  'text-gray-400 transition-transform',
                  open
                    ? 'rotate-180'
                    : '',
                )}
              />
            )
          )}
        </>
      );

    /**
     * ========================================================================
     * Trigger
     * ========================================================================
     */

    const trigger = (
      <button
        ref={ref}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={
          open
            ? listboxId
            : undefined
        }
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={
          disabled ||
          loading ||
          switching
        }
        onClick={toggleOpen}
        onKeyDown={
          handleKeyDown
        }
        className={cn(
          'flex w-full items-center gap-2.5',
          'rounded-xl border',
          'border-gray-200 bg-white',
          'text-gray-900',
          'shadow-sm',
          'transition-all duration-150',
          'hover:border-gray-300 hover:bg-gray-50',
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
          selectedSize.trigger,
          fullWidth
            ? 'w-full'
            : '',
          disabled ||
            loading ||
            switching
            ? 'cursor-not-allowed opacity-60'
            : '',
          triggerClassName,
        )}
      >
        {renderTrigger
          ? renderTrigger({
              tenant:
                selectedTenant,
              open,
              switching,
              loading,
              toggle:
                toggleOpen,
            })
          : defaultTrigger}
      </button>
    );

    /**
     * ========================================================================
     * Tenant option
     * ========================================================================
     */

    const renderTenantOption =
      (
        tenant,
        index,
      ) => {
        const isSelected =
          selectedTenant &&
          String(
            selectedTenant.id,
          ) ===
            String(
              tenant.id,
            );

        const selectableIndex =
          selectableTenants.findIndex(
            (item) =>
              String(
                item.id,
              ) ===
              String(
                tenant.id,
              ),
          );

        const isHighlighted =
          !tenant.disabled &&
          selectableIndex ===
            highlightedIndex;

        if (
          renderTenant
        ) {
          return renderTenant({
            tenant,
            index,
            isSelected,
            isHighlighted,
            onSelect:
              handleTenantSelect,
          });
        }

        return (
          <button
            key={
              tenant.id ||
              `tenant-${index}`
            }
            ref={(element) => {
              if (
                !tenant.disabled &&
                selectableIndex >= 0
              ) {
                optionRefs.current[
                  selectableIndex
                ] = element;
              }
            }}
            type="button"
            role="option"
            aria-selected={
              isSelected
            }
            aria-disabled={
              tenant.disabled ||
              undefined
            }
            disabled={
              tenant.disabled
            }
            onClick={() =>
              handleTenantSelect(
                tenant,
              )
            }
            onMouseEnter={() => {
              if (
                !tenant.disabled &&
                selectableIndex >= 0
              ) {
                setHighlightedIndex(
                  selectableIndex,
                );
              }
            }}
            className={cn(
              'flex w-full items-center gap-3',
              'px-3 py-2.5 text-left',
              'transition-colors duration-100',
              isHighlighted
                ? 'bg-gray-50 dark:bg-gray-800'
                : '',
              isSelected
                ? 'bg-gray-50/80 dark:bg-gray-800/70'
                : '',
              tenant.disabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer',
              tenantClassName,
            )}
          >
            <TenantAvatar
              tenant={tenant}
              size="md"
            />

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'truncate text-sm font-medium',
                    'text-gray-900',
                    'dark:text-gray-100',
                  )}
                >
                  {tenant.name}
                </span>

                {showStatus &&
                  tenant.status && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5',
                        'text-[10px] font-medium',
                        tenant.status ===
                          'active'
                          ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                      )}
                    >
                      {tenant.status}
                    </span>
                  )}
              </span>

              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {showTenantType &&
                  tenant.type && (
                    <span className="truncate">
                      {tenant.type}
                    </span>
                  )}

                {showCode &&
                  tenant.code && (
                    <>
                      {showTenantType &&
                        tenant.type && (
                          <span
                            aria-hidden="true"
                            className="text-gray-300 dark:text-gray-600"
                          >
                            •
                          </span>
                        )}

                      <span className="truncate font-mono text-[11px]">
                        {tenant.code}
                      </span>
                    </>
                  )}

                {showRole &&
                  tenant.role && (
                    <>
                      {(tenant.type ||
                        tenant.code) && (
                        <span
                          aria-hidden="true"
                          className="text-gray-300 dark:text-gray-600"
                        >
                          •
                        </span>
                      )}

                      <span className="truncate">
                        {tenant.role}
                      </span>
                    </>
                  )}

                {showBranch &&
                  tenant.branch && (
                    <>
                      <span
                        aria-hidden="true"
                        className="text-gray-300 dark:text-gray-600"
                      >
                        •
                      </span>

                      <span className="truncate">
                        {tenant.branch}
                      </span>
                    </>
                  )}
              </span>
            </span>

            {isSelected &&
              showSelectedCheck && (
                <span
                  className="shrink-0 text-gray-900 dark:text-white"
                  aria-hidden="true"
                >
                  <CheckIcon />
                </span>
              )}
          </button>
        );
      };

    /**
     * ========================================================================
     * Dropdown
     * ========================================================================
     */

    const dropdown =
      open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={
            ariaLabel
          }
          className={cn(
            'absolute z-50 mt-2 w-full min-w-[280px]',
            'overflow-hidden rounded-xl border',
            'border-gray-200 bg-white',
            'shadow-xl shadow-gray-900/10',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:shadow-black/30',
            alignmentClass,
            menuClassName,
          )}
        >
          {/* Search */}
          {searchable &&
            normalizedTenants.length >
              0 && (
              <div className="border-b border-gray-100 p-2 dark:border-gray-800">
                <div className="relative">
                  {showSearchIcon && (
                    <SearchIcon
                      className={cn(
                        'pointer-events-none absolute left-3 top-1/2',
                        '-translate-y-1/2',
                        'h-4 w-4 text-gray-400',
                      )}
                    />
                  )}

                  <input
                    ref={
                      searchInputRef
                    }
                    type="search"
                    value={search}
                    onChange={(
                      event,
                    ) => {
                      setSearch(
                        event
                          .target
                          .value,
                      );

                      setHighlightedIndex(
                        0,
                      );
                    }}
                    onKeyDown={
                      handleKeyDown
                    }
                    placeholder={
                      searchPlaceholder
                    }
                    className={cn(
                      'w-full rounded-lg border',
                      'border-gray-200 bg-gray-50',
                      'py-2 text-sm text-gray-900',
                      'placeholder:text-gray-400',
                      'focus:border-gray-400',
                      'focus:outline-none focus:ring-2',
                      'focus:ring-gray-200',
                      'dark:border-gray-700',
                      'dark:bg-gray-800',
                      'dark:text-gray-100',
                      'dark:placeholder:text-gray-500',
                      'dark:focus:border-gray-600',
                      'dark:focus:ring-gray-700',
                      showSearchIcon
                        ? 'pl-9 pr-8'
                        : 'px-3 pr-8',
                    )}
                    aria-label={
                      searchPlaceholder
                    }
                  />

                  {search && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      onClick={() => {
                        setSearch(
                          '',
                        );

                        setHighlightedIndex(
                          0,
                        );

                        searchInputRef.current?.focus();
                      }}
                      aria-label="Clear organization search"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

          {/* Tenant list */}
          <div
            className="overflow-y-auto py-1"
            style={{
              maxHeight,
            }}
          >
            {loading ? (
              <div className="space-y-1 p-2">
                {[
                  1, 2, 3,
                ].map(
                  (item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                    >
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />

                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />

                        <div className="h-2.5 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : filteredTenants.length >
              0 ? (
              filteredTenants.map(
                renderTenantOption,
              )
            ) : (
              <div className="px-4 py-8 text-center">
                <BuildingIcon className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />

                <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isEmpty
                    ? 'No organizations available'
                    : emptyMessage}
                </p>

                {search && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                    Try a different
                    organization
                    name or code.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer actions */}
          {(showManage ||
            showAdd) && (
            <div className="border-t border-gray-100 bg-gray-50/70 p-1.5 dark:border-gray-800 dark:bg-gray-950/50">
              {showManage &&
                onManage && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800"
                    onClick={() => {
                      setOpen(false);
                      onManage();
                    }}
                  >
                    <SettingsIcon className="h-4 w-4 text-gray-400" />

                    <span>
                      {manageLabel}
                    </span>
                  </button>
                )}

              {showAdd &&
                onAdd && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800"
                    onClick={() => {
                      setOpen(false);
                      onAdd();
                    }}
                  >
                    <PlusIcon className="h-4 w-4 text-gray-400" />

                    <span>
                      {addLabel}
                    </span>
                  </button>
                )}
            </div>
          )}
        </div>
      );

    /**
     * ========================================================================
     * Root
     * ========================================================================
     */

    return (
      <div
        ref={containerRef}
        className={cn(
          'relative',
          fullWidth
            ? 'w-full'
            : 'w-auto',
          className,
        )}
        {...rest}
      >
        {renderTrigger
          ? (
            <div
              className="relative"
            >
              {trigger}
              {dropdown}
            </div>
          )
          : (
            <>
              {trigger}
              {dropdown}
            </>
          )}
      </div>
    );
  },
);

TenantSwitcher.displayName =
  'TenantSwitcher';

/**
 * ============================================================================
 * TenantSwitcherSkeleton
 * ============================================================================
 */

export const TenantSwitcherSkeleton = ({
  size = 'md',
  compact = false,
  fullWidth = false,
  className = '',
}) => {
  const height =
    size === 'sm'
      ? 'h-9'
      : size === 'lg'
        ? 'h-12'
        : 'h-11';

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl',
        'border border-gray-200 bg-white px-3',
        'dark:border-gray-800 dark:bg-gray-900',
        height,
        fullWidth
          ? 'w-full'
          : 'w-[220px]',
        className,
      )}
      aria-busy="true"
      aria-label="Loading organizations"
    >
      <div
        className={cn(
          'shrink-0 animate-pulse rounded-lg',
          size === 'sm'
            ? 'h-7 w-7'
            : size === 'lg'
              ? 'h-10 w-10'
              : 'h-9 w-9',
          'bg-gray-100 dark:bg-gray-800',
        )}
      />

      {!compact && (
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />

          <div className="h-2.5 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      )}

      <div className="h-4 w-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
    </div>
  );
};

/**
 * ============================================================================
 * TenantSwitcherCompact
 * ============================================================================
 */

export const TenantSwitcherCompact =
  forwardRef(
    function TenantSwitcherCompact(
      props,
      ref,
    ) {
      return (
        <TenantSwitcher
          ref={ref}
          {...props}
          compact
          showTenantType={false}
          showRole={false}
          showCode={false}
        />
      );
    },
  );

TenantSwitcherCompact.displayName =
  'TenantSwitcherCompact';

/**
 * ============================================================================
 * TenantSwitcherFull
 * ============================================================================
 */

export const TenantSwitcherFull =
  forwardRef(
    function TenantSwitcherFull(
      props,
      ref,
    ) {
      return (
        <TenantSwitcher
          ref={ref}
          {...props}
          fullWidth
          showTenantType
          showRole
          showCode
        />
      );
    },
  );

TenantSwitcherFull.displayName =
  'TenantSwitcherFull';

/**
 * ============================================================================
 * Default Export
 * ============================================================================
 */

export default TenantSwitcher;