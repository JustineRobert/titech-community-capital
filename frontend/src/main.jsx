'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/main.jsx
 *
 * Purpose:
 *   Canonical React application entry point and browser runtime bootstrap.
 *
 * Responsibilities:
 *   - Validate the React root container
 *   - Establish the React 18 root
 *   - Bootstrap global application providers
 *   - Bootstrap application routes
 *   - Apply the canonical TITech frontend brand runtime
 *   - Install global browser runtime diagnostics
 *   - Capture uncaught browser errors
 *   - Capture unhandled promise rejections
 *   - Expose safe, non-sensitive application diagnostics
 *   - Provide deterministic startup behavior
 *   - Provide a controlled bootstrap failure boundary
 *   - Synchronize the browser theme-color with the official brand contract
 *
 * Non-responsibilities:
 *   - Authentication business logic
 *   - Routing configuration
 *   - API implementation
 *   - Financial operations
 *   - Wallet or ledger mutations
 *   - Offline synchronization
 *   - State management implementation
 *   - Feature-specific initialization
 *
 * Canonical architecture:
 *
 *   Browser
 *      │
 *      ▼
 *   index.html
 *      │
 *      ▼
 *   main.jsx
 *      │
 *      ├── Runtime diagnostics
 *      ├── Runtime state
 *      ├── Global error handlers
 *      ├── Official brand runtime
 *      ├── React root
 *      │
 *      ▼
 *   Providers
 *      │
 *      ▼
 *   AppRoutes
 *      │
 *      ▼
 *   Application
 *
 * Important runtime rule:
 *
 *   Presentation/branding failures must NEVER prevent the core application
 *   from booting. Financial, authentication, tenancy, routing, ledger,
 *   payments, reconciliation, and offline concerns remain outside this file.
 *
 * ============================================================================
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

import Providers from './app/providers';
import './index.css';
import './branding/brand.css';
import AppRoutes from './routes/AppRoutes';
import TITECH_BRAND from './branding/brand';

// ============================================================================
// Application identity
// ============================================================================

const APP_NAME = 'TITech Community Capital';

const APP_VERSION =
  import.meta.env.VITE_APP_VERSION || '1.0.0';

const APP_ENVIRONMENT =
  import.meta.env.MODE || 'development';

const BUILD_TIME =
  import.meta.env.VITE_BUILD_TIME || null;

const IS_DEVELOPMENT =
  Boolean(import.meta.env.DEV);

const IS_PRODUCTION =
  Boolean(import.meta.env.PROD);

// ============================================================================
// Runtime constants
// ============================================================================

const ROOT_ELEMENT_ID = 'root';

const GLOBAL_APP_INFO_KEY =
  '__TITECH_APP_INFO__';

const GLOBAL_RUNTIME_STATE_KEY =
  '__TITECH_RUNTIME_STATE__';

const GLOBAL_RUNTIME_HANDLERS_MARKER =
  '__TITECH_RUNTIME_HANDLERS_INSTALLED__';

const OFFICIAL_BRAND_NAME =
  TITECH_BRAND?.fullName ||
  APP_NAME;

const OFFICIAL_THEME_COLOR =
  TITECH_BRAND?.colorRoles?.primaryInteractive ||
  '#0058D8';

const OFFICIAL_BRAND_DATASET_KEY =
  'titechBrand';

const RUNTIME_THEME_COLOR_VARIABLE =
  '--titech-runtime-theme-color';

// ============================================================================
// Safe runtime diagnostics
// ============================================================================
//
// Only non-sensitive application metadata is exposed.
//
// NEVER expose:
//
//   - access tokens
//   - refresh tokens
//   - passwords
//   - API keys
//   - secrets
//   - encryption keys
//   - authorization headers
//   - wallet balances
//   - financial transaction data
//   - KYC data
//   - personally identifiable information
//
// ============================================================================

function installApplicationDiagnostics() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (window[GLOBAL_APP_INFO_KEY]) {
      return;
    }

    const applicationInfo = Object.freeze({
      name: APP_NAME,
      version: APP_VERSION,
      environment: APP_ENVIRONMENT,
      buildTime: BUILD_TIME,
    });

    Object.defineProperty(
      window,
      GLOBAL_APP_INFO_KEY,
      {
        configurable: false,
        enumerable: false,
        writable: false,
        value: applicationInfo,
      }
    );
  } catch (error) {
    /*
     * Diagnostics are never allowed to prevent application startup.
     */
    if (IS_DEVELOPMENT) {
      console.warn(
        '[TITech] Unable to install application diagnostics.',
        error
      );
    }
  }
}

