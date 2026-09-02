'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/index.js
 *
 * Purpose:
 *   Canonical React application bootstrap and browser runtime entry point.
 *
 * Responsibilities:
 *   - Validate the browser runtime
 *   - Validate the React root container
 *   - Install global browser runtime diagnostics
 *   - Capture uncaught browser errors
 *   - Capture unhandled promise rejections
 *   - Create the React application root
 *   - Bootstrap BrowserRouter
 *   - Render the TITech application
 *   - Expose safe, non-sensitive runtime diagnostics
 *   - Provide deterministic frontend startup behavior
 *
 * Non-responsibilities:
 *   - Authentication business logic
 *   - Routing configuration
 *   - API implementation
 *   - Financial operations
 *   - Wallet or ledger mutations
 *   - Feature-specific initialization
 *   - State management implementation
 *
 * IMPORTANT:
 *   This file must not be used simultaneously with another React entry point
 *   such as `main.jsx`.
 *
 * ============================================================================
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import './index.css';

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

const API_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_APP_API_URL ||
  'http://localhost:5000';

const IS_DEVELOPMENT =
  Boolean(import.meta.env.DEV);

const IS_PRODUCTION =
  Boolean(import.meta.env.PROD);

// ============================================================================
// Browser runtime validation
// ============================================================================

function assertBrowserRuntime() {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  ) {
    throw new Error(
      `${APP_NAME} requires a browser runtime.`
    );
  }
}

// ============================================================================
// Runtime diagnostics
// ============================================================================
//
// Only non-sensitive metadata is exposed.
//
// NEVER expose:
//
//   - Access tokens
//   - Refresh tokens
//   - Passwords
//   - API secrets
//   - Private keys
//   - Encryption material
//   - Financial transaction data
//   - Wallet balances
//   - KYC information
//   - Personally identifiable information
//
// ============================================================================

function installApplicationDiagnostics() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    Object.defineProperty(
      window,
      '__TITECH_APP_INFO__',
      {
        configurable: false,
        enumerable: false,
        writable: false,

        value: Object.freeze({
          name: APP_NAME,
          version: APP_VERSION,
          environment: APP_ENVIRONMENT,
          buildTime: BUILD_TIME,
        }),
      }
    );
  } catch (error) {
    /*
     * Diagnostics must never prevent application startup.
     */

    if (IS_DEVELOPMENT) {
      console.warn(
        '[TITech] Failed to install application diagnostics.',
        error
      );
    }
  }
}

// ============================================================================
// Error normalization
// ============================================================================

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',

      message:
        error.message || 'Unknown error',

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
// Canonical browser-level observability boundary.
//
// Future integrations may include:
//
//   - Sentry
//   - OpenTelemetry
//   - Datadog
//   - LogRocket
//   - TITech internal observability
//
// IMPORTANT:
//
// Never transmit:
//
//   - JWTs
//   - Refresh tokens
//   - Authorization headers
//   - Passwords
//   - Financial transaction payloads
//   - KYC information
//   - Personally identifiable information
//
// ============================================================================

function reportRuntimeError(
  error,
  metadata = {}
) {
  const normalizedError =
    normalizeError(error);

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

  if (IS_PRODUCTION) {
    /*
     * ========================================================================
     * Production observability integration point.
     * ========================================================================
     *
     * Example:
     *
     * Sentry.captureException(error, {
     *   extra: metadata,
     * });
     *
     * Keep production reporting centralized here.
     * ========================================================================
     */
  }
}

// ============================================================================
// Global browser error handling
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
          event?.filename || null,

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
  } catch (error) {
    /*
     * Error reporting must never generate another uncaught error.
     */

    if (IS_DEVELOPMENT) {
      console.error(
        '[TITech] Failed to process global browser error.',
        error
      );
    }
  }
}

// ============================================================================
// Unhandled promise rejection handling
// ============================================================================

function handleUnhandledRejection(event) {
  try {
    reportRuntimeError(
      event?.reason ||
        'Unhandled promise rejection',
      {
        type: 'unhandledrejection',
      }
    );
  } catch (error) {
    /*
     * Error reporting must never generate another uncaught error.
     */

    if (IS_DEVELOPMENT) {
      console.error(
        '[TITech] Failed to process unhandled promise rejection.',
        error
      );
    }
  }
}

// ============================================================================
// Runtime handler installation
// ============================================================================

function installRuntimeHandlers() {
  if (typeof window === 'undefined') {
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

  return () => {
    window.removeEventListener(
      'error',
      handleWindowError
    );

    window.removeEventListener(
      'unhandledrejection',
      handleUnhandledRejection
    );
  };
}

// ============================================================================
// Root container validation
// ============================================================================

function getRootContainer() {
  const rootElement =
    document.getElementById('root');

  if (!rootElement) {
    const error = new Error(
      `${APP_NAME} failed to start: ` +
        "React root element '#root' was not found."
    );

    reportRuntimeError(error, {
      type: 'bootstrap.root_missing',
    });

    throw error;
  }

  return rootElement;
}

// ============================================================================
// Application bootstrap
// ============================================================================

function bootstrapApplication() {
  const rootElement =
    getRootContainer();

  let root;

  // --------------------------------------------------------------------------
  // Create React root
  // --------------------------------------------------------------------------

  try {
    root = createRoot(rootElement);
  } catch (error) {
    reportRuntimeError(error, {
      type: 'bootstrap.react_root_creation',
    });

    throw error;
  }

  // --------------------------------------------------------------------------
  // Render application
  // --------------------------------------------------------------------------

  try {
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>
    );
  } catch (error) {
    reportRuntimeError(error, {
      type: 'bootstrap.react_render',
    });

    throw error;
  }

  return root;
}

// ============================================================================
// Deterministic application startup
// ============================================================================

assertBrowserRuntime();

installApplicationDiagnostics();

const removeRuntimeHandlers =
  installRuntimeHandlers();

let applicationRoot;

try {
  applicationRoot =
    bootstrapApplication();
} catch (error) {
  /*
   * Never silently continue with a partially initialized application.
   */

  if (IS_DEVELOPMENT) {
    console.error(
      '[TITech] Frontend bootstrap failed.',
      error
    );
  }

  throw error;
}

// ============================================================================
// Development startup diagnostics
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

  console.info(
    `[${APP_NAME}] API URL: ${API_URL}`
  );

  if (BUILD_TIME) {
    console.info(
      `[${APP_NAME}] Build time: ${BUILD_TIME}`
    );
  }
}

// ============================================================================
// Production startup
// ============================================================================
//
// Keep production console output intentionally minimal.
//
// Detailed telemetry should be handled through the configured observability
// platform rather than exposing unnecessary runtime information.
// ============================================================================

// ============================================================================
// Future global integrations
// ============================================================================
//
// Appropriate global integrations may eventually include:
//
//   - Sentry initialization
//   - OpenTelemetry initialization
//   - Web Vitals
//   - Feature flag bootstrap
//   - Service worker registration
//   - Performance monitoring
//   - Global WebSocket lifecycle
//   - TITech application telemetry
//
// Only initialize genuinely global concerns here.
//
// Authentication, financial operations, API clients, wallet/ledger logic,
// offline synchronization, KYC, and feature-specific services belong below
// the application/provider/feature boundaries.
//
// ============================================================================

// ============================================================================
// Runtime lifecycle references
// ============================================================================
//
// These remain private and are intentionally not exposed on `window`.
//
// `removeRuntimeHandlers` is retained for future controlled teardown,
// integration testing, or explicit application lifecycle support.
// ============================================================================

void applicationRoot;
void removeRuntimeHandlers;