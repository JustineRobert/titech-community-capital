// ============================================================================
// TITech Community Capital
// Enterprise Redux Store
//
// File:
// frontend/src/store/index.js
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Central Redux Toolkit store configuration
// - Feature-slice registration
// - Serializable-state safety
// - Development-only Redux DevTools
// - Middleware configuration
// - Future-ready architecture
// - Safe hot-module replacement
// - No business logic
//
// Architecture
// ----------------------------------------------------------------------------
// frontend/
//   store/
//     index.js
//     chatSlice.js
//     chat/
//       chatOperations.js
//       chatSelectors.js
//
// IMPORTANT
// ----------------------------------------------------------------------------
// This module intentionally does NOT contain:
// - API calls
// - authentication logic
// - token management
// - business rules
// - financial calculations
// - authorization decisions
//
// The backend remains authoritative for authentication, authorization,
// financial state and security-sensitive operations.
// ============================================================================

"use strict";

import {
  configureStore,
  combineReducers,
} from "@reduxjs/toolkit";

import chatReducer from "./chatSlice";

// ============================================================================
// Environment Helpers
// ============================================================================

const isDevelopment =
  import.meta?.env?.MODE === "development";

const isProduction =
  import.meta?.env?.MODE === "production";

// ============================================================================
// Root Reducer
// ============================================================================
//
// Keep feature reducers explicitly registered here.
//
// This makes the application state tree predictable:
//
// state
// ├── chat
// ├── auth                 (when registered)
// ├── notifications       (when registered)
// └── ...
//
// Do NOT register reducers dynamically from arbitrary components.
// ============================================================================

const rootReducer = combineReducers({
  chat: chatReducer,

  // --------------------------------------------------------------------------
  // Future TITech feature reducers can be registered here.
  //
  // Example:
  //
  // auth: authReducer,
  // notifications: notificationReducer,
  // ui: uiReducer,
  //
  // Keep each feature isolated.
  // --------------------------------------------------------------------------
});

// ============================================================================
// Middleware Configuration
// ============================================================================
//
// Redux Toolkit already includes:
// - redux-thunk
// - immutable-state invariant in development
// - serializable-state invariant in development
//
// We retain those protections while explicitly configuring the middleware
// so the store can evolve safely as the platform grows.
//
// IMPORTANT
// ----------------------------------------------------------------------------
// AbortController, Error, Response, File, Blob and other non-serializable
// objects should NOT be placed inside Redux state.
//
// API cancellation belongs at the operation/service layer.
// ============================================================================

const middlewareOptions = {
  serializableCheck: {
    // ------------------------------------------------------------------------
    // Async thunk metadata may contain AbortSignal.
    //
    // RTK internally uses this for cancellation.
    // Ignoring these action paths prevents false-positive warnings while
    // retaining serializable-state protection for application data.
    // ------------------------------------------------------------------------
    ignoredActionPaths: [
      "meta.arg.signal",
      "meta.baseQueryMeta",
    ],

    // ------------------------------------------------------------------------
    // Redux Toolkit thunk metadata may contain AbortSignal instances.
    // ------------------------------------------------------------------------
    ignoredPaths: [],
  },

  immutableCheck: isDevelopment
    ? {
        warnAfter: 32,
      }
    : false,
};

// ============================================================================
// Store Factory
// ============================================================================
//
// A factory function makes testing easier because tests can create isolated
// stores without sharing global application state.
// ============================================================================

export const createAppStore = (
  preloadedState
) =>
  configureStore({
    reducer: rootReducer,

    preloadedState,

    devTools:
      isDevelopment
        ? {
            name:
              "TITech Community Capital",
            trace: false,
          }
        : false,

    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware(
        middlewareOptions
      ),
  });

// ============================================================================
// Application Store
// ============================================================================
//
// The production application imports this default store:
//
// import store from "./store";
//
// Tests should generally use createAppStore() instead.
// ============================================================================

export const store =
  createAppStore();

// ============================================================================
// Typed-Friendly Selectors
// ============================================================================
//
// JavaScript project helpers.
//
// These provide a stable abstraction around the store and make future
// migration to TypeScript easier without changing consuming components.
// ============================================================================

export const selectRootState = (
  state
) => state;

// ============================================================================
// Store Utilities
// ============================================================================

/**
 * Returns the current Redux state.
 *
 * Useful for integration code that needs a read-only snapshot.
 */
export const getStoreState = () =>
  store.getState();

/**
 * Dispatches a Redux action.
 *
 * Centralizing dispatch access makes integration testing and future store
 * instrumentation easier.
 */
export const dispatch = (
 action
) =>
  store.dispatch(action);

// ============================================================================
// Hot Module Replacement
// ============================================================================
//
// Keep this deliberately conservative.
//
// Reducer replacement is supported by Redux Toolkit/Redux, but should only
// execute when the bundler exposes HMR APIs.
// ============================================================================

if (
  isDevelopment &&
  import.meta?.hot
) {
  import.meta.hot.accept(
    "./chatSlice",
    () => {
      // ----------------------------------------------------------------------
      // Vite will reload the module during development.
      //
      // The explicit store architecture remains compatible with HMR without
      // requiring application components to know about it.
      // ----------------------------------------------------------------------
    }
  );
}

// ============================================================================
// Development Diagnostics
// ============================================================================
//
// Do not log the Redux state, authentication tokens, financial information,
// personal information or other sensitive application data.
//
// This intentionally provides only a lightweight development signal.
// ============================================================================

if (isDevelopment) {
  // eslint-disable-next-line no-console
  console.debug(
    "[TITech Store] Redux store initialized."
  );
}

// ============================================================================
// Public API
// ============================================================================

export {
  rootReducer,
};

export default store;