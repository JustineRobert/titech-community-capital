// ============================================================================
// TITech Community Capital
// Enterprise Button Component
// File: frontend/src/ui/Button.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  forwardRef,
  memo,
} from "react";

import PropTypes from "prop-types";
import { Loader2 } from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const BUTTON_NAME = "Button";

const VARIANTS = Object.freeze({
  primary: "btn-primary",
  secondary: "btn-secondary",
  success: "btn-success",
  danger: "btn-danger",
  warning: "btn-warning",
  info: "btn-info",
  ghost: "btn-ghost",
  outline: "btn-outline",
  link: "btn-link",
});

const SIZES = Object.freeze({
  xs: "btn-xs",
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
  xl: "btn-xl",
});

const DEFAULT_VARIANT = "primary";
const DEFAULT_SIZE = "md";
const DEFAULT_LOADING_TEXT = "Please wait...";

const BUTTON_ELEMENTS = new Set([
  "button",
]);

// ============================================================================
// Utilities
// ============================================================================

/**
 * Build the final className without introducing empty values.
 *
 * @param {Array<string|false|null|undefined>} values
 * @returns {string}
 */
const cx = (...values) =>
  values
    .filter(Boolean)
    .join(" ");

/**
 * Determine whether the rendered component is a native button.
 *
 * @param {React.ElementType} Component
 * @returns {boolean}
 */
const isNativeButton = (Component) =>
  typeof Component === "string" &&
  BUTTON_ELEMENTS.has(Component);

// ============================================================================
// Component
// ============================================================================

const Button = forwardRef(
  (
    {
      children,
      type = "button",
      variant = DEFAULT_VARIANT,
      size = DEFAULT_SIZE,
      loading = false,
      disabled = false,
      fullWidth = false,
      rounded = false,
      leftIcon = null,
      rightIcon = null,
      className = "",
      loadingText = DEFAULT_LOADING_TEXT,
      as: Component = "button",
      ...props
    },
    ref
  ) => {
    const resolvedVariant =
      VARIANTS[variant] ??
      VARIANTS[DEFAULT_VARIANT];

    const resolvedSize =
      SIZES[size] ??
      SIZES[DEFAULT_SIZE];

    const isDisabled =
      Boolean(disabled) ||
      Boolean(loading);

    const nativeButton =
      isNativeButton(Component);

    const classes = cx(
      "tt-btn",
      resolvedVariant,
      resolvedSize,
      fullWidth && "btn-block",
      rounded && "btn-rounded",
      loading && "btn-loading",
      isDisabled && "btn-disabled",
      className
    );

    /**
     * Native <button> supports actual disabled semantics.
     *
     * For non-button components, we intentionally do not pass the
     * native `disabled` attribute because it is invalid for elements
     * such as <a>.
     */
    const interactionProps = nativeButton
      ? {
          disabled: isDisabled,
          type,
        }
      : {
          "aria-disabled": isDisabled || undefined,
          tabIndex: isDisabled ? -1 : props.tabIndex,
        };

    /**
     * Prevent interaction with polymorphic elements while preserving
     * accessibility semantics.
     *
     * This protects against accidental activation of links/components
     * while a financial operation is loading or disabled.
     */
    const polymorphicInteractionProps =
      !nativeButton && isDisabled
        ? {
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
            },
          }
        : {};

    return (
      <>
        <Component
          ref={ref}
          className={classes}
          aria-disabled={
            isDisabled || undefined
          }
          aria-busy={
            loading || undefined
          }
          data-loading={
            loading
              ? "true"
              : undefined
          }
          data-disabled={
            isDisabled
              ? "true"
              : undefined
          }
          {...interactionProps}
          {...polymorphicInteractionProps}
          {...props}
        >
          {loading ? (
            <>
              <Loader2
                size={18}
                className="btn-spinner"
                aria-hidden="true"
                focusable="false"
              />

              <span className="btn-content">
                {loadingText}
              </span>
            </>
          ) : (
            <>
              {leftIcon ? (
                <span
                  className="btn-icon btn-icon-left"
                  aria-hidden="true"
                >
                  {leftIcon}
                </span>
              ) : null}

              <span className="btn-content">
                {children}
              </span>

              {rightIcon ? (
                <span
                  className="btn-icon btn-icon-right"
                  aria-hidden="true"
                >
                  {rightIcon}
                </span>
              ) : null}
            </>
          )}
        </Component>

        {loading ? (
          <span
            className="sr-only"
            role="status"
            aria-live="polite"
          >
            {loadingText}
          </span>
        ) : null}
      </>
    );
  }
);

Button.displayName =
  BUTTON_NAME;

// ============================================================================
// Prop Types
// ============================================================================

Button.propTypes = {
  /**
   * Button content.
   */
  children:
    PropTypes.node,

  /**
   * Native button type.
   */
  type:
    PropTypes.oneOf([
      "button",
      "submit",
      "reset",
    ]),

  /**
   * Visual variant.
   */
  variant:
    PropTypes.oneOf(
      Object.keys(VARIANTS)
    ),

  /**
   * Visual size.
   */
  size:
    PropTypes.oneOf(
      Object.keys(SIZES)
    ),

  /**
   * Displays the loading state and prevents interaction.
   */
  loading:
    PropTypes.bool,

  /**
   * Explicitly disables the control.
   */
  disabled:
    PropTypes.bool,

  /**
   * Makes the button full width.
   */
  fullWidth:
    PropTypes.bool,

  /**
   * Applies rounded styling.
   */
  rounded:
    PropTypes.bool,

  /**
   * Optional leading icon.
   */
  leftIcon:
    PropTypes.node,

  /**
   * Optional trailing icon.
   */
  rightIcon:
    PropTypes.node,

  /**
   * Additional CSS classes.
   */
  className:
    PropTypes.string,

  /**
   * Accessible loading-state message.
   */
  loadingText:
    PropTypes.string,

  /**
   * Polymorphic rendering target.
   */
  as:
    PropTypes.elementType,
};

// ============================================================================
// Static Metadata
// ============================================================================

/**
 * Expose immutable configuration for design-system consumers.
 */
Button.VARIANTS = VARIANTS;
Button.SIZES = SIZES;

// ============================================================================
// Export
// ============================================================================

export {
  VARIANTS,
  SIZES,
};

export default memo(Button);