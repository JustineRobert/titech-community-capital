// ============================================================================
// TITech Community Capital
// Enterprise Page Header Component
// File: frontend/src/components/ui/PageHeader.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  forwardRef,
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ArrowLeft,
  ChevronRight,
  Home,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TITLE = "Page";

const SIZE_CLASSES = Object.freeze({
  sm: "page-header-sm",
  md: "page-header-md",
  lg: "page-header-lg",
});

const ALIGNMENT_CLASSES = Object.freeze({
  start: "page-header-align-start",
  center: "page-header-align-center",
  end: "page-header-align-end",
});

const VARIANT_CLASSES = Object.freeze({
  default: "page-header-default",
  bordered: "page-header-bordered",
  elevated: "page-header-elevated",
  compact: "page-header-compact",
});

// ============================================================================
// Helpers
// ============================================================================

function cx(...classes) {
  return classes
    .flat()
    .filter(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0
    )
    .join(" ");
}

function normalizeBreadcrumbs(
  breadcrumbs
) {
  if (!Array.isArray(breadcrumbs)) {
    return [];
  }

  return breadcrumbs
    .filter(Boolean)
    .map((item, index) => {
      if (
        typeof item === "string"
      ) {
        return {
          label: item,
          href: null,
          key: `${item}-${index}`,
        };
      }

      return {
        label:
          item?.label ??
          item?.title ??
          "",
        href:
          item?.href ??
          item?.to ??
          null,
        onClick:
          item?.onClick ??
          null,
        icon:
          item?.icon ??
          null,
        key:
          item?.key ??
          item?.id ??
          `${item?.label ?? "breadcrumb"}-${index}`,
      };
    })
    .filter(
      (item) =>
        item.label !== ""
    );
}

// ============================================================================
// Breadcrumbs
// ============================================================================

const Breadcrumbs = memo(
  function Breadcrumbs({
    items,
    showHome,
    homeLabel,
    homeHref,
    onHomeClick,
  }) {
    const normalizedItems =
      useMemo(
        () =>
          normalizeBreadcrumbs(
            items
          ),
        [items]
      );

    if (
      !showHome &&
      normalizedItems.length ===
        0
    ) {
      return null;
    }

    return (
      <nav
        className="page-header-breadcrumbs"
        aria-label="Breadcrumb"
      >
        <ol className="page-header-breadcrumb-list">
          {showHome && (
            <li className="page-header-breadcrumb-item">
              {homeHref ? (
                <a
                  href={homeHref}
                  className="page-header-breadcrumb-link page-header-breadcrumb-home"
                  onClick={
                    onHomeClick
                  }
                >
                  <Home
                    size={15}
                    aria-hidden="true"
                  />

                  <span>
                    {homeLabel}
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  className="page-header-breadcrumb-link page-header-breadcrumb-home"
                  onClick={
                    onHomeClick
                  }
                >
                  <Home
                    size={15}
                    aria-hidden="true"
                  />

                  <span>
                    {homeLabel}
                  </span>
                </button>
              )}
            </li>
          )}

          {normalizedItems.map(
            (
              item,
              index
            ) => {
              const isLast =
                index ===
                normalizedItems.length -
                  1;

              const content = (
                <>
                  {item.icon && (
                    <span
                      className="page-header-breadcrumb-icon"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                  )}

                  <span>
                    {item.label}
                  </span>
                </>
              );

              return (
                <React.Fragment
                  key={item.key}
                >
                  <li
                    className="page-header-breadcrumb-separator"
                    aria-hidden="true"
                  >
                    <ChevronRight
                      size={14}
                    />
                  </li>

                  <li
                    className={cx(
                      "page-header-breadcrumb-item",
                      isLast
                        ? "page-header-breadcrumb-current"
                        : ""
                    )}
                    aria-current={
                      isLast
                        ? "page"
                        : undefined
                    }
                  >
                    {!isLast &&
                    item.href ? (
                      <a
                        href={
                          item.href
                        }
                        className="page-header-breadcrumb-link"
                        onClick={
                          item.onClick
                        }
                      >
                        {content}
                      </a>
                    ) : !isLast &&
                      item.onClick ? (
                      <button
                        type="button"
                        className="page-header-breadcrumb-link"
                        onClick={
                          item.onClick
                        }
                      >
                        {content}
                      </button>
                    ) : (
                      <span className="page-header-breadcrumb-current-label">
                        {content}
                      </span>
                    )}
                  </li>
                </React.Fragment>
              );
            }
          )}
        </ol>
      </nav>
    );
  }
);

