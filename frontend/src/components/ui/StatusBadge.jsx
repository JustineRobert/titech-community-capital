/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise StatusBadge Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/StatusBadge.jsx
 *
 * Purpose:
 *   Standardized status indicator for the TITech Community Capital platform.
 *
 * Designed for:
 *   - Transaction status
 *   - Loan status
 *   - Savings status
 *   - Member status
 *   - Account status
 *   - KYC status
 *   - Approval status
 *   - Repayment status
 *   - Reconciliation status
 *   - User status
 *   - Organization status
 *   - Branch status
 *   - System / integration status
 *
 * Features:
 *   ✓ Enterprise semantic status registry
 *   ✓ Consistent status colors
 *   ✓ Dark mode support
 *   ✓ Built-in icons
 *   ✓ Dot indicators
 *   ✓ Custom icons
 *   ✓ Custom labels
 *   ✓ Loading state
 *   ✓ Pulse indicator
 *   ✓ Multiple sizes
 *   ✓ Compact mode
 *   ✓ Outline / soft / solid variants
 *   ✓ Custom status support
 *   ✓ Accessible labels
 *   ✓ Forwarded refs
 *   ✓ Optional click interaction
 *   ✓ Optional href
 *   ✓ Financial workflow friendly
 *   ✓ No ACFOS references
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useMemo,
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
 * Built-in Icons
 * ============================================================================
 */

const CheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="m5 12 4 4L19 6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const XIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="m7 7 10 10M17 7 7 17"
      strokeLinecap="round"
    />
  </svg>
);

const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="M12 7v5l3 2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const AlertIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M12 3 2.8 19a1 1 0 0 0 .87 1.5h16.66A1 1 0 0 0 21.2 19L12 3Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M12 9v4"
      strokeLinecap="round"
    />

    <path
      d="M12 17h.01"
      strokeLinecap="round"
    />
  </svg>
);

const InfoIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="M12 11v5"
      strokeLinecap="round"
    />

    <path
      d="M12 8h.01"
      strokeLinecap="round"
    />
  </svg>
);

const PauseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M8 5v14M16 5v14"
      strokeLinecap="round"
    />
  </svg>
);

const BanIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="m6 6 12 12"
      strokeLinecap="round"
    />
  </svg>
);

const RefreshIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M3 5v5h5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M21 19v-5h-5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ShieldIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M12 3 20 6v5c0 5-3.2 8.5-8 10-4.8-1.5-8-5-8-10V6l8-3Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LoaderIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className="h-3.5 w-3.5 animate-spin"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      className="opacity-25"
      stroke="currentColor"
      strokeWidth="3"
    />

    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

const DotIcon = () => (
  <span
    className="h-2 w-2 rounded-full bg-current"
    aria-hidden="true"
  />
);

/**
 * ============================================================================
 * Enterprise Status Registry
 * ============================================================================
 *
 * The registry provides normalized semantic meanings while allowing callers
 * to pass values received directly from APIs.
 *
 * Example:
 *
 *   <StatusBadge status="pending" />
 *   <StatusBadge status="PENDING" />
 *   <StatusBadge status="loan_pending_approval" />
 *
 * ============================================================================
 */

