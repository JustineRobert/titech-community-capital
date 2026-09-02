// ============================================================================
// TITech Community Capital
// Enterprise Stat Card Component
// File: src/components/ui/StatCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";

import Card from "./Card";

// ============================================================================
// Helpers
// ============================================================================

function formatValue(
  value,
  formatter
) {
  if (
    typeof formatter ===
    "function"
  ) {
    return formatter(
      value
    );
  }

  if (
    typeof value ===
    "number"
  ) {
    return new Intl.NumberFormat(
      "en-UG"
    ).format(value);
  }

  return (
    value ?? "-"
  );
}

function getTrendIcon(
  trend
) {
  switch (
    trend
  ) {
    case "up":
      return (
        <ArrowUpRight
          size={16}
        />
      );

    case "down":
      return (
        <ArrowDownRight
          size={16}
        />
      );

    default:
      return (
        <Minus
          size={16}
        />
      );
  }
}

// ============================================================================
// Component
// ============================================================================

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = "primary",
  trend,
  trendValue,
  formatter,
  loading = false,
  footer,
  onClick,
  className = "",
}) {
  const displayValue =
    useMemo(
      () =>
        formatValue(
          value,
          formatter
        ),
      [value, formatter]
    );

  const trendClass =
    useMemo(() => {
      switch (
        trend
      ) {
        case "up":
          return "tt-stat-trend-up";

        case "down":
          return "tt-stat-trend-down";

        default:
          return "tt-stat-trend-neutral";
      }
    }, [trend]);

  return (
    <Card
      loading={
        loading
      }
      hoverable={
        !!onClick
      }
      clickable={
        !!onClick
      }
      onClick={
        onClick
      }
      className={`tt-stat-card tt-stat-${color} ${className}`}
      padding="md"
      fullHeight
    >
      <div className="tt-stat-content">
        <div className="tt-stat-header">
          <div className="tt-stat-info">
            <span className="tt-stat-title">
              {title}
            </span>

            <h2 className="tt-stat-value">
              {
                displayValue
              }
            </h2>

            {subtitle && (
              <span className="tt-stat-subtitle">
                {
                  subtitle
                }
              </span>
            )}
          </div>

          {icon && (
            <div className="tt-stat-icon">
              {icon}
            </div>
          )}
        </div>

        {(trend ||
          trendValue) && (
          <div
            className={`tt-stat-trend ${trendClass}`}
          >
            {getTrendIcon(
              trend
            )}

            <span>
              {trendValue ||
                "No change"}
            </span>
          </div>
        )}

        {footer && (
          <div className="tt-stat-footer">
            {footer}
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

StatCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  value:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.number,
        PropTypes.node,
      ]
    ),

  subtitle:
    PropTypes.node,

  icon:
    PropTypes.node,

  color:
    PropTypes.oneOf([
      "primary",
      "success",
      "warning",
      "danger",
      "info",
      "secondary",
    ]),

  trend:
    PropTypes.oneOf([
      "up",
      "down",
      "neutral",
    ]),

  trendValue:
    PropTypes.string,

  formatter:
    PropTypes.func,

  loading:
    PropTypes.bool,

  footer:
    PropTypes.node,

  onClick:
    PropTypes.func,

  className:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  StatCard
);