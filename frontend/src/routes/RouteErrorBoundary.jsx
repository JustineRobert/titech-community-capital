'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/routes/RouteErrorBoundary.jsx
 *
 * Purpose:
 *   Canonical route-level React error boundary.
 *
 * Responsibilities:
 *   - Capture route/component render failures
 *   - Provide a controlled user-facing fallback
 *   - Generate a safe correlation identifier
 *   - Detect common lazy-chunk loading failures
 *   - Provide bounded chunk-recovery behavior
 *   - Provide retry without a full application reload
 *   - Provide dashboard recovery navigation
 *   - Support custom fallback components
 *   - Support external error-reporting hooks
 *
 * Non-responsibilities:
 *   - Global browser error handling
 *   - Authentication
 *   - Authorization
 *   - API error handling
 *   - Financial transaction rollback
 *   - Backend observability
 *
 * IMPORTANT:
 *
 *   React Error Boundaries catch render/lifecycle failures below them.
 *   They do not replace global `window.error` / `unhandledrejection`
 *   monitoring established by `main.jsx`.
 *
 * ============================================================================
 */

import React from 'react';

import {
  AlertTriangle,
  RefreshCw,
  Home,
} from 'lucide-react';

import {
  useLocation,
  useNavigate,
} from 'react-router-dom';

// ============================================================================
// Constants
// ============================================================================

const CHUNK_RETRY_STORAGE_KEY =
  'titech:route-chunk-recovery';

const CHUNK_RETRY_MAX_AGE_MS =
  30_000;

const DEFAULT_HOME_ROUTE =
  '/dashboard';

// ============================================================================
// Correlation ID
// ============================================================================
//
// This is a diagnostic identifier, not a security token.
//
// Prefer crypto.randomUUID when available.
// ============================================================================

function generateCorrelationId() {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      return `TIT-${crypto
        .randomUUID()
        .replace(/-/g, '')
        .slice(0, 16)
        .toUpperCase()}`;
    }
  } catch {
    // Fall through to timestamp-based fallback.
  }

  return (
    `TIT-${Date.now().toString(36)}-` +
    Math.random()
      .toString(36)
      .slice(2, 10)
      .toUpperCase()
  );
}

// ============================================================================
// Error classification
// ============================================================================

function getErrorMessage(error) {
  if (
    error &&
    typeof error.message ===
      'string'
  ) {
    return error.message;
  }

  if (
    typeof error ===
    'string'
  ) {
    return error;
  }

  return '';
}

function isChunkLoadError(error) {
  const message =
    getErrorMessage(error)
      .toLowerCase();

  return (
    message.includes(
      'loading chunk'
    ) ||
    message.includes(
      'chunkloaderror'
    ) ||
    message.includes(
      'failed to fetch dynamically imported module'
    ) ||
    message.includes(
      'importing a module script failed'
    ) ||
    message.includes(
      'dynamically imported module'
    )
  );
}

// ============================================================================
// Safe error serialization
// ============================================================================

function serializeError(error) {
  if (
    error instanceof Error
  ) {
    return {
      name:
        error.name ||
        'Error',

      message:
        error.message ||
        'Unknown error',

      stack:
        typeof error.stack ===
        'string'
          ? error.stack
          : null,
    };
  }

  if (
    typeof error ===
    'string'
  ) {
    return {
      name: 'Error',
      message: error,
      stack: null,
    };
  }

  return {
    name:
      'UnknownError',
    message:
      'An unknown route error occurred.',
    stack: null,
  };
}

// ============================================================================
// Chunk recovery state
// ============================================================================

