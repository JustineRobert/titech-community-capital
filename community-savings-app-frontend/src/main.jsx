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
 *   - Install global browser runtime diagnostics
 *   - Capture uncaught browser errors
 *   - Capture unhandled promise rejections
 *   - Expose safe, non-sensitive application diagnostics
 *   - Provide deterministic startup behavior
 *   - Provide a controlled bootstrap failure boundary
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
 *      ├── Global error handlers
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
 * ============================================================================
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

import Providers from './app/providers';
import AppRoutes from './routes/AppRoutes';

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

  updateRuntimeState({
    runtimeErrors:
      (
        window?.[GLOBAL_RUNTIME_STATE_KEY]
          ?.runtimeErrors || 0
      ) + 1,
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

    wrapper.style.cssText = [
      'min-height:100vh',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'box-sizing:border-box',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'background:#f8fafc',
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
      'border:1px solid #e2e8f0',
      'border-radius:16px',
      'box-shadow:0 10px 30px rgba(15,23,42,.08)',
    ].join(';');

    const heading =
      document.createElement('h1');

    heading.textContent =
      'TITech Community Capital';

    heading.style.cssText = [
      'margin:0 0 12px',
      'font-size:24px',
      'line-height:1.25',
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

    reloadButton.style.cssText = [
      'padding:10px 16px',
      'border:0',
      'border-radius:8px',
      'background:#2563eb',
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

  const marker =
    '__TITECH_RUNTIME_HANDLERS_INSTALLED__';

  if (window[marker]) {
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
      marker,
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
      delete window[marker];
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
  const container =
    getRootContainer();

  let root;

  // --------------------------------------------------------------------------
  // Create React root
  // --------------------------------------------------------------------------

  try {
    root =
      ReactDOM.createRoot(
        container
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
//   4. React bootstrap
//   5. Startup state
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