Breadcrumbs.displayName =
  "PageHeader.Breadcrumbs";

// ============================================================================
// Page Header
// ============================================================================

const PageHeader = forwardRef(
  (
    {
      title = DEFAULT_TITLE,
      subtitle,
      description,

      breadcrumbs = [],
      showBreadcrumbs = true,
      showHome = true,
      homeLabel = "Home",
      homeHref = "/",
      onHomeClick,

      icon,
      backButton = false,
      onBack,
      backLabel = "Go back",

      actions,
      primaryAction,
      secondaryAction,

      badge,
      status,

      loading = false,
      sticky = false,

      size = "md",
      align = "start",
      variant = "default",

      className = "",
      titleClassName = "",
      subtitleClassName = "",
      actionsClassName = "",

      children,

      as: Component = "header",

      ...props
    },
    ref
  ) => {
    const safeSize =
      SIZE_CLASSES[size]
        ? size
        : "md";

    const safeAlign =
      ALIGNMENT_CLASSES[
        align
      ]
        ? align
        : "start";

    const safeVariant =
      VARIANT_CLASSES[
        variant
      ]
        ? variant
        : "default";

    const hasActions =
      Boolean(
        actions ||
          primaryAction ||
          secondaryAction
      );

    const hasMetadata =
      Boolean(
        badge ||
          status ||
          subtitle ||
          description
      );

    const classes = cx(
      "tt-page-header",
      SIZE_CLASSES[
        safeSize
      ],
      ALIGNMENT_CLASSES[
        safeAlign
      ],
      VARIANT_CLASSES[
        safeVariant
      ],
      sticky
        ? "page-header-sticky"
        : "",
      loading
        ? "page-header-loading"
        : "",
      className
    );

    const renderAction =
      (
        action,
        fallbackVariant
      ) => {
        if (!action) {
          return null;
        }

        if (
          React.isValidElement(
            action
          )
        ) {
          return action;
        }

        if (
          typeof action ===
          "function"
        ) {
          return action();
        }

        if (
          typeof action !==
            "object" ||
          !action.label
        ) {
          return null;
        }

        const {
          label,
          icon: actionIcon,
          onClick,
          href,
          disabled = false,
          loading:
            actionLoading = false,
          type = "button",
          variant:
            actionVariant =
              fallbackVariant,
          ...actionProps
        } = action;

        const actionClasses =
          cx(
            "tt-btn",
            `btn-${actionVariant}`,
            actionLoading
              ? "btn-loading"
              : ""
          );

        const content = (
          <>
            {actionIcon && (
              <span
                className="btn-icon btn-icon-left"
                aria-hidden="true"
              >
                {actionIcon}
              </span>
            )}

            <span className="btn-content">
              {actionLoading
                ? "Please wait..."
                : label}
            </span>
          </>
        );

        if (href) {
          return (
            <a
              href={href}
              className={
                actionClasses
              }
              aria-disabled={
                disabled ||
                actionLoading
              }
              {...actionProps}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            type={type}
            className={
              actionClasses
            }
            disabled={
              disabled ||
              actionLoading
            }
            aria-disabled={
              disabled ||
              actionLoading
            }
            aria-busy={
              actionLoading
            }
            onClick={
              onClick
            }
            {...actionProps}
          >
            {content}
          </button>
        );
      };

    return (
      <Component
        ref={ref}
        className={classes}
        {...props}
      >
        <div className="page-header-container">
          {showBreadcrumbs &&
            (breadcrumbs?.length >
              0 ||
              showHome) && (
              <Breadcrumbs
                items={
                  breadcrumbs
                }
                showHome={
                  showHome
                }
                homeLabel={
                  homeLabel
                }
                homeHref={
                  homeHref
                }
                onHomeClick={
                  onHomeClick
                }
              />
            )}

          <div className="page-header-main">
            <div className="page-header-content">
              <div className="page-header-heading">
                {backButton && (
                  <button
                    type="button"
                    className="page-header-back-button"
                    onClick={onBack}
                    aria-label={
                      backLabel
                    }
                    title={
                      backLabel
                    }
                    disabled={
                      !onBack
                    }
                  >
                    <ArrowLeft
                      size={20}
                      aria-hidden="true"
                    />
                  </button>
                )}

                {icon && (
                  <div
                    className="page-header-icon"
                    aria-hidden="true"
                  >
                    {icon}
                  </div>
                )}

                <div className="page-header-heading-content">
                  <div className="page-header-title-row">
                    <h1
                      className={cx(
                        "page-header-title",
                        titleClassName
                      )}
                    >
                      {title}
                    </h1>

                    {badge && (
                      <span className="page-header-badge">
                        {badge}
                      </span>
                    )}

                    {status && (
                      <span className="page-header-status">
                        {status}
                      </span>
                    )}
                  </div>

                  {subtitle && (
                    <p
                      className={cx(
                        "page-header-subtitle",
                        subtitleClassName
                      )}
                    >
                      {
                        subtitle
                      }
                    </p>
                  )}

                  {description &&
                    !subtitle && (
                      <p
                        className={cx(
                          "page-header-description",
                          subtitleClassName
                        )}
                      >
                        {
                          description
                        }
                      </p>
                    )}
                </div>
              </div>

              {hasActions && (
                <div
                  className={cx(
                    "page-header-actions",
                    actionsClassName
                  )}
                >
                  {secondaryAction &&
                    renderAction(
                      secondaryAction,
                      "secondary"
                    )}

                  {actions}

                  {primaryAction &&
                    renderAction(
                      primaryAction,
                      "primary"
                    )}
                </div>
              )}
            </div>

            {children && (
              <div className="page-header-extension">
                {children}
              </div>
            )}
          </div>

          {loading && (
            <div
              className="page-header-progress"
              role="progressbar"
              aria-label="Loading"
              aria-valuetext="Loading page data"
            />
          )}

          {hasMetadata &&
            !subtitle &&
            !description &&
            !badge &&
            !status &&
            null}
        </div>
      </Component>
    );
  }
);

PageHeader.displayName =
  "PageHeader";

// ============================================================================
// Prop Types
// ============================================================================

const actionShape =
  PropTypes.oneOfType([
    PropTypes.node,
    PropTypes.func,
    PropTypes.shape({
      label:
        PropTypes.node
          .isRequired,
      icon:
        PropTypes.node,
      onClick:
        PropTypes.func,
      href:
        PropTypes.string,
      disabled:
        PropTypes.bool,
      loading:
        PropTypes.bool,
      type:
        PropTypes.oneOf([
          "button",
          "submit",
          "reset",
        ]),
      variant:
        PropTypes.string,
    }),
  ]);

PageHeader.propTypes = {
  title:
    PropTypes.node,

  subtitle:
    PropTypes.node,

  description:
    PropTypes.node,

  breadcrumbs:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.shape({
          key:
            PropTypes.oneOfType([
              PropTypes.string,
              PropTypes.number,
            ]),
          id:
            PropTypes.oneOfType([
              PropTypes.string,
              PropTypes.number,
            ]),
          label:
            PropTypes.node,
          title:
            PropTypes.node,
          href:
            PropTypes.string,
          to:
            PropTypes.string,
          icon:
            PropTypes.node,
          onClick:
            PropTypes.func,
        }),
      ])
    ),

  showBreadcrumbs:
    PropTypes.bool,

  showHome:
    PropTypes.bool,

  homeLabel:
    PropTypes.node,

  homeHref:
    PropTypes.string,

  onHomeClick:
    PropTypes.func,

  icon:
    PropTypes.node,

  backButton:
    PropTypes.bool,

  onBack:
    PropTypes.func,

  backLabel:
    PropTypes.string,

  actions:
    PropTypes.node,

  primaryAction:
    actionShape,

  secondaryAction:
    actionShape,

  badge:
    PropTypes.node,

  status:
    PropTypes.node,

  loading:
    PropTypes.bool,

  sticky:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      "sm",
      "md",
      "lg",
    ]),

  align:
    PropTypes.oneOf([
      "start",
      "center",
      "end",
    ]),

  variant:
    PropTypes.oneOf([
      "default",
      "bordered",
      "elevated",
      "compact",
    ]),

  className:
    PropTypes.string,

  titleClassName:
    PropTypes.string,

  subtitleClassName:
    PropTypes.string,

  actionsClassName:
    PropTypes.string,

  children:
    PropTypes.node,

  as:
    PropTypes.elementType,
};

// ============================================================================
// Subcomponent Exports
// ============================================================================

PageHeader.Breadcrumbs =
  Breadcrumbs;

// ============================================================================
// Export
// ============================================================================

export default memo(
  PageHeader
);