function readChunkRecoveryState() {
  try {
    const raw =
      sessionStorage.getItem(
        CHUNK_RETRY_STORAGE_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !==
        'object'
    ) {
      return null;
    }

    if (
      typeof parsed.timestamp !==
      'number'
    ) {
      return null;
    }

    if (
      Date.now() -
        parsed.timestamp >
      CHUNK_RETRY_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(
        CHUNK_RETRY_STORAGE_KEY
      );

      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeChunkRecoveryState(
  pathname
) {
  try {
    sessionStorage.setItem(
      CHUNK_RETRY_STORAGE_KEY,
      JSON.stringify({
        pathname:
          pathname || '/',
        timestamp:
          Date.now(),
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function clearChunkRecoveryState() {
  try {
    sessionStorage.removeItem(
      CHUNK_RETRY_STORAGE_KEY
    );
  } catch {
    // Ignore storage failures.
  }
}

// ============================================================================
// Default fallback
// ============================================================================

function DefaultFallback({
  error,
  errorInfo,
  correlationId,
  isChunkError,
  onRetry,
  onHome,
}) {
  const isDevelopment =
    import.meta.env.DEV;

  return (
    <div
      className="route-error-page"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="route-error-card"
      >
        <AlertTriangle
          size={56}
          aria-hidden="true"
        />

        <h1>
          Something went wrong
        </h1>

        <p>
          {isChunkError
            ? 'This page could not be loaded because a newer application version may have been deployed.'
            : 'An unexpected error occurred while loading this page.'}
        </p>

        {isDevelopment &&
          error && (
            <details
              className="route-error-details-container"
            >
              <summary>
                Development error details
              </summary>

              <pre className="route-error-details">
                {error.stack ||
                  error.message ||
                  'Unknown error'}

                {errorInfo?.componentStack
                  ? `\n\nComponent stack:\n${errorInfo.componentStack}`
                  : ''}
              </pre>
            </details>
          )}

        <div
          className="route-error-meta"
        >
          <strong>
            Error ID:
          </strong>{' '}
          {correlationId}
        </div>

        <div
          className="route-error-actions"
        >
          <button
            type="button"
            onClick={onRetry}
            className="btn-primary"
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
            />

            Try Again
          </button>

          <button
            type="button"
            onClick={onHome}
            className="btn-secondary"
          >
            <Home
              size={18}
              aria-hidden="true"
            />

            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Error boundary
// ============================================================================

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      correlationId:
        generateCorrelationId(),
      isChunkError: false,
    };
  }

  // --------------------------------------------------------------------------
  // React error capture
  // --------------------------------------------------------------------------

  static getDerivedStateFromError(
    error
  ) {
    return {
      hasError: true,
      error,
      isChunkError:
        isChunkLoadError(error),
    };
  }

  // --------------------------------------------------------------------------
  // Error reporting
  // --------------------------------------------------------------------------

  componentDidCatch(
    error,
    errorInfo
  ) {
    const correlationId =
      this.state.correlationId;

    const serialized =
      serializeError(error);

    const payload = {
      correlationId,

      error: serialized,

      componentStack:
        typeof errorInfo
          ?.componentStack ===
        'string'
          ? errorInfo.componentStack
          : null,

      pathname:
        this.props.pathname ||
        window.location
          .pathname,

      routeId:
        this.props.routeId ||
        null,

      timestamp:
        new Date().toISOString(),

      type:
        isChunkLoadError(error)
          ? 'route.chunk_load'
          : 'route.render',
    };

    /*
     * Development diagnostics only.
     *
     * Production telemetry should use onError / the central observability
     * boundary rather than dumping application details to the console.
     */
    if (
      import.meta.env.DEV
    ) {
      console.error(
        '[TITech Route Error]',
        payload
      );
    }

    // ------------------------------------------------------------------------
    // External error reporting
    // ------------------------------------------------------------------------

    if (
      typeof this.props
        .onError ===
      'function'
    ) {
      try {
        this.props.onError(
          payload
        );
      } catch (reportingError) {
        if (
          import.meta.env.DEV
        ) {
          console.error(
            '[TITech] Route error reporting failed.',
            reportingError
          );
        }
      }
    }

    // ------------------------------------------------------------------------
    // Bounded chunk recovery
    // ------------------------------------------------------------------------

    if (
      isChunkLoadError(error)
    ) {
      const pathname =
        this.props.pathname ||
        window.location.pathname;

      const previousRecovery =
        readChunkRecoveryState();

      /*
       * Allow only ONE automatic reload for the same short-lived stale-chunk
       * condition.
       *
       * This prevents an infinite reload loop.
       */
      const canAutoRecover =
        !previousRecovery ||
        previousRecovery.pathname !==
          pathname;

      if (canAutoRecover) {
        writeChunkRecoveryState(
          pathname
        );

        window.setTimeout(() => {
          window.location.reload();
        }, 250);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Retry
  // --------------------------------------------------------------------------

  handleRetry = () => {
    clearChunkRecoveryState();

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      correlationId:
        generateCorrelationId(),
      isChunkError: false,
    });
  };

  // --------------------------------------------------------------------------
  // Dashboard navigation
  // --------------------------------------------------------------------------

  handleHome = () => {
    clearChunkRecoveryState();

    const homeRoute =
      this.props.homeRoute ||
      DEFAULT_HOME_ROUTE;

    if (
      typeof this.props
        .onHome ===
      'function'
    ) {
      try {
        this.props.onHome(
          homeRoute
        );
        return;
      } catch {
        // Fall through to hard navigation.
      }
    }

    window.location.assign(
      homeRoute
    );
  };

  // --------------------------------------------------------------------------
  // Route-change reset
  // --------------------------------------------------------------------------

  componentDidUpdate(
    previousProps
  ) {
    if (
      previousProps.pathname !==
        this.props.pathname &&
      this.state.hasError
    ) {
      this.handleRetry();
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  render() {
    if (
      !this.state.hasError
    ) {
      return this.props
        .children;
    }

    const Fallback =
      this.props.fallback ||
      DefaultFallback;

    return (
      <Fallback
        error={
          this.state.error
        }
        errorInfo={
          this.state.errorInfo
        }
        correlationId={
          this.state
            .correlationId
        }
        isChunkError={
          this.state
            .isChunkError
        }
        onRetry={
          this.handleRetry
        }
        onHome={
          this.handleHome
        }
      />
    );
  }
}

// ============================================================================
// Router-aware boundary
// ============================================================================
//
// This wrapper supplies the current route pathname so that the underlying
// class boundary can reset cleanly after navigation.
// ============================================================================

function RouteErrorBoundaryWithRouter(
  props
) {
  const location =
    useLocation();

  const navigate =
    useNavigate();

  const handleHome = (
    homeRoute
  ) => {
    navigate(
      homeRoute,
      {
        replace: true,
      }
    );
  };

  return (
    <RouteErrorBoundary
      {...props}
      pathname={
        location.pathname
      }
      onHome={
        handleHome
      }
    />
  );
}

// ============================================================================
// Higher-order component
// ============================================================================

export function withRouteErrorBoundary(
  Component,
  options = {}
) {
  if (
    typeof Component !==
    'function'
  ) {
    throw new TypeError(
      'withRouteErrorBoundary requires a valid React component.'
    );
  }

  function WrappedComponent(
    props
  ) {
    return (
      <RouteErrorBoundaryWithRouter
        {...options}
      >
        <Component
          {...props}
        />
      </RouteErrorBoundaryWithRouter>
    );
  }

  WrappedComponent.displayName =
    `withRouteErrorBoundary(${
      Component.displayName ||
      Component.name ||
      'Component'
    })`;

  return WrappedComponent;
}

// ============================================================================
// Export
// ============================================================================

export {
  RouteErrorBoundaryWithRouter,
};

export default RouteErrorBoundaryWithRouter;