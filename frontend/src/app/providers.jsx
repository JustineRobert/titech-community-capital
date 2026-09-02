// ============================================================================
// TITech Community Capital
// Application Providers
//
// File:
// frontend/src/app/providers.jsx
//
// Production Grade
// Secure Authentication Boundary | Service Worker | Redux Persistence
// Multi-Tenant | Offline Ready | Error Isolation | StrictMode Safe
//
// RESPONSIBILITY
//
// This component owns APPLICATION infrastructure.
//
// Authentication lifecycle is owned exclusively by:
//     ../context/AuthContext.jsx
//
// AuthContext owns:
//     - Access token
//     - HttpOnly refresh-cookie session
//     - Login
//     - Register
//     - Refresh
//     - Logout
//     - /me hydration
//     - Tenant synchronization
//     - Socket lifecycle
//
// This file intentionally does NOT:
//     - read authentication tokens
//     - refresh authentication
//     - connect/disconnect sockets
//     - perform /auth/me
//     - perform /auth/refresh
// ============================================================================

import React, {
  StrictMode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Provider,
} from "react-redux";

import {
  PersistGate,
} from "redux-persist/integration/react";

import {
  BrowserRouter,
} from "react-router-dom";

import {
  store,
  persistor,
} from "./store";

import {
  AuthProvider,
} from "../context/AuthContext";

import ErrorBoundary from "../components/ui/ErrorBoundary";

import LoadingScreen from "../components/ui/LoadingScreen";

import NotificationProvider from "../components/ui/NotificationProvider";

import {
  onNetworkStateChange,
} from "../services/api";

// ============================================================================
// Environment Flags
// ============================================================================

const ENABLE_SERVICE_WORKER =
  import.meta.env.VITE_ENABLE_SW ===
  "true";

const IS_DEV =
  import.meta.env.DEV;

// ============================================================================
// Application Bootstrap State
// ============================================================================
//
// A module-level promise prevents duplicate initialization if React StrictMode
// mounts/unmounts the component during development.
//
// Authentication is intentionally NOT included here.
// ============================================================================

let applicationBootstrapPromise =
  null;

// ============================================================================
// Application Bootstrap
// ============================================================================
//
// Initializes non-authentication application infrastructure.
//
// Authentication belongs to AuthContext.
// ============================================================================

async function initializeApplication() {
  if (
    applicationBootstrapPromise
  ) {
    return applicationBootstrapPromise;
  }

  applicationBootstrapPromise =
    (async () => {
      // ======================================================================
      // Service Worker
      // ======================================================================

      if (
        ENABLE_SERVICE_WORKER &&
        typeof navigator !==
          "undefined" &&
        "serviceWorker" in
          navigator
      ) {
        try {
          const registration =
            await navigator.serviceWorker.register(
              "/sw.js",
              {
                scope: "/",
              }
            );

          if (IS_DEV) {
            console.info(
              "[BOOTSTRAP] Service Worker registered",
              {
                scope:
                  registration.scope,
              }
            );
          }

          // --------------------------------------------------------------
          // Detect newly installed worker
          // --------------------------------------------------------------

          if (
            registration.waiting &&
            IS_DEV
          ) {
            console.info(
              "[BOOTSTRAP] Service Worker waiting for activation"
            );
          }

          // --------------------------------------------------------------
          // Detect updates
          // --------------------------------------------------------------

          registration.addEventListener(
            "updatefound",
            () => {
              if (IS_DEV) {
                console.info(
                  "[BOOTSTRAP] Service Worker update found"
                );
              }
            }
          );
        } catch (
          error
        ) {
          // Service worker failure must never prevent the application
          // from loading.
          console.error(
            "[BOOTSTRAP] Service Worker registration failed",
            error
          );
        }
      }

      // ======================================================================
      // Feature Flags
      // ======================================================================

      try {
        store.dispatch({
          type:
            "featureFlags/initializeFeatureFlags",
        });
      } catch (
        error
      ) {
        console.error(
          "[BOOTSTRAP] Feature flags initialization failed",
          error
        );
      }

      // ======================================================================
      // Settings
      // ======================================================================

      try {
        store.dispatch({
          type:
            "settings/initializeSettings",
        });
      } catch (
        error
      ) {
        console.error(
          "[BOOTSTRAP] Settings initialization failed",
          error
        );
      }

      // ======================================================================
      // Audit
      // ======================================================================

      try {
        store.dispatch({
          type:
            "audit/initializeAudit",
        });
      } catch (
        error
      ) {
        console.error(
          "[BOOTSTRAP] Audit initialization failed",
          error
        );
      }

      // ======================================================================
      // Application Bootstrap Complete
      // ======================================================================

      return {
        initialized: true,
      };
    })();

  try {
    return await applicationBootstrapPromise;
  } finally {
    applicationBootstrapPromise =
      null;
  }
}

// ============================================================================
// Bootstrap Component
// ============================================================================

