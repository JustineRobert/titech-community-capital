'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Error State Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ErrorState.jsx
 *
 * Purpose:
 *   Production-grade, reusable, accessible and security-conscious error-state
 *   component for TITech applications.
 *
 * Design principles
 * ----------------------------------------------------------------------------
 * ✓ Presentation-only security boundary
 * ✓ Safe public error messaging
 * ✓ Stable error reference identifiers
 * ✓ Enterprise error variants
 * ✓ Retry / navigation / support actions
 * ✓ Promise-aware action handling
 * ✓ Retry race protection
 * ✓ Accessible alert semantics
 * ✓ Correct aria relationships
 * ✓ Keyboard accessibility
 * ✓ Ref API
 * ✓ Development diagnostics only
 * ✓ Production-safe error details
 * ✓ External-link protocol validation
 * ✓ Stable test selectors
 * ✓ Compact / inline / bordered / elevated modes
 * ✓ Custom content / actions / footer
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * Never use this component as an authorization, tenant-isolation, financial
 * integrity or security-control boundary.
 *
 * Backend errors MUST be sanitized before being presented to users.
 * Credentials, tokens, secrets, internal stack traces and confidential
 * financial information must never be rendered into production UI.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileWarning,
  Home,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';

import './ErrorState.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

export const ERROR_VARIANTS = Object.freeze({
  DEFAULT: 'default',
  NETWORK: 'network',
  SERVER: 'server',
  PERMISSION: 'permission',
  NOT_FOUND: 'not_found',
});

export const ERROR_ICONS = Object.freeze({
  [ERROR_VARIANTS.DEFAULT]: AlertTriangle,
  [ERROR_VARIANTS.NETWORK]: WifiOff,
  [ERROR_VARIANTS.SERVER]: ServerCrash,
  [ERROR_VARIANTS.PERMISSION]: ShieldAlert,
  [ERROR_VARIANTS.NOT_FOUND]: FileWarning,
});

export const ERROR_TITLES = Object.freeze({
  [ERROR_VARIANTS.DEFAULT]: 'Something went wrong',
  [ERROR_VARIANTS.NETWORK]: 'Network Connection Error',
  [ERROR_VARIANTS.SERVER]: 'Service Temporarily Unavailable',
  [ERROR_VARIANTS.PERMISSION]: 'Access Denied',
  [ERROR_VARIANTS.NOT_FOUND]: 'Resource Not Found',
});

export const ERROR_DESCRIPTIONS = Object.freeze({
  [ERROR_VARIANTS.DEFAULT]:
    'An unexpected error occurred while processing your request.',

  [ERROR_VARIANTS.NETWORK]:
    'Unable to connect to the server. Please check your internet connection and try again.',

  [ERROR_VARIANTS.SERVER]:
    'Our services are temporarily unavailable. Please try again in a few moments.',

  [ERROR_VARIANTS.PERMISSION]:
    "You don't have permission to access this resource.",

  [ERROR_VARIANTS.NOT_FOUND]:
    'The requested resource could not be found or may have been removed.',
});

export const ERROR_SIZES = Object.freeze([
  'small',
  'medium',
  'large',
]);

export const ERROR_ALIGNMENTS = Object.freeze([
  'left',
  'center',
  'right',
]);

export const ERROR_LIVE_MODES = Object.freeze([
  'off',
  'polite',
  'assertive',
]);

export const ERROR_ROLES = Object.freeze([
  'alert',
  'status',
]);

export const DEFAULT_RETRY_LABEL = 'Try Again';
export const DEFAULT_HOME_LABEL = 'Go Home';
export const DEFAULT_BACK_LABEL = 'Go Back';
export const DEFAULT_DETAILS_LABEL = 'View error details';
export const DEFAULT_TEST_ID = 'titech-error-state';
export const DEFAULT_LOADING_LABEL = 'Retrying…';
export const DEFAULT_ERROR_REFERENCE_PREFIX = 'TITech-ERR';

const SAFE_EXTERNAL_PROTOCOLS = Object.freeze([
  'http:',
  'https:',
  'mailto:',
  'tel:',
]);

