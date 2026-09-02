/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Error State
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ErrorState.js
 *
 * Purpose:
 *   Production-grade reusable error-state component for TITech Community
 *   Capital messaging and related communication interfaces.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Generic application errors
 * ✓ Network / offline errors
 * ✓ Authentication errors
 * ✓ Authorization / permission errors
 * ✓ Not-found errors
 * ✓ Rate-limit errors
 * ✓ Service-unavailable errors
 * ✓ Validation errors
 * ✓ Retry action
 * ✓ Back action
 * ✓ Primary / secondary custom actions
 * ✓ Error code / request ID display
 * ✓ Safe error-message rendering
 * ✓ Sensitive error suppression
 * ✓ Loading / retrying state
 * ✓ Accessible alert semantics
 * ✓ Keyboard accessibility
 * ✓ Ref API
 * ✓ Custom illustration support
 * ✓ Compact / full-height modes
 * ✓ Responsive-friendly markup
 * ✓ TITech branding consistency
 *
 * Security
 * ----------------------------------------------------------------------------
 * Never render raw backend exception stacks, tokens, passwords, SQL errors,
 * internal infrastructure details, signed URLs, or other sensitive debugging
 * information directly to users.
 *
 * Authoritative error details should be logged server-side and correlated
 * using a request/correlation ID where appropriate.
 *
 * ============================================================================
 */

'use strict';

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_ERROR_MESSAGE =
  'We could not complete your request. Please try again.';

const DEFAULT_RETRY_LABEL =
  'Retry';

const DEFAULT_BACK_LABEL =
  'Back';

const DEFAULT_SUPPORT_LABEL =
  'Contact support';

const DEFAULT_TITLE =
  'Something went wrong';


/* ============================================================================
 * Safe utility helpers
 * ========================================================================== */

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
    return String(value).trim() ||
      fallback;
  } catch {
    return fallback;
  }
};


/**
 * Prevent accidental rendering of obviously sensitive internal information.
 *
 * This is only a presentation safeguard.
 * It is NOT a substitute for backend error sanitization.
 */
const sanitizeErrorMessage = (
  value,
) => {
  const original =
    safeText(
      value,
    );

  if (!original) {
    return DEFAULT_ERROR_MESSAGE;
  }

  const sensitivePatterns = [
    /password\s*=/i,
    /passwd\s*=/i,
    /secret\s*=/i,
    /access[_\s-]?token/i,
    /refresh[_\s-]?token/i,
    /authorization:\s*bearer/i,
    /bearer\s+[a-z0-9._-]+/i,
    /private[_\s-]?key/i,
    /client[_\s-]?secret/i,
    /-----BEGIN .*PRIVATE KEY-----/i,
    /mongodb(\+srv)?:\/\//i,
    /postgres(ql)?:\/\//i,
    /mysql:\/\//i,
    /redis:\/\//i,
    /file:\/\/\//i,
  ];

  if (
    sensitivePatterns.some(
      (
        pattern,
      ) =>
        pattern.test(
          original,
        ),
    )
  ) {
    return DEFAULT_ERROR_MESSAGE;
  }

  /**
   * Avoid presenting raw stack traces.
   */
  if (
    /\bat .+\(.+:\d+:\d+\)/i.test(
      original,
    ) ||
    /^Error:\s*/i.test(
      original,
    )
  ) {
    return DEFAULT_ERROR_MESSAGE;
  }

  return original.slice(
    0,
    1000,
  );
};


/**
 * Normalize an arbitrary error-like value.
 */
const normalizeError =
  (
    error,
  ) => {
    if (!error) {
      return {
        message:
          DEFAULT_ERROR_MESSAGE,
        code:
          '',
        requestId:
          '',
        retryable:
          true,
      };
    }

    if (
      typeof error ===
      'string'
    ) {
      return {
        message:
          sanitizeErrorMessage(
            error,
          ),
        code:
          '',
        requestId:
          '',
        retryable:
          true,
      };
    }

    const code =
      safeText(
        error.code ||
          error.errorCode ||
          error.statusCode ||
          error.status,
      );

    const requestId =
      safeText(
        error.requestId ||
          error.correlationId ||
          error.traceId ||
          error.transactionId,
      );

    const retryable =
      error.retryable !==
      undefined
        ? Boolean(
            error.retryable,
          )
        : true;

    return {
      message:
        sanitizeErrorMessage(
          error.userMessage ||
            error.message ||
            error.error ||
            DEFAULT_ERROR_MESSAGE,
        ),
      code,
      requestId,
      retryable,
    };
  };


