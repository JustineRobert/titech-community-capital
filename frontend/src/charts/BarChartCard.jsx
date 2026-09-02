// ============================================================================
// TITech Community Capital
// Enterprise Bar Chart Card
// File: src/components/charts/BarChartCard.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";

import ChartCard from "./ChartCard";

// ============================================================================
// Default Colors
// ============================================================================

const DEFAULT_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

// ============================================================================
// Number Formatter
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

// ============================================================================
// Tooltip
// ============================================================================

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
        (entry) => (
          <div
            key={
              entry.name
            }
            className="chart-tooltip-row"
          >
            <span>
              {entry.name}
            </span>

            <strong>
              {valueFormatter(
                entry.value
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

function BarChartCard({
  title,
  subtitle,
  data = [],
  bars = [],
  xKey = "name",
  height = 320,
  loading = false,
  error = null,
  emptyMessage =
    "No chart data available.",
  grid = true,
  legend = true,
  horizontal = false,
  stacked = false,
  colors =
    DEFAULT_COLORS,
  valueFormatter =
    defaultFormatter,
  onRetry,
  onRefresh,
  onExport,
  onToggleFullscreen,
  fullscreen = false,
  refreshLoading = false,
  updatedAt,
  footer,
  actions,
  className,
}) {
  const empty =
    !data?.length;

  const chartBars =
    useMemo(() => {
      if (
        bars.length
      ) {
        return bars;
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
      bars,
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
      height={
        height
      }
      className={
        className
      }
    >
      <ResponsiveContainer
        width="100%"
        height={height}
      >
        <BarChart
          data={data}
          layout={
            horizontal
              ? "vertical"
              : "horizontal"
          }
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

          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={
                  valueFormatter
                }
              />

              <YAxis
                type="category"
                dataKey={
                  xKey
                }
                width={
                  120
                }
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={
                  xKey
                }
              />

              <YAxis
                tickFormatter={
                  valueFormatter
                }
              />
            </>
          )}

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

          {chartBars.map(
            (
              bar,
              index
            ) => (
              <Bar
                key={
                  bar.dataKey
                }
                dataKey={
                  bar.dataKey
                }
                name={
                  bar.name ||
                  bar.label ||
                  bar.dataKey
                }
                fill={
                  bar.color ||
                  colors[
                    index %
                      colors.length
                  ]
                }
                stackId={
                  stacked
                    ? "stack"
                    : undefined
                }
                radius={[
                  6,
                  6,
                  0,
                  0,
                ]}
                isAnimationActive
              >
                {bar.useCells &&
                  data.map(
                    (
                      _,
                      i
                    ) => (
                      <Cell
                        key={
                          i
                        }
                        fill={
                          colors[
                            i %
                              colors.length
                          ]
                        }
                      />
                    )
                  )}
              </Bar>
            )
          )}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

BarChartCard.propTypes = {
  title:
    PropTypes.node
      .isRequired,

  subtitle:
    PropTypes.node,

  data:
    PropTypes.array,

  bars:
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

  grid:
    PropTypes.bool,

  legend:
    PropTypes.bool,

  horizontal:
    PropTypes.bool,

  stacked:
    PropTypes.bool,

  colors:
    PropTypes.array,

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

  updatedAt:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.instanceOf(
          Date
        ),
      ]
    ),

  footer:
    PropTypes.node,

  actions:
    PropTypes.node,

  className:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  BarChartCard
);