'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartLoadingSkeleton.jsx
 *
 * Purpose:
 *   Enterprise-grade loading skeleton for TITech charts, analytics panels,
 *   dashboards and reporting visualizations.
 *
 * Responsibilities:
 *   - Provide a consistent loading experience across TITech chart surfaces.
 *   - Support chart, metric, axis, legend and table-like loading structures.
 *   - Remain independent of Recharts or any charting library.
 *   - Preserve layout geometry while async chart data is loading.
 *   - Support compact, standard and spacious variants.
 *   - Support configurable chart dimensions and skeleton density.
 *   - Respect prefers-reduced-motion.
 *   - Provide accessible loading semantics.
 *   - Support optional header, controls and footer placeholders.
 *
 * Financial integrity:
 *   - Presentation-only.
 *   - Does not calculate or mutate financial data.
 *   - Does not represent pending/provider-accepted/offline transactions as
 *     settled financial values.
 *   - Does not create balances, ledger entries, settlement state or reports.
 *
 * Typical usage:
 *
 *   <ChartLoadingSkeleton />
 *
 *   <ChartLoadingSkeleton
 *     title="Contribution analytics"
 *     showMetrics
 *     metricCount={4}
 *     height={360}
 *   />
 *
 *   <ChartLoadingSkeleton
 *     variant="compact"
 *     showLegend={false}
 *   />
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useMemo,
} from 'react';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME = 'TITechChartLoadingSkeleton';

const DEFAULT_CHART_HEIGHT = 320;
const DEFAULT_MIN_CHART_HEIGHT = 220;
const DEFAULT_METRIC_COUNT = 4;
const DEFAULT_LEGEND_COUNT = 3;
const DEFAULT_BAR_COUNT = 12;
const DEFAULT_GRID_ROWS = 5;
const DEFAULT_GRID_COLUMNS = 6;
const DEFAULT_PADDING = 20;

const VALID_VARIANTS = new Set([
  'compact',
  'standard',
  'spacious',
]);

/* ============================================================================
 * Utilities
 * ========================================================================== */

function classNames(...values) {
  return values
    .flat(Infinity)
    .filter(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0,
    )
    .join(' ');
}

function positiveInteger(
  value,
  fallback,
  max = 100,
) {
  const numeric = Number(value);

  if (
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    return fallback;
  }

  return Math.min(
    Math.floor(numeric),
    max,
  );
}

function normalizeDimension(
  value,
  fallback,
) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    value.trim().length > 0
  ) {
    return value;
  }

  return fallback;
}

function normalizeVariant(value) {
  if (
    typeof value === 'string' &&
    VALID_VARIANTS.has(value)
  ) {
    return value;
  }

  return 'standard';
}

function normalizePadding(value, fallback) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    value.trim().length > 0
  ) {
    return value;
  }

  return fallback;
}

function resolveBarHeight(
  index,
  total,
  pattern,
) {
  if (
    Array.isArray(pattern) &&
    pattern.length > 0
  ) {
    const value =
      pattern[index % pattern.length];

    const numeric = Number(value);

    if (
      Number.isFinite(numeric) &&
      numeric > 0
    ) {
      return Math.min(numeric, 100);
    }
  }

  /**
   * Deterministic visual variation.
   *
   * No randomness is used because a loading placeholder should render
   * consistently between React renders and tests.
   */
  const normalized =
    total <= 1
      ? 0.5
      : index / (total - 1);

  const wave = Math.sin(
    normalized * Math.PI * 2.2,
  );

  const value =
    42 + ((wave + 1) / 2) * 42;

  return Math.max(
    24,
    Math.min(value, 92),
  );
}

/* ============================================================================
 * Skeleton primitive
 * ========================================================================== */

const SkeletonBlock = memo(
  function SkeletonBlock({
    width = '100%',
    height = 12,
    radius = 6,
    className = '',
    style,
    ariaHidden = true,
  }) {
    return (
      <span
        className={classNames(
          'titech-chart-skeleton__block',
          className,
        )}
        aria-hidden={ariaHidden}
        style={{
          width,
          height,
          borderRadius: radius,
          ...style,
        }}
      />
    );
  },
);

