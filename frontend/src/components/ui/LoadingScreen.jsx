"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Loading Screen
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/LoadingScreen.jsx
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Centralized loading experience for TITech applications.
 *
 * Designed for:
 * ----------------------------------------------------------------------------
 * ✓ Application bootstrap
 * ✓ Authentication initialization
 * ✓ Route transitions
 * ✓ Dashboard loading
 * ✓ Offline synchronization
 * ✓ Financial operations
 * ✓ Data hydration
 * ✓ Lazy-loaded modules
 * ✓ Background initialization
 *
 * Features:
 * ----------------------------------------------------------------------------
 * ✓ Accessible loading state
 * ✓ Screen-reader support
 * ✓ Full-screen / inline modes
 * ✓ Configurable message
 * ✓ Progress support
 * ✓ Indeterminate progress
 * ✓ Error state support
 * ✓ Retry action
 * ✓ Cancel action
 * ✓ Minimum display duration
 * ✓ Brand-safe TITech identity
 * ✓ React 18 compatible
 * ✓ Ref forwarding
 * ✓ Reduced-motion friendly
 * ✓ Custom className support
 *
 * Security:
 * ----------------------------------------------------------------------------
 * This component does not expose tokens, financial information, internal
 * errors, stack traces, or sensitive operational details to end users.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MESSAGE =
  "Loading...";

const DEFAULT_SUBMESSAGE =
  "Please wait while TITech prepares your experience.";

const DEFAULT_MIN_DISPLAY_TIME = 250;

const PROGRESS_MIN = 0;
const PROGRESS_MAX = 100;

// ============================================================================
// Helpers
// ============================================================================

function clampProgress(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }

  return Math.min(
    PROGRESS_MAX,
    Math.max(
      PROGRESS_MIN,
      numericValue
    )
  );
}

function normalizeMessage(
  value,
  fallback
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  const normalized =
    value.trim();

  return normalized || fallback;
}

// ============================================================================
// Component
// ============================================================================

