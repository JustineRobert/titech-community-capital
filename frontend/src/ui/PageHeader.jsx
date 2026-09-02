// ============================================================================
// TITech Community Capital
// Enterprise Page Header Component
// File: src/components/ui/PageHeader.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
} from "react";

import PropTypes from "prop-types";
import {
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

import Button from "./Button";

// ============================================================================
// Component
// ============================================================================

function PageHeader({
  title,
  subtitle,
  description,
  breadcrumbs = [],
  actions,
  icon,
  backButton = false,
  backButtonLabel = "Back",
  onBack,
  sticky = false,
  compact = false,
  className = "",
  children,
}) {
  return (
    <header
      className={[
        "tt-page-header",
        sticky
          ? "tt-page-header-sticky"
          : "",
        compact
          ? "tt-page-header-compact"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* ------------------------------------------------------------------- */}
      {/* Top Row */}
      {/* ------------------------------------------------------------------- */}

      <div className="tt-page-header-top">
        <div className="tt-page-header-left">
          {backButton && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <ArrowLeft
                  size={16}
                />
              }
              onClick={
                onBack
              }
            >
              {
                backButtonLabel
              }
            </Button>
          )}

          <div className="tt-page-header-content">
            {breadcrumbs
              .length >
              0 && (
              <nav
                aria-label="Breadcrumb"
                className="tt-page-breadcrumbs"
              >
                {breadcrumbs.map(
                  (
                    item,
                    index
                  ) => (
                    <React.Fragment
                      key={`${item.label}-${index}`}
                    >
                      <span
                        className={`tt-page-breadcrumb ${
                          item.active
                            ? "active"
                            : ""
                        }`}
                      >
                        {item.href ? (
                          <a
                            href={
                              item.href
                            }
                          >
                            {
                              item.label
                            }
                          </a>
                        ) : (
                          item.label
                        )}
                      </span>

                      {index <
                        breadcrumbs.length -
                          1 && (
                        <ChevronRight
                          size={
                            14
                          }
                          className="tt-page-breadcrumb-divider"
                        />
                      )}
                    </React.Fragment>
                  )
                )}
              </nav>
            )}

            <div className="tt-page-title-row">
              {icon && (
                <div className="tt-page-icon">
                  {icon}
                </div>
              )}

              <div>
                <h1 className="tt-page-title">
                  {title}
                </h1>

                {subtitle && (
                  <p className="tt-page-subtitle">
                    {
                      subtitle
                    }
                  </p>
                )}
              </div>
            </div>

            {description && (
              <p className="tt-page-description">
                {
                  description
                }
              </p>
            )}
          </div>
        </div>

        {(actions ||
          children) && (
          <div className="tt-page-header-right">
            {actions}
            {children}
          </div>
        )}
      </div>
    </header>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

PageHeader.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  description:
    PropTypes.node,

  breadcrumbs:
    PropTypes.arrayOf(
      PropTypes.shape({
        label:
          PropTypes.node
            .isRequired,
        href:
          PropTypes.string,
        active:
          PropTypes.bool,
      })
    ),

  actions:
    PropTypes.node,

  icon:
    PropTypes.node,

  backButton:
    PropTypes.bool,

  backButtonLabel:
    PropTypes.string,

  onBack:
    PropTypes.func,

  sticky:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  className:
    PropTypes.string,

  children:
    PropTypes.node,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  PageHeader
);