SkeletonBlock.displayName = 'SkeletonBlock';

/* ============================================================================
 * Header skeleton
 * ========================================================================== */

const ChartHeaderSkeleton = memo(
  function ChartHeaderSkeleton({
    showEyebrow = true,
    showDescription = true,
    showStatus = true,
    showActions = true,
  }) {
    return (
      <div className="titech-chart-skeleton__header">
        <div className="titech-chart-skeleton__header-main">
          {showEyebrow ? (
            <SkeletonBlock
              width="18%"
              height={9}
              radius={4}
              className="titech-chart-skeleton__eyebrow"
            />
          ) : null}

          <SkeletonBlock
            width="34%"
            height={18}
            radius={5}
            className="titech-chart-skeleton__title"
          />

          {showDescription ? (
            <>
              <SkeletonBlock
                width="55%"
                height={10}
                radius={4}
                className="titech-chart-skeleton__description"
              />

              <SkeletonBlock
                width="38%"
                height={10}
                radius={4}
                className="titech-chart-skeleton__description titech-chart-skeleton__description--short"
              />
            </>
          ) : null}
        </div>

        <div className="titech-chart-skeleton__header-actions">
          {showStatus ? (
            <SkeletonBlock
              width={70}
              height={25}
              radius={999}
            />
          ) : null}

          {showActions ? (
            <>
              <SkeletonBlock
                width={78}
                height={34}
                radius={8}
              />

              <SkeletonBlock
                width={38}
                height={34}
                radius={8}
              />
            </>
          ) : null}
        </div>
      </div>
    );
  },
);

ChartHeaderSkeleton.displayName =
  'ChartHeaderSkeleton';

/* ============================================================================
 * Metrics skeleton
 * ========================================================================== */

const ChartMetricsSkeleton = memo(
  function ChartMetricsSkeleton({
    count = DEFAULT_METRIC_COUNT,
  }) {
    const safeCount = positiveInteger(
      count,
      DEFAULT_METRIC_COUNT,
      8,
    );

    return (
      <div className="titech-chart-skeleton__metrics">
        {Array.from(
          { length: safeCount },
          (_, index) => (
            <div
              key={`metric-${index}`}
              className="titech-chart-skeleton__metric"
            >
              <SkeletonBlock
                width={
                  index % 2 === 0
                    ? '46%'
                    : '58%'
                }
                height={9}
                radius={4}
              />

              <SkeletonBlock
                width={
                  index % 3 === 0
                    ? '74%'
                    : '61%'
                }
                height={20}
                radius={5}
                className="titech-chart-skeleton__metric-value"
              />

              <SkeletonBlock
                width="52%"
                height={8}
                radius={4}
              />
            </div>
          ),
        )}
      </div>
    );
  },
);

ChartMetricsSkeleton.displayName =
  'ChartMetricsSkeleton';

/* ============================================================================
 * Legend skeleton
 * ========================================================================== */

const ChartLegendSkeleton = memo(
  function ChartLegendSkeleton({
    count = DEFAULT_LEGEND_COUNT,
  }) {
    const safeCount = positiveInteger(
      count,
      DEFAULT_LEGEND_COUNT,
      10,
    );

    return (
      <div
        className="titech-chart-skeleton__legend"
        aria-hidden="true"
      >
        {Array.from(
          { length: safeCount },
          (_, index) => (
            <div
              key={`legend-${index}`}
              className="titech-chart-skeleton__legend-item"
            >
              <SkeletonBlock
                width={9}
                height={9}
                radius={999}
              />

              <SkeletonBlock
                width={
                  index % 2 === 0
                    ? 72
                    : 88
                }
                height={9}
                radius={4}
              />
            </div>
          ),
        )}
      </div>
    );
  },
);

ChartLegendSkeleton.displayName =
  'ChartLegendSkeleton';

/* ============================================================================
 * Chart drawing skeleton
 * ========================================================================== */

