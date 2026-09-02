'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Button Component
 * File: frontend/src/components/ui/Button.jsx
 * Production Grade
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central reusable button primitive for the TITech frontend application.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✓ Enterprise visual variants
 * ✓ Multiple sizes
 * ✓ Loading state
 * ✓ Disabled state
 * ✓ Full-width mode
 * ✓ Rounded mode
 * ✓ Left / right icons
 * ✓ Polymorphic rendering via `as`
 * ✓ React forwardRef
 * ✓ React.memo
 * ✓ Native button semantics
 * ✓ Accessibility attributes
 * ✓ Keyboard-safe behavior
 * ✓ Loading interaction protection
 * ✓ Submit / reset / button support
 * ✓ Link / anchor compatibility
 * ✓ Custom class composition
 * ✓ Data-state attributes
 * ✓ React 18 compatible
 * ✓ Strict Mode compatible
 * ✓ PropTypes validation
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 * UI primitive only.
 *
 * Business logic belongs in:
 *   → feature components
 *   → hooks
 *   → services
 *   → application/domain layers
 *
 * This component MUST NOT:
 *   → perform API requests
 *   → contain financial business rules
 *   → manipulate authentication state
 *   → contain navigation business logic
 *   → access local storage directly
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
} from 'react';

import PropTypes from 'prop-types';

import {
  Loader2,
} from 'lucide-react';

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const VARIANTS = Object.freeze({
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  success: 'btn-success',
  danger: 'btn-danger',
  warning: 'btn-warning',
  info: 'btn-info',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  link: 'btn-link',
});

const SIZES = Object.freeze({
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
  xl: 'btn-xl',
});

const DEFAULT_VARIANT =
  'primary';

const DEFAULT_SIZE =
  'md';

const DEFAULT_LOADING_TEXT =
  'Please wait…';

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

/**
 * Safely compose CSS classes.
 *
 * @param {...any} values
 * @returns {string}
 */
function classNames(...values) {
  return values
    .flat(Infinity)
    .filter(
      (value) =>
        typeof value ===
          'string' &&
        value.trim().length > 0
    )
    .join(' ');
}

/**
 * Determines whether the rendered component is a native button.
 *
 * @param {React.ElementType} Component
 * @returns {boolean}
 */
function isNativeButton(Component) {
  return (
    Component === 'button'
  );
}

/**
 * Determines whether the rendered component is an anchor.
 *
 * @param {React.ElementType} Component
 * @returns {boolean}
 */
function isAnchor(Component) {
  return (
    Component === 'a'
  );
}

/*
|--------------------------------------------------------------------------
| Component
|--------------------------------------------------------------------------
*/

const Button = forwardRef(
  (
    {
      children,

      type = 'button',

      variant =
        DEFAULT_VARIANT,

      size =
        DEFAULT_SIZE,

      loading = false,

      disabled = false,

      fullWidth = false,

      rounded = false,

      leftIcon = null,

      rightIcon = null,

      className = '',

      loadingText =
        DEFAULT_LOADING_TEXT,

      as: Component =
        'button',

      ariaLabel,

      ariaLabelledBy,

      ariaDescribedBy,

      ...props
    },
    ref
  ) => {
    /*
    |--------------------------------------------------------------------------
    | State
    |--------------------------------------------------------------------------
    */

    const isDisabled =
      Boolean(
        disabled || loading
      );

    /*
    |--------------------------------------------------------------------------
    | Resolve Classes
    |--------------------------------------------------------------------------
    */

    const resolvedVariant =
      VARIANTS[variant] ||
      VARIANTS[
        DEFAULT_VARIANT
      ];

    const resolvedSize =
      SIZES[size] ||
      SIZES[DEFAULT_SIZE];

    const classes =
      classNames(
        'tt-btn',
        resolvedVariant,
        resolvedSize,
        fullWidth
          ? 'btn-block'
          : null,
        rounded
          ? 'btn-rounded'
          : null,
        loading
          ? 'btn-loading'
          : null,
        isDisabled
          ? 'btn-disabled'
          : null,
        className
      );

    /*
    |--------------------------------------------------------------------------
    | Accessibility
    |--------------------------------------------------------------------------
    */

    const accessibilityProps = {
      'aria-disabled':
        isDisabled,

      'aria-busy':
        loading,

      'aria-label':
        ariaLabel,

      'aria-labelledby':
        ariaLabelledBy,

      'aria-describedby':
        ariaDescribedBy,

      'data-component':
        'titech-button',

      'data-variant':
        variant,

      'data-size':
        size,

      'data-loading':
        loading
          ? 'true'
          : 'false',

      'data-disabled':
        isDisabled
          ? 'true'
          : 'false',
    };

    /*
    |--------------------------------------------------------------------------
    | Native Button Properties
    |--------------------------------------------------------------------------
    */

    const nativeButtonProps =
      isNativeButton(
        Component
      )
        ? {
            type,
            disabled:
              isDisabled,
          }
        : {
            /*
             * Non-button components should not receive the native
             * `disabled` attribute because React will pass it through
             * to arbitrary DOM elements.
             */
            ...(isAnchor(
              Component
            ) &&
            isDisabled
              ? {
                  'aria-disabled':
                    true,
                  tabIndex: -1,
                }
              : {}),
          };

    /*
    |--------------------------------------------------------------------------
    | Render
    |--------------------------------------------------------------------------
    */

    return (
      <Component
        ref={ref}
        className={classes}
        {...nativeButtonProps}
        {...accessibilityProps}
        {...props}
      >
        {loading ? (
          <>
            <Loader2
              size={18}
              aria-hidden="true"
              focusable="false"
              className="btn-spinner"
            />

            <span
              className="btn-loading-content"
              aria-live="polite"
            >
              {loadingText}
            </span>
          </>
        ) : (
          <>
            {leftIcon ? (
              <span
                className="btn-icon btn-icon-left"
                aria-hidden={
                  ariaLabel
                    ? 'true'
                    : undefined
                }
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
                aria-hidden={
                  ariaLabel
                    ? 'true'
                    : undefined
                }
              >
                {rightIcon}
              </span>
            ) : null}
          </>
        )}
      </Component>
    );
  }
);

Button.displayName =
  'TITechButton';

/*
|--------------------------------------------------------------------------
| PropTypes
|--------------------------------------------------------------------------
*/

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
      'button',
      'submit',
      'reset',
    ]),

  /**
   * Visual variant.
   */
  variant:
    PropTypes.oneOf(
      Object.keys(
        VARIANTS
      )
    ),

  /**
   * Button size.
   */
  size:
    PropTypes.oneOf(
      Object.keys(
        SIZES
      )
    ),

  /**
   * Displays loading state and prevents interaction.
   */
  loading:
    PropTypes.bool,

  /**
   * Explicitly disables interaction.
   */
  disabled:
    PropTypes.bool,

  /**
   * Makes button span its available width.
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
   * Text displayed during loading.
   */
  loadingText:
    PropTypes.string,

  /**
   * Polymorphic component.
   *
   * Examples:
   *   as="button"
   *   as="a"
   *   as={Link}
   */
  as:
    PropTypes.elementType,

  /**
   * Accessible label for icon-only buttons.
   */
  ariaLabel:
    PropTypes.string,

  /**
   * Accessible labelled-by reference.
   */
  ariaLabelledBy:
    PropTypes.string,

  /**
   * Accessible description reference.
   */
  ariaDescribedBy:
    PropTypes.string,
};

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

export default memo(
  Button
);