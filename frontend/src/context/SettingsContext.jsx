// ============================================================================
// TITech Community Capital
// Enterprise Settings Context
//
// File:
// frontend/src/context/SettingsContext.jsx
//
// Production Grade
// Domain Context | Redux Toolkit Compatible
// Defensive Loading | Retry | Refresh
// StrictMode Safe | Unmount Safe
// Stable Selectors | Error Isolation
//
// IMPORTANT ARCHITECTURAL MODEL
//
// React Context:
//   - Exposes the settings domain API to UI components.
//   - Does NOT expose Redux dispatch directly.
//
// State Layer:
//   - Owns settings persistence/state transitions.
//
// API Layer:
//   - Owns HTTP communication.
//
// Backend:
//   - Remains authoritative for server-controlled settings.
//
// ============================================================================

"use strict";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import PropTypes from "prop-types";

import { useDispatch, useSelector } from "react-redux";

import { toast } from "react-toastify";

import {
  fetchSettings,
  refreshSettings,
} from "../state/settings/settingsOperations";

// ============================================================================
// Context
// ============================================================================

const SettingsContext =
  createContext(undefined);

// ============================================================================
// Constants
// ============================================================================

const EMPTY_SETTINGS = Object.freeze({});

// ============================================================================
// Selectors
// ============================================================================
//
// Keep state-shape knowledge inside the settings domain.
//
// This makes SettingsContext independent from the exact Redux store shape
// and makes future migration easier.
//

const selectSettingsState = state =>
  state?.settings ?? {};

const selectSettingsData = state =>
  selectSettingsState(
    state
  )?.data ?? EMPTY_SETTINGS;

const selectSettingsLoading = state =>
  Boolean(
    selectSettingsState(
      state
    )?.loading
  );

const selectSettingsError = state =>
  selectSettingsState(
    state
  )?.error ?? null;

const selectSettingsLoaded = state =>
  Boolean(
    selectSettingsState(
      state
    )?.loaded
  );

// ============================================================================
// Provider
// ============================================================================

export function SettingsProvider({
  children,
}) {
  // ========================================================================
  // Redux
  // ========================================================================

  const dispatch =
    useDispatch();

  // ========================================================================
  // State
  // ========================================================================

  const settings =
    useSelector(
      selectSettingsData
    );

  const loading =
    useSelector(
      selectSettingsLoading
    );

  const error =
    useSelector(
      selectSettingsError
    );

  const loaded =
    useSelector(
      selectSettingsLoaded
    );

  // ========================================================================
  // Lifecycle
  // ========================================================================

  const mountedRef =
    useRef(false);

  const initialLoadStartedRef =
    useRef(false);

  // ========================================================================
  // Mounted Helper
  // ========================================================================

  const isMounted =
    useCallback(
      () =>
        mountedRef.current,
      []
    );

  // ========================================================================
  // Fetch Settings
  // ========================================================================
  //
  // This is the public domain operation.
  //
  // Consumers should not need to know that Redux is underneath.
  // ========================================================================

  const loadSettings =
    useCallback(
      async ({
        force = false,
        notify = false,
      } = {}) => {
        if (
          !isMounted()
        ) {
          return null;
        }

        try {
          const result =
            await dispatch(
              fetchSettings({
                force,
              })
            );

          if (
            notify &&
            isMounted()
          ) {
            toast.success(
              "Settings updated successfully."
            );
          }

          return result;
        } catch (fetchError) {
          if (
            notify &&
            isMounted()
          ) {
            toast.error(
              "Failed to load application settings."
            );
          }

          throw fetchError;
        }
      },
      [
        dispatch,
        isMounted,
      ]
    );

  // ========================================================================
  // Refresh Settings
  // ========================================================================

  const refresh =
    useCallback(
      async ({
        notify = true,
      } = {}) => {
        if (
          !isMounted()
        ) {
          return null;
        }

        try {
          /**
           * Prefer the explicit refresh operation when available.
           *
           * This allows the state layer to force server synchronization
           * without duplicating fetch semantics inside the context.
           */
          const result =
            await dispatch(
              refreshSettings()
            );

          if (
            notify &&
            isMounted()
          ) {
            toast.success(
              "Settings refreshed successfully."
            );
          }

          return result;
        } catch (refreshError) {
          if (
            notify &&
            isMounted()
          ) {
            toast.error(
              "Failed to refresh application settings."
            );
          }

          throw refreshError;
        }
      },
      [
        dispatch,
        isMounted,
      ]
    );

  // ========================================================================
  // Initial Settings Bootstrap
  // ========================================================================
  //
  // The explicit ref prevents duplicate initial fetches caused by React
  // StrictMode development re-execution.
  //
  // The loaded flag remains the authoritative state-layer indication that
  // settings have already been successfully retrieved.
  // ========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;
    };
  }, []);

  useEffect(() => {
    if (
      initialLoadStartedRef.current
    ) {
      return;
    }

    if (
      loaded ||
      loading
    ) {
      return;
    }

    initialLoadStartedRef.current =
      true;

    loadSettings({
      force: false,
      notify: false,
    }).catch(error => {
      /**
       * The error is already represented by the settings state.
       *
       * Avoid automatically displaying a toast here because settings are
       * application infrastructure and a toast on every mount can become
       * noisy, particularly during development StrictMode execution.
       */
      if (
        import.meta.env.DEV
      ) {
        console.warn(
          "[SETTINGS] Initial settings load failed.",
          error
        );
      }
    });
  }, [
    loadSettings,
    loaded,
    loading,
  ]);

  // ========================================================================
  // Context Value
  // ========================================================================

  const contextValue =
    useMemo(
      () => ({
        // --------------------------------------------------------------
        // Data
        // --------------------------------------------------------------

        settings,

        // --------------------------------------------------------------
        // State
        // --------------------------------------------------------------

        loading,

        loaded,

        error,

        // --------------------------------------------------------------
        // Derived state
        // --------------------------------------------------------------

        ready:
          loaded &&
          !loading,

        hasSettings:
          Object.keys(
            settings
          ).length > 0,

        // --------------------------------------------------------------
        // Operations
        // --------------------------------------------------------------

        refresh,

        reload:
          refresh,
      }),
      [
        settings,
        loading,
        loaded,
        error,
        refresh,
      ]
    );

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <SettingsContext.Provider
      value={contextValue}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

SettingsProvider.propTypes = {
  children:
    PropTypes.node.isRequired,
};

// ============================================================================
// Hook
// ============================================================================

export function useSettings() {
  const context =
    useContext(
      SettingsContext
    );

  if (
    context === undefined
  ) {
    throw new Error(
      "useSettings must be used within <SettingsProvider>."
    );
  }

  return context;
}

// ============================================================================
// Export
// ============================================================================

export default SettingsContext;