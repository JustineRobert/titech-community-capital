// ============================================================================
// TITech Community Capital
// Enterprise Settings Reducer
//
// File:
// frontend/src/redux/reducers/settingsReducer.js
//
// Production Grade
//
// Domain State | Serializable State
// Fetch/Update Separation
// Request Correlation | Stale Response Protection
// Loading | Updating | Loaded
// Timestamp Tracking | Defensive Payload Handling
//
// IMPORTANT
// ============================================================================
//
// This reducer MUST remain pure.
//
// It must NOT:
//
//   - call APIs
//   - access localStorage/sessionStorage
//   - access cookies
//   - display toast notifications
//   - perform navigation
//   - mutate external state
//
// API operations belong in:
//   frontend/src/redux/actions/settingsActions.js
//
// HTTP transport belongs in:
//   frontend/src/services/api.js
//
// ============================================================================

"use strict";

// ============================================================================
// Initial Settings
// ============================================================================

const DEFAULT_SETTINGS =
  Object.freeze({
    siteName: "",
    enableContributions: false,
    defaultUserRole: "user",
  });

// ============================================================================
// Initial State
// ============================================================================

const initialState = {
  // --------------------------------------------------------------------------
  // Settings data
  // --------------------------------------------------------------------------

  data: {
    ...DEFAULT_SETTINGS,
  },

  // --------------------------------------------------------------------------
  // Fetch state
  // --------------------------------------------------------------------------

  loading: false,

  loaded: false,

  error: null,

  // --------------------------------------------------------------------------
  // Update state
  // --------------------------------------------------------------------------

  updating: false,

  updateError: null,

  // --------------------------------------------------------------------------
  // Synchronization metadata
  // --------------------------------------------------------------------------

  lastFetchedAt: null,

  lastUpdatedAt: null,

  // --------------------------------------------------------------------------
  // Request correlation
  // --------------------------------------------------------------------------

  requestId: null,

  updateRequestId: null,
};

// ============================================================================
// Helpers
// ============================================================================

function normalizePayload(
  payload
) {
  if (
    !payload ||
    typeof payload !==
      "object" ||
    Array.isArray(
      payload
    )
  ) {
    return {};
  }

  return payload;
}

// ============================================================================
// Reducer
// ============================================================================

export const settingsReducer = (
  state = initialState,
  action = {}
) => {
  switch (
    action.type
  ) {
    // ========================================================================
    // FETCH
    // ========================================================================

    case "FETCH_SETTINGS_REQUEST": {
      return {
        ...state,

        loading: true,

        error: null,

        requestId:
          action.meta?.requestId ??
          null,
      };
    }

    // ------------------------------------------------------------------------
    // FETCH SUCCESS
    // ------------------------------------------------------------------------

    case "FETCH_SETTINGS_SUCCESS": {
      const requestId =
        action.meta?.requestId ??
        null;

      /**
       * Ignore an older response if a newer fetch request is already active.
       *
       * This protects the settings state from race conditions such as:
       *
       * Request A ────────────────┐
       *                            ▼
       * Request B ────────┐    A completes late
       *                    ▼
       *                  B completes first
       *
       * Without request correlation, A could overwrite B.
       */

      if (
        state.requestId &&
        requestId &&
        state.requestId !==
          requestId
      ) {
        return state;
      }

      return {
        ...state,

        loading: false,

        loaded: true,

        data: {
          ...state.data,
          ...normalizePayload(
            action.payload
          ),
        },

        error: null,

        lastFetchedAt:
          Date.now(),

        requestId,
      };
    }

    // ------------------------------------------------------------------------
    // FETCH FAILURE
    // ------------------------------------------------------------------------

    case "FETCH_SETTINGS_FAILURE": {
      const requestId =
        action.meta?.requestId ??
        null;

      if (
        state.requestId &&
        requestId &&
        state.requestId !==
          requestId
      ) {
        return state;
      }

      return {
        ...state,

        loading: false,

        error:
          action.payload ?? {
            message:
              "Failed to fetch application settings.",
            status: null,
            code: null,
          },

        requestId,
      };
    }

    // ========================================================================
    // UPDATE
    // ========================================================================

    case "UPDATE_SETTINGS_REQUEST": {
      return {
        ...state,

        updating: true,

        updateError: null,

        updateRequestId:
          action.meta?.requestId ??
          null,
      };
    }

    // ------------------------------------------------------------------------
    // UPDATE SUCCESS
    // ------------------------------------------------------------------------

    case "UPDATE_SETTINGS_SUCCESS": {
      const requestId =
        action.meta?.requestId ??
        null;

      /**
       * Ignore stale update responses.
       */

      if (
        state.updateRequestId &&
        requestId &&
        state.updateRequestId !==
          requestId
      ) {
        return state;
      }

      return {
        ...state,

        updating: false,

        data: {
          ...state.data,
          ...normalizePayload(
            action.payload
          ),
        },

        updateError: null,

        lastUpdatedAt:
          Date.now(),

        updateRequestId:
          requestId,
      };
    }

    // ------------------------------------------------------------------------
    // UPDATE FAILURE
    // ------------------------------------------------------------------------

    case "UPDATE_SETTINGS_FAILURE": {
      const requestId =
        action.meta?.requestId ??
        null;

      if (
        state.updateRequestId &&
        requestId &&
        state.updateRequestId !==
          requestId
      ) {
        return state;
      }

      return {
        ...state,

        updating: false,

        updateError:
          action.payload ?? {
            message:
              "Failed to update application settings.",
            status: null,
            code: null,
          },

        updateRequestId:
          requestId,
      };
    }

    // ========================================================================
    // LOCAL SETTINGS OVERRIDE
    // ========================================================================
    //
    // Intended for controlled client-side state changes only.
    //
    // This does NOT imply the backend has accepted or persisted the change.
    //
    // Do not use this as an authorization mechanism.
    //
    // ========================================================================

    case "SET_SETTINGS": {
      return {
        ...state,

        data: {
          ...state.data,
          ...normalizePayload(
            action.payload
          ),
        },
      };
    }

    // ========================================================================
    // CLEAR SETTINGS
    // ========================================================================
    //
    // Useful during logout, tenant switching, session invalidation, or
    // application reset.
    //
    // ========================================================================

    case "CLEAR_SETTINGS": {
      return {
        ...initialState,

        data: {
          ...DEFAULT_SETTINGS,
        },
      };
    }

    // ========================================================================
    // RESET SETTINGS ERROR
    // ========================================================================

    case "CLEAR_SETTINGS_ERROR": {
      return {
        ...state,

        error: null,

        updateError: null,
      };
    }

    // ========================================================================
    // DEFAULT
    // ========================================================================

    default:
      return state;
  }
};

// ============================================================================
// Initial State Export
// ============================================================================
//
// Useful for tests and store initialization.
//

export { initialState as settingsInitialState };

export default settingsReducer;