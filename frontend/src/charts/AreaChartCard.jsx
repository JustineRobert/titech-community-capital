// ============================================================================
// TITech Community Capital
// Enterprise Area Chart Card
// File: src/components/charts/AreaChartCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
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
  "#0ea5e9",
  "#22c55e",
  "#ec4899",
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

function AreaChartCard({
  title,
  subtitle,
  data = [],
  areas = [],
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
  stacked = false,
  curveType =
    "monotone",
  syncId,
  animate = true,
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

  const chartAreas =
    useMemo(() => {
      if (
        areas.length
      ) {
        return areas;
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
      areas,
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
        <AreaChart
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

          {chartAreas.map(
            (
              area,
              index
            ) => (
              <Area
                key={
                  area.dataKey
                }
                type={
                  area.type ||
                  curveType
                }
                dataKey={
                  area.dataKey
                }
                name={
                  area.name ||
                  area.label ||
                  area.dataKey
                }
                stroke={
                  area.color ||
                  colors[
                    index %
                      colors.length
                  ]
                }
                fill={
                  area.fill ||
                  area.color ||
                  colors[
                    index %
                      colors.length
                  ]
                }
                fillOpacity={
                  area.fillOpacity ??
                  0.25
                }
                strokeWidth={
                  area.strokeWidth ||
                  2
                }
                stackId={
                  stacked
                    ? "stack"
                    : area.stackId
                }
                isAnimationActive={
                  animate
                }
                connectNulls
              />
            )
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

AreaChartCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  data:
    PropTypes.array,

  areas:
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

  stacked:
    PropTypes.bool,

  curveType:
    PropTypes.string,

  syncId:
    PropTypes.string,

  animate:
    PropTypes.bool,

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
  AreaChartCard
);