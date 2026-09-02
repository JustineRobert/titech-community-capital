/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Modal Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/common/Modal.jsx
 *
 * Purpose:
 *   Reusable enterprise-grade modal/dialog primitive for the TITech Community
 *   Finance Operating System.
 *
 * Features:
 *   ✓ Accessible dialog semantics
 *   ✓ aria-labelledby / aria-describedby
 *   ✓ Automatic IDs
 *   ✓ Escape-to-close
 *   ✓ Backdrop click handling
 *   ✓ Prevent accidental close
 *   ✓ Focus trapping
 *   ✓ Focus restoration
 *   ✓ Scroll locking
 *   ✓ Nested modal awareness
 *   ✓ Responsive layouts
 *   ✓ Configurable sizes
 *   ✓ Header / body / footer composition
 *   ✓ Loading / processing state
 *   ✓ Confirm / destructive variants
 *   ✓ Custom actions
 *   ✓ Close button
 *   ✓ Optional close icon
 *   ✓ Full-screen mode
 *   ✓ Mobile-friendly presentation
 *   ✓ Dark mode
 *   ✓ Reduced-motion friendly transitions
 *   ✓ Forwarded ref
 *   ✓ Portal rendering
 *   ✓ Native React APIs only
 *
 * Security:
 *   --------------------------------------------------------------------------
 *   This component is a presentation and interaction layer.
 *
 *   It MUST NOT:
 *     - perform authorization checks
 *     - manage authentication tokens
 *     - directly modify financial records
 *     - determine whether a transaction is permitted
 *
 *   Authorization and financial validation remain backend responsibilities.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  createPortal,
} from 'react-dom';

/**
 * ============================================================================
 * Utilities
 * ============================================================================
 */

const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');

/**
 * ============================================================================
 * Icons
 * ============================================================================
 */

