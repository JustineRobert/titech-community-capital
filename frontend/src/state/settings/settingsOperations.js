// ============================================================================
// TITech Community Capital
// Enterprise Settings Operations
//
// File:
// frontend/src/state/settings/settingsOperations.js
//
// Production Grade
//
// Centralized API | Redux-Compatible
// Memory-Only JWT | HttpOnly Refresh Cookie
// Multi-Tenant | Retry Delegation
// Offline Awareness | Error Normalization
// Request Correlation | Force Refresh
//
// IMPORTANT
// ============================================================================
//
// DO NOT:
//
//   - create another Axios instance
//   - read JWT from localStorage
//   - read JWT from sessionStorage
//   - construct Authorization headers here
//   - manage refresh tokens here
//   - display toast notifications here
//   - put UI concerns into state operations
//
// Authentication and transport are delegated to:
//
//   frontend/src/services/api.js
//
// This module owns only settings-domain state transitions.
//
// ============================================================================

"use strict";

import {
  get as apiGet,
  put as apiPut,
  getTenant,
} from "../../services/api";

// ============================================================================
// Constants
// ============================================================================

const SETTINGS_ENDPOINT =
  "/api/settings";

const SETTINGS_ACTIONS = Object.freeze({
  FETCH_REQUEST:
    "settings/fetchRequest",

  FETCH_SUCCESS:
    "settings/fetchSuccess",

  FETCH_FAILURE:
    "settings/fetchFailure",

  UPDATE_REQUEST:
    "settings/updateRequest",

  UPDATE_SUCCESS:
    "settings/updateSuccess",

  UPDATE_FAILURE:
    "settings/updateFailure",
});

// ============================================================================
// Environment
// ============================================================================

const IS_DEV =
  Boolean(import.meta.env.DEV);

// ============================================================================
// Safe Development Logging
// ============================================================================

function devLog(
  level,
  message,
  metadata
) {
  if (!IS_DEV) {
    return;
  }

  try {
    const logger =
      console[level] ||
      console.info;

    if (
      metadata !== undefined
    ) {
      logger(
        message,
        metadata
      );
    } else {
      logger(message);
    }
  } catch {
    // Logging must never affect application state.
  }
}

// ============================================================================
// Request ID
// ============================================================================
//
// A request identifier allows logs/traces to correlate a settings operation
// without putting sensitive information into the client state.
//
// The API layer may independently generate its own request ID as well.
//