const STATUS_REGISTRY = {
  /**
   * --------------------------------------------------------------------------
   * Generic
   * --------------------------------------------------------------------------
   */

  active: {
    label: 'Active',
    tone: 'success',
    icon: CheckIcon,
  },

  inactive: {
    label: 'Inactive',
    tone: 'neutral',
    icon: PauseIcon,
  },

  enabled: {
    label: 'Enabled',
    tone: 'success',
    icon: CheckIcon,
  },

  disabled: {
    label: 'Disabled',
    tone: 'neutral',
    icon: BanIcon,
  },

  pending: {
    label: 'Pending',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  processing: {
    label: 'Processing',
    tone: 'info',
    icon: RefreshIcon,
    pulse: true,
  },

  completed: {
    label: 'Completed',
    tone: 'success',
    icon: CheckIcon,
  },

  success: {
    label: 'Successful',
    tone: 'success',
    icon: CheckIcon,
  },

  failed: {
    label: 'Failed',
    tone: 'danger',
    icon: XIcon,
  },

  error: {
    label: 'Error',
    tone: 'danger',
    icon: XIcon,
  },

  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    icon: BanIcon,
  },

  canceled: {
    label: 'Canceled',
    tone: 'neutral',
    icon: BanIcon,
  },

  rejected: {
    label: 'Rejected',
    tone: 'danger',
    icon: XIcon,
  },

  approved: {
    label: 'Approved',
    tone: 'success',
    icon: CheckIcon,
  },

  declined: {
    label: 'Declined',
    tone: 'danger',
    icon: XIcon,
  },

  suspended: {
    label: 'Suspended',
    tone: 'danger',
    icon: BanIcon,
  },

  blocked: {
    label: 'Blocked',
    tone: 'danger',
    icon: BanIcon,
  },

  archived: {
    label: 'Archived',
    tone: 'neutral',
    icon: PauseIcon,
  },

  draft: {
    label: 'Draft',
    tone: 'neutral',
    icon: InfoIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * Transaction
   * --------------------------------------------------------------------------
   */

  initiated: {
    label: 'Initiated',
    tone: 'info',
    icon: RefreshIcon,
    pulse: true,
  },

  queued: {
    label: 'Queued',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  authorized: {
    label: 'Authorized',
    tone: 'success',
    icon: ShieldIcon,
  },

  posted: {
    label: 'Posted',
    tone: 'success',
    icon: CheckIcon,
  },

  reversed: {
    label: 'Reversed',
    tone: 'warning',
    icon: RefreshIcon,
  },

  refunded: {
    label: 'Refunded',
    tone: 'info',
    icon: RefreshIcon,
  },

  settled: {
    label: 'Settled',
    tone: 'success',
    icon: CheckIcon,
  },

  pending_review: {
    label: 'Pending Review',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  reconciliation_pending: {
    label: 'Reconciliation Pending',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  reconciled: {
    label: 'Reconciled',
    tone: 'success',
    icon: CheckIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * Loan
   * --------------------------------------------------------------------------
   */

  applied: {
    label: 'Applied',
    tone: 'info',
    icon: InfoIcon,
  },

  under_review: {
    label: 'Under Review',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  pending_approval: {
    label: 'Pending Approval',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  disbursed: {
    label: 'Disbursed',
    tone: 'success',
    icon: CheckIcon,
  },

  outstanding: {
    label: 'Outstanding',
    tone: 'warning',
    icon: ClockIcon,
  },

  overdue: {
    label: 'Overdue',
    tone: 'danger',
    icon: AlertIcon,
  },

  delinquent: {
    label: 'Delinquent',
    tone: 'danger',
    icon: AlertIcon,
  },

  defaulted: {
    label: 'Defaulted',
    tone: 'danger',
    icon: AlertIcon,
  },

  written_off: {
    label: 'Written Off',
    tone: 'neutral',
    icon: BanIcon,
  },

  fully_paid: {
    label: 'Fully Paid',
    tone: 'success',
    icon: CheckIcon,
  },

  partially_paid: {
    label: 'Partially Paid',
    tone: 'warning',
    icon: ClockIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * Member / KYC
   * --------------------------------------------------------------------------
   */

  verified: {
    label: 'Verified',
    tone: 'success',
    icon: ShieldIcon,
  },

  unverified: {
    label: 'Unverified',
    tone: 'warning',
    icon: AlertIcon,
  },

  verification_pending: {
    label: 'Verification Pending',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  verification_failed: {
    label: 'Verification Failed',
    tone: 'danger',
    icon: XIcon,
  },

  kyc_pending: {
    label: 'KYC Pending',
    tone: 'warning',
    icon: ClockIcon,
    pulse: true,
  },

  kyc_verified: {
    label: 'KYC Verified',
    tone: 'success',
    icon: ShieldIcon,
  },

  kyc_rejected: {
    label: 'KYC Rejected',
    tone: 'danger',
    icon: XIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * Savings
   * --------------------------------------------------------------------------
   */

  savings_active: {
    label: 'Savings Active',
    tone: 'success',
    icon: CheckIcon,
  },

  savings_suspended: {
    label: 'Savings Suspended',
    tone: 'warning',
    icon: PauseIcon,
  },

  savings_closed: {
    label: 'Savings Closed',
    tone: 'neutral',
    icon: BanIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * Account
   * --------------------------------------------------------------------------
   */

  open: {
    label: 'Open',
    tone: 'success',
    icon: CheckIcon,
  },

  closed: {
    label: 'Closed',
    tone: 'neutral',
    icon: BanIcon,
  },

  frozen: {
    label: 'Frozen',
    tone: 'danger',
    icon: PauseIcon,
  },

  locked: {
    label: 'Locked',
    tone: 'danger',
    icon: ShieldIcon,
  },

  /**
   * --------------------------------------------------------------------------
   * System / Integration
   * --------------------------------------------------------------------------
   */

  healthy: {
    label: 'Healthy',
    tone: 'success',
    icon: CheckIcon,
  },

  degraded: {
    label: 'Degraded',
    tone: 'warning',
    icon: AlertIcon,
  },

  unavailable: {
    label: 'Unavailable',
    tone: 'danger',
    icon: XIcon,
  },

  online: {
    label: 'Online',
    tone: 'success',
    icon: CheckIcon,
  },

  offline: {
    label: 'Offline',
    tone: 'danger',
    icon: XIcon,
  },

  syncing: {
    label: 'Syncing',
    tone: 'info',
    icon: RefreshIcon,
    pulse: true,
  },
};

/**
 * ============================================================================
 * Status Normalization
 * ============================================================================
 */

const normalizeStatus = (
  status,
) => {
  if (
    status === null ||
    status === undefined
  ) {
    return 'unknown';
  }

  return String(status)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
};

/**
 * ============================================================================
 * Humanize Unknown Status
 * ============================================================================
 */

const humanizeStatus = (
  status,
) => {
  if (
    status === null ||
    status === undefined ||
    status === ''
  ) {
    return 'Unknown';
  }

  return String(status)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /\w\S*/g,
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1).toLowerCase(),
    );
};

/**
 * ============================================================================
 * Tone Styles
 * ============================================================================
 */

const TONE_STYLES = {
  success: {
    soft:
      'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-400/20',

    solid:
      'bg-green-600 text-white dark:bg-green-500 dark:text-white',

    outline:
      'bg-transparent text-green-700 ring-1 ring-inset ring-green-600/40 dark:text-green-300 dark:ring-green-400/40',
  },

  warning: {
    soft:
      'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20',

    solid:
      'bg-amber-500 text-white dark:bg-amber-500 dark:text-white',

    outline:
      'bg-transparent text-amber-700 ring-1 ring-inset ring-amber-600/40 dark:text-amber-300 dark:ring-amber-400/40',
  },

  danger: {
    soft:
      'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/20',

    solid:
      'bg-red-600 text-white dark:bg-red-500 dark:text-white',

    outline:
      'bg-transparent text-red-700 ring-1 ring-inset ring-red-600/40 dark:text-red-300 dark:ring-red-400/40',
  },

  info: {
    soft:
      'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20',

    solid:
      'bg-blue-600 text-white dark:bg-blue-500 dark:text-white',

    outline:
      'bg-transparent text-blue-700 ring-1 ring-inset ring-blue-600/40 dark:text-blue-300 dark:ring-blue-400/40',
  },

  neutral: {
    soft:
      'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-400/20',

    solid:
      'bg-gray-600 text-white dark:bg-gray-500 dark:text-white',

    outline:
      'bg-transparent text-gray-700 ring-1 ring-inset ring-gray-500/40 dark:text-gray-300 dark:ring-gray-400/40',
  },

  purple: {
    soft:
      'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-400/20',

    solid:
      'bg-purple-600 text-white dark:bg-purple-500 dark:text-white',

    outline:
      'bg-transparent text-purple-700 ring-1 ring-inset ring-purple-600/40 dark:text-purple-300 dark:ring-purple-400/40',
  },
};

/**
 * ============================================================================
 * Size Styles
 * ============================================================================
 */

const SIZE_STYLES = {
  xs: {
    root:
      'gap-1 px-1.5 py-0.5 text-[10px]',

    icon:
      'h-3 w-3',

    dot:
      'h-1.5 w-1.5',
  },

  sm: {
    root:
      'gap-1 px-2 py-0.5 text-xs',

    icon:
      'h-3.5 w-3.5',

    dot:
      'h-1.5 w-1.5',
  },

  md: {
    root:
      'gap-1.5 px-2.5 py-1 text-xs',

    icon:
      'h-3.5 w-3.5',

    dot:
      'h-2 w-2',
  },

  lg: {
    root:
      'gap-2 px-3 py-1.5 text-sm',

    icon:
      'h-4 w-4',

    dot:
      'h-2.5 w-2.5',
  },
};

/**
 * ============================================================================
 * StatusBadge
 * ============================================================================
 */

const StatusBadge = forwardRef(
  function StatusBadge(
    {
      status = 'unknown',

      label,

      tone,

      variant = 'soft',

      size = 'md',

      icon,

      showIcon = true,

      showDot = false,

      pulse,

      loading = false,

      href,

      onClick,

      disabled = false,

      title,

      ariaLabel,

      className = '',

      iconClassName = '',

      dotClassName = '',

      children,

      ...rest
    },
    ref,
  ) {
    /**
     * ========================================================================
     * Normalize status
     * ========================================================================
     */

    const normalizedStatus =
      normalizeStatus(status);

    /**
     * ========================================================================
     * Registry configuration
     * ========================================================================
     */

    const configuration =
      useMemo(
        () =>
          STATUS_REGISTRY[
            normalizedStatus
          ] || {
            label:
              humanizeStatus(
                status,
              ),

            tone:
              tone || 'neutral',

            icon: InfoIcon,
          },
        [
          normalizedStatus,
          status,
          tone,
        ],
      );

    /**
     * ========================================================================
     * Resolved values
     * ========================================================================
     */

    const resolvedTone =
      tone ||
      configuration.tone ||
      'neutral';

    const resolvedLabel =
      label ??
      children ??
      configuration.label ??
      humanizeStatus(status);

    const resolvedIcon =
      icon ||
      configuration.icon;

    const shouldPulse =
      pulse ??
      configuration.pulse ??
      false;

    const sizeConfig =
      SIZE_STYLES[size] ||
      SIZE_STYLES.md;

    const toneConfig =
      TONE_STYLES[
        resolvedTone
      ] ||
      TONE_STYLES.neutral;

    const toneClass =
      toneConfig[
        variant
      ] ||
      toneConfig.soft;

    /**
     * ========================================================================
     * Loading state
     * ========================================================================
     */

    if (loading) {
      const loadingClassName =
        cn(
          'inline-flex items-center justify-center',
          'rounded-full font-medium',
          'whitespace-nowrap select-none',
          'bg-gray-100 text-gray-500',
          'ring-1 ring-inset ring-gray-500/20',
          'dark:bg-gray-800 dark:text-gray-400',
          sizeConfig.root,
          className,
        );

      const loadingContent = (
        <>
          <LoaderIcon />

          <span>
            {label ||
              'Loading'}
          </span>
        </>
      );

      if (
        href &&
        !disabled
      ) {
        return (
          <a
            ref={ref}
            href={href}
            className={
              loadingClassName
            }
            aria-busy="true"
            aria-label={
              ariaLabel ||
              'Loading'
            }
            {...rest}
          >
            {loadingContent}
          </a>
        );
      }

      return (
        <span
          ref={ref}
          className={
            loadingClassName
          }
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={
            ariaLabel ||
            'Loading'
          }
          {...rest}
        >
          {loadingContent}
        </span>
      );
    }

    /**
     * ========================================================================
     * Main class
     * ========================================================================
     */

    const badgeClassName =
      cn(
        'inline-flex max-w-full items-center',
        'justify-center rounded-full',
        'font-medium leading-none',
        'whitespace-nowrap select-none',
        'transition-colors duration-150',

        toneClass,

        sizeConfig.root,

        shouldPulse
          ? 'animate-pulse'
          : '',

        (
          href ||
          onClick
        ) &&
        !disabled
          ? [
              'cursor-pointer',
              'hover:opacity-90',
              'focus:outline-none',
              'focus-visible:ring-2',
              'focus-visible:ring-gray-400',
              'focus-visible:ring-offset-2',
              'dark:focus-visible:ring-gray-600',
              'dark:focus-visible:ring-offset-gray-900',
            ].join(' ')
          : '',

        disabled
          ? 'cursor-not-allowed opacity-50'
          : '',

        className,
      );

    /**
     * ========================================================================
     * Badge content
     * ========================================================================
     */

    const badgeContent = (
      <>
        {showDot && (
          <span
            className={cn(
              'shrink-0 rounded-full',
              'bg-current',
              sizeConfig.dot,
              shouldPulse
                ? 'animate-pulse'
                : '',
              dotClassName,
            )}
            aria-hidden="true"
          />
        )}

        {showIcon &&
          resolvedIcon && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center justify-center',
                sizeConfig.icon,
                iconClassName,
              )}
              aria-hidden="true"
            >
              {React.isValidElement(
                resolvedIcon,
              )
                ? React.cloneElement(
                    resolvedIcon,
                    {
                      className:
                        cn(
                          sizeConfig.icon,
                          resolvedIcon.props
                            ?.className,
                        ),
                      'aria-hidden':
                        true,
                    },
                  )
                : resolvedIcon}
            </span>
          )}

        <span className="truncate">
          {resolvedLabel}
        </span>
      </>
    );

    /**
     * ========================================================================
     * Link
     * ========================================================================
     */

    if (
      href &&
      !disabled
    ) {
      return (
        <a
          ref={ref}
          href={href}
          className={
            badgeClassName
          }
          title={title}
          aria-label={
            ariaLabel ||
            String(
              resolvedLabel,
            )
          }
          {...rest}
        >
          {badgeContent}
        </a>
      );
    }

    /**
     * ========================================================================
     * Button
     * ========================================================================
     */

    if (
      onClick &&
      !disabled
    ) {
      return (
        <button
          ref={ref}
          type="button"
          className={
            badgeClassName
          }
          onClick={onClick}
          disabled={disabled}
          title={title}
          aria-label={
            ariaLabel ||
            String(
              resolvedLabel,
            )
          }
          {...rest}
        >
          {badgeContent}
        </button>
      );
    }

    /**
     * ========================================================================
     * Static Badge
     * ========================================================================
     */

    return (
      <span
        ref={ref}
        className={
          badgeClassName
        }
        title={title}
        aria-label={
          ariaLabel
        }
        {...rest}
      >
        {badgeContent}
      </span>
    );
  },
);

StatusBadge.displayName =
  'StatusBadge';

/**
 * ============================================================================
 * Specialized Status Components
 * ============================================================================
 *
 * These wrappers make common financial workflow statuses explicit and easy
 * to use without repeating status strings throughout the application.
 * ============================================================================
 */

export const TransactionStatusBadge =
  forwardRef(
    function TransactionStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

TransactionStatusBadge.displayName =
  'TransactionStatusBadge';

export const LoanStatusBadge =
  forwardRef(
    function LoanStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

LoanStatusBadge.displayName =
  'LoanStatusBadge';

export const MemberStatusBadge =
  forwardRef(
    function MemberStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

MemberStatusBadge.displayName =
  'MemberStatusBadge';

export const KYCStatusBadge =
  forwardRef(
    function KYCStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

KYCStatusBadge.displayName =
  'KYCStatusBadge';

export const ApprovalStatusBadge =
  forwardRef(
    function ApprovalStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

ApprovalStatusBadge.displayName =
  'ApprovalStatusBadge';

export const AccountStatusBadge =
  forwardRef(
    function AccountStatusBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          {...props}
        />
      );
    },
  );

AccountStatusBadge.displayName =
  'AccountStatusBadge';

/**
 * ============================================================================
 * Convenience Status Components
 * ============================================================================
 */

export const ActiveBadge = forwardRef(
  function ActiveBadge(
    props,
    ref,
  ) {
    return (
      <StatusBadge
        ref={ref}
        status="active"
        {...props}
      />
    );
  },
);

ActiveBadge.displayName =
  'ActiveBadge';

export const PendingBadge =
  forwardRef(
    function PendingBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          status="pending"
          {...props}
        />
      );
    },
  );

PendingBadge.displayName =
  'PendingBadge';

export const ApprovedBadge =
  forwardRef(
    function ApprovedBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          status="approved"
          {...props}
        />
      );
    },
  );

ApprovedBadge.displayName =
  'ApprovedBadge';

export const RejectedBadge =
  forwardRef(
    function RejectedBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          status="rejected"
          {...props}
        />
      );
    },
  );

RejectedBadge.displayName =
  'RejectedBadge';

export const CompletedBadge =
  forwardRef(
    function CompletedBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          status="completed"
          {...props}
        />
      );
    },
  );

CompletedBadge.displayName =
  'CompletedBadge';

export const FailedBadge =
  forwardRef(
    function FailedBadge(
      props,
      ref,
    ) {
      return (
        <StatusBadge
          ref={ref}
          status="failed"
          {...props}
        />
      );
    },
  );

FailedBadge.displayName =
  'FailedBadge';

/**
 * ============================================================================
 * Registry Export
 * ============================================================================
 *
 * Useful when building tables, filters, forms, reporting systems or
 * configuration-driven interfaces.
 * ============================================================================
 */

export {
  STATUS_REGISTRY,
  TONE_STYLES,
  SIZE_STYLES,
};

/**
 * ============================================================================
 * Default Export
 * ============================================================================
 */

export default StatusBadge;