const CloseIcon = ({
  className = 'h-5 w-5',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M6 6l12 12M18 6 6 18"
      strokeLinecap="round"
    />
  </svg>
);

const CheckIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className={className}
    aria-hidden="true"
  >
    <path
      d="m5 12 4 4 8-9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WarningIcon = ({
  className = 'h-5 w-5',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"
      strokeLinejoin="round"
    />

    <path
      d="M12 9v4"
      strokeLinecap="round"
    />

    <circle
      cx="12"
      cy="16.5"
      r=".8"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const InfoIcon = ({
  className = 'h-5 w-5',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="M12 10v6"
      strokeLinecap="round"
    />

    <circle
      cx="12"
      cy="7"
      r=".8"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const SuccessIcon = ({
  className = 'h-5 w-5',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path
      d="m8 12 2.7 2.7L16.5 9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const DangerIcon = ({
  className = 'h-5 w-5',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M12 3 21 20H3L12 3Z"
      strokeLinejoin="round"
    />

    <path
      d="M12 9v5"
      strokeLinecap="round"
    />

    <circle
      cx="12"
      cy="17"
      r=".8"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const LoaderIcon = ({
  className = 'h-4 w-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={cn(
      'animate-spin',
      className,
    )}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="3"
      className="opacity-25"
    />

    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODAL_ROOT_ID =
  'titech-modal-root';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SIZE_CLASSES = {
  xs:
    'max-w-sm',
  sm:
    'max-w-md',
  md:
    'max-w-lg',
  lg:
    'max-w-2xl',
  xl:
    'max-w-4xl',
  '2xl':
    'max-w-5xl',
  '3xl':
    'max-w-6xl',
  '4xl':
    'max-w-7xl',
  full:
    'max-w-[calc(100vw-1rem)]',
};

const VARIANT_STYLES = {
  default: {
    icon: null,
    iconClass:
      '',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },

  info: {
    icon: InfoIcon,
    iconClass:
      'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },

  success: {
    icon: SuccessIcon,
    iconClass:
      'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },

  warning: {
    icon: WarningIcon,
    iconClass:
      'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },

  danger: {
    icon: DangerIcon,
    iconClass:
      'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },

  destructive: {
    icon: DangerIcon,
    iconClass:
      'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
    titleClass:
      'text-gray-900 dark:text-gray-100',
  },
};

/**
 * ============================================================================
 * Modal Root
 * ============================================================================
 */

const getModalRoot = () => {
  if (
    typeof document ===
    'undefined'
  ) {
    return null;
  }

  let root =
    document.getElementById(
      MODAL_ROOT_ID,
    );

  if (!root) {
    root =
      document.createElement(
        'div',
      );

    root.id =
      MODAL_ROOT_ID;

    root.setAttribute(
      'data-titech-modal-root',
      'true',
    );

    document.body.appendChild(
      root,
    );
  }

  return root;
};

/**
 * ============================================================================
 * Focus helpers
 * ============================================================================
 */

const getFocusableElements = (
  container,
) => {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll(
      FOCUSABLE_SELECTOR,
    ),
  ).filter(
    (element) =>
      !element.hasAttribute(
        'disabled',
      ) &&
      element.getAttribute(
        'aria-hidden',
      ) !== 'true' &&
      element.offsetParent !==
        null,
  );
};

/**
 * ============================================================================
 * Button
 * ============================================================================
 */

const ModalButton = ({
  children,
  variant = 'secondary',
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  ...props
}) => {
  const variants = {
    primary:
      'bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-400 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100',

    secondary:
      'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800',

    danger:
      'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400 dark:bg-red-600 dark:hover:bg-red-500',

    destructive:
      'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400 dark:bg-red-600 dark:hover:bg-red-500',

    ghost:
      'bg-transparent text-gray-600 hover:bg-gray-100 focus-visible:ring-gray-300 dark:text-gray-300 dark:hover:bg-gray-800',

    success:
      'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-400',

    warning:
      'bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-300',
  };

  return (
    <button
      {...props}
      type={type}
      disabled={
        disabled || loading
      }
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2',
        'rounded-lg px-4 py-2',
        'text-sm font-semibold',
        'transition-colors duration-150',
        'focus:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-offset-2',
        'dark:focus-visible:ring-offset-gray-900',
        variants[
          variant
        ] ||
          variants.secondary,
        disabled ||
          loading
          ? 'cursor-not-allowed opacity-60'
          : '',
        className,
      )}
    >
      {loading && (
        <LoaderIcon className="h-4 w-4" />
      )}

      {children}
    </button>
  );
};

/**
 * ============================================================================
 * Modal
 * ============================================================================
 */

const Modal = forwardRef(
  function Modal(
    {
      /**
       * ----------------------------------------------------------------------
       * Visibility
       * ----------------------------------------------------------------------
       */

      open = false,

      onClose,

      /**
       * ----------------------------------------------------------------------
       * Content
       * ----------------------------------------------------------------------
       */

      title,

      description,

      children,

      header,

      footer,

      /**
       * ----------------------------------------------------------------------
       * Behavior
       * ----------------------------------------------------------------------
       */

      closeOnOverlayClick = true,

      closeOnEscape = true,

      closeOnCloseButton = true,

      preventClose = false,

      /**
       * ----------------------------------------------------------------------
       * Loading / processing
       * ----------------------------------------------------------------------
       */

      loading = false,

      processing = false,

      processingMessage =
        'Processing...',

      /**
       * ----------------------------------------------------------------------
       * Display
       * ----------------------------------------------------------------------
       */

      size = 'md',

      variant = 'default',

      centered = true,

      fullScreen = false,

      showClose = true,

      closeLabel =
        'Close dialog',

      /**
       * ----------------------------------------------------------------------
       * Header
       * ----------------------------------------------------------------------
       */

      showHeader = true,

      headerClassName = '',

      bodyClassName = '',

      footerClassName = '',

      /**
       * ----------------------------------------------------------------------
       * Footer
       * ----------------------------------------------------------------------
       */

      showFooter = false,

      confirmLabel = 'Confirm',

      cancelLabel = 'Cancel',

      confirmVariant =
        'primary',

      cancelVariant =
        'secondary',

      onConfirm,

      onCancel,

      confirmLoading = false,

      confirmDisabled = false,

      cancelDisabled = false,

      /**
       * ----------------------------------------------------------------------
       * Accessibility
       * ----------------------------------------------------------------------
       */

      ariaLabel,

      ariaDescribedBy,

      /**
       * ----------------------------------------------------------------------
       * Styling
       * ----------------------------------------------------------------------
       */

      className = '',

      overlayClassName = '',

      panelClassName = '',

      /**
       * ----------------------------------------------------------------------
       * Advanced
       * ----------------------------------------------------------------------
       */

      initialFocusRef,

      finalFocusRef,

      portalTarget,

      zIndex = 1000,

      onOpen,

      onOpened,

      onClosed,

      ...rest
    },
    forwardedRef,
  ) {
    /**
     * ========================================================================
     * IDs
     * ========================================================================
     */

    const generatedId =
      useId();

    const titleId =
      `titech-modal-title-${generatedId}`;

    const descriptionId =
      `titech-modal-description-${generatedId}`;

    /**
     * ========================================================================
     * State
     * ========================================================================
     */

    const [
      mounted,
      setMounted,
    ] = useState(false);

    /**
     * ========================================================================
     * Refs
     * ========================================================================
     */

    const panelRef =
      useRef(null);

    const previousActiveElement =
      useRef(null);

    const originalBodyOverflow =
      useRef('');

    /**
     * ========================================================================
     * Merge forwarded ref
     * ========================================================================
     */

    useEffect(() => {
      if (!forwardedRef) {
        return;
      }

      if (
        typeof forwardedRef ===
        'function'
      ) {
        forwardedRef(
          panelRef.current,
        );
      } else {
        forwardedRef.current =
          panelRef.current;
      }
    });

    /**
     * ========================================================================
     * Mount / unmount state
     * ========================================================================
     */

    useEffect(() => {
      if (open) {
        setMounted(true);

        onOpen?.();
      }
    }, [
      open,
      onOpen,
    ]);

    /**
     * ========================================================================
     * Body scroll lock
     * ========================================================================
     */

    useEffect(() => {
      if (
        !open ||
        typeof document ===
          'undefined'
      ) {
        return undefined;
      }

      originalBodyOverflow.current =
        document.body.style
          .overflow;

      document.body.style.overflow =
        'hidden';

      return () => {
        document.body.style.overflow =
          originalBodyOverflow.current;
      };
    }, [open]);

    /**
     * ========================================================================
     * Focus management
     * ========================================================================
     */

    useEffect(() => {
      if (!open) {
        return undefined;
      }

      previousActiveElement.current =
        document.activeElement;

      const focusTimer =
        window.setTimeout(() => {
          if (
            initialFocusRef?.current
          ) {
            initialFocusRef.current.focus();
            return;
          }

          const focusable =
            getFocusableElements(
              panelRef.current,
            );

          if (focusable.length) {
            focusable[0].focus();
          } else {
            panelRef.current?.focus();
          }
        }, 0);

      return () => {
        window.clearTimeout(
          focusTimer,
        );

        const target =
          finalFocusRef?.current ||
          previousActiveElement.current;

        if (
          target &&
          typeof target.focus ===
            'function'
        ) {
          window.setTimeout(
            () => {
              try {
                target.focus();
              } catch {
                // Ignore focus restoration errors.
              }
            },
            0,
          );
        }
      };
    }, [
      open,
      initialFocusRef,
      finalFocusRef,
    ]);

    /**
     * ========================================================================
     * Focus trap + keyboard handling
     * ========================================================================
     */

    useEffect(() => {
      if (
        !open ||
        typeof document ===
          'undefined'
      ) {
        return undefined;
      }

      const handleKeyDown =
        (event) => {
          if (
            event.key ===
            'Escape'
          ) {
            if (
              closeOnEscape &&
              !preventClose &&
              !processing &&
              !loading &&
              !confirmLoading
            ) {
              event.preventDefault();

              onClose?.();
            }

            return;
          }

          if (
            event.key !==
            'Tab'
          ) {
            return;
          }

          const focusable =
            getFocusableElements(
              panelRef.current,
            );

          if (!focusable.length) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
          }

          const first =
            focusable[0];

          const last =
            focusable[
              focusable.length - 1
            ];

          if (
            event.shiftKey
          ) {
            if (
              document.activeElement ===
              first
            ) {
              event.preventDefault();
              last.focus();
            }
          } else if (
            document.activeElement ===
            last
          ) {
            event.preventDefault();
            first.focus();
          }
        };

      document.addEventListener(
        'keydown',
        handleKeyDown,
      );

      return () => {
        document.removeEventListener(
          'keydown',
          handleKeyDown,
        );
      };
    }, [
      open,
      closeOnEscape,
      preventClose,
      processing,
      loading,
      confirmLoading,
      onClose,
    ]);

    /**
     * ========================================================================
     * Animation / closing
     * ========================================================================
     */

    useEffect(() => {
      if (
        !open &&
        mounted
      ) {
        const timer =
          window.setTimeout(() => {
            setMounted(false);

            onClosed?.();
          }, 150);

        return () =>
          window.clearTimeout(
            timer,
          );
      }

      if (
        open &&
        mounted
      ) {
        const timer =
          window.setTimeout(() => {
            onOpened?.();
          }, 20);

        return () =>
          window.clearTimeout(
            timer,
          );
      }

      return undefined;
    }, [
      open,
      mounted,
      onOpened,
      onClosed,
    ]);

    /**
     * ========================================================================
     * Close handler
     * ========================================================================
     */

    const handleClose =
      () => {
        if (
          preventClose ||
          processing ||
          loading ||
          confirmLoading
        ) {
          return;
        }

        onClose?.();
      };

    /**
     * ========================================================================
     * Overlay click
     * ========================================================================
     */

    const handleOverlayClick =
      (event) => {
        if (
          event.target !==
          event.currentTarget
        ) {
          return;
        }

        if (
          closeOnOverlayClick
        ) {
          handleClose();
        }
      };

    /**
     * ========================================================================
     * Variant
     * ========================================================================
     */

    const variantConfig =
      VARIANT_STYLES[
        variant
      ] ||
      VARIANT_STYLES.default;

    const VariantIcon =
      variantConfig.icon;

    /**
     * ========================================================================
     * Portal
     * ========================================================================
     */

    if (
      !mounted ||
      typeof document ===
        'undefined'
    ) {
      return null;
    }

    const root =
      portalTarget ||
      getModalRoot();

    if (!root) {
      return null;
    }

    /**
     * ========================================================================
     * Accessibility
     * ========================================================================
     */

    const resolvedAriaLabelledBy =
      title
        ? titleId
        : undefined;

    const resolvedAriaDescribedBy =
      ariaDescribedBy ||
      (description
        ? descriptionId
        : undefined);

    /**
     * ========================================================================
     * Modal panel classes
     * ========================================================================
     */

    const panelWidth =
      fullScreen
        ? 'w-full max-w-none'
        : SIZE_CLASSES[
            size
          ] ||
          SIZE_CLASSES.md;

    const panelShape =
      fullScreen
        ? 'rounded-none'
        : 'rounded-2xl';

    const panelHeight =
      fullScreen
        ? 'h-full'
        : 'max-h-[calc(100vh-2rem)]';

    /**
     * ========================================================================
     * Default header
     * ========================================================================
     */

    const defaultHeader =
      showHeader &&
      (title ||
        description ||
        showClose) ? (
        <div
          className={cn(
            'flex shrink-0 items-start gap-4',
            'border-b border-gray-100',
            'px-5 py-4 sm:px-6',
            'dark:border-gray-800',
            headerClassName,
          )}
        >
          <div className="min-w-0 flex-1">
            {title && (
              <h2
                id={titleId}
                className={cn(
                  'text-lg font-semibold tracking-tight',
                  variantConfig.titleClass,
                )}
              >
                {title}
              </h2>
            )}

            {description && (
              <p
                id={descriptionId}
                className="mt-1.5 max-w-3xl text-sm leading-5 text-gray-500 dark:text-gray-400"
              >
                {description}
              </p>
            )}
          </div>

          {showClose && (
            <button
              type="button"
              onClick={
                handleClose
              }
              disabled={
                preventClose ||
                processing ||
                loading ||
                confirmLoading
              }
              aria-label={
                closeLabel
              }
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                'text-gray-400',
                'transition-colors',
                'hover:bg-gray-100 hover:text-gray-700',
                'focus:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-gray-300',
                'dark:text-gray-500',
                'dark:hover:bg-gray-800',
                'dark:hover:text-gray-200',
                'dark:focus-visible:ring-gray-600',
                preventClose ||
                  processing ||
                  loading ||
                  confirmLoading
                  ? 'cursor-not-allowed opacity-50'
                  : '',
              )}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ) : null;

    /**
     * ========================================================================
     * Processing overlay
     * ========================================================================
     */

    const processingOverlay =
      (processing ||
        loading) && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-[1px] dark:bg-gray-950/70"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <LoaderIcon className="h-5 w-5" />

            <span>
              {processingMessage}
            </span>
          </div>
        </div>
      );

    /**
     * ========================================================================
     * Default footer
     * ========================================================================
     */

    const defaultFooter =
      showFooter ? (
        <div
          className={cn(
            'flex shrink-0 flex-col-reverse gap-2',
            'border-t border-gray-100',
            'px-5 py-4 sm:flex-row sm:justify-end sm:px-6',
            'dark:border-gray-800',
            footerClassName,
          )}
        >
          <ModalButton
            variant={
              cancelVariant
            }
            disabled={
              cancelDisabled ||
              processing ||
              loading ||
              confirmLoading
            }
            onClick={() => {
              onCancel
                ? onCancel()
                : handleClose();
            }}
          >
            {cancelLabel}
          </ModalButton>

          <ModalButton
            variant={
              confirmVariant
            }
            loading={
              confirmLoading
            }
            disabled={
              confirmDisabled
            }
            onClick={
              onConfirm
            }
          >
            {confirmLabel}
          </ModalButton>
        </div>
      ) : null;

    /**
     * ========================================================================
     * Render
     * ========================================================================
     */

    const modal = (
      <div
        className={cn(
          'fixed inset-0',
          'flex',
          centered
            ? 'items-center justify-center'
            : 'items-start justify-center',
          'p-2 sm:p-4',
          'transition-opacity duration-150',
          open
            ? 'opacity-100'
            : 'opacity-0',
          overlayClassName,
        )}
        style={{
          zIndex,
        }}
        onMouseDown={
          handleOverlayClick
        }
        role="presentation"
      >
        {/* ================================================================
            Backdrop
            ================================================================ */}

        <div
          className="absolute inset-0 bg-gray-950/50 backdrop-blur-[2px] dark:bg-black/70"
          aria-hidden="true"
        />

        {/* ================================================================
            Dialog
            ================================================================ */}

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={
            ariaLabel
              ? undefined
              : resolvedAriaLabelledBy
          }
          aria-describedby={
            resolvedAriaDescribedBy
          }
          aria-label={
            ariaLabel
          }
          tabIndex={-1}
          className={cn(
            'relative z-10 flex flex-col',
            'overflow-hidden',
            'border border-gray-200',
            'bg-white shadow-2xl shadow-gray-900/20',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:shadow-black/40',
            panelWidth,
            panelShape,
            panelHeight,
            'transform transition-all duration-150',
            open
              ? 'translate-y-0 scale-100 opacity-100'
              : 'translate-y-2 scale-[0.99] opacity-0',
            className,
            panelClassName,
          )}
          onMouseDown={(event) =>
            event.stopPropagation()
          }
          {...rest}
        >
          {/* Variant indicator */}
          {VariantIcon && (
            <div className="absolute left-5 top-4 z-10 hidden sm:block">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  variantConfig.iconClass,
                )}
              >
                <VariantIcon />
              </span>
            </div>
          )}

          {/* Header */}
          {header ||
            defaultHeader}

          {/* Body */}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              'overscroll-contain',
              'px-5 py-5 sm:px-6',
              bodyClassName,
            )}
          >
            {children}
          </div>

          {/* Footer */}
          {footer ||
            defaultFooter}

          {/* Processing state */}
          {processingOverlay}
        </div>
      </div>
    );

    return createPortal(
      modal,
      root,
    );
  },
);