// ============================================================================
// Runtime state
// ============================================================================
//
// This state is deliberately minimal.
//
// It is NOT an application state store.
// It is only intended for safe browser-runtime diagnostics.
//
// HMR-safe behavior:
//   - Preserve an existing runtime state object.
//   - Avoid resetting diagnostic counters during module re-evaluation.
// ============================================================================

function initializeRuntimeState() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (window[GLOBAL_RUNTIME_STATE_KEY]) {
      return;
    }

    Object.defineProperty(
      window,
      GLOBAL_RUNTIME_STATE_KEY,
      {
        configurable: true,
        enumerable: false,
        writable: true,
        value: {
          bootstrapped: false,
          bootstrapStartedAt:
            new Date().toISOString(),
          runtimeErrors: 0,
        },
      }
    );
  } catch (error) {
    if (IS_DEVELOPMENT) {
      console.warn(
        '[TITech] Unable to initialize runtime state.',
        error
      );
    }
  }
}

// ============================================================================
// Runtime state updates
// ============================================================================

function updateRuntimeState(updates = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const state =
      window[GLOBAL_RUNTIME_STATE_KEY];

    if (!state) {
      return;
    }

    Object.assign(state, updates);
  } catch {
    /*
     * Runtime diagnostics must never interfere with the application.
     */
  }
}

// ============================================================================
// Error normalization
// ============================================================================

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name:
        error.name ||
        'Error',

      message:
        error.message ||
        'Unknown error',

      stack:
        typeof error.stack === 'string'
          ? error.stack
          : undefined,
    };
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
      stack: undefined,
    };
  }

  if (
    error !== null &&
    typeof error === 'object'
  ) {
    try {
      return {
        name:
          typeof error.name === 'string'
            ? error.name
            : 'UnknownError',

        message:
          typeof error.message === 'string'
            ? error.message
            : JSON.stringify(error),

        stack:
          typeof error.stack === 'string'
            ? error.stack
            : undefined,
      };
    } catch {
      return {
        name: 'UnknownError',
        message:
          '[Unserializable error object]',
        stack: undefined,
      };
    }
  }

  return {
    name: 'UnknownError',
    message: String(error),
    stack: undefined,
  };
}

// ============================================================================
// Runtime error reporting
// ============================================================================
//
// This is the canonical browser-level observability boundary.
//
// Production integrations can later be connected here:
//
//   - Sentry
//   - OpenTelemetry
//   - Datadog
//   - LogRocket
//   - TITech internal telemetry
//
// IMPORTANT:
//
// Sensitive application data must NEVER be transmitted through this
// boundary unless explicitly sanitized by the observability layer.
// ============================================================================

function reportRuntimeError(
  error,
  metadata = {}
) {
  const normalizedError =
    normalizeError(error);

  let currentRuntimeErrors = 0;

  if (typeof window !== 'undefined') {
    currentRuntimeErrors =
      window[GLOBAL_RUNTIME_STATE_KEY]
        ?.runtimeErrors || 0;
  }

  updateRuntimeState({
    runtimeErrors:
      currentRuntimeErrors + 1,
  });

  const payload = {
    application: APP_NAME,
    version: APP_VERSION,
    environment: APP_ENVIRONMENT,
    timestamp: new Date().toISOString(),

    error: normalizedError,

    metadata: {
      ...metadata,
    },
  };

  if (IS_DEVELOPMENT) {
    console.error(
      '[TITech Runtime Error]',
      payload
    );
  }

  /*
   * Production observability boundary.
   *
   * Keep production telemetry integration centralized here.
   *
   * Example future implementation:
   *
   * telemetry.captureException(
   *   error,
   *   metadata
   * );
   *
   * Do NOT directly send raw application state.
   */
  if (IS_PRODUCTION) {
    // Intentionally empty until the production telemetry provider
    // is formally integrated.
  }
}

// ============================================================================
// Controlled bootstrap failure UI
// ============================================================================
//
// This is intentionally dependency-free.
//
// It must work even when React itself cannot mount.
// ============================================================================

