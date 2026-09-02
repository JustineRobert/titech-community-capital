'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise React Error Boundary
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ErrorBoundary.jsx
 *
 * Purpose:
 *   Production-grade React error boundary for isolating UI failures while
 *   preserving application availability, observability, accessibility, and
 *   controlled recovery.
 *
 * Design goals:
 *   - Isolate render/lifecycle failures
 *   - Recover safely without corrupting application state
 *   - Support controlled retry and hard reload
 *   - Support route/context-driven reset
 *   - Support custom fallback rendering
 *   - Prevent sensitive information from reaching production UI
 *   - Provide stable error correlation identifiers
 *   - Provide optional telemetry integration
 *   - Support imperative ref operations
 *   - Work correctly with lazy-loaded React modules
 *   - Remain framework-light and architecture-compatible
 *
 * SECURITY / PRIVACY BOUNDARY
 * ----------------------------------------------------------------------------
 * Never expose:
 *   - JWTs
 *   - refresh tokens
 *   - passwords
 *   - financial records
 *   - KYC documents
 *   - tenant secrets
 *   - authorization headers
 *   - backend credentials
 *   - payment data
 *   - complete request payloads
 *   - raw production stack traces
 *
 * Error telemetry should be routed through an approved TITech observability
 * pipeline and should itself enforce redaction before transmission.
 *
 * ============================================================================
 */

import React, {
  Component,
  createRef,
  forwardRef,
} from 'react';

import PropTypes from 'prop-types';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_RETRY_LIMIT = 2;

const DEFAULT_RETRY_DELAY = 0;

const DEFAULT_ERROR_ID_PREFIX = 'TITech-ERR';

const DEFAULT_TEST_ID = 'titech-error-boundary';

const DEFAULT_TITLE = 'Something went wrong';

const DEFAULT_MESSAGE =
  'TITech encountered an unexpected application error.';

const DEFAULT_RETRY_LABEL = 'Try again';

const DEFAULT_HOME_LABEL = 'Return to dashboard';

const DEFAULT_RELOAD_LABEL = 'Reload application';

const DEFAULT_HOME_PATH = '/dashboard';

const MAX_SAFE_RETRY_LIMIT = 10;

const MAX_SAFE_RETRY_DELAY = 30000;

/**
 * Browser error types that commonly indicate stale deployed JavaScript
 * chunks after a frontend deployment.
 */
const CHUNK_LOAD_ERROR_PATTERNS = Object.freeze([
  /ChunkLoadError/i,
  /Loading chunk [\d]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
]);

/* ============================================================================
 * Environment helpers
 * ========================================================================== */

const isDevelopment =
  typeof process !== 'undefined' &&
  process?.env?.NODE_ENV === 'development';

const isProduction =
  typeof process !== 'undefined' &&
  process?.env?.NODE_ENV === 'production';

/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (...classes) =>
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
    const text = String(value).trim();

    return text || fallback;
  } catch {
    return fallback;
  }
};

const clampNumber = (
  value,
  {
    min,
    max,
    fallback,
  },
) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      numeric,
    ),
  );
};

const normalizeRetryLimit = (
  value,
) =>
  Math.floor(
    clampNumber(
      value,
      {
        min: 0,
        max: MAX_SAFE_RETRY_LIMIT,
        fallback: DEFAULT_RETRY_LIMIT,
      },
    ),
  );

const normalizeRetryDelay = (
  value,
) =>
  clampNumber(
    value,
    {
      min: 0,
      max: MAX_SAFE_RETRY_DELAY,
      fallback: DEFAULT_RETRY_DELAY,
    },
  );

const safeJsonClone = (
  value,
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
  } catch {
    return null;
  }
};

