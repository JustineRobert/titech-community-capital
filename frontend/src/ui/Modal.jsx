// ============================================================================
// TITech Community Capital
// Enterprise Modal Component
// File: src/components/ui/Modal.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useEffect,
  useRef,
} from "react";

import ReactDOM from "react-dom";
import PropTypes from "prop-types";

import {
  X,
  Loader2,
} from "lucide-react";

// ============================================================================
// Helpers
// ============================================================================

function getPortalRoot() {
  let root =
    document.getElementById(
      "modal-root"
    );

  if (!root) {
    root =
      document.createElement(
        "div"
      );

    root.id =
      "modal-root";

    document.body.appendChild(
      root
    );
  }

  return root;
}

// ============================================================================
// Component
// ============================================================================

function Modal({
  open = false,
  title,
  subtitle,
  children,
  size = "md",
  loading = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  destroyOnClose = false,
  footer,
  className = "",
  onClose,
  onOpened,
  onClosed,
}) {
  const modalRef =
    useRef(null);

  const previousFocus =
    useRef(null);

  // ===========================================================================
  // Focus Management
  // ===========================================================================

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocus.current =
      document.activeElement;

    modalRef.current?.focus();

    onOpened?.();

    return () => {
      previousFocus.current?.focus?.();
      onClosed?.();
    };
  }, [
    open,
    onOpened,
    onClosed,
  ]);

  // ===========================================================================
  // Escape Handler
  // ===========================================================================

  useEffect(() => {
    if (
      !open ||
      !closeOnEscape
    ) {
      return undefined;
    }

    const handler = (
      event
    ) => {
      if (
        event.key ===
        "Escape"
      ) {
        onClose?.();
      }
    };

    document.addEventListener(
      "keydown",
      handler
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handler
      );
    };
  }, [
    open,
    closeOnEscape,
    onClose,
  ]);

  // ===========================================================================
  // Early Return
  // ===========================================================================

  if (
    !open &&
    destroyOnClose
  ) {
    return null;
  }

  const sizeClass = {
    xs: "tt-modal-xs",
    sm: "tt-modal-sm",
    md: "tt-modal-md",
    lg: "tt-modal-lg",
    xl: "tt-modal-xl",
    full: "tt-modal-full",
  }[size];

  const content =
    open ? (
      <div className="tt-modal-overlay">
        <div
          className="tt-modal-backdrop"
          onClick={() => {
            if (
              closeOnBackdrop
            ) {
              onClose?.();
            }
          }}
        />

        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={`tt-modal ${sizeClass} ${className}`}
        >
          {(title ||
            subtitle ||
            showCloseButton) && (
            <div className="tt-modal-header">
              <div className="tt-modal-header-content">
                {title && (
                  <h2 className="tt-modal-title">
                    {title}
                  </h2>
                )}

                {subtitle && (
                  <p className="tt-modal-subtitle">
                    {
                      subtitle
                    }
                  </p>
                )}
              </div>

              {showCloseButton && (
                <button
                  type="button"
                  className="tt-modal-close"
                  onClick={
                    onClose
                  }
                  aria-label="Close modal"
                >
                  <X
                    size={20}
                  />
                </button>
              )}
            </div>
          )}

          <div className="tt-modal-body">
            {loading ? (
              <div className="tt-modal-loading">
                <Loader2
                  size={32}
                  className="tt-modal-spinner"
                />

                <span>
                  Loading...
                </span>
              </div>
            ) : (
              children
            )}
          </div>

          {footer && (
            <div className="tt-modal-footer">
              {footer}
            </div>
          )}
        </div>
      </div>
    ) : null;

  return ReactDOM.createPortal(
    content,
    getPortalRoot()
  );
}

// ============================================================================
// PropTypes
// ============================================================================

Modal.propTypes = {
  open:
    PropTypes.bool,

  title:
    PropTypes.node,

  subtitle:
    PropTypes.node,

  children:
    PropTypes.node,

  size:
    PropTypes.oneOf([
      "xs",
      "sm",
      "md",
      "lg",
      "xl",
      "full",
    ]),

  loading:
    PropTypes.bool,

  closeOnBackdrop:
    PropTypes.bool,

  closeOnEscape:
    PropTypes.bool,

  showCloseButton:
    PropTypes.bool,

  destroyOnClose:
    PropTypes.bool,

  footer:
    PropTypes.node,

  className:
    PropTypes.string,

  onClose:
    PropTypes.func,

  onOpened:
    PropTypes.func,

  onClosed:
    PropTypes.func,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  Modal
);