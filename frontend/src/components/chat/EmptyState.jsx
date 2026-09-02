'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Empty State
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/EmptyState.jsx
 *
 * Purpose:
 *   Reusable, accessible and production-grade empty-state component for the
 *   TITech Community Capital messaging platform.
 *
 * Supported states
 * ----------------------------------------------------------------------------
 * ✓ Empty conversations
 * ✓ Empty messages
 * ✓ Search with no results
 * ✓ Empty attachments
 * ✓ Empty notifications
 * ✓ Error
 * ✓ Permission / authorization unavailable
 * ✓ Unauthorized
 * ✓ Forbidden
 * ✓ Offline / unavailable
 * ✓ Loading
 * ✓ Custom state / content
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Primary action
 * ✓ Secondary action
 * ✓ Retry action
 * ✓ Back action
 * ✓ Custom icon / illustration
 * ✓ TITech branding option
 * ✓ Loading state
 * ✓ Accessible status semantics
 * ✓ Keyboard accessible actions
 * ✓ Ref API
 * ✓ Defensive text normalization
 * ✓ Responsive-friendly markup
 * ✓ Custom class hooks
 * ✓ Stable test selectors
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Presentation and interaction only.
 *
 * This component MUST NOT:
 *   - perform authorization
 *   - bypass tenant isolation
 *   - make financial decisions
 *   - execute transactions
 *   - approve loans
 *   - perform fraud decisions
 *   - modify authoritative financial records
 *
 * Those responsibilities belong to TITech's trusted service/API layers.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import './empty-state.css';


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
    const result =
      String(value).trim();

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


/* ============================================================================
 * SVG icons
 * ========================================================================== */

const IconBase = ({
  children,
  size = 56,
  className = '',
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
    className={className}
  >
    {children}
  </svg>
);


const InboxIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <path d="M4 4h16v16H4z" />
    <path d="M4 14h4l2 3h4l2-3h4" />
    <path d="M8 8h8" />
  </IconBase>
);


const SearchIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
  </IconBase>
);


const MessageIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 4a8.38 8.38 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8Z" />
  </IconBase>
);


const AttachmentIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </IconBase>
);


const AlertIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </IconBase>
);


const LockIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <rect
      x="4"
      y="10"
      width="16"
      height="11"
      rx="2"
    />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 14v3" />
  </IconBase>
);


const WifiOffIcon = ({
  size = 56,
}) => (
  <IconBase size={size}>
    <path d="M1 1l22 22" />
    <path d="M16.72 11.06a10.94 10.94 0 0 0-3.44-1.94" />
    <path d="M5 12.55a10.94 10.94 0 0 1 4-2.13" />
    <path d="M8.53 16.11a6 6 0 0 1 6.94 0" />
    <path d="M12 20h.01" />
  </IconBase>
);


const RefreshIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
    strokeWidth={1.8}
  >
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </IconBase>
);


const PlusIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
    strokeWidth={1.8}
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </IconBase>
);


const ArrowLeftIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
    strokeWidth={1.8}
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </IconBase>
);


/* ============================================================================
 * Default icon resolution
 * ========================================================================== */

const getDefaultIcon = (
  variant,
  iconSize,
) => {
  switch (
    variant
  ) {
    case 'search':
      return (
        <SearchIcon
          size={
            iconSize
          }
        />
      );

    case 'messages':
      return (
        <MessageIcon
          size={
            iconSize
          }
        />
      );

    case 'attachments':
      return (
        <AttachmentIcon
          size={
            iconSize
          }
        />
      );

    case 'error':
      return (
        <AlertIcon
          size={
            iconSize
          }
        />
      );

    case 'permission':
    case 'unauthorized':
    case 'forbidden':
      return (
        <LockIcon
          size={
            iconSize
          }
        />
      );

    case 'offline':
      return (
        <WifiOffIcon
          size={
            iconSize
          }
        />
      );

    case 'inbox':
    case 'empty':
    default:
      return (
        <InboxIcon
          size={
            iconSize
          }
        />
      );
  }
};


/* ============================================================================
 * Variant defaults
 * ========================================================================== */

