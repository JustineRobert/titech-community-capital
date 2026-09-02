// ============================================================================
// TITech Community Capital
// Enterprise Settings Actions / Operations
//
// File:
// frontend/src/redux/actions/settingsActions.js
//
// Production Grade
//
// Centralized API | Secure JWT Handling
// HttpOnly Refresh Cookie Compatible
// Multi-Tenant | Offline Aware
// Error Normalization | Request Correlation
// Redux Thunk Compatible | UI-Agnostic
//
// IMPORTANT SECURITY MODEL
// ============================================================================
//
// DO NOT:
//
//   - Create an Axios instance here.
//   - Read JWT from localStorage.
//   - Read JWT from sessionStorage.
//   - Construct Authorization headers here.
//   - Access refresh tokens here.
//   - Display toast notifications here.
//
// Authentication and HTTP transport are owned by:
//
//   frontend/src/services/api.js
//
// This module owns SETTINGS DOMAIN OPERATIONS only.
//
// ============================================================================

"use strict";

import {
  get as apiGet,
  put as apiPut,
  getTenant,
} from "../../services/api";

// ============================================================================
// Configuration
// ============================================================================

const SETTINGS_ENDPOINT =
  "/api/settings";

const IS_DEV =
  Boolean(import.meta.env.DEV);

// ============================================================================
// Action Types
// ============================================================================
//
// Keep these compatible with the existing reducer during migration.
//
// ============================================================================

export const SETTINGS_ACTION_TYPES =
  Object.freeze({
    FETCH_REQUEST:
      "FETCH_SETTINGS_REQUEST",

    FETCH_SUCCESS:
      "FETCH_SETTINGS_SUCCESS",

    FETCH_FAILURE:
      "FETCH_SETTINGS_FAILURE",

    UPDATE_REQUEST:
      "UPDATE_SETTINGS_REQUEST",

    UPDATE_SUCCESS:
      "UPDATE_SETTINGS_SUCCESS",

    UPDATE_FAILURE:
      "UPDATE_SETTINGS_FAILURE",
  });

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
    // Logging must never affect application execution.
  }
}

// ============================================================================
// Request ID
// ============================================================================
//
// Request IDs are diagnostic identifiers only.
//
// Never place access tokens, passwords, refresh tokens, or sensitive user data
// into request metadata.
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
      return [
        "settings",
        operation,
        crypto.randomUUID(),
      ].join("-");
    }
  } catch {
    // Fall through.
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
// Tenant Context
// ============================================================================
//
// Tenant ID is contextual metadata only.
//
// Backend authorization remains authoritative.
//
// ============================================================================

function getCurrentTenantId() {
  try {
    return getTenant() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Error Normalization
// ============================================================================
//
// Redux state should contain serializable error information rather than a
// complete Axios/network error object.
//
// ============================================================================

function normalizeError(
  error,
  fallbackMessage
) {
  const responseData =
    error?.response?.data;

  const status =
    error?.response?.status ??
    error?.status ??
    error?.statusCode ??
    null;

  const code =
    error?.code ??
    null;

  const backendMessage =
    responseData?.message;

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
    code,
  };
}

// ============================================================================
// Settings Response Normalization
// ============================================================================
//
// Supports common backend response envelopes:
//
//   { settings: {...} }
//   { data: {...} }
//   { data: { settings: {...} } }
//   { ...settings }
//
// The Redux state receives a predictable settings object.
//

function normalizeSettingsResponse(
  response
) {
  if (
    !response
  ) {
    return {};
  }

  if (
    response.settings &&
    typeof response.settings ===
      "object" &&
    !Array.isArray(
      response.settings
    )
  ) {
    return response.settings;
  }

  if (
    response.data?.settings &&
    typeof response.data.settings ===
      "object" &&
    !Array.isArray(
      response.data.settings
    )
  ) {
    return response.data.settings;
  }

  if (
    response.data &&
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
// Payload Validation
// ============================================================================

function validateSettingsPayload(
  settings
) {
  if (
    settings === null ||
    typeof settings !==
      "object" ||
    Array.isArray(
      settings
    )
  ) {
    throw new TypeError(
      "Settings payload must be a valid object."
    );
  }

  return settings;
}

// ============================================================================
// FETCH SETTINGS
// ============================================================================
//
// Fetches application/tenant settings through the centralized API client.
//
// Usage:
//
//   dispatch(fetchSettings());
//
// Force server refresh:
//
//   dispatch(
//     fetchSettings({
//       force: true,
//     })
//   );
//
// The thunk resolves to the normalized settings object.
//

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
      getCurrentTenantId();

    dispatch({
      type:
        SETTINGS_ACTION_TYPES.FETCH_REQUEST,

      meta: {
        requestId,
        tenantId,
        force: Boolean(force),
      },
    });

    try {
      // --------------------------------------------------------------
      // IMPORTANT:
      //
      // apiGet owns:
      //
      //   - access-token handling
      //   - refresh behavior
      //   - retry behavior
      //   - offline handling
      //   - observability
      //   - request configuration
      //
      // This module does not duplicate any of those responsibilities.
      // --------------------------------------------------------------

      const response =
        await apiGet(
          SETTINGS_ENDPOINT
        );

      const settings =
        normalizeSettingsResponse(
          response
        );

      dispatch({
        type:
          SETTINGS_ACTION_TYPES.FETCH_SUCCESS,

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
        "[SETTINGS] Settings fetch succeeded",
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
          SETTINGS_ACTION_TYPES.FETCH_FAILURE,

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

      // --------------------------------------------------------------
      // IMPORTANT:
      //
      // Re-throw so callers can use:
      //
      //   await dispatch(fetchSettings());
      //
      // and handle failures themselves.
      //
      // The old implementation swallowed the error.
      // --------------------------------------------------------------

      throw error;
    }
  };

// ============================================================================
// REFRESH SETTINGS
// ============================================================================
//
// Semantic alias for explicitly synchronizing settings with the backend.
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
// UPDATE SETTINGS
// ============================================================================
//
// Updates application settings.
//
// Backend MUST enforce:
//
//   - authentication
//   - authorization
//   - tenant membership
//   - role/permission checks
//   - schema validation
//   - audit logging
//   - concurrency rules where applicable
//
// The frontend must never be considered the authorization boundary.
//

export const updateSettings =
  settings =>
  async dispatch => {
    const requestId =
      createRequestId(
        "update"
      );

    const tenantId =
      getCurrentTenantId();

    // --------------------------------------------------------------
    // Validate before dispatching the network operation.
    // --------------------------------------------------------------

    try {
      validateSettingsPayload(
        settings
      );
    } catch (error) {
      const normalizedError =
        normalizeError(
          error,
          "Invalid settings payload."
        );

      dispatch({
        type:
          SETTINGS_ACTION_TYPES.UPDATE_FAILURE,

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
        SETTINGS_ACTION_TYPES.UPDATE_REQUEST,

      meta: {
        requestId,
        tenantId,
      },
    });

    try {
      const response =
        await apiPut(
          SETTINGS_ENDPOINT,
          settings
        );

      const updatedSettings =
        normalizeSettingsResponse(
          response
        );

      dispatch({
        type:
          SETTINGS_ACTION_TYPES.UPDATE_SUCCESS,

        payload:
          updatedSettings,

        meta: {
          requestId,
          tenantId,
        },
      });

      devLog(
        "info",
        "[SETTINGS] Settings update succeeded",
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
          SETTINGS_ACTION_TYPES.UPDATE_FAILURE,

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
// Default Export
// ============================================================================

export default {
  fetchSettings,
  refreshSettings,
  updateSettings,
};