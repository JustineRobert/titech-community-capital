'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Card Component
 * File: frontend/src/components/ui/Card.jsx
 * Production Grade
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides the centralized, reusable Card primitive for the TITech frontend.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✓ Card container
 * ✓ Header / body / footer composition
 * ✓ Title and description support
 * ✓ Optional actions
 * ✓ Clickable cards
 * ✓ Hoverable cards
 * ✓ Selected state
 * ✓ Loading state
 * ✓ Error state
 * ✓ Empty state
 * ✓ Semantic HTML support
 * ✓ Polymorphic `as` rendering
 * ✓ Forwarded refs
 * ✓ React.memo optimization
 * ✓ Accessibility support
 * ✓ Keyboard support for interactive cards
 * ✓ Data-state attributes
 * ✓ Custom class composition
 * ✓ React 18 compatible
 * ✓ Strict Mode compatible
 * ✓ PropTypes validation
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 * Presentation/UI primitive only.
 *
 * Business logic belongs in:
 *   → feature components
 *   → hooks
 *   → services
 *   → domain/application layers
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useCallback,
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
  default: 'card-default',
  primary: 'card-primary',
  secondary: 'card-secondary',
  success: 'card-success',
  danger: 'card-danger',
  warning: 'card-warning',
  info: 'card-info',
  ghost: 'card-ghost',
  outline: 'card-outline',
});

const PADDINGS = Object.freeze({
  none: 'card-padding-none',
  xs: 'card-padding-xs',
  sm: 'card-padding-sm',
  md: 'card-padding-md',
  lg: 'card-padding-lg',
  xl: 'card-padding-xl',
});

const RADII = Object.freeze({
  none: 'card-radius-none',
  sm: 'card-radius-sm',
  md: 'card-radius-md',
  lg: 'card-radius-lg',
  xl: 'card-radius-xl',
});

const DEFAULT_VARIANT =
  'default';

const DEFAULT_PADDING =
  'md';

const DEFAULT_RADIUS =
  'lg';

const DEFAULT_LOADING_TEXT =
  'Loading…';

const DEFAULT_ERROR_TEXT =
  'Unable to load this content.';

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
        typeof value === 'string' &&
        value.trim().length > 0
    )
    .join(' ');
}

/**
 * Resolve a configured class safely.
 *
 * @param {Object} map
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function resolveClass(
  map,
  key,
  fallback
) {
  return (
    map[key] ||
    map[fallback]
  );
}

/*
|--------------------------------------------------------------------------
| Card Header
|--------------------------------------------------------------------------
*/