/* ============================================================================
 * Icons
 * ========================================================================== */

const IconBase = ({
  children,
  size = 48,
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
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);


const AlertIcon = ({
  size = 48,
}) => (
  <IconBase size={size}>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </IconBase>
);


const NetworkIcon = ({
  size = 48,
}) => (
  <IconBase size={size}>
    <path d="M1 1l22 22" />
    <path d="M16.72 11.06a10.94 10.94 0 0 0-3.44-1.94" />
    <path d="M5 12.55a10.94 10.94 0 0 1 4-2.13" />
    <path d="M8.53 16.11a6 6 0 0 1 6.94 0" />
    <path d="M12 20h.01" />
  </IconBase>
);


const LockIcon = ({
  size = 48,
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


const SearchNotFoundIcon = ({
  size = 48,
}) => (
  <IconBase size={size}>
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
    <path d="m9 9 4 4" />
    <path d="m13 9-4 4" />
  </IconBase>
);


const RefreshIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
  >
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </IconBase>
);


const ArrowLeftIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </IconBase>
);


const SupportIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
  >
    <path d="M3 11a9 9 0 0 1 18 0" />
    <path d="M5 15a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z" />
    <path d="M19 15a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z" />
    <path d="M19 15c0 3-2.5 5-6 5" />
    <path d="M13 20h-2" />
  </IconBase>
);


/* ============================================================================
 * Variant configuration
 * ========================================================================== */

const ERROR_VARIANTS = {
  generic: {
    title:
      DEFAULT_TITLE,

    description:
      DEFAULT_ERROR_MESSAGE,

    icon:
      'alert',
  },

  network: {
    title:
      'Connection problem',

    description:
      'We could not connect to the TITech service. Check your network connection and try again.',

    icon:
      'network',
  },

  offline: {
    title:
      'You are offline',

    description:
      'Check your network connection and try again.',

    icon:
      'network',
  },

  unauthorized: {
    title:
      'Authentication required',

    description:
      'Your session may have expired. Please sign in again to continue.',

    icon:
      'lock',
  },

  forbidden: {
    title:
      'Access denied',

    description:
      'You do not currently have permission to perform this action.',

    icon:
      'lock',
  },

  permission: {
    title:
      'Access unavailable',

    description:
      'Your account does not currently have permission to access this content.',

    icon:
      'lock',
  },

  notFound: {
    title:
      'Content not found',

    description:
      'The requested conversation or resource could not be found.',

    icon:
      'search',
  },

  rateLimit: {
    title:
      'Too many requests',

    description:
      'Please wait a moment before trying again.',

    icon:
      'alert',
  },

  serviceUnavailable: {
    title:
      'Service temporarily unavailable',

    description:
      'The TITech service is temporarily unavailable. Please try again shortly.',

    icon:
      'network',
  },

  validation: {
    title:
      'Request could not be completed',

    description:
      'Please review your information and try again.',

    icon:
      'alert',
  },

  search: {
    title:
      'No matching conversations',

    description:
      'Try a different search term or clear the current filter.',

    icon:
      'search',
  },
};


/* ============================================================================
 * ErrorState
 * ========================================================================== */

