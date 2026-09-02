// ============================================================================
// TITech Community Capital
// Enterprise Modal Component
// File: frontend/src/components/ui/Modal.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";

import PropTypes from "prop-types";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const MODAL_SIZES = {
  xs: "tt-modal-xs",
  sm: "tt-modal-sm",
  md: "tt-modal-md",
  lg: "tt-modal-lg",
  xl: "tt-modal-xl",
  "2xl": "tt-modal-2xl",
  full: "tt-modal-full",
};

const MODAL_VARIANTS = {
  default: "tt-modal-default",
  info: "tt-modal-info",
  success: "tt-modal-success",
  warning: "tt-modal-warning",
  danger: "tt-modal-danger",
};

const VARIANT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const DEFAULT_TITLE = "Dialog";

// ============================================================================
// Environment Helpers
// ============================================================================

function canUseDOM() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined"
  );
}

// ============================================================================
// Focus Helpers
// ============================================================================

function getFocusableElements(container) {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll(
      [
        "a[href]",
        "area[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "iframe",
        "object",
        "embed",
        "[contenteditable='true']",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",")
    )
  ).filter((element) => {
    const style = window.getComputedStyle(element);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getAttribute("aria-hidden") !== "true"
    );
  });
}

// ============================================================================
// Component
// ============================================================================

