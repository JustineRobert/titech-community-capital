// ============================================================================
// TITech Community Capital
// Enterprise Line Chart Card
// File: src/components/charts/LineChartCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

import ChartCard from "./ChartCard";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HEIGHT = 320;

const DEFAULT_COLORS = [
  "#2563eb",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#22c55e",
];

// ============================================================================
// Helpers
// ============================================================================

function defaultFormatter(
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

function CustomTooltip({
  active,
  payload,
  label,
  valueFormatter,
}) {
  if (
    !active ||
    !payload?.length
  ) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">
        {label}
      </div>

      {payload.map(
        (item) => (
          <div
            key={item.name}
            className="chart-tooltip-row"
          >
            <span>
              {item.name}
            </span>

            <strong>
              {valueFormatter(
                item.value
              )}
            </strong>
          </div>
        )
      )}
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

function LineChartCard({
  title,
  subtitle,
  data = [],
  lines = [],
  xKey = "name",
  height =
    DEFAULT_HEIGHT,
  loading = false,
  error = null,
  emptyMessage =
    "No chart data available.",
  colors =
    DEFAULT_COLORS,
  grid = true,
  legend = true,
  curveType =
    "monotone",
  showDots = true,
  animate = true,
  syncId,
  footer,
  actions,
  className,
  bodyClassName,
  updatedAt,
  valueFormatter =
    defaultFormatter,
  onRetry,
  onRefresh,
  onExport,
  onToggleFullscreen,
  fullscreen = false,
  refreshLoading = false,
}) {
  const empty =
    !data?.length;

  const chartLines =
    useMemo(() => {
      if (
        lines.length
      ) {
        return lines;
      }

      const first =
        data?.[0];

      if (!first) {
        return [];
      }

      return Object.keys(
        first
      )
        .filter(
          (key) =>
            key !== xKey
        )
        .map(
          (
            key,
            index
          ) => ({
            dataKey:
              key,
            name:
              key,
            color:
              colors[
                index %
                  colors.length
              ],
          })
        );
    }, [
      lines,
      data,
      xKey,
      colors,
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
      className={
        className
      }
      bodyClassName={
        bodyClassName
      }
      height={
        height
      }
    >
      <ResponsiveContainer
        width="100%"
        height={height}
      >
        <LineChart
          data={data}
          syncId={syncId}
          margin={{
            top: 16,
            right: 16,
            left: 16,
            bottom: 16,
          }}
        >
          {grid && (
            <CartesianGrid
              strokeDasharray="3 3"
            />
          )}

          <XAxis
            dataKey={xKey}
          />

          <YAxis
            tickFormatter={
              valueFormatter
            }
          />

          <Tooltip
            content={
              <CustomTooltip
                valueFormatter={
                  valueFormatter
                }
              />
            }
          />

          {legend && (
            <Legend />
          )}

          {chartLines.map(
            (
              line,
              index
            ) => (
              <Line
                key={
                  line.dataKey
                }
                type={
                  line.type ||
                  curveType
                }
                dataKey={
                  line.dataKey
                }
                name={
                  line.name ||
                  line.label ||
                  line.dataKey
                }
                stroke={
                  line.color ||
                  colors[
                    index %
                      colors.length
                  ]
                }
                strokeWidth={
                  line.strokeWidth ||
                  3
                }
                dot={
                  line.dot ??
                  showDots
                }
                activeDot={{
                  r: 6,
                }}
                connectNulls
                isAnimationActive={
                  animate
                }
              />
            )
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

LineChartCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  data:
    PropTypes.array,

  lines:
    PropTypes.array,

  xKey:
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

  grid:
    PropTypes.bool,

  legend:
    PropTypes.bool,

  curveType:
    PropTypes.string,

  showDots:
    PropTypes.bool,

  animate:
    PropTypes.bool,

  syncId:
    PropTypes.string,

  footer:
    PropTypes.node,

  actions:
    PropTypes.node,

  className:
    PropTypes.string,

  bodyClassName:
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

  valueFormatter:
    PropTypes.func,

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
  LineChartCard
);