const DEFAULT_ICON_SIZE = Object.freeze({
  small: 36,
  medium: 48,
  large: 56,
});


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

/**
 * Join CSS class names while ignoring empty values.
 */
export const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');


/**
 * Safely convert an unknown value to trimmed text.
 */
export const safeText = (
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
    const result = String(value).trim();

    return result || fallback;
  } catch {
    return fallback;
  }
};


/**
 * Detect Promise / thenable values.
 */
export const isPromiseLike = (value) =>
  Boolean(
    value &&
      typeof value.then === 'function',
  );


/**
 * Determine whether the current runtime is development.
 *
 * Supports standard browser bundlers without assuming process exists.
 */
export const isDevelopment =
  typeof process !== 'undefined' &&
  process?.env?.NODE_ENV === 'development';


/**
 * Normalize an unsupported variant to the default application error.
 */
export const normalizeVariant = (variant) =>
  Object.values(ERROR_VARIANTS).includes(variant)
    ? variant
    : ERROR_VARIANTS.DEFAULT;


/**
 * Extract a safe, user-presentable error message.
 *
 * NOTE:
 * This helper is intentionally conservative. The returned message should
 * still be considered application-provided public text rather than a trust
 * boundary.
 */
export const getSafeErrorMessage = (error) => {
  if (typeof error === 'string') {
    return safeText(error);
  }

  if (
    error &&
    typeof error === 'object'
  ) {
    return safeText(
      error.userMessage ||
        error.publicMessage ||
        '',
    );
  }

  return '';
};


/**
 * Extract a safe error code.
 */
export const getErrorCode = (error) => {
  if (
    !error ||
    typeof error !== 'object'
  ) {
    return '';
  }

  return safeText(
    error.code ||
      error.errorCode ||
      error.statusCode ||
      '',
  );
};


/**
 * Generate a lightweight client-side support reference.
 *
 * No error contents are embedded into the reference.
 */
export const createErrorReference = (
  prefix = DEFAULT_ERROR_REFERENCE_PREFIX,
) => {
  const timestamp = Date.now()
    .toString(36)
    .toUpperCase();

  let entropy = '';

  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      entropy = crypto
        .randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)
        .toUpperCase();
    }
  } catch {
    entropy = '';
  }

  if (!entropy) {
    entropy = Math.random()
      .toString(36)
      .slice(2, 10)
      .toUpperCase();
  }

  return `${safeText(
    prefix,
    DEFAULT_ERROR_REFERENCE_PREFIX,
  )}-${timestamp}-${entropy}`;
};


/**
 * Return development-only diagnostic information.
 *
 * Production builds intentionally receive no diagnostic object.
 */
export const getDevelopmentDiagnostics = (error) => {
  if (
    !isDevelopment ||
    !error
  ) {
    return null;
  }

  if (
    typeof error !== 'object' &&
    typeof error !== 'string'
  ) {
    return null;
  }

  return {
    name:
      typeof error === 'object'
        ? safeText(error?.name, 'Error')
        : 'Error',

    message:
      getSafeErrorMessage(error) ||
      (typeof error === 'string'
        ? safeText(error)
        : ''),

    code:
      getErrorCode(error),

    stack:
      typeof error === 'object'
        ? safeText(error?.stack)
        : '',
  };
};


/**
 * Validate an external URL before rendering it as a navigable href.
 *
 * Relative URLs are accepted.
 *
 * Absolute URLs are restricted to safe browser protocols to prevent
 * javascript:, data:, vbscript: and similar dangerous destinations.
 */
export const getSafeExternalHref = (href) => {
  const value = safeText(href);

  if (!value) {
    return '';
  }

  if (
    value.startsWith('/') &&
    !value.startsWith('//')
  ) {
    return value;
  }

  if (
    value.startsWith('#') ||
    value.startsWith('?')
  ) {
    return value;
  }

  try {
    const parsed = new URL(
      value,
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost',
    );

    if (
      !SAFE_EXTERNAL_PROTOCOLS.includes(
        parsed.protocol,
      )
    ) {
      return '';
    }

    return value;
  } catch {
    return '';
  }
};


