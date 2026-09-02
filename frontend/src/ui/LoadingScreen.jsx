// ============================================================================
// TITech Community Capital
// Enterprise Loading Screen Component
// File: src/components/ui/LoadingScreen.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
} from "react";

import PropTypes from "prop-types";

import {
  Loader2,
} from "lucide-react";

// ============================================================================
// Component
// ============================================================================

function LoadingScreen({
  message = "Loading...",
  subMessage,
  fullScreen = true,
  size = "md",
  variant = "spinner",
  logo,
  overlay = false,
  className = "",
}) {
  const containerClass = [
    "tt-loading-screen",
    fullScreen
      ? "tt-loading-fullscreen"
      : "",
    overlay
      ? "tt-loading-overlay"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const spinnerSize =
    {
      sm: 28,
      md: 40,
      lg: 56,
      xl: 72,
    }[size] || 40;

  return (
    <div
      className={
        containerClass
      }
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="tt-loading-content">
        {/* -------------------------------------------------------------- */}
        {/* Logo */}
        {/* -------------------------------------------------------------- */}

        {logo && (
          <div className="tt-loading-logo">
            {logo}
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Loader */}
        {/* -------------------------------------------------------------- */}

        {variant ===
        "spinner" ? (
          <Loader2
            size={
              spinnerSize
            }
            className="tt-loading-spinner"
          />
        ) : (
          <div className="tt-loading-dots">
            <span />
            <span />
            <span />
          </div>
        )}

        {/* -------------------------------------------------------------- */}
        {/* Text */}
        {/* -------------------------------------------------------------- */}

        <h3 className="tt-loading-message">
          {message}
        </h3>

        {subMessage && (
          <p className="tt-loading-submessage">
            {
              subMessage
            }
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

LoadingScreen.propTypes =
  {
    message:
      PropTypes.node,

    subMessage:
      PropTypes.node,

    fullScreen:
      PropTypes.bool,

    size:
      PropTypes.oneOf([
        "sm",
        "md",
        "lg",
        "xl",
      ]),

    variant:
      PropTypes.oneOf([
        "spinner",
        "dots",
      ]),

    logo:
      PropTypes.node,

    overlay:
      PropTypes.bool,

    className:
      PropTypes.string,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  LoadingScreen
);