const ChartPlotSkeleton = memo(
  function ChartPlotSkeleton({
    chartHeight,
    showAxes = true,
    showGrid = true,
    showBars = true,
    showTrend = true,
    barCount = DEFAULT_BAR_COUNT,
    gridRows = DEFAULT_GRID_ROWS,
    gridColumns = DEFAULT_GRID_COLUMNS,
    barPattern,
  }) {
    const safeBarCount = positiveInteger(
      barCount,
      DEFAULT_BAR_COUNT,
      36,
    );

    const safeGridRows = positiveInteger(
      gridRows,
      DEFAULT_GRID_ROWS,
      10,
    );

    const safeGridColumns =
      positiveInteger(
        gridColumns,
        DEFAULT_GRID_COLUMNS,
        12,
      );

    const bars = useMemo(
      () =>
        Array.from(
          { length: safeBarCount },
          (_, index) =>
            resolveBarHeight(
              index,
              safeBarCount,
              barPattern,
            ),
        ),
      [safeBarCount, barPattern],
    );

    return (
      <div
        className="titech-chart-skeleton__plot"
        style={{
          minHeight: chartHeight,
        }}
      >
        {showAxes ? (
          <>
            <div
              className="titech-chart-skeleton__y-axis"
              aria-hidden="true"
            >
              {Array.from(
                { length: safeGridRows },
                (_, index) => (
                  <SkeletonBlock
                    key={`y-${index}`}
                    width={
                      index % 2 === 0
                        ? 37
                        : 29
                    }
                    height={7}
                    radius={3}
                  />
                ),
              )}
            </div>

            <div
              className="titech-chart-skeleton__x-axis"
              aria-hidden="true"
            >
              {Array.from(
                {
                  length: Math.min(
                    safeGridColumns,
                    8,
                  ),
                },
                (_, index) => (
                  <SkeletonBlock
                    key={`x-${index}`}
                    width={
                      index % 2 === 0
                        ? 28
                        : 35
                    }
                    height={7}
                    radius={3}
                  />
                ),
              )}
            </div>
          </>
        ) : null}

        {showGrid ? (
          <div
            className="titech-chart-skeleton__grid"
            aria-hidden="true"
            style={{
              gridTemplateRows:
                `repeat(${safeGridRows}, 1fr)`,
              gridTemplateColumns:
                `repeat(${safeGridColumns}, 1fr)`,
            }}
          >
            {Array.from(
              {
                length:
                  safeGridRows *
                  safeGridColumns,
              },
              (_, index) => (
                <span
                  key={`grid-${index}`}
                />
              ),
            )}
          </div>
        ) : null}

        {showBars ? (
          <div
            className="titech-chart-skeleton__bars"
            aria-hidden="true"
          >
            {bars.map(
              (barHeight, index) => (
                <span
                  key={`bar-${index}`}
                  style={{
                    height: `${barHeight}%`,
                  }}
                />
              ),
            )}
          </div>
        ) : null}

        {showTrend ? (
          <div
            className="titech-chart-skeleton__trend"
            aria-hidden="true"
          >
            <span />
            <span />
          </div>
        ) : null}
      </div>
    );
  },
);

ChartPlotSkeleton.displayName =
  'ChartPlotSkeleton';

/* ============================================================================
 * Footer skeleton
 * ========================================================================== */

const ChartFooterSkeleton = memo(
  function ChartFooterSkeleton() {
    return (
      <div
        className="titech-chart-skeleton__footer"
        aria-hidden="true"
      >
        <SkeletonBlock
          width="21%"
          height={8}
          radius={4}
        />

        <SkeletonBlock
          width="18%"
          height={8}
          radius={4}
        />
      </div>
    );
  },
);

