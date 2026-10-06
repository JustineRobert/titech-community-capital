'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/CollectionPerformanceChart.jsx
 *
 * Purpose:
 *   Enterprise-grade collection performance visualization for TITech.
 *
 * Responsibilities:
 *   - Visualize collection targets versus actual collections.
 *   - Visualize collection performance percentage.
 *   - Support collection achievement and variance analytics.
 *   - Normalize heterogeneous API response shapes.
 *   - Support daily, weekly, monthly and custom reporting datasets.
 *   - Handle currency values safely for presentation.
 *   - Provide loading, error and empty states.
 *   - Support responsive rendering.
 *   - Provide accessible chart semantics and summary metrics.
 *   - Support external filter/query state without owning financial state.
 *   - Support Recharts-compatible composition.
 *
 * Financial integrity:
 *   - Presentation-only.
 *   - Does not create, mutate or settle transactions.
 *   - Does not modify balances, ledgers, journals or reconciliation records.
 *   - Does not treat queued/offline/pending/provider-accepted collections as
 *     settled funds.
 *   - Backend-authoritative values remain authoritative.
 *   - Performance percentage is an analytical ratio for display only.
 *
 * Canonical record:
 *
 *   {
 *     date: '2026-09-01',
 *     target: 5000000,
 *     collected: 4250000,
 *     collectionRate: 85
 *   }
 *
 * Supported aliases:
 *   target / targetAmount / collectionTarget / targetValue / expected
 *   collected / collection / collectedAmount / actual / actualCollection
 *   rate / collectionRate / achievementRate / performance / achievement
 *   date / period / timestamp / createdAt / reportingDate / label
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { collections: [] }
 *   { collectionPerformance: [] }
 *   { series: [] }
 *
 * ============================================================================
 */

import { TITECH_BRAND } from "../branding/brand";
import React, {
  memo,
  useCallback,
  useMemo,
} from 'react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechCollectionPerformanceChart';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_HEIGHT = 380;

const DEFAULT_MIN_HEIGHT = 260;

const DEFAULT_TITLE =
  'Collection Performance';

const DEFAULT_DESCRIPTION =
  'Actual collections compared with collection targets over time.';

const DEFAULT_EMPTY_MESSAGE =
  'No collection performance data is available for the selected period.';

const DEFAULT_TARGET = 0;

const RATE_CAP_FOR_DISPLAY = 9999;

const DEFAULT_MARGIN = {
  top: 16,
  right: 20,
  left: 8,
  bottom: 8,
};

/* ============================================================================
 * Generic helpers
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

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function hasValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== ''
  );
}

function firstDefined(object, keys) {
  if (!isObject(object)) {
    return undefined;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        object,
        key,
      ) &&
      hasValue(object[key])
    ) {
      return object[key];
    }
  }

  return undefined;
}

/* ============================================================================
 * Number helpers
 * ========================================================================== */

function toDisplayNumber(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (!hasValue(value)) {
    return 0;
  }

  if (
    isObject(value) &&
    Object.prototype.hasOwnProperty.call(
      value,
      '$numberDecimal',
    )
  ) {
    return toDisplayNumber(
      value.$numberDecimal,
    );
  }

  if (typeof value === 'string') {
    const normalized =
      value
        .replace(/,/g, '')
        .trim();

    if (!normalized) {
      return 0;
    }

    const parsed =
      Number(normalized);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  if (
    isObject(value) &&
    typeof value.toString ===
      'function'
  ) {
    const serialized =
      value.toString();

    if (
      serialized &&
      serialized !== '[object Object]'
    ) {
      const parsed =
        Number(
          serialized
            .replace(/,/g, '')
            .trim(),
        );

      return Number.isFinite(
        parsed,
      )
        ? parsed
        : 0;
    }
  }

  return 0;
}

function clampRate(value) {
  const number =
    toDisplayNumber(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      number,
      RATE_CAP_FOR_DISPLAY,
    ),
  );
}

/* ============================================================================
 * Date helpers
 * ========================================================================== */

function parseDate(value) {
  if (!hasValue(value)) {
    return null;
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function formatDateLabel(
  value,
  locale = DEFAULT_LOCALE,
) {
  const date =
    parseDate(value);

  if (!date) {
    return String(
      value ?? '',
    );
  }

  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      },
    ).format(date);
  } catch {
    return String(value);
  }
}