const Modal = forwardRef(
  (
    {
      open = false,
      onClose,
      children,
      title,
      description,
      size = "md",
      variant = "default",
      closeOnOverlayClick = true,
      closeOnEscape = true,
      showCloseButton = true,
      closeButtonLabel = "Close dialog",
      preventBodyScroll = true,
      restoreFocus = true,
      trapFocus = true,
      initialFocusRef,
      footer,
      loading = false,
      loadingText = "Please wait...",
      destructive = false,
      className = "",
      overlayClassName = "",
      contentClassName = "",
      headerClassName = "",
      bodyClassName = "",
      footerClassName = "",
      role = "dialog",
      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,
      portalTarget,
      zIndex = 1000,
      onOpen,
      onAfterClose,
      "data-testid": dataTestId,
      ...props
    },
    forwardedRef
  ) => {
    const generatedId = useId();

    const modalId = `tt-modal-${generatedId}`;

    const titleId =
      ariaLabelledBy ||
      (title
        ? `${modalId}-title`
        : undefined);

    const descriptionId =
      ariaDescribedBy ||
      (description
        ? `${modalId}-description`
        : undefined);

    const modalRef = useRef(null);
    const previousActiveElementRef =
      useRef(null);

    const setModalRef = useCallback(
      (node) => {
        modalRef.current = node;

        if (
          typeof forwardedRef ===
          "function"
        ) {
          forwardedRef(node);
        } else if (
          forwardedRef
        ) {
          forwardedRef.current =
            node;
        }
      },
      [forwardedRef]
    );

    // ========================================================================
    // Open / Close Lifecycle
    // ========================================================================

    useEffect(() => {
      if (!canUseDOM() || !open) {
        return undefined;
      }

      previousActiveElementRef.current =
        document.activeElement;

      if (typeof onOpen === "function") {
        onOpen();
      }

      return undefined;
    }, [open, onOpen]);

    // ========================================================================
    // Body Scroll Lock
    // ========================================================================

    useEffect(() => {
      if (
        !canUseDOM() ||
        !open ||
        !preventBodyScroll
      ) {
        return undefined;
      }

      const body = document.body;

      const previousOverflow =
        body.style.overflow;

      const previousPaddingRight =
        body.style.paddingRight;

      const scrollbarWidth =
        window.innerWidth -
        document.documentElement
          .clientWidth;

      body.style.overflow = "hidden";

      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`;
      }

      return () => {
        body.style.overflow =
          previousOverflow;

        body.style.paddingRight =
          previousPaddingRight;
      };
    }, [
      open,
      preventBodyScroll,
    ]);

    // ========================================================================
    // Focus Management + Keyboard Handling
    // ========================================================================

    useEffect(() => {
      if (
        !canUseDOM() ||
        !open
      ) {
        return undefined;
      }

      const handleKeyDown = (
        event
      ) => {
        if (
          event.key === "Escape"
        ) {
          if (
            closeOnEscape &&
            !loading &&
            typeof onClose ===
              "function"
          ) {
            event.preventDefault();
            event.stopPropagation();

            onClose({
              reason: "escape",
            });
          }

          return;
        }

        if (
          event.key !== "Tab" ||
          !trapFocus
        ) {
          return;
        }

        const modal =
          modalRef.current;

        if (!modal) {
          return;
        }

        const focusable =
          getFocusableElements(
            modal
          );

        if (
          focusable.length === 0
        ) {
          event.preventDefault();
          modal.focus();
          return;
        }

        const first =
          focusable[0];

        const last =
          focusable[
            focusable.length - 1
          ];

        if (
          event.shiftKey &&
          document.activeElement ===
            first
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement ===
            last
        ) {
          event.preventDefault();
          first.focus();
        }
      };

      document.addEventListener(
        "keydown",
        handleKeyDown,
        true
      );

      const focusTimer =
        window.setTimeout(() => {
          const target =
            initialFocusRef?.current;

          if (
            target &&
            typeof target.focus ===
              "function"
          ) {
            target.focus();
            return;
          }

          const modal =
            modalRef.current;

          if (!modal) {
            return;
          }

          const focusable =
            getFocusableElements(
              modal
            );

          if (
            focusable.length > 0
          ) {
            focusable[0].focus();
          } else {
            modal.focus();
          }
        }, 0);

      return () => {
        window.clearTimeout(
          focusTimer
        );

        document.removeEventListener(
          "keydown",
          handleKeyDown,
          true
        );
      };
    }, [
      open,
      closeOnEscape,
      loading,
      onClose,
      trapFocus,
      initialFocusRef,
    ]);

    // ========================================================================
    // Restore Focus
    // ========================================================================

    useEffect(() => {
      if (
        canUseDOM() &&
        !open &&
        restoreFocus
      ) {
        const previous =
          previousActiveElementRef.current;

        if (
          previous &&
          typeof previous.focus ===
            "function" &&
          document.contains(previous)
        ) {
          const timer =
            window.setTimeout(
              () => {
                previous.focus();
              },
              0
            );

          return () => {
            window.clearTimeout(
              timer
            );
          };
        }
      }

      return undefined;
    }, [
      open,
      restoreFocus,
    ]);

    // ========================================================================
    // After Close
    // ========================================================================

    useEffect(() => {
      if (
        !canUseDOM() ||
        open ||
        typeof onAfterClose !==
          "function"
      ) {
        return undefined;
      }

      onAfterClose();

      return undefined;
    }, [
      open,
      onAfterClose,
    ]);

    // ========================================================================
    // Overlay Handler
    // ========================================================================

    const handleOverlayClick =
      useCallback(
        (event) => {
          if (
            event.target !==
            event.currentTarget
          ) {
            return;
          }

          if (
            !closeOnOverlayClick ||
            loading
          ) {
            return;
          }

          if (
            typeof onClose ===
            "function"
          ) {
            onClose({
              reason: "overlay",
            });
          }
        },
        [
          closeOnOverlayClick,
          loading,
          onClose,
        ]
      );

    // ========================================================================
    // Close Handler
    // ========================================================================

    const handleClose =
      useCallback(() => {
        if (loading) {
          return;
        }

        if (
          typeof onClose ===
          "function"
        ) {
          onClose({
            reason: "close-button",
          });
        }
      }, [
        loading,
        onClose,
      ]);

    // ========================================================================
    // SSR / Portal Resolution
    // ========================================================================

    if (
      !open ||
      !canUseDOM()
    ) {
      return null;
    }

    const target =
      portalTarget ||
      document.body;

    if (!target) {
      return null;
    }

    // ========================================================================
    // Classes
    // ========================================================================

    const modalClasses = [
      "tt-modal",
      MODAL_SIZES[size] ||
        MODAL_SIZES.md,
      MODAL_VARIANTS[
        variant
      ] ||
        MODAL_VARIANTS.default,
      destructive
        ? "tt-modal-destructive"
        : "",
      loading
        ? "tt-modal-loading"
        : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const overlayClasses = [
      "tt-modal-overlay",
      overlayClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const headerClasses = [
      "tt-modal-header",
      headerClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const bodyClasses = [
      "tt-modal-body",
      bodyClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const footerClasses = [
      "tt-modal-footer",
      footerClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const VariantIcon =
      VARIANT_ICONS[
        variant
      ];

    // ========================================================================
    // Render
    // ========================================================================

    return createPortal(
      <div
        className={overlayClasses}
        role="presentation"
        onMouseDown={
          handleOverlayClick
        }
        style={{
          zIndex,
        }}
        data-testid={
          dataTestId
            ? `${dataTestId}-overlay`
            : undefined
        }
      >
        <div
          {...props}
          ref={setModalRef}
          id={modalId}
          className={modalClasses}
          role={role}
          aria-modal="true"
          aria-label={
            ariaLabel ||
            (!title
              ? DEFAULT_TITLE
              : undefined)
          }
          aria-labelledby={
            titleId
          }
          aria-describedby={
            descriptionId
          }
          tabIndex={-1}
          data-testid={
            dataTestId
          }
          onMouseDown={(event) =>
            event.stopPropagation()
          }
        >
          {(title ||
            description ||
            showCloseButton) && (
            <header
              className={
                headerClasses
              }
            >
              <div className="tt-modal-heading">
                {VariantIcon &&
                  variant !==
                    "default" && (
                    <span
                      className="tt-modal-variant-icon"
                      aria-hidden="true"
                    >
                      <VariantIcon
                        size={20}
                      />
                    </span>
                  )}

                <div className="tt-modal-title-group">
                  {title && (
                    <h2
                      id={
                        titleId
                      }
                      className="tt-modal-title"
                    >
                      {title}
                    </h2>
                  )}

                  {description && (
                    <p
                      id={
                        descriptionId
                      }
                      className="tt-modal-description"
                    >
                      {
                        description
                      }
                    </p>
                  )}
                </div>
              </div>

              {showCloseButton && (
                <button
                  type="button"
                  className="tt-modal-close"
                  onClick={
                    handleClose
                  }
                  disabled={
                    loading
                  }
                  aria-label={
                    closeButtonLabel
                  }
                  title={
                    closeButtonLabel
                  }
                >
                  <X
                    size={20}
                    aria-hidden="true"
                  />
                </button>
              )}
            </header>
          )}

          <div
            className={
              bodyClasses
            }
          >
            {loading && (
              <div
                className="tt-modal-loading-indicator"
                aria-live="polite"
                aria-label={
                  loadingText
                }
              >
                <Loader2
                  size={20}
                  className="tt-modal-spinner"
                  aria-hidden="true"
                />

                <span>
                  {
                    loadingText
                  }
                </span>
              </div>
            )}

            <div
              className={
                loading
                  ? "tt-modal-content tt-modal-content-disabled"
                  : "tt-modal-content"
              }
              aria-hidden={
                loading
                  ? "true"
                  : undefined
              }
            >
              {children}
            </div>
          </div>

          {footer && (
            <footer
              className={
                footerClasses
              }
            >
              {footer}
            </footer>
          )}
        </div>
      </div>,
      target
    );
  }
);

Modal.displayName =
  "Modal";

// ============================================================================
// Prop Types
// ============================================================================

Modal.propTypes = {
  open:
    PropTypes.bool,

  onClose:
    PropTypes.func,

  children:
    PropTypes.node,

  title:
    PropTypes.node,

  description:
    PropTypes.node,

  size:
    PropTypes.oneOf(
      Object.keys(
        MODAL_SIZES
      )
    ),

  variant:
    PropTypes.oneOf(
      Object.keys(
        MODAL_VARIANTS
      )
    ),

  closeOnOverlayClick:
    PropTypes.bool,

  closeOnEscape:
    PropTypes.bool,

  showCloseButton:
    PropTypes.bool,

  closeButtonLabel:
    PropTypes.string,

  preventBodyScroll:
    PropTypes.bool,

  restoreFocus:
    PropTypes.bool,

  trapFocus:
    PropTypes.bool,

  initialFocusRef:
    PropTypes.shape({
      current:
        PropTypes.instanceOf(
          typeof Element !==
            "undefined"
            ? Element
            : Object
        ),
    }),

  footer:
    PropTypes.node,

  loading:
    PropTypes.bool,

  loadingText:
    PropTypes.string,

  destructive:
    PropTypes.bool,

  className:
    PropTypes.string,

  overlayClassName:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  headerClassName:
    PropTypes.string,

  bodyClassName:
    PropTypes.string,

  footerClassName:
    PropTypes.string,

  role:
    PropTypes.oneOf([
      "dialog",
      "alertdialog",
    ]),

  ariaLabel:
    PropTypes.string,

  ariaLabelledBy:
    PropTypes.string,

  ariaDescribedBy:
    PropTypes.string,

  portalTarget:
    PropTypes.instanceOf(
      typeof Element !==
        "undefined"
        ? Element
        : Object
    ),

  zIndex:
    PropTypes.number,

  onOpen:
    PropTypes.func,

  onAfterClose:
    PropTypes.func,

  "data-testid":
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export {
  MODAL_SIZES,
  MODAL_VARIANTS,
};

export default memo(
  Modal
);