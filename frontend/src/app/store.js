// ============================================================================
// TITech Community Capital
// Enterprise Redux Store
// File: frontend/src/app/store.js
// Production Grade
// ============================================================================

import {
  configureStore,
  combineReducers,
} from "@reduxjs/toolkit";

import {
  persistStore,
  persistReducer,
  createMigrate,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";

import storage from "redux-persist/lib/storage";

// ============================================================================
// Core Reducers
// ============================================================================

import authReducer from "../features/auth/authSlice";
import userReducer from "../features/user/userSlice";
import tenantReducer from "../features/tenant/tenantSlice";
import notificationReducer from "../features/notification/notificationSlice";
import uiReducer from "../features/ui/uiSlice";
import settingsReducer from "../features/settings/settingsSlice";
import featureFlagReducer from "../features/featureFlags/featureFlagSlice";
import auditReducer from "../features/audit/auditSlice";

// ============================================================================
// API Services
// ============================================================================

import api from "../services/api";

// ============================================================================
// Constants
// ============================================================================

const IS_DEV =
  import.meta.env.DEV;

const APP_VERSION = "1.0.0";

// ============================================================================
// Root Reset Action
// ============================================================================

const RESET_APPLICATION =
  "RESET_APPLICATION";

// ============================================================================
// Persist Migrations
// ============================================================================

const migrations = {
  0: (state) => ({
    ...state,
  }),

  1: (state) => ({
    ...state,
    appVersion:
      APP_VERSION,
  }),
};

// ============================================================================
// Static Reducers
// ============================================================================

const staticReducers = {
  auth: authReducer,
  user: userReducer,
  tenant: tenantReducer,
  notifications:
    notificationReducer,
  ui: uiReducer,
  settings:
    settingsReducer,
  featureFlags:
    featureFlagReducer,
  audit: auditReducer,
};

// ============================================================================
// Reducer Factory
// ============================================================================

function createReducer(
  asyncReducers = {}
) {
  const appReducer =
    combineReducers({
      ...staticReducers,
      ...asyncReducers,

      ...(api?.reducer
        ? {
            [api.reducerPath]:
              api.reducer,
          }
        : {}),
    });

  return (
    state,
    action
  ) => {
    if (
      action.type ===
      RESET_APPLICATION
    ) {
      state =
        undefined;
    }

    return appReducer(
      state,
      action
    );
  };
}

// ============================================================================
// Persist Configuration
// ============================================================================

const persistConfig = {
  key: "root",
  version: 1,
  storage,

  whitelist: [
    "auth",
    "tenant",
    "settings",
    "featureFlags",
  ],

  blacklist: [
    "notifications",
    "ui",
    "audit",

    ...(api?.reducer
      ? [api.reducerPath]
      : []),
  ],

  migrate:
    createMigrate(
      migrations,
      {
        debug: IS_DEV,
      }
    ),

  timeout: 10000,
};

const persistedReducer =
  persistReducer(
    persistConfig,
    createReducer()
  );

// ============================================================================
// Middleware
// ============================================================================

const middleware = (
  getDefaultMiddleware
) => {
  const defaultMiddleware =
    getDefaultMiddleware({
      serializableCheck:
        {
          ignoredActions:
            [
              FLUSH,
              REHYDRATE,
              PAUSE,
              PERSIST,
              PURGE,
              REGISTER,
            ],

          ignoredPaths:
            [
              "auth.lastLoginAt",
              "auth.lastActivityAt",
            ],
        },

      immutableCheck:
        IS_DEV,
    });

  if (
    api?.middleware
  ) {
    return defaultMiddleware.concat(
      api.middleware
    );
  }

  return defaultMiddleware;
};

// ============================================================================
// Store
// ============================================================================

export const store =
  configureStore({
    reducer:
      persistedReducer,

    middleware,

    devTools:
      IS_DEV,

    enhancers: (
      getDefaultEnhancers
    ) =>
      getDefaultEnhancers({
        autoBatch:
          true,
      }),
  });

// ============================================================================
// Persistor
// ============================================================================

export const persistor =
  persistStore(
    store,
    null,
    () => {
      if (IS_DEV) {
        console.info(
          "Redux state rehydrated."
        );
      }
    }
  );

// ============================================================================
// Async Reducers Registry
// ============================================================================

store.asyncReducers =
  {};

// ============================================================================
// Dynamic Reducer Injection
// ============================================================================

export function injectReducer(
  key,
  reducer
) {
  if (
    !key ||
    !reducer
  ) {
    throw new Error(
      "Reducer key and reducer are required."
    );
  }

  if (
    store.asyncReducers[
      key
    ]
  ) {
    return;
  }

  store.asyncReducers[
    key
  ] = reducer;

  const newReducer =
    persistReducer(
      persistConfig,
      createReducer(
        store.asyncReducers
      )
    );

  store.replaceReducer(
    newReducer
  );

  if (IS_DEV) {
    console.info(
      `Reducer injected: ${key}`
    );
  }
}

// ============================================================================
// Remove Dynamic Reducer
// ============================================================================

export function removeReducer(
  key
) {
  if (
    !store.asyncReducers[
      key
    ]
  ) {
    return;
  }

  delete store.asyncReducers[
    key
  ];

  const newReducer =
    persistReducer(
      persistConfig,
      createReducer(
        store.asyncReducers
      )
    );

  store.replaceReducer(
    newReducer
  );

  if (IS_DEV) {
    console.info(
      `Reducer removed: ${key}`
    );
  }
}

// ============================================================================
// Reset Store
// ============================================================================

export async function resetStore() {
  try {
    await persistor.flush();
    await persistor.purge();

    store.dispatch({
      type:
        RESET_APPLICATION,
    });

    if (
      api?.util
        ?.resetApiState
    ) {
      store.dispatch(
        api.util.resetApiState()
      );
    }

    if (IS_DEV) {
      console.info(
        "Store reset completed."
      );
    }
  } catch (error) {
    console.error(
      "Store reset failed:",
      error
    );
  }
}

// ============================================================================
// Logout Helper
// ============================================================================

export async function logoutAndClearStore() {
  try {
    await persistor.flush();
    await persistor.purge();

    store.dispatch({
      type:
        "auth/logout",
    });

    if (
      api?.util
        ?.resetApiState
    ) {
      store.dispatch(
        api.util.resetApiState()
      );
    }

    localStorage.removeItem(
      "accessToken"
    );

    localStorage.removeItem(
      "refreshToken"
    );

    localStorage.removeItem(
      "tenantId"
    );

    if (IS_DEV) {
      console.info(
        "Logout cleanup complete."
      );
    }
  } catch (error) {
    console.error(
      "Logout cleanup failed:",
      error
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

export const dispatch =
  store.dispatch;

export const getState =
  () =>
    store.getState();

export const subscribe =
  store.subscribe;

// ============================================================================
// Global Error Handlers
// ============================================================================

if (
  typeof window !==
  "undefined"
) {
  window.addEventListener(
    "unhandledrejection",
    (
      event
    ) => {
      console.error(
        "Unhandled Promise Rejection:",
        event.reason
      );
    }
  );

  window.addEventListener(
    "error",
    (
      event
    ) => {
      console.error(
        "Global Error:",
        event.error
      );
    }
  );
}

// ============================================================================
// Hot Module Replacement
// ============================================================================

if (
  IS_DEV &&
  import.meta?.hot
) {
  import.meta.hot.accept();
}

// ============================================================================
// Enterprise Store Utilities
// ============================================================================

export function hasReducer(
  key
) {
  return Boolean(
    store.asyncReducers[
      key
    ]
  );
}

export function getReducers() {
  return {
    ...staticReducers,
    ...store.asyncReducers,
  };
}

// ============================================================================
// Types Support (Future TypeScript Migration)
// ============================================================================

export const RootState =
  {};

export const AppDispatch =
  dispatch;

// ============================================================================
// Exports
// ============================================================================

export default store;