/**
 * Build a single accessible label.
 */
export const buildAccessibleLabel = (
  title,
  description,
) => {
  const safeTitle = safeText(title);
  const safeDescription = safeText(description);

  if (
    safeTitle &&
    safeDescription
  ) {
    return `${safeTitle}. ${safeDescription}`;
  }

  return safeTitle || safeDescription;
};


/**
 * Resolve a safe icon size.
 */
const resolveIconSize = (size) =>
  DEFAULT_ICON_SIZE[size] ||
  DEFAULT_ICON_SIZE.medium;


/**
 * Execute a callback while protecting UI state from stale asynchronous
 * completions.
 */
const executeAction = async (
  callback,
  error,
) => {
  if (typeof callback !== 'function') {
    return undefined;
  }

  return callback(error);
};


/* ============================================================================
 * Main component
 * ========================================================================== */

const ErrorStateInner = forwardRef(
  function ErrorStateInner(
    props,
    forwardedRef,
  ) {
    const generatedId = useId();

    const rootRef = useRef(null);
    const retryOperationRef = useRef(0);

    const [
      retrying,
      setRetrying,
    ] = useState(false);

    const {
      title,
      description,

      variant = ERROR_VARIANTS.DEFAULT,

      error,

      showRetry = true,
      showHome = false,
      showBack = false,

      retryLabel = DEFAULT_RETRY_LABEL,
      homeLabel = DEFAULT_HOME_LABEL,
      backLabel = DEFAULT_BACK_LABEL,

      onRetry,
      onHome,
      onBack,

      showErrorDetails = false,

      errorReference,
      showErrorReference = false,

      showErrorCode = false,

      customErrorContent,
      customActions,

      loading = false,
      loadingLabel = DEFAULT_LOADING_LABEL,

      disabled = false,

      compact = false,
      inline = false,
      bordered = false,
      elevated = false,

      size = 'medium',
      align = 'center',

      className = '',
      contentClassName = '',
      iconClassName = '',
      actionsClassName = '',
      detailsClassName = '',

      testId = DEFAULT_TEST_ID,

      role = 'alert',
      live = 'assertive',

      ariaLabel,

      titleId,
      descriptionId,

      children,
      footer,

      externalHelpLabel,
      externalHelpHref,
      onExternalHelp,

      ...rest
    } = props;


    /* ========================================================================
     * Derived state
     * ====================================================================== */

    const resolvedVariant = useMemo(
      () => normalizeVariant(variant),
      [variant],
    );

    const Icon =
      ERROR_ICONS[resolvedVariant] ||
      AlertTriangle;

    const finalTitle = useMemo(
      () =>
        safeText(
          title,
          ERROR_TITLES[resolvedVariant] ||
            ERROR_TITLES.default,
        ),
      [
        resolvedVariant,
        title,
      ],
    );

    const finalDescription = useMemo(
      () =>
        safeText(
          description,
          ERROR_DESCRIPTIONS[resolvedVariant] ||
            ERROR_DESCRIPTIONS.default,
        ),
      [
        description,
        resolvedVariant,
      ],
    );

    const safeErrorMessage = useMemo(
      () =>
        getSafeErrorMessage(error),
      [error],
    );

    const errorCode = useMemo(
      () => getErrorCode(error),
      [error],
    );

    const resolvedSize = ERROR_SIZES.includes(
      size,
    )
      ? size
      : 'medium';

    const resolvedAlign =
      ERROR_ALIGNMENTS.includes(align)
        ? align
        : 'center';

    const resolvedRole =
      ERROR_ROLES.includes(role)
        ? role
        : 'alert';

    const resolvedLive =
      ERROR_LIVE_MODES.includes(live)
        ? live
        : 'assertive';

    const resolvedTitleId =
      safeText(titleId) ||
      `titech-error-title-${generatedId}`;

    const resolvedDescriptionId =
      safeText(descriptionId) ||
      `titech-error-description-${generatedId}`;

    const resolvedDetailsId =
      `titech-error-details-${generatedId}`;

    const reference = useMemo(
      () =>
        safeText(errorReference) ||
        (
          showErrorReference
            ? createErrorReference()
            : ''
        ),
      [
        errorReference,
        showErrorReference,
      ],
    );

    const diagnostics = useMemo(
      () =>
        getDevelopmentDiagnostics(error),
      [error],
    );

    const safeHelpHref = useMemo(
      () =>
        getSafeExternalHref(
          externalHelpHref,
        ),
      [externalHelpHref],
    );

    const isBusy =
      Boolean(
        loading ||
          retrying,
      );

    const isInteractionDisabled =
      Boolean(
        disabled ||
          isBusy,
      );

    const accessibleLabel = useMemo(
      () =>
        safeText(
          ariaLabel,
          buildAccessibleLabel(
            isBusy
              ? loadingLabel
              : finalTitle,
            isBusy
              ? ''
              : finalDescription,
          ),
        ),
      [
        ariaLabel,
        finalDescription,
        finalTitle,
        isBusy,
        loadingLabel,
      ],
    );

    const hasDescription =
      Boolean(
        finalDescription &&
          !isBusy,
      );

    const hasActions =
      (
        showRetry &&
        typeof onRetry === 'function'
      ) ||
      (
        showBack &&
        typeof onBack === 'function'
      ) ||
      (
        showHome &&
        typeof onHome === 'function'
      ) ||
      Boolean(customActions) ||
      (
        externalHelpLabel &&
        (
          typeof onExternalHelp === 'function' ||
          safeHelpHref
        )
      );


    /* ========================================================================
     * Action handlers
     * ====================================================================== */

    const handleRetry = useCallback(
      async () => {
        if (
          retrying ||
          disabled ||
          loading ||
          typeof onRetry !== 'function'
        ) {
          return;
        }

        const operationId =
          retryOperationRef.current + 1;

        retryOperationRef.current =
          operationId;

        setRetrying(true);

        try {
          await executeAction(
            onRetry,
            error,
          );
        } finally {
          if (
            retryOperationRef.current ===
            operationId
          ) {
            setRetrying(false);
          }
        }
      },
      [
        disabled,
        error,
        loading,
        onRetry,
        retrying,
      ],
    );


    const handleHome = useCallback(
      async () => {
        if (
          disabled ||
          loading ||
          retrying ||
          typeof onHome !== 'function'
        ) {
          return;
        }

        await executeAction(
          onHome,
          error,
        );
      },
      [
        disabled,
        error,
        loading,
        onHome,
        retrying,
      ],
    );


    const handleBack = useCallback(
      async () => {
        if (
          disabled ||
          loading ||
          retrying ||
          typeof onBack !== 'function'
        ) {
          return;
        }

        await executeAction(
          onBack,
          error,
        );
      },
      [
        disabled,
        error,
        loading,
        onBack,
        retrying,
      ],
    );


    const handleExternalHelp =
      useCallback(
        async (event) => {
          if (
            disabled ||
            loading ||
            retrying
          ) {
            event?.preventDefault?.();
            return;
          }

          if (
            typeof onExternalHelp ===
            'function'
          ) {
            await executeAction(
              onExternalHelp,
              error,
            );
          }
        },
        [
          disabled,
          error,
          loading,
          onExternalHelp,
          retrying,
        ],
      );


    /* ========================================================================
     * Ref API
     * ====================================================================== */

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus() {
          rootRef.current?.focus?.();
        },

        getElement() {
          return rootRef.current;
        },

        getVariant() {
          return resolvedVariant;
        },

        getErrorReference() {
          return reference;
        },

        getErrorCode() {
          return errorCode;
        },

        isLoading() {
          return isBusy;
        },

        retry() {
          return handleRetry();
        },
      }),
      [
        errorCode,
        handleRetry,
        isBusy,
        reference,
        resolvedVariant,
      ],
    );


    /* ========================================================================
     * CSS classes
     * ====================================================================== */

    const rootClassName = cn(
      'error-state',
      `error-state-${resolvedVariant}`,
      `error-state-${resolvedSize}`,
      `error-state-align-${resolvedAlign}`,

      compact &&
        'error-state-compact',

      inline &&
        'error-state-inline',

      bordered &&
        'error-state-bordered',

      elevated &&
        'error-state-elevated',

      isBusy &&
        'error-state-loading',

      disabled &&
        'error-state-disabled',

      className,
    );


    /* ========================================================================
     * Render
     * ====================================================================== */

    return (
      <section
        {...rest}
        ref={rootRef}
        className={rootClassName}
        role={resolvedRole}
        aria-live={resolvedLive}
        aria-busy={
          isBusy
            ? 'true'
            : undefined
        }
        aria-labelledby={
          finalTitle
            ? resolvedTitleId
            : undefined
        }
        aria-describedby={
          hasDescription
            ? resolvedDescriptionId
            : undefined
        }
        aria-label={
          accessibleLabel ||
          undefined
        }
        data-testid={testId}
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        data-align={resolvedAlign}
        data-state={
          isBusy
            ? 'loading'
            : 'error'
        }
        tabIndex={-1}
      >
        <div
          className={cn(
            'error-state-content',
            contentClassName,
          )}
        >
          {/* ==================================================================
              Icon
              ================================================================== */}

          <div
            className={cn(
              'error-state-icon',
              iconClassName,
            )}
            aria-hidden="true"
          >
            {isBusy ? (
              <RefreshCw
                size={resolveIconSize(
                  resolvedSize,
                )}
                className="error-state-spinner"
              />
            ) : (
              <Icon
                size={resolveIconSize(
                  resolvedSize,
                )}
              />
            )}
          </div>


          {/* ==================================================================
              Copy
              ================================================================== */}

          <div className="error-state-copy">
            <h2
              id={resolvedTitleId}
              className="error-state-title"
            >
              {isBusy
                ? safeText(
                    loadingLabel,
                    DEFAULT_LOADING_LABEL,
                  )
                : finalTitle}
            </h2>


            {hasDescription ? (
              <p
                id={resolvedDescriptionId}
                className="error-state-description"
              >
                {finalDescription}
              </p>
            ) : null}


            {/* ================================================================
                Safe error reference
                ================================================================ */}

            {showErrorReference &&
            reference ? (
              <p
                className="error-state-reference"
                data-testid="titech-error-state-reference"
              >
                Reference:{' '}
                <code>
                  {reference}
                </code>
              </p>
            ) : null}


            {/* ================================================================
                Error code
                ================================================================ */}

            {showErrorCode &&
            errorCode ? (
              <p
                className="error-state-code"
                data-testid="titech-error-state-code"
              >
                Code:{' '}
                <code>
                  {errorCode}
                </code>
              </p>
            ) : null}


            {/* ================================================================
                Custom content
                ================================================================ */}

            {customErrorContent ? (
              <div className="error-state-custom-content">
                {customErrorContent}
              </div>
            ) : null}


            {/* ================================================================
                Development diagnostics
                ================================================================ */}

            {showErrorDetails &&
            diagnostics ? (
              <details
                id={resolvedDetailsId}
                className={cn(
                  'error-state-details',
                  detailsClassName,
                )}
              >
                <summary>
                  {DEFAULT_DETAILS_LABEL}
                </summary>

                <div className="error-state-details-body">
                  <div>
                    <strong>
                      Name:
                    </strong>{' '}
                    {diagnostics.name ||
                      'Error'}
                  </div>

                  <div>
                    <strong>
                      Message:
                    </strong>{' '}
                    {diagnostics.message ||
                      safeErrorMessage ||
                      'Unknown error'}
                  </div>

                  {diagnostics.code ? (
                    <div>
                      <strong>
                        Code:
                      </strong>{' '}
                      {diagnostics.code}
                    </div>
                  ) : null}

                  {diagnostics.stack ? (
                    <pre>
                      {diagnostics.stack}
                    </pre>
                  ) : null}
                </div>
              </details>
            ) : null}


            {/* ================================================================
                Explicit children
                ================================================================ */}

            {children ? (
              <div className="error-state-extra">
                {children}
              </div>
            ) : null}
          </div>


          {/* ==================================================================
              Actions
              ================================================================== */}

          {hasActions ? (
            <div
              className={cn(
                'error-state-actions',
                actionsClassName,
              )}
              data-testid="titech-error-state-actions"
            >
              {/* ==============================================================
                  Retry
                  ============================================================== */}

              {showRetry &&
              typeof onRetry === 'function' ? (
                <button
                  type="button"
                  className="error-state-btn primary"
                  onClick={handleRetry}
                  disabled={isInteractionDisabled}
                  aria-busy={
                    retrying
                      ? 'true'
                      : undefined
                  }
                  data-testid="titech-error-state-retry"
                >
                  <RefreshCw
                    size={18}
                    className={
                      retrying
                        ? 'error-state-btn-spinner'
                        : undefined
                    }
                    aria-hidden="true"
                  />

                  <span>
                    {retrying
                      ? safeText(
                          loadingLabel,
                          DEFAULT_LOADING_LABEL,
                        )
                      : safeText(
                          retryLabel,
                          DEFAULT_RETRY_LABEL,
                        )}
                  </span>
                </button>
              ) : null}


              {/* ==============================================================
                  Back
                  ============================================================== */}

              {showBack &&
              typeof onBack === 'function' ? (
                <button
                  type="button"
                  className="error-state-btn secondary"
                  onClick={handleBack}
                  disabled={isInteractionDisabled}
                  data-testid="titech-error-state-back"
                >
                  <ArrowLeft
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    {safeText(
                      backLabel,
                      DEFAULT_BACK_LABEL,
                    )}
                  </span>
                </button>
              ) : null}


              {/* ==============================================================
                  Home
                  ============================================================== */}

              {showHome &&
              typeof onHome === 'function' ? (
                <button
                  type="button"
                  className="error-state-btn secondary"
                  onClick={handleHome}
                  disabled={isInteractionDisabled}
                  data-testid="titech-error-state-home"
                >
                  <Home
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    {safeText(
                      homeLabel,
                      DEFAULT_HOME_LABEL,
                    )}
                  </span>
                </button>
              ) : null}


              {/* ==============================================================
                  External support/help
                  ============================================================== */}

              {externalHelpLabel &&
              (
                typeof onExternalHelp ===
                  'function' ||
                safeHelpHref
              ) ? (
                safeHelpHref ? (
                  <a
                    href={safeHelpHref}
                    className="error-state-btn secondary"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={
                      handleExternalHelp
                    }
                    aria-disabled={
                      isInteractionDisabled
                        ? 'true'
                        : undefined
                    }
                    tabIndex={
                      isInteractionDisabled
                        ? -1
                        : undefined
                    }
                    data-testid="titech-error-state-help-link"
                  >
                    <ExternalLink
                      size={18}
                      aria-hidden="true"
                    />

                    <span>
                      {externalHelpLabel}
                    </span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className="error-state-btn secondary"
                    onClick={
                      handleExternalHelp
                    }
                    disabled={
                      isInteractionDisabled
                    }
                    data-testid="titech-error-state-help"
                  >
                    <ExternalLink
                      size={18}
                      aria-hidden="true"
                    />

                    <span>
                      {externalHelpLabel}
                    </span>
                  </button>
                )
              ) : null}


              {/* ==============================================================
                  Custom actions
                  ============================================================== */}

              {customActions}
            </div>
          ) : null}


          {/* ==================================================================
              Footer
              ================================================================== */}

          {footer ? (
            <div className="error-state-footer">
              {footer}
            </div>
          ) : null}
        </div>
      </section>
    );
  },
);