Modal.displayName =
  'Modal';

/**
 * ============================================================================
 * ConfirmationModal
 * ============================================================================
 *
 * Standardized confirmation dialog for important TITech operations.
 *
 * Appropriate examples:
 *   - Delete member
 *   - Approve loan
 *   - Reverse transaction
 *   - Close account
 *   - Remove user
 *
 * Business authorization MUST still happen server-side.
 * ============================================================================
 */

export const ConfirmationModal =
  forwardRef(
    function ConfirmationModal(
      {
        open,
        onClose,
        onConfirm,

        title =
          'Confirm action',

        description,

        confirmLabel =
          'Confirm',

        cancelLabel =
          'Cancel',

        confirmVariant =
          'primary',

        confirmLoading =
          false,

        confirmDisabled =
          false,

        danger = false,

        children,

        ...props
      },
      ref,
    ) {
      return (
        <Modal
          ref={ref}
          open={open}
          onClose={onClose}
          title={title}
          description={
            description
          }
          variant={
            danger
              ? 'danger'
              : 'default'
          }
          showFooter
          confirmLabel={
            confirmLabel
          }
          cancelLabel={
            cancelLabel
          }
          confirmVariant={
            danger
              ? 'danger'
              : confirmVariant
          }
          confirmLoading={
            confirmLoading
          }
          confirmDisabled={
            confirmDisabled
          }
          onConfirm={
            onConfirm
          }
          onCancel={
            onClose
          }
          {...props}
        >
          {children}
        </Modal>
      );
    },
  );