const createErrorId = (
  prefix = DEFAULT_ERROR_ID_PREFIX,
) => {
  const normalizedPrefix =
    safeText(
      prefix,
      DEFAULT_ERROR_ID_PREFIX,
    );

  /**
   * Prefer cryptographically stronger UUID generation when available.
   */
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `${normalizedPrefix}-${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to portable generation.
  }

  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    Math.random()
      .toString(36)
      .slice(
        2,
        10,
      )
      .toUpperCase();

  return `${normalizedPrefix}-${timestamp}-${random}`;
};

const isErrorLike = (
  value,
) =>
  Boolean(
    value &&
    (
      value instanceof Error ||
      typeof value === 'object'
    ),
  );

const serializeError = (
  error,
  {
    includeStack = false,
  } = {},
) => {
  if (!error) {
    return {
      name: 'UnknownError',
      message: 'Unknown application error',
    };
  }

  const serialized = {
    name: safeText(
      error.name,
      'Error',
    ),

    message: safeText(
      error.message,
      'Unknown application error',
    ),
  };

  if (
    includeStack &&
    error.stack
  ) {
    serialized.stack = safeText(
      error.stack,
    );
  }

  return serialized;
};

const getLocationSnapshot = () => {
  if (
    typeof window === 'undefined'
  ) {
    return null;
  }

  return {
    pathname:
      safeText(
        window.location?.pathname,
      ),

    search:
      safeText(
        window.location?.search,
      ),

    hash:
      safeText(
        window.location?.hash,
      ),
  };
};

const getEnvironmentSnapshot = () => ({
  online:
    typeof navigator !== 'undefined'
      ? Boolean(
          navigator.onLine,
        )
      : true,

  language:
    typeof navigator !== 'undefined'
      ? safeText(
          navigator.language,
        )
      : '',

  platform:
    typeof navigator !== 'undefined'
      ? safeText(
          navigator.platform,
        )
      : '',

  timestamp:
    new Date().toISOString(),
});

const sanitizeContext = (
  context,
) => {
  if (
    context === null ||
    context === undefined
  ) {
    return null;
  }

  if (
    typeof context === 'string'
  ) {
    return safeText(
      context,
    );
  }

  if (
    typeof context !== 'object'
  ) {
    return null;
  }

  try {
    /**
     * Deliberately restrict context serialization.
     */
    const candidate = {};

    Object.keys(context)
      .slice(0, 20)
      .forEach(
        (key) => {
          if (
            !key ||
            typeof key !== 'string'
          ) {
            return;
          }

          const lowerKey =
            key.toLowerCase();

          const blocked =
            lowerKey.includes('token') ||
            lowerKey.includes('secret') ||
            lowerKey.includes('password') ||
            lowerKey.includes('authorization') ||
            lowerKey.includes('cookie') ||
            lowerKey.includes('credential');

          if (blocked) {
            return;
          }

          const value =
            context[key];

          if (
            value === null ||
            typeof value ===
              'string' ||
            typeof value ===
              'number' ||
            typeof value ===
              'boolean'
          ) {
            candidate[key] =
              value;
          }
        },
      );

    return candidate;
  } catch {
    return null;
  }
};

const sanitizeTenant = (
  tenant,
) => {
  if (
    !tenant ||
    typeof tenant !==
      'object'
  ) {
    return null;
  }

  const tenantId =
    tenant.id ??
    tenant.tenantId ??
    null;

  /**
   * Keep tenant correlation deliberately narrow.
   */
  return tenantId === null ||
    tenantId === undefined
    ? null
    : {
        id: safeText(
          tenantId,
        ),
      };
};

const isChunkLoadError = (
  error,
) => {
  const message =
    safeText(
      error?.message,
    );

  const name =
    safeText(
      error?.name,
    );

  return CHUNK_LOAD_ERROR_PATTERNS.some(
    (pattern) =>
      pattern.test(message) ||
      pattern.test(name),
  );
};

/* ============================================================================
 * Icons
 * ========================================================================== */

const Icon = ({
  children,
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
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

Icon.propTypes = {
  children:
    PropTypes.node.isRequired,

  size:
    PropTypes.number,
};

const AlertIcon = ({
  size = 48,
}) => (
  <Icon size={size}>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);

AlertIcon.propTypes = {
  size:
    PropTypes.number,
};

const RefreshIcon = ({
  size = 17,
}) => (
  <Icon size={size}>
    <path d="M20 11a8 8 0 0 0-15-3" />
    <path d="M5 4v5h5" />
    <path d="M4 13a8 8 0 0 0 15 3" />
    <path d="M19 20v-5h-5" />
  </Icon>
);

RefreshIcon.propTypes = {
  size:
    PropTypes.number,
};

const HomeIcon = ({
  size = 17,
}) => (
  <Icon size={size}>
    <path d="m3 10 9-7 9 7" />
    <path d="M5 9v11h14V9" />
    <path d="M9 20v-6h6v6" />
  </Icon>
);

HomeIcon.propTypes = {
  size:
    PropTypes.number,
};

const ReloadIcon = ({
  size = 17,
}) => (
  <Icon size={size}>
    <path d="M20 11a8 8 0 1 0 2 5" />
    <path d="M20 4v7h-7" />
  </Icon>
);

ReloadIcon.propTypes = {
  size:
    PropTypes.number,
};

/* ============================================================================
 * Default fallback presentation
 * ========================================================================== */

class DefaultErrorFallback extends React.PureComponent {
  handleRetry = () => {
    const {
      onRetry,
    } = this.props;

    onRetry?.();
  };

  handleHome = () => {
    const {
      onHome,
    } = this.props;

    onHome?.();
  };

  handleReload = () => {
    const {
      onReload,
    } = this.props;

    onReload?.();
  };

  render() {
    const {
      title,
      message,
      errorId,
      retryLabel,
      homeLabel,
      reloadLabel,
      canRetry,
      showHome,
      showReload,
      showErrorId,
      showDetails,
      error,
      retrying,
      className,
      testId,
      isChunkError,
    } = this.props;

    return (
      <section
        className={cn(
          'titech-error-boundary',
          className,
        )}
        role="alert"
        aria-live="assertive"
        aria-labelledby="titech-error-boundary-title"
        aria-describedby="titech-error-boundary-message"
        data-testid={testId}
      >
        <div className="titech-error-boundary__content">

          <div
            className="titech-error-boundary__icon"
            aria-hidden="true"
          >
            <AlertIcon />
          </div>

          <h1
            id="titech-error-boundary-title"
            className="titech-error-boundary__title"
          >
            {title}
          </h1>

          <p
            id="titech-error-boundary-message"
            className="titech-error-boundary__message"
          >
            {message}
          </p>

          {isChunkError ? (
            <p className="titech-error-boundary__message">
              A newer version of TITech may have been
              deployed. Reloading the application may
              resolve this problem.
            </p>
          ) : null}

          {showErrorId &&
          errorId ? (
            <p className="titech-error-boundary__error-id">
              Reference:{' '}
              <code>{errorId}</code>
            </p>
          ) : null}

          {showDetails &&
          isDevelopment ? (
            <details className="titech-error-boundary__details">
              <summary>
                Development diagnostics
              </summary>

              <div className="titech-error-boundary__details-body">
                <div>
                  <strong>Name:</strong>{' '}
                  {error?.name ||
                    'Error'}
                </div>

                <div>
                  <strong>Message:</strong>{' '}
                  {error?.message ||
                    'Unknown error'}
                </div>

                {error?.stack ? (
                  <pre>
                    {error.stack}
                  </pre>
                ) : null}
              </div>
            </details>
          ) : null}

          <div className="titech-error-boundary__actions">

            {canRetry ? (
              <button
                type="button"
                className="titech-error-boundary__button titech-error-boundary__button--primary"
                onClick={
                  this.handleRetry
                }
                disabled={retrying}
                aria-busy={
                  retrying
                    ? 'true'
                    : undefined
                }
                data-testid="titech-error-boundary-retry"
              >
                <RefreshIcon />

                <span>
                  {retrying
                    ? 'Retrying…'
                    : retryLabel}
                </span>
              </button>
            ) : null}

            {showHome ? (
              <button
                type="button"
                className="titech-error-boundary__button titech-error-boundary__button--secondary"
                onClick={
                  this.handleHome
                }
                disabled={
                  retrying
                }
                data-testid="titech-error-boundary-home"
              >
                <HomeIcon />

                <span>
                  {homeLabel}
                </span>
              </button>
            ) : null}

            {showReload ? (
              <button
                type="button"
                className="titech-error-boundary__button titech-error-boundary__button--secondary"
                onClick={
                  this.handleReload
                }
                disabled={
                  retrying
                }
                data-testid="titech-error-boundary-reload"
              >
                <ReloadIcon />

                <span>
                  {reloadLabel}
                </span>
              </button>
            ) : null}

          </div>
        </div>
      </section>
    );
  }
}

DefaultErrorFallback.propTypes = {
  title:
    PropTypes.string.isRequired,

  message:
    PropTypes.string.isRequired,

  errorId:
    PropTypes.string,

  retryLabel:
    PropTypes.string.isRequired,

  homeLabel:
    PropTypes.string.isRequired,

  reloadLabel:
    PropTypes.string.isRequired,

  canRetry:
    PropTypes.bool.isRequired,

  showHome:
    PropTypes.bool.isRequired,

  showReload:
    PropTypes.bool.isRequired,

  showErrorId:
    PropTypes.bool.isRequired,

  showDetails:
    PropTypes.bool.isRequired,

  error:
    PropTypes.shape({
      name:
        PropTypes.string,

      message:
        PropTypes.string,

      stack:
        PropTypes.string,
    }),

  retrying:
    PropTypes.bool.isRequired,

  className:
    PropTypes.string.isRequired,

  testId:
    PropTypes.string.isRequired,

  onRetry:
    PropTypes.func.isRequired,

  onHome:
    PropTypes.func.isRequired,

  onReload:
    PropTypes.func.isRequired,

  isChunkError:
    PropTypes.bool.isRequired,
};

/* ============================================================================
 * Internal ErrorBoundary
 * ========================================================================== */

class ErrorBoundaryController extends Component {
  constructor(
    props,
  ) {
    super(props);

    this.state = {
      hasError: false,

      error: null,

      errorInfo: null,

      errorId: null,

      retryCount: 0,

      retrying: false,

      lastResetKey: props.resetKey,

      lastLocationKey:
        props.locationKey ??
        null,
    };

    this.rootRef =
      createRef();

    this.hasAnnouncedError =
      false;
  }

  /* ==========================================================================
   * React error capture
   * ======================================================================== */

  static getDerivedStateFromError(
    error,
  ) {
    return {
      hasError: true,

      error,

      errorInfo: null,

      errorId:
        createErrorId(),
    };
  }

  componentDidCatch(
    error,
    errorInfo,
  ) {
    const errorId =
      this.state.errorId ||
      createErrorId();

    const serialized =
      serializeError(
        error,
        {
          includeStack:
            isDevelopment,
        },
      );

    const chunkError =
      isChunkLoadError(
        error,
      );

    const payload = {
      errorId,

      error: serialized,

      componentStack:
        safeText(
          errorInfo?.componentStack,
        ),

      retryCount:
        this.state.retryCount,

      location:
        getLocationSnapshot(),

      environment:
        getEnvironmentSnapshot(),

      context:
        sanitizeContext(
          this.props.context,
        ),

      tenant:
        sanitizeTenant(
          this.props.tenant,
        ),

      metadata:
        sanitizeContext(
          this.props.metadata,
        ),

      isChunkLoadError:
        chunkError,
    };

    this.setState({
      errorInfo,

      errorId,
    });

    if (
      isDevelopment
    ) {
      // eslint-disable-next-line no-console
      console.error(
        '[TITech ErrorBoundary]',
        payload,
      );
    }

    /**
     * Parent-level error callback.
     */
    try {
      this.props.onError?.(
        payload,
      );
    } catch (
      callbackError
    ) {
      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] onError callback failed:',
          callbackError,
        );
      }
    }

    /**
     * Telemetry callback.
     */
    try {
      this.props.onTelemetry?.(
        payload,
      );
    } catch (
      telemetryError
    ) {
      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] telemetry callback failed:',
          telemetryError,
        );
      }
    }

    /**
     * Optional browser-side error event hook.
     */
    try {
      this.props.onCapturedError?.(
        error,
        errorInfo,
      );
    } catch (
      captureCallbackError
    ) {
      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] onCapturedError callback failed:',
          captureCallbackError,
        );
      }
    }

    this.deferFocus();
  }

  /* ==========================================================================
   * Lifecycle / reset handling
   * ======================================================================== */

  componentDidMount() {
    this.deferFocus();

    this.installConnectivityListeners();
  }

  componentDidUpdate(
    previousProps,
    previousState,
  ) {
    const {
      resetKey,
      resetOnLocationChange,
      locationKey,
    } = this.props;

    /**
     * Explicit reset-key driven recovery.
     */
    if (
      resetKey !==
      previousProps.resetKey
    ) {
      this.resetError({
        resetRetryCount:
          true,

        invokeCallback:
          true,
      });

      return;
    }

    /**
     * Route/context driven recovery.
     *
     * The parent should pass a stable `locationKey`, ideally pathname+search.
     * This avoids reaching into global browser state and works with routers.
     */
    if (
      resetOnLocationChange &&
      locationKey !==
        previousProps.locationKey
    ) {
      this.resetError({
        resetRetryCount:
          true,

        invokeCallback:
          true,
      });

      return;
    }

    /**
     * Focus the fallback after entering the error state.
     */
    if (
      this.state.hasError &&
      !previousState.hasError
    ) {
      this.deferFocus();
    }
  }

  componentWillUnmount() {
    this.removeConnectivityListeners();

    if (
      this.retryTimer
    ) {
      clearTimeout(
        this.retryTimer,
      );
    }
  }

  /* ==========================================================================
   * Accessibility / focus
   * ======================================================================== */

  deferFocus = () => {
    if (
      typeof window ===
      'undefined'
    ) {
      return;
    }

    window.requestAnimationFrame?.(
      () => {
        this.rootRef.current?.focus();
      },
    );
  };

  /* ==========================================================================
   * Connectivity
   * ======================================================================== */

  installConnectivityListeners = () => {
    if (
      typeof window ===
      'undefined'
    ) {
      return;
    }

    window.addEventListener(
      'online',
      this.handleOnline,
    );
  };

  removeConnectivityListeners = () => {
    if (
      typeof window ===
      'undefined'
    ) {
      return;
    }

    window.removeEventListener(
      'online',
      this.handleOnline,
    );
  };

  handleOnline = () => {
    if (
      !this.state.hasError
    ) {
      return;
    }

    if (
      this.props.autoRecoverOnOnline
    ) {
      this.handleRetry();
    }
  };

  /* ==========================================================================
   * Reset
   * ======================================================================== */

  resetError = ({
    resetRetryCount = true,
    invokeCallback = true,
  } = {}) => {
    if (
      this.state.retrying
    ) {
      return false;
    }

    this.setState(
      (previousState) => ({
        hasError: false,

        error: null,

        errorInfo: null,

        errorId: null,

        retrying: false,

        retryCount:
          resetRetryCount
            ? 0
            : previousState.retryCount,
      }),
      () => {
        if (
          invokeCallback
        ) {
          try {
            this.props.onReset?.();
          } catch (
            resetCallbackError
          ) {
            if (
              isDevelopment
            ) {
              // eslint-disable-next-line no-console
              console.error(
                '[TITech ErrorBoundary] onReset callback failed:',
                resetCallbackError,
              );
            }
          }
        }

        this.deferFocus();
      },
    );

    return true;
  };

  /* ==========================================================================
   * Retry
   * ======================================================================== */

  handleRetry = async () => {
    if (
      this.state.retrying
    ) {
      return false;
    }

    const retryLimit =
      normalizeRetryLimit(
        this.props.retryLimit,
      );

    const retryDelay =
      normalizeRetryDelay(
        this.props.retryDelay,
      );

    if (
      this.state.retryCount >=
      retryLimit
    ) {
      return false;
    }

    const nextRetryCount =
      this.state.retryCount + 1;

    const currentError =
      this.state.error;

    const currentErrorId =
      this.state.errorId;

    this.setState({
      retrying: true,
    });

    try {
      if (
        retryDelay > 0
      ) {
        await new Promise(
          (resolve) => {
            this.retryTimer =
              setTimeout(
                resolve,
                retryDelay,
              );
          },
        );
      }

      await this.props.onRetry?.({
        error:
          serializeError(
            currentError,
            {
              includeStack:
                isDevelopment,
            },
          ),

        errorId:
          currentErrorId,

        retryCount:
          nextRetryCount,
      });

      this.setState({
        hasError: false,

        error: null,

        errorInfo: null,

        errorId: null,

        retrying: false,

        retryCount:
          nextRetryCount,
      });

      try {
        this.props.onRecovered?.({
          errorId:
            currentErrorId,

          retryCount:
            nextRetryCount,
        });
      } catch (
        recoveryCallbackError
      ) {
        if (
          isDevelopment
        ) {
          // eslint-disable-next-line no-console
          console.error(
            '[TITech ErrorBoundary] onRecovered callback failed:',
            recoveryCallbackError,
          );
        }
      }

      return true;
    } catch (
      retryError
    ) {
      this.setState({
        retrying: false,

        retryCount:
          nextRetryCount,
      });

      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] retry failed:',
          retryError,
        );
      }

      try {
        this.props.onRetryError?.(
          retryError,
          {
            errorId:
              currentErrorId,

            retryCount:
              nextRetryCount,
          },
        );
      } catch (
        retryErrorCallbackError
      ) {
        if (
          isDevelopment
        ) {
          // eslint-disable-next-line no-console
          console.error(
            '[TITech ErrorBoundary] onRetryError callback failed:',
            retryErrorCallbackError,
          );
        }
      }

      return false;
    } finally {
      this.retryTimer = null;
    }
  };

  /* ==========================================================================
   * Navigation
   * ======================================================================== */

  handleHome = () => {
    const {
      homePath =
        DEFAULT_HOME_PATH,

      onHome,
    } = this.props;

    try {
      if (
        typeof onHome ===
        'function'
      ) {
        onHome();
        return;
      }

      if (
        typeof window !==
          'undefined' &&
        homePath
      ) {
        /**
         * assign() intentionally performs a full navigation, making this
         * useful when the application state itself may be compromised.
         */
        window.location.assign(
          homePath,
        );
      }
    } catch (
      navigationError
    ) {
      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] home navigation failed:',
          navigationError,
        );
      }
    }
  };

  handleReload = () => {
    const {
      onReload,
    } = this.props;

    try {
      if (
        typeof onReload ===
        'function'
      ) {
        onReload();
        return;
      }

      if (
        typeof window !==
          'undefined' &&
        typeof window.location
          ?.reload ===
          'function'
      ) {
        window.location.reload();
      }
    } catch (
      reloadError
    ) {
      if (
        isDevelopment
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[TITech ErrorBoundary] reload failed:',
          reloadError,
        );
      }
    }
  };

  /* ==========================================================================
   * Imperative ref API
   * ======================================================================== */

  getImperativeHandle = () => ({
    reset:
      () =>
        this.resetError(),

    retry:
      () =>
        this.handleRetry(),

    reload:
      () =>
        this.handleReload(),

    goHome:
      () =>
        this.handleHome(),

    hasError:
      () =>
        this.state.hasError,

    getErrorId:
      () =>
        this.state.errorId,

    getError:
      () =>
        this.state.error,

    getRetryCount:
      () =>
        this.state.retryCount,

    focus:
      () =>
        this.rootRef.current?.focus(),
  });

  /* ==========================================================================
   * Render
   * ======================================================================== */

  render() {
    const {
      children,
      fallback,
      fallbackComponent,

      title =
        DEFAULT_TITLE,

      message =
        DEFAULT_MESSAGE,

      retryLabel =
        DEFAULT_RETRY_LABEL,

      homeLabel =
        DEFAULT_HOME_LABEL,

      reloadLabel =
        DEFAULT_RELOAD_LABEL,

      showHome = true,

      showReload = false,

      showErrorId =
        isDevelopment,

      showDetails =
        isDevelopment,

      className = '',

      testId =
        DEFAULT_TEST_ID,
    } = this.props;

    if (
      !this.state.hasError
    ) {
      return children;
    }

    const errorPayload =
      serializeError(
        this.state.error,
        {
          includeStack:
            isDevelopment,
        },
      );

    const canRetry =
      this.state.retryCount <
      normalizeRetryLimit(
        this.props.retryLimit,
      );

    const fallbackProps = {
      error:
        errorPayload,

      errorInfo:
        this.state.errorInfo,

      errorId:
        this.state.errorId,

      retryCount:
        this.state.retryCount,

      retrying:
        this.state.retrying,

      canRetry,

      onRetry:
        this.handleRetry,

      onHome:
        this.handleHome,

      onReload:
        this.handleReload,

      title,

      message,

      retryLabel,

      homeLabel,

      reloadLabel,

      showHome,

      showReload,

      showErrorId,

      showDetails,

      className,

      testId,

      isChunkError:
        isChunkLoadError(
          this.state.error,
        ),
    };

    /**
     * Function-based fallback.
     */
    if (
      typeof fallbackComponent ===
      'function'
    ) {
      return fallbackComponent(
        fallbackProps,
      );
    }

    /**
     * Function or React node fallback.
     */
    if (
      fallback !==
      undefined &&
      fallback !==
        null
    ) {
      if (
        typeof fallback ===
        'function'
      ) {
        return fallback(
          fallbackProps,
        );
      }

      return fallback;
    }

    return (
      <div
        ref={
          this.rootRef
        }
        tabIndex={-1}
        style={{
          outline: 'none',
        }}
        data-testid={`${testId}-container`}
      >
        <DefaultErrorFallback
          {...fallbackProps}
        />
      </div>
    );
  }
}

/* ============================================================================
 * PropTypes
 * ========================================================================== */

ErrorBoundaryController.propTypes = {
  children:
    PropTypes.node.isRequired,

  fallback:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  fallbackComponent:
    PropTypes.func,

  title:
    PropTypes.string,

  message:
    PropTypes.string,

  retryLabel:
    PropTypes.string,

  homeLabel:
    PropTypes.string,

  reloadLabel:
    PropTypes.string,

  showHome:
    PropTypes.bool,

  showReload:
    PropTypes.bool,

  showErrorId:
    PropTypes.bool,

  showDetails:
    PropTypes.bool,

  retryLimit:
    PropTypes.number,

  retryDelay:
    PropTypes.number,

  resetKey:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.bool,
    ]),

  resetOnLocationChange:
    PropTypes.bool,

  locationKey:
    PropTypes.string,

  autoRecoverOnOnline:
    PropTypes.bool,

  onError:
    PropTypes.func,

  onTelemetry:
    PropTypes.func,

  onCapturedError:
    PropTypes.func,

  onReset:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onRetryError:
    PropTypes.func,

  onRecovered:
    PropTypes.func,

  onHome:
    PropTypes.func,

  onReload:
    PropTypes.func,

  homePath:
    PropTypes.string,

  context:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  metadata:
    PropTypes.object,

  tenant:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      tenantId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
    }),

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  /**
   * Internal callback supplied by the forwarded ref wrapper.
   */
  forwardedRef:
    PropTypes.object,
};

/* ============================================================================
 * ErrorBoundary with imperative ref support
 * ========================================================================== */

const ErrorBoundary = forwardRef(
  (props, ref) => (
    <ErrorBoundaryController
      {...props}
      ref={ref}
    />
  ),
);

ErrorBoundary.displayName =
  'TITechErrorBoundary';

ErrorBoundary.propTypes = {
  children:
    PropTypes.node.isRequired,

  fallback:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  fallbackComponent:
    PropTypes.func,

  title:
    PropTypes.string,

  message:
    PropTypes.string,

  retryLabel:
    PropTypes.string,

  homeLabel:
    PropTypes.string,

  reloadLabel:
    PropTypes.string,

  showHome:
    PropTypes.bool,

  showReload:
    PropTypes.bool,

  showErrorId:
    PropTypes.bool,

  showDetails:
    PropTypes.bool,

  retryLimit:
    PropTypes.number,

  retryDelay:
    PropTypes.number,

  resetKey:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.bool,
    ]),

  resetOnLocationChange:
    PropTypes.bool,

  locationKey:
    PropTypes.string,

  autoRecoverOnOnline:
    PropTypes.bool,

  onError:
    PropTypes.func,

  onTelemetry:
    PropTypes.func,

  onCapturedError:
    PropTypes.func,

  onReset:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onRetryError:
    PropTypes.func,

  onRecovered:
    PropTypes.func,

  onHome:
    PropTypes.func,

  onReload:
    PropTypes.func,

  homePath:
    PropTypes.string,

  context:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  metadata:
    PropTypes.object,

  tenant:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
      
      tenantId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
    }),

  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};

ErrorBoundary.defaultProps = {
  fallback:
    undefined,

  fallbackComponent:
    undefined,

  title:
    DEFAULT_TITLE,

  message:
    DEFAULT_MESSAGE,

  retryLabel:
    DEFAULT_RETRY_LABEL,

  homeLabel:
    DEFAULT_HOME_LABEL,

  reloadLabel:
    DEFAULT_RELOAD_LABEL,

  showHome:
    true,

  showReload:
    false,

  showErrorId:
    isDevelopment,

  showDetails:
    isDevelopment,

  retryLimit:
    DEFAULT_RETRY_LIMIT,

  retryDelay:
    DEFAULT_RETRY_DELAY,

  resetKey:
    undefined,

  resetOnLocationChange:
    false,

  locationKey:
    undefined,

  autoRecoverOnOnline:
    false,

  onError:
    undefined,

  onTelemetry:
    undefined,

  onCapturedError:
    undefined,

  onReset:
    undefined,

  onRetry:
    undefined,

  onRetryError:
    undefined,

  onRecovered:
    undefined,

  onHome:
    undefined,

  onReload:
    undefined,

  homePath:
    DEFAULT_HOME_PATH,

  context:
    undefined,

  metadata:
    undefined,

  tenant:
    null,

  className:
    '',

  testId:
    DEFAULT_TEST_ID,
};

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_ERROR_ID_PREFIX,
  DEFAULT_HOME_LABEL,
  DEFAULT_HOME_PATH,
  DEFAULT_MESSAGE,
  DEFAULT_RELOAD_LABEL,
  DEFAULT_RETRY_DELAY,
  DEFAULT_RETRY_LABEL,
  DEFAULT_RETRY_LIMIT,
  DEFAULT_TEST_ID,
  DEFAULT_TITLE,
  DefaultErrorFallback,
  ErrorBoundaryController,
  CHUNK_LOAD_ERROR_PATTERNS,
  clampNumber,
  createErrorId,
  getEnvironmentSnapshot,
  getLocationSnapshot,
  isChunkLoadError,
  safeText,
  sanitizeContext,
  sanitizeTenant,
  serializeError,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ErrorBoundary;