/* ============================================================================
 * Public component
 * ========================================================================== */

const ErrorState = memo(
  ErrorStateInner,
);

ErrorState.displayName =
  'TITechErrorState';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ErrorState.propTypes = {
  title:
    PropTypes.string,

  description:
    PropTypes.string,

  variant:
    PropTypes.oneOf(
      Object.values(ERROR_VARIANTS),
    ),

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  showRetry:
    PropTypes.bool,

  showHome:
    PropTypes.bool,

  showBack:
    PropTypes.bool,

  retryLabel:
    PropTypes.string,

  homeLabel:
    PropTypes.string,

  backLabel:
    PropTypes.string,

  onRetry:
    PropTypes.func,

  onHome:
    PropTypes.func,

  onBack:
    PropTypes.func,

  showErrorDetails:
    PropTypes.bool,

  errorReference:
    PropTypes.string,

  showErrorReference:
    PropTypes.bool,

  showErrorCode:
    PropTypes.bool,

  customErrorContent:
    PropTypes.node,

  customActions:
    PropTypes.node,

  loading:
    PropTypes.bool,

  loadingLabel:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  inline:
    PropTypes.bool,

  bordered:
    PropTypes.bool,

  elevated:
    PropTypes.bool,

  size:
    PropTypes.oneOf(
      ERROR_SIZES,
    ),

  align:
    PropTypes.oneOf(
      ERROR_ALIGNMENTS,
    ),

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  iconClassName:
    PropTypes.string,

  actionsClassName:
    PropTypes.string,

  detailsClassName:
    PropTypes.string,

  testId:
    PropTypes.string,

  role:
    PropTypes.oneOf(
      ERROR_ROLES,
    ),

  live:
    PropTypes.oneOf(
      ERROR_LIVE_MODES,
    ),

  ariaLabel:
    PropTypes.string,

  titleId:
    PropTypes.string,

  descriptionId:
    PropTypes.string,

  children:
    PropTypes.node,

  footer:
    PropTypes.node,

  externalHelpLabel:
    PropTypes.string,

  externalHelpHref:
    PropTypes.string,

  onExternalHelp:
    PropTypes.func,
};