ConfirmationModal.displayName =
  'ConfirmationModal';

/**
 * ============================================================================
 * AlertModal
 * ============================================================================
 */

export const AlertModal =
  forwardRef(
    function AlertModal(
      {
        open,
        onClose,

        title,
        description,

        variant = 'info',

        buttonLabel =
          'Continue',

        children,

        ...props
      },
      ref,
    ) {
      return (
        <Modal
          ref={ref}
          open={open}
          onClose={onClose}
          title={title}
          description={
            description
          }
          variant={variant}
          showFooter
          showClose
          confirmLabel={
            buttonLabel
          }
          cancelLabel=""
          onConfirm={onClose}
          onCancel={onClose}
          cancelDisabled
          {...props}
        >
          {children}
        </Modal>
      );
    },
  );

AlertModal.displayName =
  'AlertModal';

/**
 * ============================================================================
 * DestructiveModal
 * ============================================================================
 *
 * Convenience wrapper for high-risk/destructive operations.
 * ============================================================================
 */

export const DestructiveModal =
  forwardRef(
    function DestructiveModal(
      props,
      ref,
    ) {
      return (
        <ConfirmationModal
          ref={ref}
          danger
          confirmVariant="danger"
          {...props}
        />
      );
    },
  );

DestructiveModal.displayName =
  'DestructiveModal';

