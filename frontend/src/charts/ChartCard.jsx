// ============================================================================
// TITech Community Capital
// Enterprise Chart Card Component
// File: src/components/charts/ChartCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  MoreVertical,
  Download,
  RefreshCw,
  Maximize2,
  Minimize2,
  AlertCircle,
} from "lucide-react";

import Card from "../ui/Card";
import Button from "../ui/Button";
import Skeleton from "../ui/Skeleton";

import "./ChartCard.css";

// ============================================================================
// Helpers
// ============================================================================

function formatUpdatedAt(date) {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(new Date(date));
  } catch {
    return "";
  }
}

// ============================================================================
// Chart Header
// ============================================================================

const ChartHeader = memo(
  ({
    title,
    subtitle,
    updatedAt,
    actions,
    onRefresh,
    onExport,
    fullscreen,
    onToggleFullscreen,
    refreshLoading,
  }) => (
    <div className="chart-card-header">
      <div className="chart-card-heading">
        <h3 className="chart-card-title">
          {title}
        </h3>

        {subtitle && (
          <p className="chart-card-subtitle">
            {subtitle}
          </p>
        )}

        {updatedAt && (
          <span className="chart-card-updated">
            Updated{" "}
            {formatUpdatedAt(
              updatedAt
            )}
          </span>
        )}
      </div>

      <div className="chart-card-actions">
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            loading={
              refreshLoading
            }
            onClick={
              onRefresh
            }
            aria-label="Refresh chart"
          >
            <RefreshCw
              size={16}
            />
          </Button>
        )}

        {onExport && (
          <Button
            variant="ghost"
            size="sm"
            onClick={
              onExport
            }
            aria-label="Export chart"
          >
            <Download
              size={16}
            />
          </Button>
        )}

        {onToggleFullscreen && (
          <Button
            variant="ghost"
            size="sm"
            onClick={
              onToggleFullscreen
            }
            aria-label="Toggle fullscreen"
          >
            {fullscreen ? (
              <Minimize2
                size={16}
              />
            ) : (
              <Maximize2
                size={16}
              />
            )}
          </Button>
        )}

        {actions && (
          <div className="chart-card-custom-actions">
            {actions}
          </div>
        )}

        {!actions &&
          !onRefresh &&
          !onExport &&
          !onToggleFullscreen && (
            <MoreVertical
              size={18}
              className="chart-card-more"
            />
          )}
      </div>
    </div>
  )
);

ChartHeader.displayName =
  "ChartHeader";

// ============================================================================
// Loading State
// ============================================================================

function LoadingState({
  height,
}) {
  return (
    <div
      className="chart-card-loading"
      style={{
        height,
      }}
    >
      <Skeleton
        height={
          height || 300
        }
        rounded
      />
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({
  message,
  height,
}) {
  return (
    <div
      className="chart-card-empty"
      style={{
        height,
      }}
    >
      <AlertCircle
        size={40}
      />

      <p>
        {message ||
          "No chart data available."}
      </p>
    </div>
  );
}

// ============================================================================
// Error State
// ============================================================================

function ErrorState({
  error,
  onRetry,
  height,
}) {
  return (
    <div
      className="chart-card-error"
      style={{
        height,
      }}
    >
      <AlertCircle
        size={42}
      />

      <h4>
        Failed to load chart
      </h4>

      <p>
        {error?.message ||
          error ||
          "Unknown error"}
      </p>

      {onRetry && (
        <Button
          onClick={
            onRetry
          }
        >
          Retry
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

function ChartCard({
  title,
  subtitle,
  children,
  loading = false,
  error = null,
  empty = false,
  emptyMessage,
  onRetry,
  onRefresh,
  onExport,
  onToggleFullscreen,
  fullscreen = false,
  refreshLoading = false,
  actions = null,
  footer = null,
  updatedAt,
  height = 320,
  className = "",
  bodyClassName = "",
  ...props
}) {
  const cardClass =
    useMemo(
      () =>
        [
          "chart-card",
          fullscreen
            ? "fullscreen"
            : "",
          className,
        ]
          .filter(Boolean)
          .join(" "),
      [
        fullscreen,
        className,
      ]
    );

  return (
    <Card
      className={
        cardClass
      }
      {...props}
    >
      <ChartHeader
        title={title}
        subtitle={
          subtitle
        }
        updatedAt={
          updatedAt
        }
        actions={actions}
        onRefresh={
          onRefresh
        }
        onExport={
          onExport
        }
        fullscreen={
          fullscreen
        }
        onToggleFullscreen={
          onToggleFullscreen
        }
        refreshLoading={
          refreshLoading
        }
      />

      <div
        className={`chart-card-body ${bodyClassName}`}
        style={{
          minHeight:
            height,
        }}
      >
        {loading && (
          <LoadingState
            height={
              height
            }
          />
        )}

        {!loading &&
          error && (
            <ErrorState
              error={
                error
              }
              onRetry={
                onRetry
              }
              height={
                height
              }
            />
          )}

        {!loading &&
          !error &&
          empty && (
            <EmptyState
              message={
                emptyMessage
              }
              height={
                height
              }
            />
          )}

        {!loading &&
          !error &&
          !empty &&
          children}
      </div>

      {footer && (
        <div className="chart-card-footer">
          {footer}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

ChartCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  children:
    PropTypes.node,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType(
      [
        PropTypes.object,
        PropTypes.string,
      ]
    ),

  empty:
    PropTypes.bool,

  emptyMessage:
    PropTypes.string,

  onRetry:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onExport:
    PropTypes.func,

  onToggleFullscreen:
    PropTypes.func,

  fullscreen:
    PropTypes.bool,

  refreshLoading:
    PropTypes.bool,

  actions:
    PropTypes.node,

  footer:
    PropTypes.node,

  updatedAt:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.instanceOf(
          Date
        ),
      ]
    ),

  height:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.number,
      ]
    ),

  className:
    PropTypes.string,

  bodyClassName:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  ChartCard
);