function Bootstrap({
  children,
}) {
  const [
    initialized,
    setInitialized,
  ] = useState(false);

  const [
    online,
    setOnline,
  ] = useState(() =>
    typeof navigator ===
      "undefined"
      ? true
      : navigator.onLine
  );

  // ========================================================================
  // Network State
  // ========================================================================
  //
  // This is application-level network awareness.
  //
  // Authentication refresh behavior remains owned by AuthContext/api.js.
  // ========================================================================

  useEffect(() => {
    let mounted = true;

    let unsubscribe =
      null;

    try {
      unsubscribe =
        onNetworkStateChange(
          ({
            online:
              nextOnline,
          }) => {
            if (!mounted) {
              return;
            }

            setOnline(
              Boolean(
                nextOnline
              )
            );

            if (IS_DEV) {
              console.info(
                "[NETWORK]",
                nextOnline
                  ? "Online"
                  : "Offline"
              );
            }
          }
        );
    } catch (
      error
    ) {
      console.error(
        "[NETWORK] Failed to initialize network listener",
        error
      );
    }

    return () => {
      mounted = false;

      if (
        typeof unsubscribe ===
        "function"
      ) {
        try {
          unsubscribe();
        } catch (
          error
        ) {
          if (IS_DEV) {
            console.warn(
              "[NETWORK] Failed to remove network listener",
              error
            );
          }
        }
      }
    };
  }, []);

  // ========================================================================
  // Application Initialization
  // ========================================================================

  const initialize =
    useCallback(
      async () => {
        try {
          await initializeApplication();
        } catch (
          error
        ) {
          // Application shell should still be allowed to render.
          console.error(
            "[BOOTSTRAP] Application initialization failed",
            error
          );
        } finally {
          setInitialized(
            true
          );
        }
      },
      []
    );

  // ========================================================================
  // Bootstrap Lifecycle
  // ========================================================================

  useEffect(() => {
    let mounted = true;

    async function run() {
      await initialize();

      if (!mounted) {
        return;
      }
    }

    run();

    return () => {
      mounted = false;
    };
  }, [
    initialize,
  ]);

  // ========================================================================
  // Loading State
  // ========================================================================

  if (!initialized) {
    return (
      <LoadingScreen
        message={
          online
            ? "Initializing application..."
            : "Preparing offline application..."
        }
      />
    );
  }

  // ========================================================================
  // Application
  // ========================================================================

  return children;
}

Bootstrap.propTypes = {
  children:
    PropTypes.node.isRequired,
};

// ============================================================================
// Persist Loader
// ============================================================================

function PersistLoader() {
  return (
    <LoadingScreen
      message="Restoring application state..."
    />
  );
}

// ============================================================================
// Global Error Handlers
// ============================================================================
//
// This layer provides a last-resort diagnostic boundary.
//
// It intentionally does not attempt to recover authentication or redirect
// users. Authentication recovery belongs to AuthContext/api.js.
// ============================================================================

function GlobalListeners() {
  useEffect(() => {
    // ========================================================================
    // Uncaught JavaScript Error
    // ========================================================================

    function handleError(
      event
    ) {
      if (IS_DEV) {
        console.error(
          "[GLOBAL ERROR]",
          event.error ||
            event.message
        );

        return;
      }

      console.error(
        "[GLOBAL ERROR]",
        event.message ||
          "Unknown application error"
      );
    }

    // ========================================================================
    // Unhandled Promise Rejection
    // ========================================================================

    function handleRejection(
      event
    ) {
      if (IS_DEV) {
        console.error(
          "[UNHANDLED PROMISE REJECTION]",
          event.reason
        );

        return;
      }

      console.error(
        "[UNHANDLED PROMISE REJECTION]",
        event.reason
          ?.message ||
          "Unhandled promise rejection"
      );
    }

    window.addEventListener(
      "error",
      handleError
    );

    window.addEventListener(
      "unhandledrejection",
      handleRejection
    );

    return () => {
      window.removeEventListener(
        "error",
        handleError
      );

      window.removeEventListener(
        "unhandledrejection",
        handleRejection
      );
    };
  }, []);

  return null;
}

// ============================================================================
// Application Providers
// ============================================================================

export default function Providers({
  children,
}) {
  return (
    <StrictMode>
      <ErrorBoundary>
        <Provider
          store={store}
        >
          <PersistGate
            persistor={
              persistor
            }
            loading={
              <PersistLoader />
            }
          >
            <BrowserRouter>
              <AuthProvider>
                <NotificationProvider>
                  <Bootstrap>
                    <GlobalListeners />

                    <Suspense
                      fallback={
                        <LoadingScreen
                          message="Loading..."
                        />
                      }
                    >
                      {children}
                    </Suspense>
                  </Bootstrap>
                </NotificationProvider>
              </AuthProvider>
            </BrowserRouter>
          </PersistGate>
        </Provider>
      </ErrorBoundary>
    </StrictMode>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

Providers.propTypes = {
  children:
    PropTypes.node.isRequired,
};