const ErrorState =
  forwardRef(
    function ErrorState(
      {
        variant =
          'generic',

        error =
          null,

        title,

        message,

        description,

        icon,

        illustration,

        iconSize =
          48,

        onRetry,

        retryLabel =
          DEFAULT_RETRY_LABEL,

        onBack,

        backLabel =
          DEFAULT_BACK_LABEL,

        onPrimaryAction,

        primaryActionLabel,

        onSecondaryAction,

        secondaryActionLabel,

        primaryAction,

        secondaryAction,

        onSupport,

        supportLabel =
          DEFAULT_SUPPORT_LABEL,

        showErrorCode =
          false,

        showRequestId =
          false,

        showTechnicalDetails =
          false,

        technicalDetails,

        retrying =
          false,

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

        showBrand =
          false,

        brandName =
          'TITech Community Capital',

        className =
          '',

        contentClassName =
          '',

        titleClassName =
          '',

        messageClassName =
          '',

        detailsClassName =
          '',

        actionsClassName =
          '',

        ariaLabel,

        live =
          true,

        testId =
          'titech-error-state',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const normalizedError =
        useMemo(
          () =>
            normalizeError(
              error,
            ),
          [
            error,
          ],
        );

      const configuration =
        ERROR_VARIANTS[
          variant
        ] ||
        ERROR_VARIANTS.generic;

      const resolvedTitle =
        safeText(
          title,
          configuration.title,
        );

      const resolvedMessage =
        safeText(
          message ||
            description ||
            normalizedError.message,
          configuration.description,
        );

      const isBusy =
        Boolean(
          disabled ||
            loading ||
            retrying,
        );

      const resolvedIcon =
        illustration ||
        icon ||
        (
          configuration.icon ===
          'network'
            ? (
                <NetworkIcon
                  size={
                    iconSize
                  }
                />
              )
            : configuration.icon ===
                'lock'
              ? (
                  <LockIcon
                    size={
                      iconSize
                    }
                  />
                )
              : configuration.icon ===
                  'search'
                ? (
                    <SearchNotFoundIcon
                      size={
                        iconSize
                      }
                    />
                  )
                : (
                    <AlertIcon
                      size={
                        iconSize
                      }
                    />
                  )
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

      const hasSupport =
        typeof onSupport ===
        'function';

      const hasTechnicalDetails =
        showTechnicalDetails &&
        Boolean(
          technicalDetails,
        );

      /**
       * ======================================================================
       * Public ref API
       * ====================================================================
       */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          focusRetry() {
            rootRef.current
              ?.querySelector(
                '[data-titech-error-retry="true"]',
              )
              ?.focus();
          },

          focusPrimaryAction() {
            rootRef.current
              ?.querySelector(
                '[data-titech-error-primary="true"]',
              )
              ?.focus();
          },

          focusSecondaryAction() {
            rootRef.current
              ?.querySelector(
                '[data-titech-error-secondary="true"]',
              )
              ?.focus();
          },
        }),
        [],
      );

      /**
       * ======================================================================
       * Action handlers
       * ====================================================================
       */

      const handleRetry =
        () => {
          if (
            isBusy
          ) {
            return;
          }

          onRetry?.();
        };

      const handleBack =
        () => {
          if (
            isBusy
          ) {
            return;
          }

          onBack?.();
        };

      const handlePrimary =
        () => {
          if (
            isBusy
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
            isBusy
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

      const handleSupport =
        () => {
          if (
            isBusy
          ) {
            return;
          }

          onSupport?.();
        };

      /**
       * ======================================================================
       * CSS classes
       * ====================================================================
       */

      const rootClassName = [
        'titech-error-state',

        `titech-error-state--${safeText(
          variant,
          'generic',
        ).toLowerCase()}`,

        compact
          ? 'titech-error-state--compact'
          : '',

        fullHeight
          ? 'titech-error-state--full-height'
          : '',

        centered
          ? 'titech-error-state--centered'
          : '',

        isBusy
          ? 'titech-error-state--busy'
          : '',

        retrying
          ? 'titech-error-state--retrying'
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
          role="alert"
          aria-live={
            live
              ? 'assertive'
              : undefined
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
          data-error-variant={
            variant
          }
          data-error-code={
            normalizedError.code ||
            undefined
          }
        >

          <div
            className={cn(
              'titech-error-state__content',
              contentClassName,
            )}
          >

            {/* ============================================================
                Brand
                ============================================================ */}

            {showBrand ? (
              <div
                className="titech-error-state__brand"
                aria-hidden="true"
              >
                {
                  brandName
                }
              </div>
            ) : null}


            {/* ============================================================
                Icon / illustration
                ============================================================ */}

            <div
              className="titech-error-state__illustration"
              aria-hidden="true"
              data-testid="titech-error-state-icon"
            >
              {
                resolvedIcon
              }
            </div>


            {/* ============================================================
                Title
                ============================================================ */}

            <h2
              className={cn(
                'titech-error-state__title',
                titleClassName,
              )}
              data-testid="titech-error-state-title"
            >
              {
                resolvedTitle
              }
            </h2>


            {/* ============================================================
                User-safe message
                ============================================================ */}

            <p
              className={cn(
                'titech-error-state__message',
                messageClassName,
              )}
              data-testid="titech-error-state-message"
            >
              {
                resolvedMessage
              }
            </p>


            {/* ============================================================
                Error metadata
                ============================================================ */}

            {(
              (showErrorCode &&
                normalizedError.code) ||
              (showRequestId &&
                normalizedError.requestId)
            ) ? (
              <div
                className="titech-error-state__metadata"
                data-testid="titech-error-state-metadata"
              >

                {showErrorCode &&
                normalizedError.code ? (
                  <div className="titech-error-state__metadata-row">
                    <span className="titech-error-state__metadata-label">
                      Error code
                    </span>

                    <code className="titech-error-state__metadata-value">
                      {
                        normalizedError.code
                      }
                    </code>
                  </div>
                ) : null}


                {showRequestId &&
                normalizedError.requestId ? (
                  <div className="titech-error-state__metadata-row">
                    <span className="titech-error-state__metadata-label">
                      Request ID
                    </span>

                    <code className="titech-error-state__metadata-value">
                      {
                        normalizedError.requestId
                      }
                    </code>
                  </div>
                ) : null}

              </div>
            ) : null}


            {/* ============================================================
                Technical details
                ============================================================ */}

            {hasTechnicalDetails ? (
              <details
                className={cn(
                  'titech-error-state__details',
                  detailsClassName,
                )}
              >
                <summary>
                  Technical details
                </summary>

                <pre>
                  {
                    safeText(
                      technicalDetails,
                    ),
                  }
                </pre>
              </details>
            ) : null}


            {/* ============================================================
                Actions
                ============================================================ */}

            {(
              hasRetry ||
              hasPrimaryAction ||
              hasSecondaryAction ||
              hasBack ||
              hasSupport
            ) ? (
              <div
                className={cn(
                  'titech-error-state__actions',
                  actionsClassName,
                )}
                data-testid="titech-error-state-actions"
              >

                {/* ------------------------------------------------------
                    Primary action
                    ------------------------------------------------------ */}

                {hasPrimaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-error-state__button',
                      'titech-error-state__button--primary',
                    )}
                    onClick={
                      handlePrimary
                    }
                    disabled={
                      isBusy ||
                      primaryAction?.disabled
                    }
                    autoFocus={
                      Boolean(
                        primaryAction?.autoFocus,
                      )
                    }
                    data-titech-error-primary="true"
                    data-testid="titech-error-state-primary"
                  >
                    {primaryAction?.icon ? (
                      <span
                        className="titech-error-state__button-icon"
                        aria-hidden="true"
                      >
                        {
                          primaryAction.icon
                        }
                      </span>
                    ) : null}

                    <span>
                      {
                        primaryAction?.label ||
                        primaryActionLabel ||
                        'Continue'
                      }
                    </span>
                  </button>
                ) : null}


                {/* ------------------------------------------------------
                    Retry
                    ------------------------------------------------------ */}

                {hasRetry ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-error-state__button',
                      'titech-error-state__button--primary',
                    )}
                    onClick={
                      handleRetry
                    }
                    disabled={
                      isBusy
                    }
                    data-titech-error-retry="true"
                    data-testid="titech-error-state-retry"
                  >
                    <span
                      className="titech-error-state__button-icon"
                      aria-hidden="true"
                    >
                      <RefreshIcon />
                    </span>

                    <span>
                      {
                        retrying
                          ? 'Retrying…'
                          : retryLabel
                      }
                    </span>
                  </button>
                ) : null}


                {/* ------------------------------------------------------
                    Secondary action
                    ------------------------------------------------------ */}

                {hasSecondaryAction ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-error-state__button',
                      'titech-error-state__button--secondary',
                    )}
                    onClick={
                      handleSecondary
                    }
                    disabled={
                      isBusy ||
                      secondaryAction?.disabled
                    }
                    data-titech-error-secondary="true"
                    data-testid="titech-error-state-secondary"
                  >
                    {secondaryAction?.icon ? (
                      <span
                        className="titech-error-state__button-icon"
                        aria-hidden="true"
                      >
                        {
                          secondaryAction.icon
                        }
                      </span>
                    ) : null}

                    <span>
                      {
                        secondaryAction?.label ||
                        secondaryActionLabel ||
                        'Cancel'
                      }
                    </span>
                  </button>
                ) : null}


                {/* ------------------------------------------------------
                    Back
                    ------------------------------------------------------ */}

                {hasBack ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-error-state__button',
                      'titech-error-state__button--secondary',
                    )}
                    onClick={
                      handleBack
                    }
                    disabled={
                      isBusy
                    }
                    data-testid="titech-error-state-back"
                  >
                    <span
                      className="titech-error-state__button-icon"
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


                {/* ------------------------------------------------------
                    Support
                    ------------------------------------------------------ */}

                {hasSupport ? (
                  <button
                    type="button"
                    className={cn(
                      'titech-error-state__button',
                      'titech-error-state__button--secondary',
                    )}
                    onClick={
                      handleSupport
                    }
                    disabled={
                      isBusy
                    }
                    data-testid="titech-error-state-support"
                  >
                    <span
                      className="titech-error-state__button-icon"
                      aria-hidden="true"
                    >
                      <SupportIcon />
                    </span>

                    <span>
                      {
                        supportLabel
                      }
                    </span>
                  </button>
                ) : null}

              </div>
            ) : null}


            {/* ============================================================
                Retry/loading status
                ============================================================ */}

            {retrying ||
            loading ? (
              <div
                className="titech-error-state__status"
                role="status"
                aria-live="polite"
                data-testid="titech-error-state-loading"
              >
                <span
                  className="titech-error-state__spinner"
                  aria-hidden="true"
                />

                <span>
                  {retrying
                    ? 'Retrying…'
                    : 'Processing…'}
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

ErrorState.displayName =
  'TITechErrorState';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ErrorState.propTypes = {
  variant:
    PropTypes.oneOf([
      'generic',
      'network',
      'offline',
      'unauthorized',
      'forbidden',
      'permission',
      'notFound',
      'rateLimit',
      'serviceUnavailable',
      'validation',
      'search',
    ]),

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  title:
    PropTypes.string,

  message:
    PropTypes.string,

  description:
    PropTypes.string,

  icon:
    PropTypes.node,

  illustration:
    PropTypes.node,

  iconSize:
    PropTypes.number,

  onRetry:
    PropTypes.func,

  retryLabel:
    PropTypes.string,

  onBack:
    PropTypes.func,

  backLabel:
    PropTypes.string,

  onPrimaryAction:
    PropTypes.func,

  primaryActionLabel:
    PropTypes.string,

  onSecondaryAction:
    PropTypes.func,

  secondaryActionLabel:
    PropTypes.string,

  primaryAction:
    PropTypes.shape({
      label:
        PropTypes.string,

      icon:
        PropTypes.node,

      onClick:
        PropTypes.func,

      disabled:
        PropTypes.bool,

      autoFocus:
        PropTypes.bool,
    }),

  secondaryAction:
    PropTypes.shape({
      label:
        PropTypes.string,

      icon:
        PropTypes.node,

      onClick:
        PropTypes.func,

      disabled:
        PropTypes.bool,
    }),

  onSupport:
    PropTypes.func,

  supportLabel:
    PropTypes.string,

  showErrorCode:
    PropTypes.bool,

  showRequestId:
    PropTypes.bool,

  showTechnicalDetails:
    PropTypes.bool,

  technicalDetails:
    PropTypes.string,

  retrying:
    PropTypes.bool,

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

  showBrand:
    PropTypes.bool,

  brandName:
    PropTypes.string,

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  titleClassName:
    PropTypes.string,

  messageClassName:
    PropTypes.string,

  detailsClassName:
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

ErrorState.defaultProps = {
  variant:
    'generic',

  error:
    null,

  title:
    undefined,

  message:
    undefined,

  description:
    undefined,

  icon:
    undefined,

  illustration:
    undefined,

  iconSize:
    48,

  onRetry:
    undefined,

  retryLabel:
    DEFAULT_RETRY_LABEL,

  onBack:
    undefined,

  backLabel:
    DEFAULT_BACK_LABEL,

  onPrimaryAction:
    undefined,

  primaryActionLabel:
    undefined,

  onSecondaryAction:
    undefined,

  secondaryActionLabel:
    undefined,

  primaryAction:
    undefined,

  secondaryAction:
    undefined,

  onSupport:
    undefined,

  supportLabel:
    DEFAULT_SUPPORT_LABEL,

  showErrorCode:
    false,

  showRequestId:
    false,

  showTechnicalDetails:
    false,

  technicalDetails:
    undefined,

  retrying:
    false,

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

  showBrand:
    false,

  brandName:
    'TITech Community Capital',

  className:
    '',

  contentClassName:
    '',

  titleClassName:
    '',

  messageClassName:
    '',

  detailsClassName:
    '',

  actionsClassName:
    '',

  ariaLabel:
    undefined,

  live:
    true,

  testId:
    'titech-error-state',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  ArrowLeftIcon,
  ERROR_VARIANTS,
  LockIcon,
  NetworkIcon,
  SearchNotFoundIcon,
  SupportIcon,
  normalizeError,
  safeText,
  sanitizeErrorMessage,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ErrorState;