function renderFatalBootstrapError(error) {
  if (
    typeof document === 'undefined'
  ) {
    return;
  }

  try {
    const container =
      document.getElementById(
        ROOT_ELEMENT_ID
      );

    if (!container) {
      return;
    }

    const normalizedError =
      normalizeError(error);

    const message =
      IS_DEVELOPMENT
        ? normalizedError.message
        : 'The application could not be started. Please reload the page or try again later.';

    container.innerHTML = '';

    const wrapper =
      document.createElement('div');

    wrapper.setAttribute(
      'role',
      'alert'
    );

    wrapper.setAttribute(
      'aria-live',
      'assertive'
    );

    wrapper.style.cssText = [
      'min-height:100vh',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'box-sizing:border-box',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      `background:${OFFICIAL_THEME_COLOR}`,
      'color:#0f172a',
    ].join(';');

    const card =
      document.createElement('div');

    card.style.cssText = [
      'width:100%',
      'max-width:560px',
      'padding:32px',
      'box-sizing:border-box',
      'background:#ffffff',
      'border:1px solid rgba(15,23,42,.12)',
      'border-radius:16px',
      'box-shadow:0 10px 30px rgba(15,23,42,.08)',
    ].join(';');

    const heading =
      document.createElement('h1');

    heading.textContent =
      APP_NAME;

    heading.style.cssText = [
      'margin:0 0 12px',
      'font-size:24px',
      'line-height:1.25',
      `color:${OFFICIAL_THEME_COLOR}`,
    ].join(';');

    const paragraph =
      document.createElement('p');

    paragraph.textContent = message;

    paragraph.style.cssText = [
      'margin:0 0 24px',
      'line-height:1.6',
      'color:#475569',
    ].join(';');

    const reloadButton =
      document.createElement('button');

    reloadButton.type = 'button';

    reloadButton.textContent =
      'Reload application';

    reloadButton.setAttribute(
      'aria-label',
      'Reload TITech Community Capital application'
    );

    reloadButton.style.cssText = [
      'padding:10px 16px',
      'border:0',
      'border-radius:8px',
      `background:${OFFICIAL_THEME_COLOR}`,
      'color:#ffffff',
      'font-size:14px',
      'font-weight:600',
      'cursor:pointer',
    ].join(';');

    reloadButton.addEventListener(
      'click',
      () => {
        window.location.reload();
      }
    );

    card.appendChild(heading);
    card.appendChild(paragraph);
    card.appendChild(reloadButton);

    wrapper.appendChild(card);
    container.appendChild(wrapper);
  } catch (renderError) {
    /*
     * Last-resort failure path.
     *
     * Never throw from the fatal error renderer.
     */
    if (IS_DEVELOPMENT) {
      console.error(
        '[TITech] Failed to render bootstrap failure UI.',
        renderError
      );
    }
  }
}

// ============================================================================
// Official brand runtime
// ============================================================================
//
// IMPORTANT:
//
// This function only applies presentation/runtime metadata.
//
// It MUST NOT:
//   - perform authentication
//   - call APIs
//   - mutate financial state
//   - initialize payment providers
//   - initialize ledger services
//   - initialize offline synchronization
//   - modify tenant/application state
//
// A branding failure is logged in development and otherwise ignored so that
// the core application remains bootable.
// ============================================================================

function applyOfficialBrandRuntime() {
  if (typeof document === 'undefined') {
    return;
  }

  try {
    const rootElement =
      document.documentElement;

    if (!rootElement) {
      return;
    }

    // ------------------------------------------------------------------------
    // Canonical brand metadata
    // ------------------------------------------------------------------------

    rootElement.dataset[
      OFFICIAL_BRAND_DATASET_KEY
    ] =
      OFFICIAL_BRAND_NAME;

    // ------------------------------------------------------------------------
    // Runtime theme variable
    // ------------------------------------------------------------------------

    rootElement.style.setProperty(
      RUNTIME_THEME_COLOR_VARIABLE,
      OFFICIAL_THEME_COLOR
    );

    // ------------------------------------------------------------------------
    // Keep document body metadata aligned when available
    // ------------------------------------------------------------------------

    if (document.body) {
      document.body.dataset[
        OFFICIAL_BRAND_DATASET_KEY
      ] =
        OFFICIAL_BRAND_NAME;
    }

    // ------------------------------------------------------------------------
    // Synchronize browser theme color
    // ------------------------------------------------------------------------

    const themeColorMeta =
      document.querySelector(
        'meta[name="theme-color"]'
      );

    if (themeColorMeta) {
      themeColorMeta.setAttribute(
        'content',
        OFFICIAL_THEME_COLOR
      );
    }
  } catch (error) {
    /*
     * Branding is presentation infrastructure.
     *
     * Never allow a branding error to prevent authentication, tenancy,
     * routing, ledger, payment, reconciliation, or other application
     * functionality from starting.
     */
    if (IS_DEVELOPMENT) {
      console.warn(
        '[TITech] Unable to apply official brand runtime.',
        error
      );
    }
  }
}

