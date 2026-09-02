// ============================================================================
// TITech Community Capital
// Enterprise Error Boundary
// File: frontend/src/components/ui/ErrorBoundary.jsx
// Production Grade
// ============================================================================

import React, {
  Component,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TITLE =
  "Something went wrong";

const DEFAULT_MESSAGE =
  "We encountered an unexpected error while loading this part of TITech.";

const DEFAULT_RETRY_LABEL =
  "Try Again";

const DEFAULT_HOME_LABEL =
  "Go to Dashboard";

const ERROR_STORAGE_KEY =
  "titech:error-boundary";

// ============================================================================
// Runtime Helpers
// ============================================================================

function isDevelopment() {
  return (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV ===
      "development"
  );
}

function safeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

function createErrorId() {
  try {
    if (
      typeof crypto !==
        "undefined" &&
      typeof crypto.randomUUID ===
        "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to timestamp-based identifier.
  }

  return `titech-error-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getErrorMessage(error) {
  if (!error) {
    return DEFAULT_MESSAGE;
  }

  return (
    safeString(error.message) ||
    DEFAULT_MESSAGE
  );
}

function getErrorStack(error) {
  if (!error) {
    return "";
  }

  return safeString(
    error.stack
  );
}

function buildErrorContext(
  error,
  errorInfo,
  errorId
) {
  return {
    errorId,

    message:
      getErrorMessage(error),

    stack:
      getErrorStack(error),

    componentStack:
      safeString(
        errorInfo?.componentStack
      ),

    timestamp:
      new Date().toISOString(),

    url:
      typeof window !==
        "undefined"
        ? window.location.href
        : "",

    userAgent:
      typeof navigator !==
        "undefined"
        ? navigator.userAgent
        : "",

    platform:
      "TITech",

    application:
      "TITech Community Capital",

    environment:
      typeof process !==
        "undefined"
        ? process.env
            ?.NODE_ENV ||
          "production"
        : "production",
  };
}

// ============================================================================
// Safe Storage
// ============================================================================

function persistErrorContext(
  context
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  try {
    window.sessionStorage?.setItem(
      ERROR_STORAGE_KEY,
      JSON.stringify(
        context
      )
    );
  } catch {
    // Storage may be disabled or unavailable.
  }
}

function clearPersistedError() {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  try {
    window.sessionStorage?.removeItem(
      ERROR_STORAGE_KEY
    );
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// Default Error Reporter
// ============================================================================

function defaultErrorReporter(
  error,
  errorInfo,
  context
) {
  /*
   * Production integrations such as Sentry, Datadog, OpenTelemetry,
   * or another observability platform can be connected through the
   * `onError` prop.
   *
   * Do not expose internal stack traces to end users.
   */

  if (isDevelopment()) {
    console.error(
      "[TITech ErrorBoundary]",
      {
        error,
        errorInfo,
        context,
      }
    );
  }
}

// ============================================================================
// Default Navigation
// ============================================================================

function navigateToDashboard() {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  try {
    window.location.assign(
      "/dashboard"
    );
  } catch {
    window.location.href =
      "/dashboard";
  }
}

// ============================================================================
// Component
// ============================================================================

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      retryCount: 0,
    };

    this.mounted = false;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  componentDidMount() {
    this.mounted = true;
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  // ==========================================================================
  // Error Capture
  // ==========================================================================

  static getDerivedStateFromError(
    error
  ) {
    return {
      hasError: true,
      error,
      errorId: createErrorId(),
    };
  }

  componentDidCatch(
    error,
    errorInfo
  ) {
    const errorId =
      this.state.errorId ||
      createErrorId();

    const context =
      buildErrorContext(
        error,
        errorInfo,
        errorId
      );

    this.setState({
      errorInfo,
      errorId,
    });

    persistErrorContext(
      context
    );

    try {
      const reporter =
        this.props.onError ||
        defaultErrorReporter;

      reporter(
        error,
        errorInfo,
        context
      );
    } catch (reportingError) {
      /*
       * Error reporting must never create
       * another application failure.
       */

      if (isDevelopment()) {
        console.error(
          "[TITech ErrorBoundary] Error reporter failed:",
          reportingError
        );
      }
    }
  }

  // ==========================================================================
  // Recovery
  // ==========================================================================

  handleRetry = () => {
    if (!this.mounted) {
      return;
    }

    clearPersistedError();

    this.setState(
      previous => ({
        hasError: false,
        error: null,
        errorInfo: null,
        errorId: null,
        retryCount:
          previous.retryCount +
          1,
      }),
      () => {
        try {
          this.props.onRetry?.(
            this.state.retryCount
          );
        } catch (error) {
          if (isDevelopment()) {
            console.error(
              "[TITech ErrorBoundary] Retry callback failed:",
              error
            );
          }
        }
      }
    );
  };

  handleDashboardNavigation =
    () => {
      try {
        if (
          typeof this.props
            .onNavigateHome ===
          "function"
        ) {
          this.props.onNavigateHome();

          return;
        }

        navigateToDashboard();
      } catch (error) {
        if (isDevelopment()) {
          console.error(
            "[TITech ErrorBoundary] Navigation failed:",
            error
          );
        }
      }
    };

  // ==========================================================================
  // Render
  // ==========================================================================

  render() {
    const {
      hasError,
      error,
      errorInfo,
      errorId,
    } = this.state;

    const {
      children,
      fallback,
      title,
      message,
      retryLabel,
      homeLabel,
      showHomeButton,
      showErrorId,
      showDetails,
      className,
    } = this.props;

    if (!hasError) {
      return children;
    }

    // ------------------------------------------------------------------------
    // Custom Fallback
    // ------------------------------------------------------------------------

    if (
      typeof fallback ===
      "function"
    ) {
      return fallback({
        error,
        errorInfo,
        errorId,
        retry: this.handleRetry,
        goToDashboard:
          this
            .handleDashboardNavigation,
      });
    }

    if (
      React.isValidElement(
        fallback
      )
    ) {
      return fallback;
    }

    // ------------------------------------------------------------------------
    // Default Fallback
    // ------------------------------------------------------------------------

    const displayMessage =
      isDevelopment()
        ? getErrorMessage(
            error
          )
        : message;

    return (
      <section
        className={[
          "titech-error-boundary",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="alert"
        aria-live="assertive"
      >
        <div className="titech-error-boundary__container">
          <div
            className="titech-error-boundary__icon"
            aria-hidden="true"
          >
            !
          </div>

          <div className="titech-error-boundary__content">
            <h1 className="titech-error-boundary__title">
              {title}
            </h1>

            <p className="titech-error-boundary__message">
              {displayMessage}
            </p>

            {showErrorId &&
              errorId && (
                <p className="titech-error-boundary__reference">
                  Reference:{" "}
                  <code>
                    {errorId}
                  </code>
                </p>
              )}

            {isDevelopment() &&
              showDetails && (
                <details className="titech-error-boundary__details">
                  <summary>
                    Developer error
                    details
                  </summary>

                  <div className="titech-error-boundary__debug">
                    <strong>
                      Message
                    </strong>

                    <pre>
                      {getErrorMessage(
                        error
                      )}
                    </pre>

                    {getErrorStack(
                      error
                    ) && (
                      <>
                        <strong>
                          Stack
                        </strong>

                        <pre>
                          {getErrorStack(
                            error
                          )}
                        </pre>
                      </>
                    )}

                    {errorInfo
                      ?.componentStack && (
                      <>
                        <strong>
                          Component
                          stack
                        </strong>

                        <pre>
                          {safeString(
                            errorInfo.componentStack
                          )}
                        </pre>
                      </>
                    )}
                  </div>
                </details>
              )}

            <div className="titech-error-boundary__actions">
              <button
                type="button"
                className="titech-error-boundary__button titech-error-boundary__button--primary"
                onClick={
                  this.handleRetry
                }
              >
                {retryLabel}
              </button>

              {showHomeButton && (
                <button
                  type="button"
                  className="titech-error-boundary__button titech-error-boundary__button--secondary"
                  onClick={
                    this
                      .handleDashboardNavigation
                  }
                >
                  {homeLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
}

// ============================================================================
// Prop Types
// ============================================================================

ErrorBoundary.propTypes = {
  children:
    PropTypes.node,

  fallback:
    PropTypes.oneOfType([
      PropTypes.node,
      PropTypes.func,
    ]),

  title:
    PropTypes.string,

  message:
    PropTypes.string,

  retryLabel:
    PropTypes.string,

  homeLabel:
    PropTypes.string,

  showHomeButton:
    PropTypes.bool,

  showErrorId:
    PropTypes.bool,

  showDetails:
    PropTypes.bool,

  className:
    PropTypes.string,

  onError:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onNavigateHome:
    PropTypes.func,
};

// ============================================================================
// Default Props
// ============================================================================

ErrorBoundary.defaultProps = {
  fallback: null,

  title:
    DEFAULT_TITLE,

  message:
    DEFAULT_MESSAGE,

  retryLabel:
    DEFAULT_RETRY_LABEL,

  homeLabel:
    DEFAULT_HOME_LABEL,

  showHomeButton:
    true,

  showErrorId:
    true,

  showDetails:
    true,

  className:
    "",

  onError:
    null,

  onRetry:
    null,

  onNavigateHome:
    null,
};

// ============================================================================
// Export
// ============================================================================

export default ErrorBoundary;