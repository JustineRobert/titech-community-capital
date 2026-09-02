// ============================================================================
// TITech Community Capital
// Enterprise Pie Chart Card
// File: src/components/charts/PieChartCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

import ChartCard from "./ChartCard";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_COLORS = [
  "#2563eb",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#64748b",
];

const DEFAULT_HEIGHT = 320;

// ============================================================================
// Helpers
// ============================================================================

function formatNumber(
  value
) {
  if (
    typeof value !==
    "number"
  ) {
    return value;
  }

  return new Intl.NumberFormat(
    "en-UG"
  ).format(value);
}

function calculateTotal(
  data,
  valueKey
) {
  return data.reduce(
    (sum, item) =>
      sum +
      Number(
        item?.[valueKey] ||
          0
      ),
    0
  );
}

// ============================================================================
// Tooltip
// ============================================================================

function CustomTooltip({
  active,
  payload,
  valueFormatter,
}) {
  if (
    !active ||
    !payload?.length
  ) {
    return null;
  }

  const item =
    payload[0];

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">
        {item.name}
      </div>

      <div className="chart-tooltip-row">
        <span>
          Value
        </span>

        <strong>
          {valueFormatter(
            item.value
          )}
        </strong>
      </div>

      {item.payload
        ?.percentage && (
        <div className="chart-tooltip-row">
          <span>
            Percentage
          </span>

          <strong>
            {
              item.payload
                .percentage
            }
            %
          </strong>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Label Renderer
// ============================================================================

function renderLabel({
  name,
  percent,
}) {
  if (
    percent < 0.05
  ) {
    return "";
  }

  return `${name} (${(
    percent * 100
  ).toFixed(0)}%)`;
}

// ============================================================================
// Component
// ============================================================================

function PieChartCard({
  title,
  subtitle,
  data = [],
  nameKey = "name",
  valueKey = "value",
  height =
    DEFAULT_HEIGHT,
  loading = false,
  error = null,
  emptyMessage =
    "No chart data available.",
  colors =
    DEFAULT_COLORS,
  innerRadius = 0,
  outerRadius = 110,
  showLabels = true,
  showLegend = true,
  showTotal = false,
  valueFormatter =
    formatNumber,
  footer,
  actions,
  className,
  updatedAt,
  onRetry,
  onRefresh,
  onExport,
  onToggleFullscreen,
  fullscreen = false,
  refreshLoading = false,
}) {
  const empty =
    !data?.length;

  const total =
    useMemo(
      () =>
        calculateTotal(
          data,
          valueKey
        ),
      [
        data,
        valueKey,
      ]
    );

  const processedData =
    useMemo(() => {
      if (
        !data.length
      ) {
        return [];
      }

      return data.map(
        (item) => ({
          ...item,
          percentage:
            total > 0
              ? (
                  (item[
                    valueKey
                  ] /
                    total) *
                  100
                ).toFixed(
                  1
                )
              : 0,
        })
      );
    }, [
      data,
      total,
      valueKey,
    ]);

  return (
    <ChartCard
      title={title}
      subtitle={
        subtitle
      }
      loading={
        loading
      }
      error={error}
      empty={empty}
      emptyMessage={
        emptyMessage
      }
      onRetry={
        onRetry
      }
      onRefresh={
        onRefresh
      }
      onExport={
        onExport
      }
      onToggleFullscreen={
        onToggleFullscreen
      }
      fullscreen={
        fullscreen
      }
      refreshLoading={
        refreshLoading
      }
      updatedAt={
        updatedAt
      }
      footer={
        footer
      }
      actions={
        actions
      }
      height={
        height
      }
      className={
        className
      }
    >
      <div
        className="pie-chart-card"
        style={{
          height,
        }}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <PieChart>
            <Pie
              data={
                processedData
              }
              dataKey={
                valueKey
              }
              nameKey={
                nameKey
              }
              innerRadius={
                innerRadius
              }
              outerRadius={
                outerRadius
              }
              label={
                showLabels
                  ? renderLabel
                  : false
              }
              labelLine={
                showLabels
              }
              isAnimationActive
            >
              {processedData.map(
                (
                  _,
                  index
                ) => (
                  <Cell
                    key={
                      index
                    }
                    fill={
                      colors[
                        index %
                          colors.length
                      ]
                    }
                  />
                )
              )}
            </Pie>

            <Tooltip
              content={
                <CustomTooltip
                  valueFormatter={
                    valueFormatter
                  }
                />
              }
            />

            {showLegend && (
              <Legend />
            )}
          </PieChart>
        </ResponsiveContainer>

        {showTotal && (
          <div className="pie-chart-total">
            <span>
              Total
            </span>

            <strong>
              {valueFormatter(
                total
              )}
            </strong>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

PieChartCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  data:
    PropTypes.array,

  nameKey:
    PropTypes.string,

  valueKey:
    PropTypes.string,

  height:
    PropTypes.number,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType(
      [
        PropTypes.object,
        PropTypes.string,
      ]
    ),

  emptyMessage:
    PropTypes.string,

  colors:
    PropTypes.array,

  innerRadius:
    PropTypes.number,

  outerRadius:
    PropTypes.number,

  showLabels:
    PropTypes.bool,

  showLegend:
    PropTypes.bool,

  showTotal:
    PropTypes.bool,

  valueFormatter:
    PropTypes.func,

  footer:
    PropTypes.node,

  actions:
    PropTypes.node,

  className:
    PropTypes.string,

  updatedAt:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.instanceOf(
          Date
        ),
      ]
    ),

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
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  PieChartCard
);