const VARIANT_DEFAULTS = {
  empty: {
    title:
      'Nothing here yet',

    description:
      'There is currently nothing to display.',
  },

  inbox: {
    title:
      'No conversations yet',

    description:
      'Start a TITech conversation to begin messaging.',
  },

  messages: {
    title:
      'No messages yet',

    description:
      'Messages will appear here when the conversation begins.',
  },

  search: {
    title:
      'No matching conversations',

    description:
      'Try a different search term or clear the current filter.',
  },

  attachments: {
    title:
      'No attachments',

    description:
      'Attachments added to this conversation will appear here.',
  },

  error: {
    title:
      'Something went wrong',

    description:
      'We could not load the requested content. Please try again.',
  },

  permission: {
    title:
      'Access unavailable',

    description:
      'Your account does not currently have permission to view this content.',
  },

  unauthorized: {
    title:
      'Access unavailable',

    description:
      'Please sign in with an authorized TITech account to continue.',
  },

  forbidden: {
    title:
      'Access denied',

    description:
      'You do not currently have permission to access this content.',
  },

  offline: {
    title:
      'You are offline',

    description:
      'Check your network connection and try again.',
  },
};


/* ============================================================================
 * EmptyState
 * ========================================================================== */

const EmptyState =
  forwardRef(
    function EmptyState(
      {
        variant =
          'empty',

        title,
        description,

        primaryAction,
        secondaryAction,

        onPrimaryAction,
        onSecondaryAction,

        primaryActionLabel,
        secondaryActionLabel,

        onRetry,
        retryLabel =
          'Retry',

        onBack,
        backLabel =
          'Back',

        icon,
        illustration,

        iconSize =
          56,

        loading =
          false,

        loadingLabel =
          'Loading…',

        disabled =
          false,

        compact =
          false,

        fullHeight =
          false,

        centered =
          true,

        showIcon =
          true,

        showBrand =
          false,

        brandName =
          'TITech Community Capital',

        error =
          null,

        className =
          '',

        contentClassName =
          '',

        titleClassName =
          '',

        descriptionClassName =
          '',

        actionsClassName =
          '',

        ariaLabel,

        live =
          false,

        role,

        testId =
          'titech-empty-state',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const resolvedVariant =
        safeText(
          variant,
          'empty',
        ).toLowerCase();

      const defaults =
        VARIANT_DEFAULTS[
          resolvedVariant
        ] ||
        VARIANT_DEFAULTS.empty;

      const isError =
        resolvedVariant ===
          'error' ||
        Boolean(
          error,
        );

      const isPermission =
        [
          'permission',
          'unauthorized',
          'forbidden',
        ].includes(
          resolvedVariant,
        );

      const resolvedTitle =
        safeText(
          title,
          defaults.title,
        );

      const resolvedDescription =
        safeText(
          description ||
            (
              typeof error ===
              'string'
                ? error
                : ''
            ),
          defaults.description,
        );

      const resolvedPrimaryLabel =
        safeText(
          primaryActionLabel ||
            primaryAction?.label,
        );

      const resolvedSecondaryLabel =
        safeText(
          secondaryActionLabel ||
            secondaryAction?.label,
        );

      const hasPrimaryAction =
        typeof onPrimaryAction ===
          'function' ||
        typeof primaryAction?.onClick ===
          'function';

      const hasSecondaryAction =
        typeof onSecondaryAction ===
          'function' ||
        typeof secondaryAction?.onClick ===
          'function';

      const hasRetry =
        typeof onRetry ===
        'function';

      const hasBack =
        typeof onBack ===
        'function';

      const hasActions =
        hasPrimaryAction ||
        hasSecondaryAction ||
        hasRetry ||
        hasBack;

      const resolvedIcon =
        illustration ||
        icon ||
        getDefaultIcon(
          resolvedVariant,
          iconSize,
        );

      const computedRole =
        role ||
        (
          isError
            ? 'alert'
            : 'status'
        );

      const computedLive =
        live ||
        isError
          ? 'polite'
          : undefined;

      /**
       * ----------------------------------------------------------------------
       * Public ref API
       * ----------------------------------------------------------------------
       */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          focusPrimaryAction() {
            rootRef.current
              ?.querySelector(
                '[data-titech-primary-action="true"]',
              )
              ?.focus();
          },

          focusSecondaryAction() {
            rootRef.current
              ?.querySelector(
                '[data-titech-secondary-action="true"]',
              )
              ?.focus();
          },

          focusRetry() {
            rootRef.current
              ?.querySelector(
                '[data-testid="titech-empty-state-retry"]',
              )
              ?.focus();
          },
        }),
        [],
      );

      /**
       * ----------------------------------------------------------------------
       * Action handlers
       * ----------------------------------------------------------------------
       */

      const handlePrimaryAction =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          if (
            typeof onPrimaryAction ===
            'function'
          ) {
            onPrimaryAction();
            return;
          }

          primaryAction?.onClick?.();
        };

      const handleSecondaryAction =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          if (
            typeof onSecondaryAction ===
            'function'
          ) {
            onSecondaryAction();
            return;
          }

          secondaryAction?.onClick?.();
        };

      const handleRetry =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          onRetry?.();
        };

      const handleBack =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          onBack?.();
        };

      /**
       * ----------------------------------------------------------------------
       * Classes
       * ----------------------------------------------------------------------
       */

      const rootClassName = [
        'titech-empty-state',

        `titech-empty-state--${resolvedVariant}`,

        compact
          ? 'titech-empty-state--compact'
          : '',

        fullHeight
          ? 'titech-empty-state--full-height'
          : '',

        centered
          ? 'titech-empty-state--centered'
          : '',

        loading
          ? 'titech-empty-state--loading'
          : '',

        disabled
          ? 'titech-empty-state--disabled'
          : '',

        isError
          ? 'titech-empty-state--error'
          : '',

        isPermission
          ? 'titech-empty-state--permission'
          : '',

        className,
      ]
        .filter(Boolean)
        .join(' ');

      return (
        <section
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          role={
            computedRole
          }
          aria-live={
            computedLive
          }
          aria-label={
            ariaLabel ||
            resolvedTitle
          }
          tabIndex={
            -1
          }
          data-testid={
            testId
          }
          data-state={
            resolvedVariant
          }
        >

          <div
            className={cn(
              'titech-empty-state__content',
              contentClassName,
            )}
          >

            {/* ============================================================
                Optional brand
                ============================================================ */}

            {showBrand ? (
              <div
                className="titech-empty-state__brand"
                aria-hidden="true"
              >
                {
                  brandName
                }
              </div>
            ) : null}


            {/* ============================================================
                Illustration
                ============================================================ */}

            {showIcon ? (
              <div
                className="titech-empty-state__illustration"
                aria-hidden="true"
                data-testid="titech-empty-state-illustration"
              >
                {
                  resolvedIcon
                }
              </div>
            ) : null}


            {/* ============================================================
                Title
                ============================================================ */}

            <h2
              className={cn(
                'titech-empty-state__title',
                titleClassName,
              )}
              data-testid="titech-empty-state-title"
            >
              {
                resolvedTitle
              }
            </h2>


            {/* ============================================================
                Description
                ============================================================ */}

            {resolvedDescription ? (
              <p
                className={cn(
                  'titech-empty-state__description',
                  descriptionClassName,
                )}
                data-testid="titech-empty-state-description"
              >
                {
                  resolvedDescription
                }
              </p>
            ) : null}


            {/* ============================================================
                Actions
                ============================================================ */}

            {hasActions ? (
              <div
                className={cn(
                  'titech-empty-state__actions',
                  actionsClassName,
                )}
                data-testid="titech-empty-state-actions"
              >

                {/* Primary */}
                {hasPrimaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--primary',
                    )}
                    onClick={
                      handlePrimaryAction
                    }
                    disabled={
                      disabled ||
                      loading ||
                      primaryAction?.disabled
                    }
                    autoFocus={
                      Boolean(
                        primaryAction?.autoFocus,
                      )
                    }
                    data-titech-primary-action="true"
                    data-testid="titech-empty-state-primary-action"
                  >
                    {primaryAction?.icon ? (
                      <span
                        className="titech-empty-state__button-icon"
                        aria-hidden="true"
                      >
                        {
                          primaryAction.icon
                        }
                      </span>
                    ) : null}

                    <span>
                      {
                        resolvedPrimaryLabel ||
                        'Continue'
                      }
                    </span>
                  </button>
                ) : null}


                {/* Secondary */}
                {hasSecondaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--secondary',
                    )}
                    onClick={
                      handleSecondaryAction
                    }
                    disabled={
                      disabled ||
                      loading ||
                      secondaryAction?.disabled
                    }
                    data-titech-secondary-action="true"
                    data-testid="titech-empty-state-secondary-action"
                  >
                    {secondaryAction?.icon ? (
                      <span
                        className="titech-empty-state__button-icon"
                        aria-hidden="true"
                      >
                        {
                          secondaryAction.icon
                        }
                      </span>
                    ) : null}

                    <span>
                      {
                        resolvedSecondaryLabel ||
                        'Cancel'
                      }
                    </span>
                  </button>
                ) : null}


                {/* Retry */}
                {hasRetry ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--secondary',
                    )}
                    onClick={
                      handleRetry
                    }
                    disabled={
                      disabled ||
                      loading
                    }
                    data-testid="titech-empty-state-retry"
                  >
                    <span
                      className="titech-empty-state__button-icon"
                      aria-hidden="true"
                    >
                      <RefreshIcon />
                    </span>

                    <span>
                      {
                        retryLabel
                      }
                    </span>
                  </button>
                ) : null}


                {/* Back */}
                {hasBack ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--secondary',
                    )}
                    onClick={
                      handleBack
                    }
                    disabled={
                      disabled ||
                      loading
                    }
                    data-testid="titech-empty-state-back"
                  >
                    <span
                      className="titech-empty-state__button-icon"
                      aria-hidden="true"
                    >
                      <ArrowLeftIcon />
                    </span>

                    <span>
                      {
                        backLabel
                      }
                    </span>
                  </button>
                ) : null}

              </div>
            ) : null}


            {/* ============================================================
                Loading
                ============================================================ */}

            {loading ? (
              <div
                className="titech-empty-state__loading"
                role="status"
                aria-live="polite"
                data-testid="titech-empty-state-loading"
              >
                <span
                  className="titech-empty-state__loading-spinner"
                  aria-hidden="true"
                />

                <span>
                  {
                    loadingLabel
                  }
                </span>
              </div>
            ) : null}

          </div>
        </section>
      );
    },
  );