ChartFooterSkeleton.displayName =
  'ChartFooterSkeleton';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartLoadingSkeleton = memo(
  forwardRef(
    function ChartLoadingSkeleton(
      {
        title = 'Loading chart data',
        description = null,

        height = DEFAULT_CHART_HEIGHT,
        minHeight = DEFAULT_MIN_CHART_HEIGHT,
        padding = DEFAULT_PADDING,

        variant = 'standard',

        showHeader = true,
        showEyebrow = true,
        showDescription = true,
        showStatus = true,
        showActions = true,

        showMetrics = false,
        metricCount = DEFAULT_METRIC_COUNT,

        showLegend = true,
        legendCount = DEFAULT_LEGEND_COUNT,

        showAxes = true,
        showGrid = true,
        showBars = true,
        showTrend = true,

        barCount = DEFAULT_BAR_COUNT,
        gridRows = DEFAULT_GRID_ROWS,
        gridColumns = DEFAULT_GRID_COLUMNS,

        barPattern = undefined,

        showFooter = false,

        label = null,
        ariaLabel = null,
        ariaLive = 'polite',

        bordered = true,
        elevated = false,
        rounded = true,
        fullWidth = true,
        centered = false,

        className = '',
        style = undefined,
        contentStyle = undefined,

        testId = null,

        children = null,
        preserveChildren = false,
      },
      forwardedRef,
    ) {
      const normalizedHeight =
        normalizeDimension(
          height,
          DEFAULT_CHART_HEIGHT,
        );

      const normalizedMinHeight =
        normalizeDimension(
          minHeight,
          DEFAULT_MIN_CHART_HEIGHT,
        );

      const normalizedPadding =
        normalizePadding(
          padding,
          DEFAULT_PADDING,
        );

      const normalizedVariant =
        normalizeVariant(variant);

      const rootClassName = classNames(
        'titech-chart-loading-skeleton',
        `titech-chart-loading-skeleton--${normalizedVariant}`,

        bordered &&
          'titech-chart-loading-skeleton--bordered',

        elevated &&
          'titech-chart-loading-skeleton--elevated',

        rounded &&
          'titech-chart-loading-skeleton--rounded',

        fullWidth &&
          'titech-chart-loading-skeleton--full-width',

        centered &&
          'titech-chart-loading-skeleton--centered',

        className,
      );

      const accessibleLabel =
        ariaLabel ||
        label ||
        title ||
        'Loading chart';

      const shouldShowDescription =
        Boolean(
          description || showDescription,
        );

      return (
        <section
          ref={forwardedRef}
          className={rootClassName}
          role="status"
          aria-busy="true"
          aria-live={ariaLive}
          aria-label={accessibleLabel}
          data-component={COMPONENT_NAME}
          data-testid={
            testId || undefined
          }
          style={style}
        >
          <div
            className="titech-chart-skeleton__surface"
            style={{
              padding: normalizedPadding,
              ...contentStyle,
            }}
          >
            {showHeader ? (
              <div className="titech-chart-skeleton__header-wrapper">
                <ChartHeaderSkeleton
                  showEyebrow={showEyebrow}
                  showDescription={
                    shouldShowDescription
                  }
                  showStatus={showStatus}
                  showActions={showActions}
                />

                {description ? (
                  <span className="titech-chart-skeleton__sr-only">
                    {description}
                  </span>
                ) : null}

                {title ? (
                  <span className="titech-chart-skeleton__sr-only">
                    {title}
                  </span>
                ) : null}
              </div>
            ) : null}

            {showMetrics ? (
              <ChartMetricsSkeleton
                count={metricCount}
              />
            ) : null}

            {showLegend ? (
              <ChartLegendSkeleton
                count={legendCount}
              />
            ) : null}

            <div
              className="titech-chart-skeleton__chart-wrapper"
              style={{
                minHeight:
                  normalizedMinHeight,
              }}
            >
              <ChartPlotSkeleton
                chartHeight={
                  normalizedHeight
                }
                showAxes={showAxes}
                showGrid={showGrid}
                showBars={showBars}
                showTrend={showTrend}
                barCount={barCount}
                gridRows={gridRows}
                gridColumns={gridColumns}
                barPattern={barPattern}
              />
            </div>

            {showFooter ? (
              <ChartFooterSkeleton />
            ) : null}

            {preserveChildren &&
            children ? (
              <div className="titech-chart-skeleton__preserved-content">
                {children}
              </div>
            ) : null}

            <div
              className="titech-chart-skeleton__live-region"
              aria-live="polite"
              aria-atomic="true"
            >
              {accessibleLabel}…
            </div>
          </div>

          <style>
            {`
              .titech-chart-loading-skeleton {
                --titech-skeleton-surface:
                  var(
                    --titech-surface,
                    var(--color-white)
                  );

                --titech-skeleton-surface-muted:
                  var(
                    --titech-surface-muted,
                    #f8fafc
                  );

                --titech-skeleton-border:
                  var(
                    --titech-border,
                    #e2e8f0
                  );

                --titech-skeleton-border-strong:
                  var(
                    --titech-border-strong,
                    #cbd5e1
                  );

                --titech-skeleton-text-muted:
                  var(
                    --titech-text-secondary,
                    #64748b
                  );

                --titech-skeleton-base:
                  var(
                    --titech-skeleton,
                    #e2e8f0
                  );

                --titech-skeleton-highlight:
                  var(
                    --titech-skeleton-highlight,
                    #f8fafc
                  );

                --titech-skeleton-grid:
                  var(
                    --titech-chart-grid,
                    #cbd5e1
                  );

                --titech-skeleton-bar:
                  var(
                    --titech-primary,
                    #64748b
                  );

                --titech-skeleton-trend:
                  var(
                    --titech-border-strong,
                    #94a3b8
                  );

                width: 100%;
                min-width: 0;
                color:
                  var(
                    --titech-skeleton-text-muted
                  );
                font: inherit;
              }

              .titech-chart-loading-skeleton *,
              .titech-chart-loading-skeleton
                *::before,
              .titech-chart-loading-skeleton
                *::after {
                box-sizing: border-box;
              }

              .titech-chart-loading-skeleton--full-width {
                width: 100%;
              }

              .titech-chart-loading-skeleton--centered {
                display: flex;
                justify-content: center;
              }

              .titech-chart-loading-skeleton--centered
                .titech-chart-skeleton__surface {
                width: min(
                  100%,
                  1280px
                );
              }

              .titech-chart-loading-skeleton--bordered {
                border: 1px solid
                  var(
                    --titech-skeleton-border
                  );
              }

              .titech-chart-loading-skeleton--rounded {
                border-radius: 16px;
              }

              .titech-chart-loading-skeleton--rounded
                .titech-chart-skeleton__surface {
                border-radius: inherit;
              }

              .titech-chart-loading-skeleton--elevated {
                box-shadow:
                  0 10px 30px
                  rgba(
                    15,
                    23,
                    42,
                    0.08
                  );
              }

              .titech-chart-skeleton__surface {
                width: 100%;
                min-width: 0;
                overflow: hidden;
                background:
                  var(
                    --titech-skeleton-surface
                  );
              }

              .titech-chart-skeleton__block {
                display: block;
                flex: 0 0 auto;
                max-width: 100%;

                background:
                  linear-gradient(
                    90deg,
                    var(
                      --titech-skeleton-base
                    )
                    25%,
                    var(
                      --titech-skeleton-highlight
                    )
                    50%,
                    var(
                      --titech-skeleton-base
                    )
                    75%
                  );

                background-size:
                  200%
                  100%;

                animation:
                  titech-chart-skeleton-shimmer
                  1.55s
                  ease-in-out
                  infinite;
              }

              /* ------------------------------------------------------------
                 Header
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 20px;
                min-width: 0;
              }

              .titech-chart-skeleton__header-main {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                min-width: 0;
                flex: 1 1 auto;
              }

              .titech-chart-skeleton__eyebrow {
                margin-bottom: 7px;
              }

              .titech-chart-skeleton__title {
                margin-bottom: 7px;
              }

              .titech-chart-skeleton__description {
                margin-bottom: 5px;
              }

              .titech-chart-skeleton__description--short {
                margin-bottom: 0;
              }

              .titech-chart-skeleton__header-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
                flex: 0 0 auto;
              }

              .titech-chart-skeleton__header-wrapper {
                margin-bottom: 20px;
              }

              /* ------------------------------------------------------------
                 Metrics
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__metrics {
                display: grid;
                grid-template-columns:
                  repeat(
                    auto-fit,
                    minmax(
                      145px,
                      1fr
                    )
                  );
                gap: 12px;
                margin-bottom: 18px;
              }

              .titech-chart-skeleton__metric {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                min-width: 0;
                min-height: 78px;
                padding: 13px;

                border: 1px solid
                  var(
                    --titech-skeleton-border
                  );

                border-radius: 10px;

                background:
                  var(
                    --titech-skeleton-surface
                  );
              }

              .titech-chart-skeleton__metric-value {
                margin-top: 7px;
                margin-bottom: 6px;
              }

              /* ------------------------------------------------------------
                 Legend
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__legend {
                display: flex;
                align-items: center;
                gap: 16px;
                flex-wrap: wrap;
                min-width: 0;
                margin-bottom: 12px;
              }

              .titech-chart-skeleton__legend-item {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                min-width: 70px;
              }

              /* ------------------------------------------------------------
                 Plot area
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__chart-wrapper {
                width: 100%;
                min-width: 0;
              }

              .titech-chart-skeleton__plot {
                position: relative;
                width: 100%;
                height: 100%;
                min-height: 220px;
                overflow: hidden;
                border-radius: 11px;

                background:
                  var(
                    --titech-skeleton-surface-muted
                  );
              }

              .titech-chart-skeleton__grid {
                position: absolute;
                left: 64px;
                right: 18px;
                top: 18px;
                bottom: 42px;

                display: grid;
                gap: 0;
                pointer-events: none;
              }

              .titech-chart-skeleton__grid span {
                position: relative;
                border-top: 1px dashed
                  var(
                    --titech-skeleton-grid
                  );
                opacity: 0.38;
                min-width: 0;
              }

              .titech-chart-skeleton__y-axis {
                position: absolute;
                left: 10px;
                top: 18px;
                bottom: 42px;

                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: flex-end;
              }

              .titech-chart-skeleton__x-axis {
                position: absolute;
                left: 68px;
                right: 18px;
                bottom: 15px;

                display: flex;
                justify-content: space-between;
                align-items: center;
              }

              .titech-chart-skeleton__bars {
                position: absolute;
                left: 72px;
                right: 22px;
                top: 32px;
                bottom: 43px;

                display: flex;
                align-items: flex-end;
                justify-content: space-between;
                gap: 7px;

                pointer-events: none;
              }

              .titech-chart-skeleton__bars span {
                display: block;
                width: 100%;
                max-width: 34px;
                min-width: 3px;
                flex: 1 1 0;

                border-radius:
                  5px
                  5px
                  2px
                  2px;

                background:
                  linear-gradient(
                    180deg,
                    var(
                      --titech-skeleton-bar
                    ),
                    var(
                      --titech-skeleton-base
                    )
                  );

                opacity: 0.33;
              }

              /* ------------------------------------------------------------
                 Decorative trend path
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__trend {
                position: absolute;
                left: 70px;
                right: 20px;
                top: 28%;
                height: 36%;
                pointer-events: none;
              }

              .titech-chart-skeleton__trend::before,
              .titech-chart-skeleton__trend::after,
              .titech-chart-skeleton__trend span {
                position: absolute;
                display: block;
                height: 2px;
                border-radius: 999px;

                background:
                  var(
                    --titech-skeleton-trend
                  );

                opacity: 0.23;
              }

              .titech-chart-skeleton__trend
                span:nth-child(1) {
                left: 0%;
                top: 58%;
                width: 26%;

                transform:
                  rotate(-5deg);

                transform-origin:
                  right center;
              }

              .titech-chart-skeleton__trend
                span:nth-child(2) {
                left: 22%;
                top: 47%;
                width: 56%;

                transform:
                  rotate(7deg);

                transform-origin:
                  left center;
              }

              .titech-chart-skeleton__trend::before {
                content: "";
                left: 75%;
                top: 70%;
                width: 25%;

                transform:
                  rotate(-11deg);

                transform-origin:
                  left center;
              }

              .titech-chart-skeleton__trend::after {
                content: "";
                left: 47%;
                top: 25%;
                width: 31%;

                transform:
                  rotate(-2deg);

                transform-origin:
                  right center;
              }

              /* ------------------------------------------------------------
                 Footer
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 15px;
                flex-wrap: wrap;
                margin-top: 13px;
              }

              .titech-chart-skeleton__preserved-content {
                margin-top: 12px;
              }

              /* ------------------------------------------------------------
                 Accessibility
                 ---------------------------------------------------------- */

              .titech-chart-skeleton__live-region,
              .titech-chart-skeleton__sr-only {
                position: absolute;
                width: 1px;
                height: 1px;
                padding: 0;
                margin: -1px;
                overflow: hidden;
                clip: rect(
                  0,
                  0,
                  0,
                  0
                );
                white-space: nowrap;
                border: 0;
              }

              /* ------------------------------------------------------------
                 Compact variant
                 ---------------------------------------------------------- */

              .titech-chart-loading-skeleton--compact
                .titech-chart-skeleton__surface {
                padding: 14px;
              }

              .titech-chart-loading-skeleton--compact
                .titech-chart-skeleton__header-wrapper {
                margin-bottom: 13px;
              }

              .titech-chart-loading-skeleton--compact
                .titech-chart-skeleton__metrics {
                gap: 8px;
                margin-bottom: 12px;
              }

              .titech-chart-loading-skeleton--compact
                .titech-chart-skeleton__metric {
                min-height: 64px;
                padding: 10px;
              }

              .titech-chart-loading-skeleton--compact
                .titech-chart-skeleton__legend {
                gap: 10px;
                margin-bottom: 9px;
              }

              /* ------------------------------------------------------------
                 Spacious variant
                 ---------------------------------------------------------- */

              .titech-chart-loading-skeleton--spacious
                .titech-chart-skeleton__surface {
                padding: 26px;
              }

              .titech-chart-loading-skeleton--spacious
                .titech-chart-skeleton__header-wrapper {
                margin-bottom: 24px;
              }

              .titech-chart-loading-skeleton--spacious
                .titech-chart-skeleton__metrics {
                gap: 16px;
                margin-bottom: 23px;
              }

              .titech-chart-loading-skeleton--spacious
                .titech-chart-skeleton__metric {
                min-height: 90px;
                padding: 16px;
              }

              /* ------------------------------------------------------------
                 Responsive
                 ---------------------------------------------------------- */

              @media (max-width: 800px) {
                .titech-chart-skeleton__header {
                  flex-direction: column;
                  align-items: stretch;
                }

                .titech-chart-skeleton__header-actions {
                  justify-content: flex-start;
                }

                .titech-chart-skeleton__metrics {
                  grid-template-columns:
                    repeat(
                      2,
                      minmax(
                        0,
                        1fr
                      )
                    );
                }
              }

              @media (max-width: 560px) {
                .titech-chart-skeleton__header-actions {
                  width: 100%;
                }

                .titech-chart-skeleton__metrics {
                  grid-template-columns:
                    1fr;
                }

                .titech-chart-skeleton__legend {
                  gap: 9px;
                }

                .titech-chart-skeleton__plot {
                  min-height: 210px;
                }

                .titech-chart-skeleton__grid {
                  left: 50px;
                  right: 12px;
                }

                .titech-chart-skeleton__y-axis {
                  left: 7px;
                }

                .titech-chart-skeleton__bars {
                  left: 56px;
                  right: 15px;
                  gap: 4px;
                }

                .titech-chart-skeleton__trend {
                  left: 54px;
                  right: 15px;
                }

                .titech-chart-skeleton__x-axis {
                  left: 54px;
                  right: 14px;
                }
              }

              /* ------------------------------------------------------------
                 Reduced motion
                 ---------------------------------------------------------- */

              @media (prefers-reduced-motion: reduce) {
                .titech-chart-skeleton__block {
                  animation: none !important;
                  background:
                    var(
                      --titech-skeleton-base
                    );
                }
              }

              /* ------------------------------------------------------------
                 Print
                 ---------------------------------------------------------- */

              @media print {
                .titech-chart-loading-skeleton {
                  display: none !important;
                }
              }

              @keyframes titech-chart-skeleton-shimmer {
                0% {
                  background-position:
                    200%
                    0;
                }

                100% {
                  background-position:
                    -200%
                    0;
                }
              }
            `}
          </style>
        </section>
      );
    },
  ),
);

ChartLoadingSkeleton.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ChartLoadingSkeleton,
  ChartHeaderSkeleton,
  ChartMetricsSkeleton,
  ChartLegendSkeleton,
  ChartPlotSkeleton,
  ChartFooterSkeleton,
  SkeletonBlock,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartLoadingSkeleton;