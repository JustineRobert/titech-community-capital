// ============================================================================
// TITech Community Capital
// Enterprise Root Reducer
//
// File:
// frontend/src/redux/reducers/rootReducer.js
//
// Production Grade
//
// Centralized State Composition
// Domain-Oriented Reducers
// Defensive Reducer Registration
// Redux Migration Friendly
//
// IMPORTANT
// ============================================================================
//
// This file is responsible ONLY for composing domain reducers.
//
// It must NOT:
//
//   - perform API requests
//   - access localStorage/sessionStorage
//   - manage JWTs
//   - perform authentication
//   - contain business logic
//   - display notifications
//   - contain side effects
//
// Domain operations belong in:
//   frontend/src/state/<domain>/
//
// Transport belongs in:
//   frontend/src/services/api.js
//
// ============================================================================

"use strict";

import {
  combineReducers,
} from "redux";

import {
  settingsReducer,
} from "./settingsReducer";

// ============================================================================
// Domain Reducers
// ============================================================================
//
// Keep this registry explicit.
//
// Each key becomes part of the public Redux state contract:
//
//   state.settings
//
// Avoid dynamically discovering reducers. Explicit registration makes the
// application state topology deterministic and easier to audit.
//

const domainReducers =
  Object.freeze({
    settings:
      settingsReducer,

    // Future domains:
    //
    // auth: authReducer,
    // users: usersReducer,
    // groups: groupsReducer,
    // savings: savingsReducer,
    // contributions: contributionsReducer,
    // wallets: walletReducer,
    // transactions: transactionsReducer,
    // loans: loansReducer,
    // notifications: notificationsReducer,
    // audit: auditReducer,
  });

// ============================================================================
// Root Reducer
// ============================================================================

const rootReducer =
  combineReducers(
    domainReducers
  );

// ============================================================================
// Development Validation
// ============================================================================
//
// Redux itself validates reducer behavior when combineReducers is created.
// This additional check is intentionally lightweight and development-only.
//

if (
  import.meta.env.DEV
) {
  const reducerEntries =
    Object.entries(
      domainReducers
    );

  for (
    const [
      key,
      reducer,
    ] of reducerEntries
  ) {
    if (
      typeof reducer !==
      "function"
    ) {
      console.error(
        `[STATE] Invalid reducer registered for "${key}". ` +
          "Expected a reducer function."
      );
    }
  }
}

// ============================================================================
// Export
// ============================================================================

export default rootReducer;