/* ============================================================================
 * Display name
 * ========================================================================== */

EmptyState.displayName =
  'TITechEmptyState';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

EmptyState.propTypes = {
  variant:
    PropTypes.oneOf([
      'empty',
      'inbox',
      'messages',
      'search',
      'attachments',
      'error',
      'permission',
      'unauthorized',
      'forbidden',
      'offline',
    ]),

  title:
    PropTypes.string,

  description:
    PropTypes.string,

  primaryAction:
    PropTypes.shape({
      label:
        PropTypes.string,

      onClick:
        PropTypes.func,

      icon:
        PropTypes.node,

      disabled:
        PropTypes.bool,

      autoFocus:
        PropTypes.bool,
    }),

  secondaryAction:
    PropTypes.shape({
      label:
        PropTypes.string,

      onClick:
        PropTypes.func,

      icon:
        PropTypes.node,

      disabled:
        PropTypes.bool,
    }),

  onPrimaryAction:
    PropTypes.func,

  onSecondaryAction:
    PropTypes.func,

  primaryActionLabel:
    PropTypes.string,

  secondaryActionLabel:
    PropTypes.string,

  onRetry:
    PropTypes.func,

  retryLabel:
    PropTypes.string,

  onBack:
    PropTypes.func,

  backLabel:
    PropTypes.string,

  icon:
    PropTypes.node,

  illustration:
    PropTypes.node,

  iconSize:
    PropTypes.number,

  loading:
    PropTypes.bool,

  loadingLabel:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  fullHeight:
    PropTypes.bool,

  centered:
    PropTypes.bool,

  showIcon:
    PropTypes.bool,

  showBrand:
    PropTypes.bool,

  brandName:
    PropTypes.string,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  titleClassName:
    PropTypes.string,

  descriptionClassName:
    PropTypes.string,

  actionsClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  live:
    PropTypes.bool,

  role:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

EmptyState.defaultProps = {
  variant:
    'empty',

  title:
    undefined,

  description:
    undefined,

  primaryAction:
    undefined,

  secondaryAction:
    undefined,

  onPrimaryAction:
    undefined,

  onSecondaryAction:
    undefined,

  primaryActionLabel:
    undefined,

  secondaryActionLabel:
    undefined,

  onRetry:
    undefined,

  retryLabel:
    'Retry',

  onBack:
    undefined,

  backLabel:
    'Back',

  icon:
    undefined,

  illustration:
    undefined,

  iconSize:
    56,

  loading:
    false,

  loadingLabel:
    'Loading…',

  disabled:
    false,

  compact:
    false,

  fullHeight:
    false,

  centered:
    true,

  showIcon:
    true,

  showBrand:
    false,

  brandName:
    'TITech Community Capital',

  error:
    null,

  className:
    '',

  contentClassName:
    '',

  titleClassName:
    '',

  descriptionClassName:
    '',

  actionsClassName:
    '',

  ariaLabel:
    undefined,

  live:
    false,

  role:
    undefined,

  testId:
    'titech-empty-state',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  AttachmentIcon,
  ArrowLeftIcon,
  InboxIcon,
  LockIcon,
  MessageIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  WifiOffIcon,
  VARIANT_DEFAULTS,
  getDefaultIcon,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default EmptyState;