function createRequestId(
  operation
) {
  try {
    if (
      typeof crypto !==
        "undefined" &&
      typeof crypto.randomUUID ===
        "function"
    ) {
      return `settings-${operation}-${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to timestamp/random fallback.
  }

  return [
    "settings",
    operation,
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
}

// ============================================================================
// Error Normalization
// ============================================================================
//
// Keep Redux state serializable.
//
// Never store the complete Axios error object in Redux.
//

function normalizeError(
  error,
  fallbackMessage
) {
  const status =
    error?.response?.status ??
    error?.status ??
    error?.statusCode ??
    null;

  const backendMessage =
    error?.response?.data?.message;

  const message =
    typeof backendMessage ===
      "string" &&
    backendMessage.trim()
      ? backendMessage.trim()
      : typeof error?.message ===
          "string" &&
        error.message.trim()
      ? error.message.trim()
      : fallbackMessage;

  return {
    message,
    status,
    code:
      error?.code ??
      null,
  };
}

// ============================================================================
// Response Normalization
// ============================================================================
//
// Backend responses can evolve while the Redux state remains stable.
//
// Supported examples:
//
//   { settings: {...} }
//   { data: {...} }
//   { data: { settings: {...} } }
//   {...settings}
//
// ============================================================================

function normalizeSettingsResponse(
  response
) {
  if (
    !response
  ) {
    return {};
  }

  if (
    response?.settings &&
    typeof response.settings ===
      "object"
  ) {
    return response.settings;
  }

  if (
    response?.data?.settings &&
    typeof response.data.settings ===
      "object"
  ) {
    return response.data.settings;
  }

  if (
    response?.data &&
    typeof response.data ===
      "object" &&
    !Array.isArray(
      response.data
    )
  ) {
    return response.data;
  }

  if (
    typeof response ===
      "object" &&
    !Array.isArray(
      response
    )
  ) {
    return response;
  }

  return {};
}

// ============================================================================
// Tenant Context
// ============================================================================
//
// The backend remains authoritative for tenant authorization.
//
// This value is supplied only as contextual metadata to the centralized API
// layer when supported by that layer.
//
// Do NOT treat this client-side value as authorization.
//

function getCurrentTenantContext() {
  try {
    return getTenant() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Fetch Settings
// ============================================================================
//
// Usage:
//
//   dispatch(
//     fetchSettings()
//   );
//
// Force refresh:
//
//   dispatch(
//     fetchSettings({
//       force: true,
//     })
//   );
//
// The returned Promise resolves to normalized settings and rejects on error,
// allowing:
//
//   await dispatch(fetchSettings());
//
// ============================================================================

export const fetchSettings =
  ({
    force = false,
  } = {}) =>
  async dispatch => {
    const requestId =
      createRequestId(
        "fetch"
      );

    const tenantId =
      getCurrentTenantContext();

    dispatch({
      type:
        SETTINGS_ACTIONS.FETCH_REQUEST,

      meta: {
        requestId,
        tenantId,
        force: Boolean(force),
      },
    });

    try {
      const response =
        await apiGet(
          SETTINGS_ENDPOINT,
          {
            params: {
              ...(force
                ? {
                    refresh:
                      "true",
                  }
                : {}),
            },

            meta: {
              requestId,
              tenantId,
              operation:
                "settings.fetch",
            },
          }
        );

      const settings =
        normalizeSettingsResponse(
          response
        );

      dispatch({
        type:
          SETTINGS_ACTIONS.FETCH_SUCCESS,

        payload:
          settings,

        meta: {
          requestId,
          tenantId,
          force: Boolean(force),
        },
      });

      devLog(
        "debug",
        "[SETTINGS] Settings fetched",
        {
          requestId,
          tenantId,
          force: Boolean(force),
        }
      );

      return settings;
    } catch (error) {
      const normalizedError =
        normalizeError(
          error,
          "Failed to fetch application settings."
        );

      dispatch({
        type:
          SETTINGS_ACTIONS.FETCH_FAILURE,

        payload:
          normalizedError,

        error: true,

        meta: {
          requestId,
          tenantId,
          force: Boolean(force),
        },
      });

      devLog(
        "warn",
        "[SETTINGS] Settings fetch failed",
        {
          requestId,
          tenantId,
          status:
            normalizedError.status,
          code:
            normalizedError.code,
        }
      );

      throw error;
    }
  };

// ============================================================================
// Refresh Settings
// ============================================================================
//
// Explicit semantic alias for callers that want to communicate:
//
//   "Synchronize settings with the backend now."
//
// ============================================================================

export const refreshSettings =
  () =>
  async dispatch => {
    return dispatch(
      fetchSettings({
        force: true,
      })
    );
  };

// ============================================================================
// Update Settings
// ============================================================================
//
// IMPORTANT:
//
// Updating application settings can be security-sensitive depending on what
// the backend permits.
//
// The backend MUST enforce:
//
//   - authentication
//   - authorization
//   - tenant membership
//   - role/permission checks
//   - validation
//   - audit logging
//   - optimistic concurrency where appropriate
//
// The frontend MUST NOT attempt to enforce these rules itself.
//
// ============================================================================

export const updateSettings =
  settings =>
  async dispatch => {
    const requestId =
      createRequestId(
        "update"
      );

    const tenantId =
      getCurrentTenantContext();

    if (
      !settings ||
      typeof settings !==
        "object" ||
      Array.isArray(
        settings
      )
    ) {
      const error =
        new Error(
          "Settings payload must be a valid object."
        );

      const normalizedError =
        normalizeError(
          error,
          "Invalid settings payload."
        );

      dispatch({
        type:
          SETTINGS_ACTIONS.UPDATE_FAILURE,

        payload:
          normalizedError,

        error: true,

        meta: {
          requestId,
          tenantId,
        },
      });

      throw error;
    }

    dispatch({
      type:
        SETTINGS_ACTIONS.UPDATE_REQUEST,

      meta: {
        requestId,
        tenantId,
      },
    });

    try {
      const response =
        await apiPut(
          SETTINGS_ENDPOINT,
          settings,
          {
            meta: {
              requestId,
              tenantId,
              operation:
                "settings.update",
            },
          }
        );

      const updatedSettings =
        normalizeSettingsResponse(
          response
        );

      dispatch({
        type:
          SETTINGS_ACTIONS.UPDATE_SUCCESS,

        payload:
          updatedSettings,

        meta: {
          requestId,
          tenantId,
        },
      });

      devLog(
        "info",
        "[SETTINGS] Settings updated",
        {
          requestId,
          tenantId,
        }
      );

      return updatedSettings;
    } catch (error) {
      const normalizedError =
        normalizeError(
          error,
          "Failed to update application settings."
        );

      dispatch({
        type:
          SETTINGS_ACTIONS.UPDATE_FAILURE,

        payload:
          normalizedError,

        error: true,

        meta: {
          requestId,
          tenantId,
        },
      });

      devLog(
        "warn",
        "[SETTINGS] Settings update failed",
        {
          requestId,
          tenantId,
          status:
            normalizedError.status,
          code:
            normalizedError.code,
        }
      );

      throw error;
    }
  };

// ============================================================================
// Public Action Constants
// ============================================================================
//
// Keeping these exported makes reducer implementation explicit while
// avoiding magic strings throughout the state layer.
//

export const SETTINGS_ACTION_TYPES =
  Object.freeze({
    ...SETTINGS_ACTIONS,
  });

// ============================================================================
// Default Export
// ============================================================================

export default {
  fetchSettings,
  refreshSettings,
  updateSettings,
};