/* ============================================================================
 * Presets
 * ========================================================================== */

export const NetworkError = memo(
  function NetworkError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.NETWORK}
        {...props}
      />
    );
  },
);

NetworkError.displayName =
  'TITechNetworkError';


export const ServerError = memo(
  function ServerError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.SERVER}
        {...props}
      />
    );
  },
);

ServerError.displayName =
  'TITechServerError';


export const PermissionError = memo(
  function PermissionError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.PERMISSION}
        showRetry={false}
        {...props}
      />
    );
  },
);

PermissionError.displayName =
  'TITechPermissionError';


export const NotFoundError = memo(
  function NotFoundError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.NOT_FOUND}
        {...props}
      />
    );
  },
);

NotFoundError.displayName =
  'TITechNotFoundError';


export const RetryableNetworkError = memo(
  function RetryableNetworkError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.NETWORK}
        showRetry
        {...props}
      />
    );
  },
);

RetryableNetworkError.displayName =
  'TITechRetryableNetworkError';


export const AccessDeniedError = memo(
  function AccessDeniedError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.PERMISSION}
        showRetry={false}
        showHome
        {...props}
      />
    );
  },
);

AccessDeniedError.displayName =
  'TITechAccessDeniedError';


export const ResourceNotFoundError = memo(
  function ResourceNotFoundError(props) {
    return (
      <ErrorState
        variant={ERROR_VARIANTS.NOT_FOUND}
        showBack
        {...props}
      />
    );
  },
);

ResourceNotFoundError.displayName =
  'TITechResourceNotFoundError';


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_BACK_LABEL as ERROR_DEFAULT_BACK_LABEL,
  DEFAULT_DETAILS_LABEL as ERROR_DEFAULT_DETAILS_LABEL,
  DEFAULT_HOME_LABEL as ERROR_DEFAULT_HOME_LABEL,
  DEFAULT_RETRY_LABEL as ERROR_DEFAULT_RETRY_LABEL,
  DEFAULT_TEST_ID as ERROR_DEFAULT_TEST_ID,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ErrorState;