const CardHeader = memo(
  function CardHeader({
    children,
    title,
    description,
    actions,
    className = '',
    titleClassName = '',
    descriptionClassName = '',
    as: Component = 'div',
  }) {
    const hasHeadingContent =
      Boolean(
        title ||
          description
      );

    return (
      <Component
        className={classNames(
          'tt-card-header',
          className
        )}
        data-component="titech-card-header"
      >
        {hasHeadingContent ? (
          <div className="tt-card-heading">
            {title ? (
              <h3
                className={classNames(
                  'tt-card-title',
                  titleClassName
                )}
              >
                {title}
              </h3>
            ) : null}

            {description ? (
              <p
                className={classNames(
                  'tt-card-description',
                  descriptionClassName
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
        ) : null}

        {children}

        {actions ? (
          <div className="tt-card-actions">
            {actions}
          </div>
        ) : null}
      </Component>
    );
  }
);

CardHeader.displayName =
  'TITechCardHeader';

CardHeader.propTypes = {
  children:
    PropTypes.node,

  title:
    PropTypes.node,

  description:
    PropTypes.node,

  actions:
    PropTypes.node,

  className:
    PropTypes.string,

  titleClassName:
    PropTypes.string,

  descriptionClassName:
    PropTypes.string,

  as:
    PropTypes.elementType,
};

/*
|--------------------------------------------------------------------------
| Card Body
|--------------------------------------------------------------------------
*/

const CardBody = memo(
  function CardBody({
    children,
    className = '',
    padding = DEFAULT_PADDING,
    as: Component = 'div',
  }) {
    const resolvedPadding =
      resolveClass(
        PADDINGS,
        padding,
        DEFAULT_PADDING
      );

    return (
      <Component
        className={classNames(
          'tt-card-body',
          resolvedPadding,
          className
        )}
        data-component="titech-card-body"
        data-padding={padding}
      >
        {children}
      </Component>
    );
  }
);

CardBody.displayName =
  'TITechCardBody';

CardBody.propTypes = {
  children:
    PropTypes.node,

  className:
    PropTypes.string,

  padding:
    PropTypes.oneOf(
      Object.keys(PADDINGS)
    ),

  as:
    PropTypes.elementType,
};

/*
|--------------------------------------------------------------------------
| Card Footer
|--------------------------------------------------------------------------
*/

const CardFooter = memo(
  function CardFooter({
    children,
    actions,
    className = '',
    as: Component = 'div',
  }) {
    return (
      <Component
        className={classNames(
          'tt-card-footer',
          className
        )}
        data-component="titech-card-footer"
      >
        {children}

        {actions ? (
          <div className="tt-card-actions">
            {actions}
          </div>
        ) : null}
      </Component>
    );
  }
);

CardFooter.displayName =
  'TITechCardFooter';

CardFooter.propTypes = {
  children:
    PropTypes.node,

  actions:
    PropTypes.node,

  className:
    PropTypes.string,

  as:
    PropTypes.elementType,
};

/*
|--------------------------------------------------------------------------
| Card
|--------------------------------------------------------------------------
*/

const Card = forwardRef(
  (
    {
      children,

      title,

      description,

      header,

      footer,

      actions,

      variant =
        DEFAULT_VARIANT,

      padding =
        DEFAULT_PADDING,

      radius =
        DEFAULT_RADIUS,

      className = '',

      headerClassName = '',

      bodyClassName = '',

      footerClassName = '',

      interactive = false,

      hoverable = false,

      selected = false,

      disabled = false,

      loading = false,

      error = false,

      errorMessage =
        DEFAULT_ERROR_TEXT,

      loadingText =
        DEFAULT_LOADING_TEXT,

      onClick,

      onKeyDown,

      onRetry,

      ariaLabel,

      ariaLabelledBy,

      ariaDescribedBy,

      id,

      as: Component =
        'article',

      ...props
    },
    ref
  ) => {
    /*
    |--------------------------------------------------------------------------
    | State
    |--------------------------------------------------------------------------
    */

    const isInteractive =
      Boolean(
        interactive ||
          hoverable ||
          onClick
      );

    const isDisabled =
      Boolean(
        disabled ||
          loading
      );

    /*
    |--------------------------------------------------------------------------
    | Resolve Classes
    |--------------------------------------------------------------------------
    */

    const resolvedVariant =
      resolveClass(
        VARIANTS,
        variant,
        DEFAULT_VARIANT
      );

    const resolvedPadding =
      resolveClass(
        PADDINGS,
        padding,
        DEFAULT_PADDING
      );

    const resolvedRadius =
      resolveClass(
        RADII,
        radius,
        DEFAULT_RADIUS
      );

    const classes =
      classNames(
        'tt-card',
        resolvedVariant,
        resolvedPadding,
        resolvedRadius,

        isInteractive
          ? 'card-interactive'
          : null,

        hoverable
          ? 'card-hoverable'
          : null,

        selected
          ? 'card-selected'
          : null,

        isDisabled
          ? 'card-disabled'
          : null,

        loading
          ? 'card-loading'
          : null,

        error
          ? 'card-error'
          : null,

        className
      );

    /*
    |--------------------------------------------------------------------------
    | Keyboard Interaction
    |--------------------------------------------------------------------------
    */

    const handleKeyDown =
      useCallback(
        (event) => {
          if (
            typeof onKeyDown ===
            'function'
          ) {
            onKeyDown(event);
          }

          if (
            event.defaultPrevented ||
            !isInteractive ||
            isDisabled ||
            typeof onClick !==
              'function'
          ) {
            return;
          }

          if (
            event.key ===
              'Enter' ||
            event.key ===
              ' '
          ) {
            event.preventDefault();

            onClick(event);
          }
        },
        [
          isDisabled,
          isInteractive,
          onClick,
          onKeyDown,
        ]
      );

    /*
    |--------------------------------------------------------------------------
    | Click Interaction
    |--------------------------------------------------------------------------
    */

    const handleClick =
      useCallback(
        (event) => {
          if (
            isDisabled ||
            typeof onClick !==
              'function'
          ) {
            return;
          }

          onClick(event);
        },
        [
          isDisabled,
          onClick,
        ]
      );

    /*
    |--------------------------------------------------------------------------
    | Accessibility
    |--------------------------------------------------------------------------
    */

    const accessibilityProps =
      {
        id,

        'aria-disabled':
          isDisabled
            ? true
            : undefined,

        'aria-selected':
          selected
            ? true
            : undefined,

        'aria-busy':
          loading
            ? true
            : undefined,

        'aria-label':
          ariaLabel,

        'aria-labelledby':
          ariaLabelledBy,

        'aria-describedby':
          ariaDescribedBy,

        'data-component':
          'titech-card',

        'data-variant':
          variant,

        'data-padding':
          padding,

        'data-radius':
          radius,

        'data-interactive':
          isInteractive
            ? 'true'
            : 'false',

        'data-selected':
          selected
            ? 'true'
            : 'false',

        'data-loading':
          loading
            ? 'true'
            : 'false',

        'data-error':
          error
            ? 'true'
            : 'false',
      };

    /*
    |--------------------------------------------------------------------------
    | Interactive Keyboard Semantics
    |--------------------------------------------------------------------------
    */

    const interactiveProps =
      isInteractive
        ? {
            role:
              Component ===
              'button'
                ? undefined
                : 'button',

            tabIndex:
              isDisabled
                ? -1
                : 0,

            onClick:
              handleClick,

            onKeyDown:
              handleKeyDown,
          }
        : {};

    /*
    |--------------------------------------------------------------------------
    | Header
    |--------------------------------------------------------------------------
    */

    const hasHeader =
      Boolean(
        header ||
          title ||
          description ||
          actions
      );

    /*
    |--------------------------------------------------------------------------
    | Footer
    |--------------------------------------------------------------------------
    */

    const hasFooter =
      Boolean(footer);

    /*
    |--------------------------------------------------------------------------
    | Render
    |--------------------------------------------------------------------------
    */

    return (
      <Component
        ref={ref}
        className={classes}
        {...accessibilityProps}
        {...interactiveProps}
        {...props}
      >
        {hasHeader ? (
          header || (
            <CardHeader
              title={title}
              description={
                description
              }
              actions={
                actions
              }
              className={
                headerClassName
              }
            />
          )
        ) : null}

        <CardBody
          padding={padding}
          className={
            bodyClassName
          }
        >
          {loading ? (
            <div
              className="tt-card-loading"
              role="status"
              aria-live="polite"
            >
              <Loader2
                size={24}
                aria-hidden="true"
                focusable="false"
                className="card-spinner"
              />

              <span>
                {loadingText}
              </span>
            </div>
          ) : error ? (
            <div
              className="tt-card-error"
              role="alert"
            >
              <span className="tt-card-error-message">
                {errorMessage}
              </span>

              {typeof onRetry ===
                'function' ? (
                <button
                  type="button"
                  className="tt-card-retry"
                  onClick={
                    onRetry
                  }
                  disabled={
                    isDisabled
                  }
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : (
            children
          )}
        </CardBody>

        {hasFooter ? (
          footer
        ) : null}
      </Component>
    );
  }
);

Card.displayName =
  'TITechCard';

/*
|--------------------------------------------------------------------------
| PropTypes
|--------------------------------------------------------------------------
*/

Card.propTypes = {
  children:
    PropTypes.node,

  title:
    PropTypes.node,

  description:
    PropTypes.node,

  header:
    PropTypes.node,

  footer:
    PropTypes.node,

  actions:
    PropTypes.node,

  variant:
    PropTypes.oneOf(
      Object.keys(VARIANTS)
    ),

  padding:
    PropTypes.oneOf(
      Object.keys(PADDINGS)
    ),

  radius:
    PropTypes.oneOf(
      Object.keys(RADII)
    ),

  className:
    PropTypes.string,

  headerClassName:
    PropTypes.string,

  bodyClassName:
    PropTypes.string,

  footerClassName:
    PropTypes.string,

  interactive:
    PropTypes.bool,

  hoverable:
    PropTypes.bool,

  selected:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.bool,

  errorMessage:
    PropTypes.node,

  loadingText:
    PropTypes.node,

  onClick:
    PropTypes.func,

  onKeyDown:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  ariaLabel:
    PropTypes.string,

  ariaLabelledBy:
    PropTypes.string,

  ariaDescribedBy:
    PropTypes.string,

  id:
    PropTypes.string,

  as:
    PropTypes.elementType,
};

/*
|--------------------------------------------------------------------------
| Compound Components
|--------------------------------------------------------------------------
|
| Enables:
|
|   <Card>
|     <Card.Header />
|     <Card.Body />
|     <Card.Footer />
|   </Card>
|
|--------------------------------------------------------------------------
*/

Card.Header =
  CardHeader;

Card.Body =
  CardBody;

Card.Footer =
  CardFooter;

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

export default memo(Card);