// ============================================================================
// Global browser error handler
// ============================================================================

function handleWindowError(event) {
  try {
    reportRuntimeError(
      event?.error ||
        event?.message ||
        'Unknown browser error',
      {
        type: 'window.error',

        filename:
          event?.filename ||
          null,

        lineNumber:
          Number.isFinite(event?.lineno)
            ? event.lineno
            : null,

        columnNumber:
          Number.isFinite(event?.colno)
            ? event.colno
            : null,
      }
    );
  } catch (handlerError) {
    if (IS_DEVELOPMENT) {
      console.error(
        '[TITech] Failed to process window error.',
        handlerError
      );
    }
  }
}

// ============================================================================
// Global unhandled promise rejection handler
// ============================================================================

function handleUnhandledRejection(event) {
  try {
    reportRuntimeError(
      event?.reason ||
        'Unhandled promise rejection',
      {
        type:
          'window.unhandledrejection',
      }
    );
  } catch (handlerError) {
    if (IS_DEVELOPMENT) {
      console.error(
        '[TITech] Failed to process unhandled promise rejection.',
        handlerError
      );
    }
  }
}

// ============================================================================
// Global runtime handler installation
// ============================================================================
//
// Vite HMR can re-evaluate modules during development.
//
// We therefore use a stable window-level marker to prevent duplicate global
// listeners from accumulating across module reloads.
// ============================================================================

function installRuntimeHandlers() {
  if (
    typeof window === 'undefined'
  ) {
    return () => {};
  }

  if (
    window[
      GLOBAL_RUNTIME_HANDLERS_MARKER
    ]
  ) {
    return () => {};
  }

  window.addEventListener(
    'error',
    handleWindowError
  );

  window.addEventListener(
    'unhandledrejection',
    handleUnhandledRejection
  );

  try {
    Object.defineProperty(
      window,
      GLOBAL_RUNTIME_HANDLERS_MARKER,
      {
        configurable: true,
        enumerable: false,
        writable: true,
        value: true,
      }
    );
  } catch {
    /*
     * Listener installation itself remains valid even if the marker cannot
     * be persisted.
     */
  }

  return () => {
    /*
     * Teardown is primarily useful for controlled test environments.
     */
    window.removeEventListener(
      'error',
      handleWindowError
    );

    window.removeEventListener(
      'unhandledrejection',
      handleUnhandledRejection
    );

    try {
      delete window[
        GLOBAL_RUNTIME_HANDLERS_MARKER
      ];
    } catch {
      // Ignore cleanup failures.
    }
  };
}

// ============================================================================
// Root container validation
// ============================================================================

function getRootContainer() {
  if (
    typeof document === 'undefined'
  ) {
    throw new Error(
      'TITech Community Capital requires a browser document.'
    );
  }

  const container =
    document.getElementById(
      ROOT_ELEMENT_ID
    );

  if (!container) {
    const error = new Error(
      'TITech Community Capital failed to start: ' +
        "root container '#root' was not found in index.html."
    );

    reportRuntimeError(
      error,
      {
        type:
          'bootstrap.root_missing',
      }
    );

    throw error;
  }

  return container;
}

// ============================================================================
// React application bootstrap
// ============================================================================

