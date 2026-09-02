// ============================================================================
// TITech Community Capital
// Enterprise Card Component
// File: src/components/ui/Card.jsx
// Production Grade
// ============================================================================

import React, {
  forwardRef,
  memo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Variants
// ============================================================================

const VARIANTS = {
  default: "tt-card-default",
  outlined: "tt-card-outlined",
  elevated: "tt-card-elevated",
  flat: "tt-card-flat",
  success: "tt-card-success",
  warning: "tt-card-warning",
  danger: "tt-card-danger",
  info: "tt-card-info",
};

const PADDING = {
  none: "tt-card-p-none",
  sm: "tt-card-p-sm",
  md: "tt-card-p-md",
  lg: "tt-card-p-lg",
};

// ============================================================================
// Component
// ============================================================================

const Card = forwardRef(
  (
    {
      children,
      title,
      subtitle,
      header,
      footer,
      actions,
      variant = "default",
      padding = "md",
      bordered = false,
      hoverable = false,
      clickable = false,
      loading = false,
      fullHeight = false,
      className = "",
      bodyClassName = "",
      onClick,
      ...props
    },
    ref
  ) => {
    const classes = [
      "tt-card",
      VARIANTS[
        variant
      ] ||
        VARIANTS.default,
      PADDING[
        padding
      ] ||
        PADDING.md,
      bordered
        ? "tt-card-bordered"
        : "",
      hoverable
        ? "tt-card-hoverable"
        : "",
      clickable
        ? "tt-card-clickable"
        : "",
      fullHeight
        ? "tt-card-full-height"
        : "",
      loading
        ? "tt-card-loading"
        : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        className={
          classes
        }
        onClick={
          clickable
            ? onClick
            : undefined
        }
        role={
          clickable
            ? "button"
            : undefined
        }
        tabIndex={
          clickable
            ? 0
            : undefined
        }
        {...props}
      >
        {(header ||
          title ||
          subtitle ||
          actions) && (
          <div className="tt-card-header">
            <div className="tt-card-header-content">
              {header || (
                <>
                  {title && (
                    <h3 className="tt-card-title">
                      {title}
                    </h3>
                  )}

                  {subtitle && (
                    <p className="tt-card-subtitle">
                      {
                        subtitle
                      }
                    </p>
                  )}
                </>
              )}
            </div>

            {actions && (
              <div className="tt-card-actions">
                {actions}
              </div>
            )}
          </div>
        )}

        <div
          className={`tt-card-body ${bodyClassName}`}
        >
          {loading ? (
            <div className="tt-card-loader">
              <div className="tt-card-spinner" />
            </div>
          ) : (
            children
          )}
        </div>

        {footer && (
          <div className="tt-card-footer">
            {footer}
          </div>
        )}
      </div>
    );
  }
);

Card.displayName =
  "Card";

// ============================================================================
// Compound Components
// ============================================================================

Card.Header = function CardHeader({
  children,
  className = "",
}) {
  return (
    <div
      className={`tt-card-header ${className}`}
    >
      {children}
    </div>
  );
};

Card.Body = function CardBody({
  children,
  className = "",
}) {
  return (
    <div
      className={`tt-card-body ${className}`}
    >
      {children}
    </div>
  );
};

Card.Footer = function CardFooter({
  children,
  className = "",
}) {
  return (
    <div
      className={`tt-card-footer ${className}`}
    >
      {children}
    </div>
  );
};

// ============================================================================
// PropTypes
// ============================================================================

Card.propTypes = {
  children:
    PropTypes.node,

  title:
    PropTypes.node,

  subtitle:
    PropTypes.node,

  header:
    PropTypes.node,

  footer:
    PropTypes.node,

  actions:
    PropTypes.node,

  variant:
    PropTypes.oneOf(
      Object.keys(
        VARIANTS
      )
    ),

  padding:
    PropTypes.oneOf(
      Object.keys(
        PADDING
      )
    ),

  bordered:
    PropTypes.bool,

  hoverable:
    PropTypes.bool,

  clickable:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  fullHeight:
    PropTypes.bool,

  className:
    PropTypes.string,

  bodyClassName:
    PropTypes.string,

  onClick:
    PropTypes.func,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  Card
);