const LoadingScreen =
  forwardRef(
    (
      {
        loading = true,

        message =
          DEFAULT_MESSAGE,

        subMessage =
          DEFAULT_SUBMESSAGE,

        progress = null,

        progressLabel,

        indeterminate = true,

        fullScreen = true,

        overlay = false,

        transparent = false,

        size = "md",

        showBrand = true,

        showSpinner = true,

        showProgress = false,

        showRetry = false,

        showCancel = false,

        error = null,

        errorMessage,

        retryLabel =
          "Try again",

        cancelLabel =
          "Cancel",

        onRetry,

        onCancel,

        minDisplayTime =
          DEFAULT_MIN_DISPLAY_TIME,

        className = "",

        contentClassName = "",

        spinnerClassName = "",

        role = "status",

        ariaLabel,

        children,
      },
      ref
    ) => {
      // ======================================================================
      // Internal State
      // ======================================================================

      const mountedRef =
        useRef(false);

      const startedAtRef =
        useRef(Date.now());

      const [
        visible,
        setVisible,
      ] = useState(loading);

      // ======================================================================
      // Lifecycle
      // ======================================================================

      useEffect(() => {
        mountedRef.current =
          true;

        startedAtRef.current =
          Date.now();

        if (loading) {
          setVisible(true);
        }

        return () => {
          mountedRef.current =
            false;
        };
      }, [loading]);

      useEffect(() => {
        if (loading) {
          setVisible(true);

          startedAtRef.current =
            Date.now();

          return undefined;
        }

        const elapsed =
          Date.now() -
          startedAtRef.current;

        const remaining =
          Math.max(
            0,
            Number(
              minDisplayTime
            ) - elapsed
          );

        const timer =
          setTimeout(() => {
            if (
              mountedRef.current
            ) {
              setVisible(false);
            }
          }, remaining);

        return () =>
          clearTimeout(timer);
      }, [
        loading,
        minDisplayTime,
      ]);

      // ======================================================================
      // Derived State
      // ======================================================================

      const normalizedMessage =
        normalizeMessage(
          message,
          DEFAULT_MESSAGE
        );

      const normalizedSubMessage =
        normalizeMessage(
          subMessage,
          DEFAULT_SUBMESSAGE
        );

      const normalizedProgress =
        clampProgress(
          progress
        );

      const hasError =
        Boolean(error);

      const effectiveProgressLabel =
        progressLabel ||
        (
          normalizedProgress !==
          null
            ? `${Math.round(
                normalizedProgress
              )}%`
            : "Loading"
        );

      const spinnerSize =
        size === "sm"
          ? 20
          : size === "lg"
          ? 42
          : 30;

      // ======================================================================
      // Do Not Render
      // ======================================================================

      if (
        !visible &&
        !loading
      ) {
        return null;
      }

      // ======================================================================
      // CSS Classes
      // ======================================================================

      const rootClasses = [
        "tt-loading-screen",

        fullScreen
          ? "tt-loading-screen-fullscreen"
          : "tt-loading-screen-inline",

        overlay
          ? "tt-loading-screen-overlay"
          : "",

        transparent
          ? "tt-loading-screen-transparent"
          : "",

        hasError
          ? "tt-loading-screen-error"
          : "",

        `tt-loading-screen-${size}`,

        className,
      ]
        .filter(Boolean)
        .join(" ");

      const contentClasses = [
        "tt-loading-content",
        contentClassName,
      ]
        .filter(Boolean)
        .join(" ");

      // ======================================================================
      // Render
      // ======================================================================

      return (
        <div
          ref={ref}
          className={rootClasses}
          role={
            hasError
              ? "alert"
              : role
          }
          aria-live="polite"
          aria-busy={
            loading
              ? "true"
              : "false"
          }
          aria-label={
            ariaLabel ||
            normalizedMessage
          }
        >
          <div
            className={
              contentClasses
            }
          >
            {/* ============================================================= */}
            {/* Brand                                                          */}
            {/* ============================================================= */}

            {showBrand && (
              <div
                className="tt-loading-brand"
                aria-hidden="true"
              >
                <div className="tt-loading-brand-mark">
                  TT
                </div>

                <div className="tt-loading-brand-name">
                  TITech
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* Spinner                                                        */}
            {/* ============================================================= */}

            {showSpinner &&
              !hasError && (
                <div
                  className="tt-loading-spinner-container"
                  aria-hidden="true"
                >
                  <Loader2
                    size={
                      spinnerSize
                    }
                    className={[
                      "tt-loading-spinner",
                      indeterminate
                        ? "tt-loading-spinner-indeterminate"
                        : "",
                      spinnerClassName,
                    ]
                      .filter(
                        Boolean
                      )
                      .join(
                        " "
                      )}
                  />
                </div>
              )}

            {/* ============================================================= */}
            {/* Error Icon                                                     */}
            {/* ============================================================= */}

            {hasError && (
              <div
                className="tt-loading-error-icon"
                aria-hidden="true"
              >
                <AlertCircle
                  size={
                    spinnerSize
                  }
                />
              </div>
            )}

            {/* ============================================================= */}
            {/* Message                                                        */}
            {/* ============================================================= */}

            <div className="tt-loading-message">
              {hasError
                ? normalizeMessage(
                    errorMessage ||
                      (
                        typeof error ===
                        "string"
                          ? error
                          : null
                      ),
                    "Something went wrong while loading."
                  )
                : normalizedMessage}
            </div>

            {/* ============================================================= */}
            {/* Sub-message                                                    */}
            {/* ============================================================= */}

            {normalizedSubMessage &&
              !hasError && (
                <div className="tt-loading-submessage">
                  {
                    normalizedSubMessage
                  }
                </div>
              )}

            {/* ============================================================= */}
            {/* Progress                                                        */}
            {/* ============================================================= */}

            {showProgress &&
              !hasError && (
                <div
                  className="tt-loading-progress"
                  role="progressbar"
                  aria-valuemin={
                    PROGRESS_MIN
                  }
                  aria-valuemax={
                    PROGRESS_MAX
                  }
                  aria-valuenow={
                    normalizedProgress !==
                    null
                      ? normalizedProgress
                      : undefined
                  }
                  aria-valuetext={
                    effectiveProgressLabel
                  }
                >
                  <div className="tt-loading-progress-track">
                    <div
                      className={[
                        "tt-loading-progress-bar",
                        normalizedProgress ===
                        null
                          ? "tt-loading-progress-indeterminate"
                          : "",
                      ]
                        .filter(
                          Boolean
                        )
                        .join(
                          " "
                        )}
                      style={
                        normalizedProgress !==
                        null
                          ? {
                              width: `${normalizedProgress}%`,
                            }
                          : undefined
                      }
                    />
                  </div>

                  <div className="tt-loading-progress-label">
                    {
                      effectiveProgressLabel
                    }
                  </div>
                </div>
              )}

            {/* ============================================================= */}
            {/* Custom Content                                                  */}
            {/* ============================================================= */}

            {children && (
              <div className="tt-loading-custom-content">
                {children}
              </div>
            )}

            {/* ============================================================= */}
            {/* Actions                                                         */}
            {/* ============================================================= */}

            {(showRetry ||
              showCancel) && (
              <div className="tt-loading-actions">
                {showRetry && (
                  <button
                    type="button"
                    className="tt-loading-retry"
                    onClick={
                      onRetry
                    }
                    disabled={
                      typeof onRetry !==
                      "function"
                    }
                  >
                    <RefreshCw
                      size={16}
                      aria-hidden="true"
                    />

                    <span>
                      {
                        retryLabel
                      }
                    </span>
                  </button>
                )}

                {showCancel && (
                  <button
                    type="button"
                    className="tt-loading-cancel"
                    onClick={
                      onCancel
                    }
                    disabled={
                      typeof onCancel !==
                      "function"
                    }
                    aria-label={
                      cancelLabel
                    }
                  >
                    <X
                      size={16}
                      aria-hidden="true"
                    />

                    <span>
                      {
                        cancelLabel
                      }
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
  );

LoadingScreen.displayName =
  "TITechLoadingScreen";

// ============================================================================
// PropTypes
// ============================================================================

LoadingScreen.propTypes = {
  /**
   * Controls whether the loading screen is visible.
   */
  loading:
    PropTypes.bool,

  /**
   * Primary loading message.
   */
  message:
    PropTypes.string,

  /**
   * Secondary explanatory message.
   */
  subMessage:
    PropTypes.string,

  /**
   * Progress percentage from 0 to 100.
   */
  progress:
    PropTypes.number,

  /**
   * Accessible/custom progress label.
   */
  progressLabel:
    PropTypes.string,

  /**
   * Whether an indeterminate spinner is used.
   */
  indeterminate:
    PropTypes.bool,

  /**
   * Full viewport mode.
   */
  fullScreen:
    PropTypes.bool,

  /**
   * Overlay mode.
   */
  overlay:
    PropTypes.bool,

  /**
   * Transparent background.
   */
  transparent:
    PropTypes.bool,

  /**
   * Component size.
   */
  size: PropTypes.oneOf([
    "sm",
    "md",
    "lg",
  ]),

  /**
   * Display TITech branding.
   */
  showBrand:
    PropTypes.bool,

  /**
   * Display loading spinner.
   */
  showSpinner:
    PropTypes.bool,

  /**
   * Display progress bar.
   */
  showProgress:
    PropTypes.bool,

  /**
   * Display retry action.
   */
  showRetry:
    PropTypes.bool,

  /**
   * Display cancel action.
   */
  showCancel:
    PropTypes.bool,

  /**
   * Error value.
   */
  error:
    PropTypes.oneOfType([
      PropTypes.bool,
      PropTypes.string,
      PropTypes.object,
    ]),

  /**
   * Safe user-facing error message.
   */
  errorMessage:
    PropTypes.string,

  /**
   * Retry button label.
   */
  retryLabel:
    PropTypes.string,

  /**
   * Cancel button label.
   */
  cancelLabel:
    PropTypes.string,

  /**
   * Retry callback.
   */
  onRetry:
    PropTypes.func,

  /**
   * Cancel callback.
   */
  onCancel:
    PropTypes.func,

  /**
   * Minimum display duration in milliseconds.
   */
  minDisplayTime:
    PropTypes.number,

  /**
   * Additional root class.
   */
  className:
    PropTypes.string,

  /**
   * Additional content class.
   */
  contentClassName:
    PropTypes.string,

  /**
   * Additional spinner class.
   */
  spinnerClassName:
    PropTypes.string,

  /**
   * ARIA role.
   */
  role:
    PropTypes.string,

  /**
   * Accessible label.
   */
  ariaLabel:
    PropTypes.string,

  /**
   * Optional custom content.
   */
  children:
    PropTypes.node,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  LoadingScreen
);