function bootstrapApplication() {
  // --------------------------------------------------------------------------
  // Apply non-critical runtime branding first.
  //
  // applyOfficialBrandRuntime() is intentionally fail-safe and does not
  // throw presentation errors into the application bootstrap boundary.
  // --------------------------------------------------------------------------

  applyOfficialBrandRuntime();

  const container =
    getRootContainer();

  let root;

  // --------------------------------------------------------------------------
  // Create React root
  // --------------------------------------------------------------------------

  try {
    root =
      ReactDOM.createRoot(
        container,
        {
          onRecoverableError:
            (error, errorInfo) => {
              reportRuntimeError(
                error,
                {
                  type:
                    'bootstrap.react_recoverable_error',

                  componentStack:
                    errorInfo?.componentStack ||
                    null,
                }
              );
            },
        }
      );
  } catch (error) {
    reportRuntimeError(
      error,
      {
        type:
          'bootstrap.react_root_creation',
      }
    );

    throw error;
  }

  // --------------------------------------------------------------------------
  // Render application
  // --------------------------------------------------------------------------

  /*
   * React 18 may surface rendering/runtime failures asynchronously.
   *
   * Therefore this try/catch only protects synchronous render invocation
   * failures. Global error handlers and application-level error boundaries
   * remain responsible for asynchronous render/runtime failures.
   */

  try {
    root.render(
      <React.StrictMode>
        <Providers>
          <AppRoutes />
        </Providers>
      </React.StrictMode>
    );
  } catch (error) {
    reportRuntimeError(
      error,
      {
        type:
          'bootstrap.react_render',
      }
    );

    throw error;
  }

  return root;
}

// ============================================================================
// Startup sequence
// ============================================================================
//
// Keep this sequence deterministic:
//
//   1. Application diagnostics
//   2. Runtime state
//   3. Global runtime handlers
//   4. Official brand runtime
//   5. Root validation
//   6. React bootstrap
//   7. Startup state
//
// ============================================================================

installApplicationDiagnostics();

initializeRuntimeState();

installRuntimeHandlers();

let applicationRoot;

try {
  applicationRoot =
    bootstrapApplication();

  updateRuntimeState({
    bootstrapped: true,
    bootstrapFailed: false,
    bootstrappedAt:
      new Date().toISOString(),
  });
} catch (error) {
  updateRuntimeState({
    bootstrapped: false,
    bootstrapFailed: true,
    bootstrapFailedAt:
      new Date().toISOString(),
  });

  /*
   * Report before rendering the fatal fallback so that observability has
   * the original bootstrap failure.
   */
  reportRuntimeError(
    error,
    {
      type:
        'bootstrap.application_failed',
    }
  );

  if (IS_DEVELOPMENT) {
    console.error(
      '[TITech] Frontend bootstrap failed.',
      error
    );
  }

  renderFatalBootstrapError(error);

  /*
   * Do not silently continue with a partially initialized application.
   */
  throw error;
}

// ============================================================================
// Development diagnostics
// ============================================================================

if (IS_DEVELOPMENT) {
  console.info(
    `[${APP_NAME}] Frontend started successfully.`
  );

  console.info(
    `[${APP_NAME}] Version: ${APP_VERSION}`
  );

  console.info(
    `[${APP_NAME}] Environment: ${APP_ENVIRONMENT}`
  );

  if (BUILD_TIME) {
    console.info(
      `[${APP_NAME}] Build time: ${BUILD_TIME}`
    );
  }

  console.info(
    `[${APP_NAME}] Official brand: ${OFFICIAL_BRAND_NAME}`
  );

  console.info(
    `[${APP_NAME}] Theme color: ${OFFICIAL_THEME_COLOR}`
  );
}

// ============================================================================
// Optional performance monitoring
// ============================================================================
//
// Introduce Web Vitals / performance telemetry only after the project's
// observability strategy is established.
//
// Example:
//
// import reportWebVitals from './reportWebVitals';
// reportWebVitals();
//
// ============================================================================

// ============================================================================
// Future global integrations
// ============================================================================
//
// Appropriate global integrations:
//
//   - Sentry initialization
//   - OpenTelemetry initialization
//   - Web Vitals
//   - Feature flag bootstrap
//   - Service worker registration
//   - Global telemetry
//
// These belong here only when they are genuinely application-global.
//
// Authentication, API clients, financial services, wallet/ledger operations,
// offline synchronization, KYC, notifications, and feature-specific logic
// belong below Providers/AppRoutes.
// ============================================================================

// ============================================================================
// HMR
// ============================================================================
//
// Vite manages HMR automatically.
//
// No explicit import.meta.hot.accept() is required for this entry point.
// ============================================================================

// ============================================================================
// Runtime reference
// ============================================================================
//
// Keep the root local. Do not expose the React root through window.
// ============================================================================

void applicationRoot;