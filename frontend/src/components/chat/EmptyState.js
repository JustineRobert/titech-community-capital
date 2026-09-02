'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Empty State
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/EmptyState.js
 *
 * Purpose:
 *   Reusable enterprise empty-state component for TITech Community Capital's
 *   chat and messaging interfaces.
 *
 * Supported scenarios
 * ----------------------------------------------------------------------------
 * ✓ Empty conversation list
 * ✓ No search results
 * ✓ No messages
 * ✓ No attachments
 * ✓ No notifications
 * ✓ Error / retry state
 * ✓ Permission / unavailable state
 * ✓ Loading handoff state
 * ✓ New conversation CTA
 * ✓ Clear search CTA
 * ✓ Custom primary / secondary actions
 * ✓ Accessible status semantics
 * ✓ Keyboard accessibility
 * ✓ Ref API
 * ✓ Custom illustration/icon support
 * ✓ Responsive-friendly markup
 * ✓ Defensive text handling
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - determine authorization
 *   - bypass tenant isolation
 *   - perform financial decisions
 *   - modify authoritative records
 *   - infer membership permissions
 *
 * Those responsibilities remain in TITech's trusted service/API layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';

import PropTypes from 'prop-types';


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
 * Icons
 * ========================================================================== */

const InboxIcon = ({
  size = 56,
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
    <path d="M4 4h16v16H4z" />
    <path d="M4 14h4l2 3h4l2-3h4" />
    <path d="M8 8h8" />
  </svg>
);


const SearchIcon = ({
  size = 56,
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
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
  </svg>
);


const MessageIcon = ({
  size = 56,
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
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 4a8.38 8.38 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8Z" />
  </svg>
);


const AlertIcon = ({
  size = 56,
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
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);


const LockIcon = ({
  size = 56,
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


const RefreshIcon = ({
  size = 18,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </svg>
);


const PlusIcon = ({
  size = 18,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);


const ArrowLeftIcon = ({
  size = 18,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);


/* ============================================================================
 * Default illustration resolver
 * ========================================================================== */

const getDefaultIcon = (
  variant,
) => {
  switch (
    variant
  ) {
    case 'search':
      return (
        <SearchIcon />
      );

    case 'messages':
      return (
        <MessageIcon />
      );

    case 'error':
      return (
        <AlertIcon />
      );

    case 'permission':
    case 'unauthorized':
    case 'forbidden':
      return (
        <LockIcon />
      );

    case 'inbox':
    case 'empty':
    default:
      return (
        <InboxIcon />
      );
  }
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

        onBack,

        icon,
        illustration,

        loading =
          false,

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

      const defaultTitle =
        {
          empty:
            'Nothing here yet',

          inbox:
            'No conversations yet',

          messages:
            'No messages yet',

          search:
            'No matching conversations',

          error:
            'Something went wrong',

          permission:
            'Access unavailable',

          unauthorized:
            'Access unavailable',

          forbidden:
            'Access unavailable',
        }[
          resolvedVariant
        ] ||
        'Nothing here yet';

      const defaultDescription =
        {
          empty:
            'There is currently nothing to display.',

          inbox:
            'Start a conversation to begin messaging through TITech.',

          messages:
            'Messages will appear here when the conversation begins.',

          search:
            'Try adjusting your search or clearing the current filter.',

          error:
            'We could not load the requested content. Please try again.',

          permission:
            'Your account does not currently have access to this content.',

          unauthorized:
            'Your account does not currently have access to this content.',

          forbidden:
            'Your account does not currently have permission to view this content.',
        }[
          resolvedVariant
        ] ||
        'There is currently nothing to display.';

      const resolvedTitle =
        safeText(
          title,
          defaultTitle,
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
          defaultDescription,
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

      const handlePrimary =
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

      const handleSecondary =
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
        }),
        [],
      );

      const rootClassName =
        [
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

      const resolvedIcon =
        illustration ||
        icon ||
        getDefaultIcon(
          resolvedVariant,
        );

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
            isError
              ? 'alert'
              : 'status'
          }
          aria-label={
            ariaLabel ||
            resolvedTitle
          }
          aria-live={
            live ||
            isError
              ? 'polite'
              : undefined
          }
          tabIndex={
            -1
          }
          data-testid={
            testId
          }
        >

          <div
            className={cn(
              'titech-empty-state__content',
              contentClassName,
            )}
          >

            {/* ============================================================
                Brand
                ============================================================ */}

            {showBrand ? (
              <div
                className="titech-empty-state__brand"
                aria-hidden="true"
              >
                {brandName}
              </div>
            ) : null}


            {/* ============================================================
                Illustration
                ============================================================ */}

            {showIcon ? (
              <div
                className="titech-empty-state__illustration"
                aria-hidden="true"
              >
                {resolvedIcon}
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
              >
                {
                  resolvedDescription
                }
              </p>
            ) : null}


            {/* ============================================================
                Actions
                ============================================================ */}

            {(
              hasPrimaryAction ||
              hasSecondaryAction ||
              hasRetry ||
              hasBack
            ) ? (
              <div
                className={cn(
                  'titech-empty-state__actions',
                  actionsClassName,
                )}
              >

                {hasPrimaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--primary',
                    )}
                    onClick={
                      handlePrimary
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


                {hasSecondaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-empty-state__button',
                      'titech-empty-state__button--secondary',
                    )}
                    onClick={
                      handleSecondary
                    }
                    disabled={
                      disabled ||
                      loading ||
                      secondaryAction?.disabled
                    }
                    data-titech-secondary-action="true"
                    data-testid="titech-empty-state-secondary-action"
                  >
                    {primaryAction?.icon ? null : null}

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
                      Retry
                    </span>
                  </button>
                ) : null}


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
                      Back
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
                <span className="titech-empty-state__loading-spinner" />

                <span>
                  Loading…
                </span>
              </div>
            ) : null}

          </div>
        </section>
      );
    },
  );


/* ============================================================================
 * Metadata
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
      'error',
      'permission',
      'unauthorized',
      'forbidden',
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

  onBack:
    PropTypes.func,

  icon:
    PropTypes.node,

  illustration:
    PropTypes.node,

  loading:
    PropTypes.bool,

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

  onBack:
    undefined,

  icon:
    undefined,

  illustration:
    undefined,

  loading:
    false,

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

  testId:
    'titech-empty-state',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  ArrowLeftIcon,
  InboxIcon,
  LockIcon,
  MessageIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  getDefaultIcon,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default EmptyState;