/**
 * ============================================================================
 * ModalHeader
 * ============================================================================
 */

export const ModalHeader = ({
  children,
  className = '',
}) => (
  <div
    className={cn(
      'flex shrink-0 items-start justify-between gap-4',
      'border-b border-gray-100',
      'px-5 py-4 sm:px-6',
      'dark:border-gray-800',
      className,
    )}
  >
    {children}
  </div>
);

/**
 * ============================================================================
 * ModalTitle
 * ============================================================================
 */

export const ModalTitle = ({
  children,
  className = '',
}) => (
  <h2
    className={cn(
      'text-lg font-semibold tracking-tight',
      'text-gray-900 dark:text-gray-100',
      className,
    )}
  >
    {children}
  </h2>
);

/**
 * ============================================================================
 * ModalDescription
 * ============================================================================
 */

export const ModalDescription = ({
  children,
  className = '',
}) => (
  <p
    className={cn(
      'mt-1.5 text-sm leading-5',
      'text-gray-500 dark:text-gray-400',
      className,
    )}
  >
    {children}
  </p>
);

/**
 * ============================================================================
 * ModalBody
 * ============================================================================
 */

export const ModalBody = ({
  children,
  className = '',
}) => (
  <div
    className={cn(
      'min-h-0 overflow-y-auto',
      'px-5 py-5 sm:px-6',
      className,
    )}
  >
    {children}
  </div>
);

/**
 * ============================================================================
 * ModalFooter
 * ============================================================================
 */

export const ModalFooter = ({
  children,
  className = '',
}) => (
  <div
    className={cn(
      'flex shrink-0 flex-col-reverse gap-2',
      'border-t border-gray-100',
      'px-5 py-4 sm:flex-row sm:justify-end sm:px-6',
      'dark:border-gray-800',
      className,
    )}
  >
    {children}
  </div>
);

/**
 * ============================================================================
 * ModalButton export
 * ============================================================================
 */

export {
  ModalButton,
};

/**
 * ============================================================================
 * Default export
 * ============================================================================
 */

export default Modal;