function formatAxisLabel(
  value,
  locale = DEFAULT_LOCALE,
) {
  const date =
    parseDate(value);

  if (!date) {
    const label =
      String(value ?? '');

    return label.length > 15
      ? `${label.slice(0, 15)}…`
      : label;
  }

  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        day: '2-digit',
        month: 'short',
      },
    ).format(date);
  } catch {
    return String(value);
  }
}

/* ============================================================================
 * Currency formatting
 * ========================================================================== */

function formatCurrency(
  value,
  {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    maximumFractionDigits = 0,
    minimumFractionDigits = 0,
  } = {},
) {
  const number =
    toDisplayNumber(value);

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        maximumFractionDigits,
        minimumFractionDigits,
      },
    ).format(number);
  } catch {
    return `${currency} ${Math.round(
      number,
    ).toLocaleString(locale)}`;
  }
}

function formatCompactCurrency(
  value,
  {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
  } = {},
) {
  const number =
    toDisplayNumber(value);

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        notation: 'compact',
        maximumFractionDigits:
          Math.abs(number) >=
          1_000_000
            ? 1
            : 0,
      },
    ).format(number);
  } catch {
    return formatCurrency(
      number,
      {
        currency,
        locale,
      },
    );
  }
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

function extractRecords(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!isObject(data)) {
    return [];
  }

  const candidates = [
    data.data,
    data.items,
    data.results,
    data.collections,
    data.collectionPerformance,
    data.series,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeCollectionRecord(
  record,
  index,
  locale,
) {
  const source =
    isObject(record)
      ? record
      : {};

  const rawDate =
    firstDefined(source, [
      'date',
      'period',
      'timestamp',
      'createdAt',
      'reportingDate',
      'collectionDate',
      'label',
      'name',
    ]);

  const rawTarget =
    firstDefined(source, [
      'target',
      'targetAmount',
      'collectionTarget',
      'targetValue',
      'expected',
      'expectedCollection',
      'expectedAmount',
      'goal',
    ]);

  const rawCollected =
    firstDefined(source, [
      'collected',
      'collection',
      'collectedAmount',
      'actual',
      'actualCollection',
      'actualAmount',
      'received',
      'receivedAmount',
    ]);

  const rawRate =
    firstDefined(source, [
      'rate',
      'collectionRate',
      'achievementRate',
      'performance',
      'achievement',
      'completionRate',
    ]);

  const target = Math.max(
    0,
    toDisplayNumber(rawTarget),
  );

  const collected = Math.max(
    0,
    toDisplayNumber(rawCollected),
  );

  /**
   * Prefer the server-provided performance rate.
   * Only calculate a display ratio where the server did not supply one.
   */
  const collectionRate =
    hasValue(rawRate)
      ? clampRate(rawRate)
      : target > 0
        ? clampRate(
            (collected / target) *
              100,
          )
        : 0;

  const variance =
    collected - target;

  const varianceRate =
    target > 0
      ? (variance / target) *
        100
      : 0;

  const timestamp = hasValue(
    rawDate,
  )
    ? String(rawDate)
    : '';

  const label = timestamp
    ? formatDateLabel(
        timestamp,
        locale,
      )
    : `Period ${index + 1}`;

  return {
    id:
      source.id ??
      source._id ??
      source.key ??
      `collection-${index}`,

    timestamp,

    label,

    target,

    collected,

    collectionRate,

    variance,

    varianceRate,

    status:
      source.status ??
      null,

    institutionId:
      source.institutionId ??
      source.tenantId ??
      null,

    groupId:
      source.groupId ??
      null,

    raw: record,
  };
}

function normalizeCollectionData(
  data,
  locale = DEFAULT_LOCALE,
) {
  return extractRecords(data).map(
    (
      record,
      index,
    ) =>
      normalizeCollectionRecord(
        record,
        index,
        locale,
      ),
  );
}

/* ============================================================================
 * Summary calculations
 * ========================================================================== */

function summarizeCollectionPerformance(
  data,
) {
  const totals = data.reduce(
    (accumulator, item) => {
      accumulator.target +=
        toDisplayNumber(
          item.target,
        );

      accumulator.collected +=
        toDisplayNumber(
          item.collected,
        );

      accumulator.variance +=
        toDisplayNumber(
          item.variance,
        );

      return accumulator;
    },
    {
      target: 0,
      collected: 0,
      variance: 0,
    },
  );

  const aggregateRate =
    totals.target > 0
      ? (totals.collected /
          totals.target) *
        100
      : 0;

  const highestRate =
    data.reduce(
      (maximum, item) =>
        Math.max(
          maximum,
          toDisplayNumber(
            item.collectionRate,
          ),
        ),
      0,
    );

  const highestCollected =
    data.reduce(
      (maximum, item) =>
        Math.max(
          maximum,
          toDisplayNumber(
            item.collected,
          ),
        ),
      0,
    );

  const achievedPeriods =
    data.filter(
      (item) =>
        item.target > 0 &&
        item.collected >=
          item.target,
    ).length;

  const underTargetPeriods =
    data.filter(
      (item) =>
        item.target > 0 &&
        item.collected <
          item.target,
    ).length;

  const zeroTargetPeriods =
    data.filter(
      (item) =>
        item.target <= 0,
    ).length;

  return {
    ...totals,
    aggregateRate,
    highestRate,
    highestCollected,
    achievedPeriods,
    underTargetPeriods,
    zeroTargetPeriods,
    periods: data.length,
  };
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

const CollectionPerformanceTooltip =
  memo(
    function CollectionPerformanceTooltip({
      active,
      payload,
      label,
      currency,
      locale,
      showVariance,
    }) {
      if (
        !active ||
        !Array.isArray(
          payload,
        ) ||
        payload.length === 0
      ) {
        return null;
      }

      const point =
        payload[0]?.payload ??
        {};

      return (
        <div
          role="dialog"
          aria-label={`Collection performance details for ${label || 'selected period'}`}
          style={{
            minWidth: 235,
            padding: 14,
            border:
              '1px solid var(--titech-border, #e2e8f0)',
            borderRadius: 12,
            background:
              'var(--titech-surface, var(--color-white))',
            color:
              'var(--titech-text-primary, #0f172a)',
            boxShadow:
              '0 14px 38px rgba(15, 23, 42, 0.14)',
          }}
        >
          <div
            style={{
              marginBottom: 10,
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {label ||
              'Collection performance'}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 8,
            }}
          >
            <TooltipRow
              label="Collection target"
              value={formatCurrency(
                point.target,
                {
                  currency,
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Amount collected"
              value={formatCurrency(
                point.collected,
                {
                  currency,
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Collection rate"
              value={`${toDisplayNumber(point.collectionRate).toFixed(1)}%`}
              emphasized
            />

            {showVariance ? (
              <TooltipRow
                label="Variance"
                value={formatCurrency(
                  point.variance,
                  {
                    currency,
                    locale,
                  },
                )}
                valueClassName={
                  point.variance >=
                  0
                    ? 'titech-collection-tooltip__positive'
                    : 'titech-collection-tooltip__negative'
                }
              />
            ) : null}
          </div>
        </div>
      );
    },
  );

CollectionPerformanceTooltip.displayName =
  'CollectionPerformanceTooltip';

const TooltipRow = memo(
  function TooltipRow({
    label,
    value,
    emphasized = false,
    valueClassName = '',
  }) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent:
            'space-between',
          gap: 15,
          alignItems: 'baseline',
          fontSize: 11,
          fontWeight:
            emphasized
              ? 800
              : 500,
        }}
      >
        <span
          style={{
            color:
              'var(--titech-text-secondary, #64748b)',
          }}
        >
          {label}
        </span>

        <strong
          className={
            valueClassName
          }
          style={{
            color:
              emphasized
                ? 'var(--titech-text-primary, #0f172a)'
                : undefined,
            fontVariantNumeric:
              'tabular-nums',
            whiteSpace:
              'nowrap',
          }}
        >
          {value}
        </strong>
      </div>
    );
  },
);

TooltipRow.displayName =
  'TooltipRow';

/* ============================================================================
 * Summary metric
 * ========================================================================== */

const SummaryMetric = memo(
  function SummaryMetric({
    label,
    value,
    helper,
  }) {
    return (
      <div
        style={{
          minWidth: 0,
        }}
      >
        <div
          style={{
            marginBottom: 4,
            fontSize: 10,
            lineHeight: 1.25,
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform:
              'uppercase',
            opacity: 0.62,
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 17,
            lineHeight: 1.25,
            fontWeight: 850,
            fontVariantNumeric:
              'tabular-nums',
            overflowWrap:
              'anywhere',
          }}
        >
          {value}
        </div>

        {helper ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 9,
              lineHeight: 1.4,
              opacity: 0.55,
            }}
          >
            {helper}
          </div>
        ) : null}
      </div>
    );
  },
);

SummaryMetric.displayName =
  'SummaryMetric';

/* ============================================================================
 * State components
 * ========================================================================== */

const StatePanel = memo(
  function StatePanel({
    type,
    title,
    message,
    action,
    height,
  }) {
    const isError =
      type === 'error';

    return (
      <div
        role={
          isError
            ? 'alert'
            : 'status'
        }
        style={{
          minHeight:
            Math.max(
              220,
              Math.min(
                Number(height) ||
                  DEFAULT_HEIGHT,
                360,
              ),
            ),
          display: 'grid',
          placeItems: 'center',
          alignContent: 'center',
          padding: 28,
          border: isError
            ? '1px solid var(--titech-danger-border, #fecaca)'
            : '1px dashed var(--titech-border-strong, #cbd5e1)',
          borderRadius: 12,
          background: isError
            ? 'var(--titech-danger-surface, #fff7f7)'
            : 'var(--titech-surface-muted, #f8fafc)',
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 42,
            height: 42,
            display: 'grid',
            placeItems: 'center',
            marginBottom: 10,
            borderRadius: 12,
            background:
              'var(--titech-surface, var(--color-white))',
            opacity: 0.58,
            fontSize: 22,
          }}
        >
          {type === 'loading'
            ? '…'
            : type === 'error'
              ? '!'
              : '◌'}
        </div>

        <div
          style={{
            marginBottom: 5,
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          {title}
        </div>

        <div
          style={{
            maxWidth: 480,
            color:
              'var(--titech-text-secondary, #64748b)',
            fontSize: 11,
            lineHeight: 1.55,
          }}
        >
          {message}
        </div>

        {action ? (
          <div
            style={{
              marginTop: 14,
            }}
          >
            {action}
          </div>
        ) : null}
      </div>
    );
  },
);

StatePanel.displayName =
  'StatePanel';

/* ============================================================================
 * Main component
 * ========================================================================== */

const CollectionPerformanceChart =
  memo(function CollectionPerformanceChart({
    data = [],

    title =
      DEFAULT_TITLE,

    description =
      DEFAULT_DESCRIPTION,

    currency =
      DEFAULT_CURRENCY,

    locale =
      DEFAULT_LOCALE,

    height =
      DEFAULT_HEIGHT,

    loading = false,

    error = null,

    emptyMessage =
      DEFAULT_EMPTY_MESSAGE,

    emptyAction = null,

    onRetry = null,

    className = '',

    style = undefined,

    showSummary = true,

    showLegend = true,

    showGrid = true,

    showXAxis = true,

    showYAxis = true,

    showRateAxis = true,

    showRateLine = true,

    showVariance = true,

    showLabels = false,

    showZeroLine = true,

    showFooter = true,

    interactive = true,

    animate = false,

    animationDuration = 500,

    barGap = 6,

    targetBarSize = 22,

    collectedBarSize = 22,

    targetColor =
      'var(--titech-chart-target, #94a3b8)',

    collectedColor =
      'var(--titech-chart-collected, #0f766e)',

    rateColor =
      'var(--titech-chart-rate, #2563eb)',

    underTargetColor =
      'var(--titech-chart-under-target, #b45309)',

    onPointClick = null,

    onPointFocus = null,

    xAxisFormatter = null,

    yAxisFormatter = null,

    rateFormatter = null,

    valueFormatter = null,

    ariaLabel =
      'TITech collection performance chart',

    testId = null,
  }) {
    const normalizedData =
      useMemo(
        () =>
          normalizeCollectionData(
            data,
            locale,
          ),
        [data, locale],
      );

    const summary =
      useMemo(
        () =>
          summarizeCollectionPerformance(
            normalizedData,
          ),
        [
          normalizedData,
        ],
      );

    const resolvedHeight =
      useMemo(() => {
        const numeric =
          Number(height);

        if (
          Number.isFinite(
            numeric,
          ) &&
          numeric > 0
        ) {
          return Math.max(
            240,
            numeric,
          );
        }

        return DEFAULT_HEIGHT;
      }, [height]);

    const xAxisTick =
      useCallback(
        (value) => {
          if (
            typeof xAxisFormatter ===
            'function'
          ) {
            return xAxisFormatter(
              value,
            );
          }

          return formatAxisLabel(
            value,
            locale,
          );
        },
        [
          xAxisFormatter,
          locale,
        ],
      );

    const yAxisTick =
      useCallback(
        (value) => {
          if (
            typeof yAxisFormatter ===
            'function'
          ) {
            return yAxisFormatter(
              value,
              currency,
            );
          }

          return formatCompactCurrency(
            value,
            {
              currency,
              locale,
            },
          );
        },
        [
          yAxisFormatter,
          currency,
          locale,
        ],
      );

    const rateAxisTick =
      useCallback(
        (value) => {
          if (
            typeof rateFormatter ===
            'function'
          ) {
            return rateFormatter(
              value,
            );
          }

          return `${Number(value).toFixed(0)}%`;
        },
        [rateFormatter],
      );

    const tooltipContent =
      useMemo(
        () => (
          <CollectionPerformanceTooltip
            currency={
              currency
            }
            locale={locale}
            showVariance={
              showVariance
            }
          />
        ),
        [
          currency,
          locale,
          showVariance,
        ],
      );

    const rootClassName =
      classNames(
        'titech-collection-performance-chart',
        className,
      );

    const handlePointClick =
      useCallback(
        (payload) => {
          if (
            typeof onPointClick ===
            'function'
          ) {
            onPointClick(
              payload,
            );
          }
        },
        [onPointClick],
      );

    if (loading) {
      return (
        <section
          className={
            rootClassName
          }
          aria-busy="true"
          aria-label={`${title} loading`}
          style={{
            width: '100%',
            minWidth: 0,
            ...style,
          }}
        >
          <ChartLoadingState
            title={title}
            description={
              description
            }
            height={
              resolvedHeight
            }
          />
        </section>
      );
    }

    if (error) {
      const message =
        typeof error ===
        'string'
          ? error
          : error?.message ||
            'An unexpected error occurred while loading collection performance data.';

      return (
        <section
          className={
            rootClassName
          }
          role="alert"
          aria-label={`${title} error`}
          style={{
            width: '100%',
            minWidth: 0,
            ...style,
          }}
        >
          <ChartFrame
            title={title}
            description={
              description
            }
            currency={
              currency
            }
          >
            <StatePanel
              type="error"
              title="Unable to load collection performance"
              message={message}
              action={
                typeof onRetry ===
                'function' ? (
                  <button
                    type="button"
                    onClick={
                      onRetry
                    }
                    style={{
                      minHeight: 38,
                      padding:
                        '8px 14px',
                      border:
                        '1px solid var(--titech-primary, #0f172a)',
                      borderRadius: 8,
                      background:
                        'var(--titech-primary, #0f172a)',
                      color:
                        TITECH_BRAND.colors.white,
                      cursor:
                        'pointer',
                      font:
                        'inherit',
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    Retry
                  </button>
                ) : null
              }
              height={
                resolvedHeight
              }
            />
          </ChartFrame>
        </section>
      );
    }

    if (
      normalizedData.length ===
      0
    ) {
      return (
        <section
          className={
            rootClassName
          }
          aria-label={`${title} empty state`}
          style={{
            width: '100%',
            minWidth: 0,
            ...style,
          }}
        >
          <ChartFrame
            title={title}
            description={
              description
            }
            currency={
              currency
            }
          >
            <StatePanel
              type="empty"
              title="No collection data"
              message={
                emptyMessage
              }
              action={
                emptyAction
              }
              height={
                resolvedHeight
              }
            />
          </ChartFrame>
        </section>
      );
    }

    const getBarColor =
      useCallback(
        (
          entry,
          dataKey,
        ) => {
          if (
            dataKey ===
            'target'
          ) {
            return targetColor;
          }

          if (
            dataKey ===
            'collected'
          ) {
            if (
              Number(
                entry?.collected,
              ) <
              Number(
                entry?.target,
              )
            ) {
              return (
                underTargetColor
              );
            }

            return collectedColor;
          }

          return undefined;
        },
        [
          targetColor,
          underTargetColor,
          collectedColor,
        ],
      );

    return (
      <section
        className={
          rootClassName
        }
        aria-label={
          ariaLabel
        }
        data-testid={
          testId ||
          undefined
        }
        data-component={
          COMPONENT_NAME
        }
        style={{
          width: '100%',
          minWidth: 0,
          ...style,
        }}
      >
        <ChartFrame
          title={title}
          description={
            description
          }
          currency={
            currency
          }
        >
          {/* --------------------------------------------------------------
              Summary
              ------------------------------------------------------------ */}
          {showSummary ? (
            <div
              className="titech-collection-performance__summary"
              style={{
                display:
                  'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(145px, 1fr))',
                gap: 12,
                marginBottom: 22,
              }}
            >
              <SummaryMetric
                label="Collection target"
                value={formatCurrency(
                  summary.target,
                  {
                    currency,
                    locale,
                  },
                )}
                helper={`${summary.periods} reporting period${
                  summary.periods ===
                  1
                    ? ''
                    : 's'
                }`}
              />

              <SummaryMetric
                label="Collected"
                value={formatCurrency(
                  summary.collected,
                  {
                    currency,
                    locale,
                  },
                )}
                helper="Amount recorded as collected"
              />

              <SummaryMetric
                label="Achievement"
                value={`${summary.aggregateRate.toFixed(1)}%`}
                helper={
                  summary.aggregateRate >=
                  100
                    ? 'At or above aggregate target'
                    : 'Below aggregate target'
                }
              />

              <SummaryMetric
                label="Variance"
                value={formatCurrency(
                  summary.variance,
                  {
                    currency,
                    locale,
                  },
                )}
                helper={`${summary.achievedPeriods} period${
                  summary.achievedPeriods ===
                  1
                    ? ''
                    : 's'
                } at or above target`}
              />
            </div>
          ) : null}

          {/* --------------------------------------------------------------
              Performance chart
              ------------------------------------------------------------ */}
          <div
            role="img"
            aria-label={`${title}. ${description}`}
            style={{
              width: '100%',
              minWidth: 0,
              height:
                resolvedHeight,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={
                DEFAULT_MIN_HEIGHT
              }
            >
              <BarChart
                data={
                  normalizedData
                }
                margin={
                  DEFAULT_MARGIN
                }
                barGap={
                  barGap
                }
                onClick={
                  interactive
                    ? (
                        state,
                      ) => {
                        const activePayload =
                          state?.activePayload?.[0];

                        if (
                          activePayload
                            ?.payload
                        ) {
                          handlePointClick(
                            activePayload.payload,
                          );
                        }
                      }
                    : undefined
                }
              >
                {showGrid ? (
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="var(--titech-chart-grid, #cbd5e1)"
                    opacity={0.45}
                  />
                ) : null}

                {showXAxis ? (
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={
                      xAxisTick
                    }
                    tickLine={false}
                    axisLine={false}
                    minTickGap={
                      28
                    }
                    dy={8}
                    tick={{
                      fontSize: 10,
                      fill:
                        'var(--titech-chart-axis, #64748b)',
                    }}
                  />
                ) : null}

                {showYAxis ? (
                  <YAxis
                    yAxisId="amount"
                    tickFormatter={
                      yAxisTick
                    }
                    tickLine={false}
                    axisLine={false}
                    width={88}
                    tick={{
                      fontSize: 10,
                      fill:
                        'var(--titech-chart-axis, #64748b)',
                    }}
                  />
                ) : null}

                {showRateAxis &&
                showRateLine ? (
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[
                      0,
                      'auto',
                    ]}
                    tickFormatter={
                      rateAxisTick
                    }
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tick={{
                      fontSize: 10,
                      fill:
                        'var(--titech-chart-axis, #64748b)',
                    }}
                  />
                ) : null}

                <Tooltip
                  content={
                    tooltipContent
                  }
                  cursor={{
                    fill:
                      'var(--titech-chart-tooltip-cursor, #94a3b8)',
                    opacity: 0.06,
                  }}
                />

                {showLegend ? (
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={34}
                    iconType="circle"
                    wrapperStyle={{
                      fontSize: 11,
                      color:
                        'var(--titech-chart-legend, #475569)',
                    }}
                  />
                ) : null}

                {showZeroLine ? (
                  <ReferenceLine
                    y={0}
                    yAxisId="amount"
                    stroke="var(--titech-chart-zero, #94a3b8)"
                    strokeDasharray="4 4"
                    strokeOpacity={
                      0.6
                    }
                  />
                ) : null}

                <Bar
                  yAxisId="amount"
                  dataKey="target"
                  name="Collection target"
                  fill={
                    targetColor
                  }
                  fillOpacity={
                    0.42
                  }
                  stroke={
                    targetColor
                  }
                  strokeWidth={
                    1
                  }
                  barSize={
                    targetBarSize
                  }
                  radius={[
                    4,
                    4,
                    0,
                    0,
                  ]}
                  isAnimationActive={
                    animate
                  }
                  animationDuration={
                    animationDuration
                  }
                  cursor={
                    interactive
                      ? 'pointer'
                      : undefined
                  }
                >
                  {normalizedData.map(
                    (
                      entry,
                      index,
                    ) => (
                      <Cell
                        key={`target-${entry.id || index}`}
                        fill={
                          getBarColor(
                            entry,
                            'target',
                          )
                        }
                      />
                    ),
                  )}

                  {showLabels ? (
                    <LabelList
                      dataKey="target"
                      formatter={(
                        value,
                      ) =>
                        formatCompactCurrency(
                          value,
                          {
                            currency,
                            locale,
                          },
                        )
                      }
                      position="top"
                      style={{
                        fontSize: 9,
                        fill:
                          'var(--titech-chart-label, #64748b)',
                      }}
                    />
                  ) : null}
                </Bar>

                <Bar
                  yAxisId="amount"
                  dataKey="collected"
                  name="Amount collected"
                  fill={
                    collectedColor
                  }
                  stroke={
                    collectedColor
                  }
                  strokeWidth={
                    1
                  }
                  barSize={
                    collectedBarSize
                  }
                  radius={[
                    4,
                    4,
                    0,
                    0,
                  ]}
                  isAnimationActive={
                    animate
                  }
                  animationDuration={
                    animationDuration
                  }
                  cursor={
                    interactive
                      ? 'pointer'
                      : undefined
                  }
                >
                  {normalizedData.map(
                    (
                      entry,
                      index,
                    ) => (
                      <Cell
                        key={`collected-${entry.id || index}`}
                        fill={
                          getBarColor(
                            entry,
                            'collected',
                          )
                        }
                      />
                    ),
                  )}

                  {showLabels ? (
                    <LabelList
                      dataKey="collected"
                      formatter={(
                        value,
                      ) =>
                        formatCompactCurrency(
                          value,
                          {
                            currency,
                            locale,
                          },
                        )
                      }
                      position="top"
                      style={{
                        fontSize: 9,
                        fill:
                          'var(--titech-chart-label, #0f172a)',
                        fontWeight: 700,
                      }}
                    />
                  ) : null}
                </Bar>

                {showRateLine ? (
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="collectionRate"
                    name="Collection rate"
                    stroke={
                      rateColor
                    }
                    strokeWidth={
                      2.5
                    }
                    dot={{
                      r: 3,
                      strokeWidth: 1.5,
                    }}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                    }}
                    connectNulls
                    isAnimationActive={
                      animate
                    }
                    animationDuration={
                      animationDuration
                    }
                  />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* --------------------------------------------------------------
              Footer
              ------------------------------------------------------------ */}
          {showFooter ? (
            <footer
              style={{
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'center',
                gap: 12,
                flexWrap:
                  'wrap',
                marginTop: 14,
                fontSize: 10,
                lineHeight: 1.4,
                opacity: 0.58,
              }}
            >
              <span>
                {summary.achievedPeriods}{' '}
                at/above target
                {' · '}
                {
                  summary.underTargetPeriods
                }{' '}
                below target
              </span>

              <span>
                TITech Community Capital · Collection analytics
              </span>
            </footer>
          ) : null}

          <style>
            {`
              .titech-collection-performance-chart {
                --titech-collection-positive:
                  var(
                    --titech-success,
                    #047857
                  );

                --titech-collection-negative:
                  var(
                    --titech-danger,
                    #b91c1c
                  );
              }

              .titech-collection-performance-chart
                * {
                box-sizing: border-box;
              }

              .titech-collection-tooltip__positive {
                color:
                  var(
                    --titech-collection-positive
                  );
              }

              .titech-collection-tooltip__negative {
                color:
                  var(
                    --titech-collection-negative
                  );
              }

              .titech-collection-performance-chart
                .recharts-legend-item-text {
                font-size: 10px;
              }

              @media (max-width: 640px) {
                .titech-collection-performance-chart
                  .recharts-legend-wrapper {
                  position: static !important;
                  width: 100% !important;
                  height: auto !important;
                  margin-bottom: 8px;
                }
              }

              @media (prefers-reduced-motion: reduce) {
                .titech-collection-performance-chart
                  *,
                .titech-collection-performance-chart
                  *::before,
                .titech-collection-performance-chart
                  *::after {
                  animation: none !important;
                  transition: none !important;
                }
              }

              @media print {
                .titech-collection-performance-chart {
                  break-inside: avoid;
                  page-break-inside: avoid;
                }
              }
            `}
          </style>
        </ChartFrame>
      </section>
    );
  });

CollectionPerformanceChart.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Chart frame
 * ========================================================================== */

const ChartFrame = memo(
  function ChartFrame({
    title,
    description,
    currency,
    children,
  }) {
    return (
      <div
        style={{
          width: '100%',
          minWidth: 0,
          border:
            '1px solid var(--titech-border, #e2e8f0)',
          borderRadius: 16,
          padding: 20,
          background:
            'var(--titech-surface, var(--color-white))',
          color:
            'var(--titech-text-primary, #0f172a)',
        }}
      >
        <header
          style={{
            display:
              'flex',
            justifyContent:
              'space-between',
            alignItems:
              'flex-start',
            gap: 16,
            flexWrap:
              'wrap',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              minWidth: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                lineHeight: 1.3,
                fontWeight: 800,
                letterSpacing:
                  '-0.015em',
              }}
            >
              {title}
            </h2>

            {description ? (
              <p
                style={{
                  maxWidth: 740,
                  margin:
                    '6px 0 0',
                  color:
                    'var(--titech-text-secondary, #64748b)',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                {description}
              </p>
            ) : null}
          </div>

          {currency ? (
            <span
              aria-label={`Reporting currency ${currency}`}
              style={{
                flexShrink: 0,
                border:
                  '1px solid var(--titech-border, #e2e8f0)',
                borderRadius: 8,
                padding:
                  '6px 9px',
                fontSize: 10,
                lineHeight: 1.2,
                fontWeight: 800,
                letterSpacing:
                  '0.06em',
                textTransform:
                  'uppercase',
              }}
            >
              {currency}
            </span>
          ) : null}
        </header>

        {children}
      </div>
    );
  },
);

ChartFrame.displayName =
  'ChartFrame';

/* ============================================================================
 * Loading state
 * ========================================================================== */

const ChartLoadingState = memo(
  function ChartLoadingState({
    title,
    description,
    height,
  }) {
    return (
      <div
        style={{
          width: '100%',
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: '30%',
            minWidth: 130,
            height: 17,
            marginBottom: 8,
            borderRadius: 5,
            background:
              'var(--titech-skeleton, #e2e8f0)',
          }}
        />

        {description ? (
          <div
            style={{
              width: '54%',
              minWidth: 190,
              height: 10,
              marginBottom: 20,
              borderRadius: 4,
              background:
                'var(--titech-skeleton-muted, #f1f5f9)',
            }}
          />
        ) : null}

        <div
          style={{
            minHeight:
              Math.max(
                240,
                Number(height) ||
                  DEFAULT_HEIGHT,
              ),
            borderRadius: 12,
            background:
              'linear-gradient(90deg, var(--titech-skeleton, #e2e8f0) 25%, var(--titech-skeleton-muted, #f8fafc) 50%, var(--titech-skeleton, #e2e8f0) 75%)',
            backgroundSize:
              '200% 100%',
            animation:
              'titech-collection-performance-loading 1.5s ease-in-out infinite',
          }}
          aria-hidden="true"
        />

        <span
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {title} loading
        </span>

        <style>
          {`
            @keyframes titech-collection-performance-loading {
              0% {
                background-position: 200% 0;
              }

              100% {
                background-position: -200% 0;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .titech-collection-performance-chart [aria-hidden="true"] {
                animation: none !important;
              }
            }
          `}
        </style>
      </div>
    );
  },
);

ChartLoadingState.displayName =
  'ChartLoadingState';

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  CollectionPerformanceChart,
  CollectionPerformanceTooltip,
  ChartFrame,
  ChartLoadingState,
  SummaryMetric,
  formatCurrency,
  formatCompactCurrency,
  normalizeCollectionRecord,
  normalizeCollectionData,
  summarizeCollectionPerformance,
  toDisplayNumber,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default CollectionPerformanceChart;