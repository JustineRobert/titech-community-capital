'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/FinancialTrendChart.jsx
 *
 * Purpose:
 *   Enterprise-grade financial trend visualization for TITech.
 *
 * Responsibilities:
 *   - Visualize one or more financial time series.
 *   - Support amount, number and percentage series.
 *   - Support multiple currencies through caller-supplied formatting.
 *   - Support server-supplied series metadata.
 *   - Support heterogeneous API response envelopes.
 *   - Support explicit server-provided values without silently recalculating
 *     authoritative financial data.
 *   - Provide summary metrics for current, prior and change values.
 *   - Provide loading, error and empty states.
 *   - Provide responsive chart rendering.
 *   - Provide accessible semantics.
 *   - Support custom tooltip and formatter hooks.
 *   - Remain independent from ledger, transaction and state-management logic.
 *
 * Financial integrity:
 *   - Presentation-only.
 *   - Does NOT mutate balances, transactions, journals or ledger entries.
 *   - Does NOT determine settlement.
 *   - Does NOT convert pending, queued, offline, processing or UNKNOWN
 *     transactions into settled financial state.
 *   - Server-authoritative financial values remain authoritative.
 *   - Any locally derived change/summary value is explicitly marked as a
 *     presentation metric.
 *
 * Supported canonical data:
 *
 *   {
 *     date: '2026-09-01',
 *     collections: 12500000,
 *     savings: 8500000,
 *     loans: 4200000
 *   }
 *
 * Recommended explicit series:
 *
 *   series={[
 *     {
 *       key: 'collections',
 *       label: 'Collections',
 *       color: 'var(--titech-chart-series-1)',
 *       valueType: 'currency',
 *     },
 *     {
 *       key: 'savings',
 *       label: 'Savings',
 *       color: 'var(--titech-chart-series-2)',
 *       valueType: 'currency',
 *     },
 *   ]}
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { rows: [] }
 *   { seriesData: [] }
 *   { trend: [] }
 *   { trends: [] }
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useMemo,
} from 'react';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
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
  'TITechFinancialTrendChart';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_HEIGHT = 360;

const DEFAULT_MIN_HEIGHT = 250;

const DEFAULT_MAX_SERIES = 8;

const DEFAULT_MAX_POINTS = 500;

const DEFAULT_TITLE =
  'Financial Trend';

const DEFAULT_DESCRIPTION =
  'Financial movement over the selected reporting period.';

const DEFAULT_EMPTY_MESSAGE =
  'No financial trend data is available for the selected period.';

const DEFAULT_ERROR_MESSAGE =
  'Unable to load financial trend data.';

const DEFAULT_COLORS = [
  'var(--titech-chart-series-1)',
  'var(--titech-chart-series-2)',
  'var(--titech-chart-series-3)',
  'var(--titech-chart-series-4)',
  'var(--titech-chart-series-5)',
  'var(--titech-chart-series-6)',
  'var(--titech-chart-series-7)',
  'var(--titech-chart-series-8)',
];

const DEFAULT_MARGIN = {
  top: 14,
  right: 16,
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
 * Numeric helpers
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
    const normalized = value
      .replace(/,/g, '')
      .trim();

    if (!normalized) {
      return 0;
    }

    const parsed = Number(
      normalized,
    );

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
      const parsed = Number(
        serialized
          .replace(/,/g, '')
          .trim(),
      );

      return Number.isFinite(parsed)
        ? parsed
        : 0;
    }
  }

  return 0;
}

function isNumericLike(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return true;
  }

  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value
    .replace(/,/g, '')
    .trim();

  return (
    normalized !== '' &&
    Number.isFinite(
      Number(normalized),
    )
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

function formatAxisDate(
  value,
  locale = DEFAULT_LOCALE,
) {
  const date =
    parseDate(value);

  if (!date) {
    const text =
      String(value ?? '');

    return text.length > 14
      ? `${text.slice(0, 14)}…`
      : text;
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
 * Financial formatting
 * ========================================================================== */

function formatNumber(
  value,
  {
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
        maximumFractionDigits,
        minimumFractionDigits,
      },
    ).format(number);
  } catch {
    return String(number);
  }
}

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

function formatPercent(
  value,
  maximumFractionDigits = 1,
) {
  return `${toDisplayNumber(
    value,
  ).toFixed(
    maximumFractionDigits,
  )}%`;
}

function formatSeriesValue(
  value,
  series,
  {
    currency,
    locale,
  },
) {
  const valueType =
    String(
      series?.valueType ??
        'number',
    ).toLowerCase();

  switch (valueType) {
    case 'currency':
      return formatCurrency(
        value,
        {
          currency:
            series?.currency ??
            currency,
          locale:
            series?.locale ??
            locale,
          maximumFractionDigits:
            series?.maximumFractionDigits ??
            0,
          minimumFractionDigits:
            series?.minimumFractionDigits ??
            0,
        },
      );

    case 'compact-currency':
      return formatCompactCurrency(
        value,
        {
          currency:
            series?.currency ??
            currency,
          locale:
            series?.locale ??
            locale,
        },
      );

    case 'percent':
    case 'percentage':
      return formatPercent(
        value,
        series?.maximumFractionDigits ??
          1,
      );

    case 'integer':
      return formatNumber(
        value,
        {
          locale,
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        },
      );

    case 'number':
    default:
      return formatNumber(
        value,
        {
          locale:
            series?.locale ??
            locale,
          maximumFractionDigits:
            series?.maximumFractionDigits ??
            2,
          minimumFractionDigits:
            series?.minimumFractionDigits ??
            0,
        },
      );
  }
}

/* ============================================================================
 * Data extraction
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
    data.rows,
    data.seriesData,
    data.trend,
    data.trends,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function detectDateField(record) {
  return (
    firstDefined(record, [
      'date',
      'period',
      'timestamp',
      'time',
      'createdAt',
      'reportingDate',
      'transactionDate',
      'postedAt',
      'label',
    ]) ?? ''
  );
}

/* ============================================================================
 * Series inference / normalization
 * ========================================================================== */

function normalizeSeriesDefinition(
  series,
  index,
) {
  const source =
    isObject(series)
      ? series
      : {};

  const key =
    firstDefined(source, [
      'key',
      'dataKey',
      'id',
      'code',
      'name',
    ]) ??
    `series-${index}`;

  const label =
    firstDefined(source, [
      'label',
      'name',
      'title',
      'dataKey',
    ]) ??
    String(key);

  return {
    ...source,

    key: String(key),

    label: String(label),

    dataKey:
      source.dataKey ??
      String(key),

    color:
      source.color ??
      source.stroke ??
      DEFAULT_COLORS[
        index %
          DEFAULT_COLORS.length
      ],

    valueType:
      source.valueType ??
      'number',

    axis:
      source.axis ??
      'primary',

    chartType:
      source.chartType ??
      'line',

    hidden:
      Boolean(source.hidden),

    disabled:
      Boolean(source.disabled),

    fillOpacity:
      Number.isFinite(
        Number(
          source.fillOpacity,
        ),
      )
        ? Number(
            source.fillOpacity,
          )
        : 0.06,

    strokeWidth:
      Number.isFinite(
        Number(
          source.strokeWidth,
        ),
      )
        ? Number(
            source.strokeWidth,
          )
        : 2.4,

    unit:
      source.unit ??
      null,

    currency:
      source.currency ??
      null,

    description:
      source.description ??
      null,
  };
}

function inferSeriesDefinitions(
  records,
  explicitSeries,
  maximum,
) {
  if (
    Array.isArray(
      explicitSeries,
    ) &&
    explicitSeries.length >
      0
  ) {
    return explicitSeries
      .slice(0, maximum)
      .map(
        normalizeSeriesDefinition,
      );
  }

  if (
    records.length === 0
  ) {
    return [];
  }

  const firstRecord =
    records[0];

  if (
    !isObject(
      firstRecord,
    )
  ) {
    return [];
  }

  const dateKeys = new Set([
    'date',
    'period',
    'timestamp',
    'time',
    'createdAt',
    'reportingDate',
    'transactionDate',
    'postedAt',
    'label',
  ]);

  const metricKeys =
    Object.keys(
      firstRecord,
    ).filter(
      (key) =>
        !dateKeys.has(
          key,
        ) &&
        isNumericLike(
          firstRecord[key],
        ),
    );

  return metricKeys
    .slice(0, maximum)
    .map(
      (key, index) =>
        normalizeSeriesDefinition(
          {
            key,
            dataKey: key,
            label: key,
          },
          index,
        ),
    );
}

function normalizeTrendData(
  data,
  series,
  maximumPoints,
  locale,
) {
  const records =
    extractRecords(data)
      .slice(
        0,
        Math.max(
          1,
          maximumPoints,
        ),
      );

  return records.map(
    (record, index) => {
      const source =
        isObject(record)
          ? record
          : {};

      const timestamp =
        detectDateField(
          source,
        );

      const output = {
        _index: index,
        timestamp: hasValue(
          timestamp,
        )
          ? String(
              timestamp,
            )
          : '',
        label: hasValue(
          timestamp,
        )
          ? formatDateLabel(
              timestamp,
              locale,
            )
          : `Period ${index + 1}`,
      };

      series.forEach(
        (definition) => {
          const rawValue =
            firstDefined(
              source,
              [
                definition.dataKey,
                definition.key,
              ],
            );

          output[
            definition.key
          ] = toDisplayNumber(
            rawValue,
          );
        },
      );

      return output;
    },
  );
}

/* ============================================================================
 * Summary calculations
 * ========================================================================== */

function calculateSeriesSummary(
  data,
  series,
) {
  return series.map(
    (definition) => {
      const values =
        data.map(
          (point) =>
            toDisplayNumber(
              point[
                definition.key
              ],
            ),
        );

      const current =
        values.length > 0
          ? values[
              values.length - 1
            ]
          : 0;

      const previous =
        values.length > 1
          ? values[
              values.length - 2
            ]
          : null;

      const minimum =
        values.length > 0
          ? Math.min(...values)
          : 0;

      const maximum =
        values.length > 0
          ? Math.max(...values)
          : 0;

      const change =
        previous !== null
          ? current -
            previous
          : null;

      const changePercent =
        previous !== null &&
        previous !== 0
          ? (change /
              Math.abs(
                previous,
              )) *
            100
          : null;

      const total =
        values.reduce(
          (sum, value) =>
            sum + value,
          0,
        );

      return {
        ...definition,

        current,

        previous,

        minimum,

        maximum,

        change,

        changePercent,

        total,

        direction:
          change === null
            ? 'flat'
            : change > 0
              ? 'up'
              : change < 0
                ? 'down'
                : 'flat',
      };
    },
  );
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

const FinancialTrendTooltip =
  memo(
    function FinancialTrendTooltip({
      active,
      payload,
      label,
      series,
      currency,
      locale,
      showChange,
      pointFormatter,
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

      const rows =
        payload
          .filter(
            (entry) =>
              entry?.dataKey,
          )
          .map((entry) => {
            const definition =
              series.find(
                (item) =>
                  item.key ===
                    String(
                      entry.dataKey,
                    ) ||
                  item.dataKey ===
                    entry.dataKey,
              );

            const value =
              toDisplayNumber(
                entry.value,
              );

            return {
              key:
                String(
                  entry.dataKey,
                ),

              label:
                definition?.label ??
                entry.name ??
                String(
                  entry.dataKey,
                ),

              value,

              color:
                definition?.color ??
                entry.color ??
                DEFAULT_COLORS[0],

              valueType:
                definition?.valueType ??
                'number',

              currency:
                definition?.currency ??
                currency,

              unit:
                definition?.unit ??
                null,
            };
          });

      return (
        <div
          role="dialog"
          aria-label={`Financial trend details for ${label || 'selected period'}`}
          style={{
            minWidth: 235,
            maxWidth: 340,
            padding: 13,
            border:
              '1px solid var(--titech-border)',
            borderRadius: 12,
            background:
              'var(--titech-surface)',
            color:
              'var(--titech-text-primary)',
            boxShadow:
              '0 14px 40px rgba(15, 23, 42, 0.14)',
          }}
        >
          <div
            style={{
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom:
                '1px solid var(--titech-border)',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {label ||
              'Selected period'}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 7,
            }}
          >
            {rows.map(
              (row) => {
                const formattedValue =
                  typeof pointFormatter ===
                  'function'
                    ? pointFormatter(
                        row.value,
                        row,
                        point,
                      )
                    : formatSeriesValue(
                        row.value,
                        row,
                        {
                          currency:
                            row.currency ??
                            currency,
                          locale,
                        },
                      );

                return (
                  <div
                    key={
                      row.key
                    }
                    style={{
                      display:
                        'flex',
                      justifyContent:
                        'space-between',
                      alignItems:
                        'baseline',
                      gap: 14,
                      fontSize: 10,
                    }}
                  >
                    <div
                      style={{
                        display:
                          'flex',
                        alignItems:
                          'center',
                        gap: 7,
                        minWidth: 0,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          flex:
                            '0 0 auto',
                          borderRadius:
                            '50%',
                          background:
                            row.color,
                        }}
                      />

                      <span
                        style={{
                          minWidth:
                            0,
                          color:
                            'var(--titech-text-secondary)',
                          overflowWrap:
                            'anywhere',
                        }}
                      >
                        {
                          row.label
                        }
                      </span>
                    </div>

                    <strong
                      style={{
                        flex:
                          '0 0 auto',
                        fontVariantNumeric:
                          'tabular-nums',
                        textAlign:
                          'right',
                      }}
                    >
                      {
                        formattedValue
                      }
                    </strong>
                  </div>
                );
              },
            )}
          </div>

          {showChange &&
          rows.length ===
            1 ? (
            <div
              style={{
                marginTop: 9,
                paddingTop: 8,
                borderTop:
                  '1px solid var(--titech-border)',
                color:
                  'var(--titech-text-secondary)',
                fontSize: 9,
              }}
            >
              Point values are descriptive
              analytics; authoritative
              financial state remains
              server-side.
            </div>
          ) : null}
        </div>
      );
    },
  );

FinancialTrendTooltip.displayName =
  'FinancialTrendTooltip';

/* ============================================================================
 * Summary metric
 * ========================================================================== */

const TrendSummaryCard =
  memo(
    function TrendSummaryCard({
      summary,
      currency,
      locale,
      compact,
      valueFormatter,
      showChange,
      showTotal,
    }) {
      const formattedCurrent =
        typeof valueFormatter ===
        'function'
          ? valueFormatter(
              summary.current,
              summary,
            )
          : formatSeriesValue(
              summary.current,
              summary,
              {
                currency:
                  summary.currency ??
                  currency,
                locale,
              },
            );

      const formattedChange =
        summary.change !==
          null &&
        summary.change !==
          undefined
          ? typeof valueFormatter ===
            'function'
            ? valueFormatter(
                summary.change,
                summary,
              )
            : formatSeriesValue(
                summary.change,
                summary,
                {
                  currency:
                    summary.currency ??
                    currency,
                  locale,
                },
              )
          : null;

      const changePercentage =
        summary.changePercent !==
          null &&
        summary.changePercent !==
          undefined
          ? `${summary.changePercent > 0 ? '+' : ''}${formatPercent(summary.changePercent)}`
          : null;

      const directionClass =
        summary.direction ===
        'up'
          ? 'titech-financial-trend__change--up'
          : summary.direction ===
              'down'
            ? 'titech-financial-trend__change--down'
            : 'titech-financial-trend__change--flat';

      const formattedTotal =
        showTotal
          ? formatSeriesValue(
              summary.total,
              summary,
              {
                currency:
                  summary.currency ??
                  currency,
                locale,
              },
            )
          : null;

      return (
        <article
          className={classNames(
            'titech-financial-trend__summary-card',
            compact &&
              'titech-financial-trend__summary-card--compact',
          )}
        >
          <div className="titech-financial-trend__summary-header">
            <span
              className="titech-financial-trend__summary-indicator"
              aria-hidden="true"
              style={{
                background:
                  summary.color,
              }}
            />

            <span className="titech-financial-trend__summary-label">
              {summary.label}
            </span>
          </div>

          <div className="titech-financial-trend__summary-current">
            {formattedCurrent}
          </div>

          {showChange &&
          formattedChange ? (
            <div
              className={classNames(
                'titech-financial-trend__change',
                directionClass,
              )}
            >
              <span
                aria-hidden="true"
              >
                {summary.direction ===
                'up'
                  ? '↑'
                  : summary.direction ===
                      'down'
                    ? '↓'
                    : '→'}
              </span>

              <span>
                {changePercentage
                  ? `${changePercentage}`
                  : formattedChange}
              </span>
            </div>
          ) : null}

          {showTotal &&
          formattedTotal ? (
            <div className="titech-financial-trend__summary-total">
              Period total: {formattedTotal}
            </div>
          ) : null}
        </article>
      );
    },
  );

TrendSummaryCard.displayName =
  'TrendSummaryCard';

/* ============================================================================
 * State panel
 * ========================================================================== */

const StatePanel =
  memo(function StatePanel({
    type,
    title,
    message,
    action,
    height,
  }) {
    return (
      <div
        className={classNames(
          'titech-financial-trend__state',
          type === 'error' &&
            'titech-financial-trend__state--error',
        )}
        role={
          type === 'error'
            ? 'alert'
            : 'status'
        }
        style={{
          minHeight: Math.max(
            220,
            Number(height) ||
              DEFAULT_HEIGHT,
          ),
        }}
      >
        <div
          className="titech-financial-trend__state-icon"
          aria-hidden="true"
        >
          {type === 'loading'
            ? '…'
            : type === 'error'
              ? '!'
              : '◌'}
        </div>

        <div className="titech-financial-trend__state-title">
          {title}
        </div>

        <div className="titech-financial-trend__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-financial-trend__state-action">
            {action}
          </div>
        ) : null}
      </div>
    );
  });

StatePanel.displayName =
  'StatePanel';

/* ============================================================================
 * Main component
 * ========================================================================== */

const FinancialTrendChart =
  memo(function FinancialTrendChart({
    data = [],

    series = [],

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

    maxSeries =
      DEFAULT_MAX_SERIES,

    maxPoints =
      DEFAULT_MAX_POINTS,

    showSummary = true,

    showLegend = true,

    showGrid = true,

    showXAxis = true,

    showYAxis = true,

    showSecondaryAxis = true,

    showZeroLine = false,

    showArea = false,

    showChange = true,

    showTotal = false,

    showFooter = true,

    interactive = true,

    animate = false,

    animationDuration = 500,

    curve = 'monotone',

    strokeWidth = 2.4,

    dot = false,

    activeDot = {
      r: 4,
      strokeWidth: 2,
    },

    xAxisFormatter = null,

    yAxisFormatter = null,

    valueFormatter = null,

    tooltipFormatter = null,

    onPointClick = null,

    onPointMouseEnter = null,

    onPointMouseLeave = null,

    onSeriesClick = null,

    selectedSeries = null,

    className = '',

    style = undefined,

    compact = false,

    bordered = true,

    elevated = false,

    ariaLabel =
      'TITech financial trend chart',

    testId = null,
  }) {
    /* ------------------------------------------------------------------------
       Extract and normalize source data
       ---------------------------------------------------------------------- */

    const sourceRecords =
      useMemo(
        () =>
          extractRecords(
            data,
          ).slice(
            0,
            Math.max(
              1,
              Number(
                maxPoints,
              ) ||
                DEFAULT_MAX_POINTS,
            ),
          ),
        [data, maxPoints],
      );

    const normalizedSeries =
      useMemo(
        () =>
          inferSeriesDefinitions(
            sourceRecords,
            series,
            Math.max(
              1,
              Number(
                maxSeries,
              ) ||
                DEFAULT_MAX_SERIES,
            ),
          ),
        [
          sourceRecords,
          series,
          maxSeries,
        ],
      );

    const normalizedData =
      useMemo(
        () =>
          normalizeTrendData(
            sourceRecords,
            normalizedSeries,
            maxPoints,
            locale,
          ),
        [
          sourceRecords,
          normalizedSeries,
          maxPoints,
          locale,
        ],
      );

    const summary =
      useMemo(
        () =>
          calculateSeriesSummary(
            normalizedData,
            normalizedSeries,
          ),
        [
          normalizedData,
          normalizedSeries,
        ],
      );

    const hasSecondaryAxis =
      useMemo(
        () =>
          normalizedSeries.some(
            (definition) =>
              definition.axis ===
              'secondary',
          ),
        [normalizedSeries],
      );

    const primarySeries =
      useMemo(
        () =>
          normalizedSeries.filter(
            (definition) =>
              definition.axis !==
              'secondary',
          ),
        [normalizedSeries],
      );

    const secondarySeries =
      useMemo(
        () =>
          normalizedSeries.filter(
            (definition) =>
              definition.axis ===
              'secondary',
          ),
        [normalizedSeries],
      );

    const resolvedHeight =
      useMemo(() => {
        const number =
          Number(height);

        if (
          !Number.isFinite(
            number,
          ) ||
          number <= 0
        ) {
          return DEFAULT_HEIGHT;
        }

        return Math.max(
          240,
          number,
        );
      }, [height]);

    const resolvedStrokeWidth =
      useMemo(() => {
        const number =
          Number(strokeWidth);

        return Number.isFinite(
          number,
        ) &&
          number > 0
          ? Math.min(
              number,
              8,
            )
          : 2.4;
      }, [strokeWidth]);

    const effectiveCurve =
      curve ===
        'linear' ||
      curve ===
        'step' ||
      curve ===
        'stepBefore' ||
      curve ===
        'stepAfter'
        ? curve
        : 'monotone';

    const formatXAxis =
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

          return formatAxisDate(
            value,
            locale,
          );
        },
        [
          xAxisFormatter,
          locale,
        ],
      );

    const formatPrimaryYAxis =
      useCallback(
        (value) => {
          if (
            typeof yAxisFormatter ===
            'function'
          ) {
            return yAxisFormatter(
              value,
              primarySeries[0] ??
                null,
            );
          }

          const firstSeries =
            primarySeries[0];

          return formatSeriesValue(
            value,
            firstSeries ?? {
              valueType:
                'number',
            },
            {
              currency,
              locale,
            },
          );
        },
        [
          yAxisFormatter,
          primarySeries,
          currency,
          locale,
        ],
      );

    const formatSecondaryYAxis =
      useCallback(
        (value) => {
          const firstSeries =
            secondarySeries[0];

          return formatSeriesValue(
            value,
            firstSeries ?? {
              valueType:
                'number',
            },
            {
              currency,
              locale,
            },
          );
        },
        [
          secondarySeries,
          currency,
          locale,
        ],
      );

    const renderTooltip =
      useCallback(
        (props) => {
          if (
            typeof tooltipFormatter ===
            'function'
          ) {
            return tooltipFormatter({
              ...props,
              series:
                normalizedSeries,
              currency,
              locale,
            });
          }

          return (
            <FinancialTrendTooltip
              {...props}
              series={
                normalizedSeries
              }
              currency={
                currency
              }
              locale={
                locale
              }
              showChange={
                showChange
              }
            />
          );
        },
        [
          tooltipFormatter,
          normalizedSeries,
          currency,
          locale,
          showChange,
        ],
      );

    const handleChartClick =
      useCallback(
        (state) => {
          if (
            typeof onPointClick !==
            'function'
          ) {
            return;
          }

          const activePayload =
            state?.activePayload;

          const point =
            activePayload?.[0]
              ?.payload;

          if (point) {
            onPointClick(
              point,
              state,
            );
          }
        },
        [onPointClick],
      );

    const resolvedSelectedSeries =
      useMemo(() => {
        if (
          selectedSeries ===
          null ||
          selectedSeries ===
          undefined
        ) {
          return null;
        }

        return String(
          selectedSeries,
        );
      }, [selectedSeries]);

    const rootClassName =
      classNames(
        'titech-financial-trend',
        bordered &&
          'titech-financial-trend--bordered',
        elevated &&
          'titech-financial-trend--elevated',
        compact &&
          'titech-financial-trend--compact',
        className,
      );

    /* ------------------------------------------------------------------------
       Loading
       ---------------------------------------------------------------------- */

    if (loading) {
      return (
        <section
          className={
            rootClassName
          }
          aria-busy="true"
          aria-label={`${title} loading`}
          style={style}
        >
          <div className="titech-financial-trend__frame">
            <div className="titech-financial-trend__loading">
              <span className="titech-financial-trend__loading-title" />

              <span className="titech-financial-trend__loading-description" />

              <div
                className="titech-financial-trend__loading-chart"
                style={{
                  minHeight:
                    resolvedHeight,
                }}
              >
                <div className="titech-financial-trend__loading-grid">
                  {Array.from(
                    {
                      length: 5,
                    },
                    (_, index) => (
                      <span
                        key={
                          index
                        }
                      />
                    ),
                  )}
                </div>

                <div className="titech-financial-trend__loading-bars">
                  {Array.from(
                    {
                      length: 12,
                    },
                    (_, index) => (
                      <span
                        key={
                          index
                        }
                        style={{
                          height: `${40 + ((index * 13) % 46)}%`,
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          <style>
            {getFinancialTrendStyles()}
          </style>
        </section>
      );
    }

    /* ------------------------------------------------------------------------
       Error
       ---------------------------------------------------------------------- */

    if (error) {
      const message =
        typeof error ===
        'string'
          ? error
          : error?.message ||
            DEFAULT_ERROR_MESSAGE;

      return (
        <section
          className={
            rootClassName
          }
          role="alert"
          aria-label={`${title} error`}
          style={style}
        >
          <div className="titech-financial-trend__frame">
            <header className="titech-financial-trend__header">
              <div>
                <h2 className="titech-financial-trend__title">
                  {title}
                </h2>

                {description ? (
                  <p className="titech-financial-trend__description">
                    {
                      description
                    }
                  </p>
                ) : null}
              </div>

              <span className="titech-financial-trend__currency">
                {currency}
              </span>
            </header>

            <StatePanel
              type="error"
              title="Unable to load financial trend"
              message={
                message
              }
              action={
                typeof onRetry ===
                'function' ? (
                  <button
                    type="button"
                    className="titech-financial-trend__retry"
                    onClick={
                      onRetry
                    }
                  >
                    Retry
                  </button>
                ) : null
              }
              height={
                resolvedHeight
              }
            />
          </div>

          <style>
            {getFinancialTrendStyles()}
          </style>
        </section>
      );
    }

    /* ------------------------------------------------------------------------
       Empty
       ---------------------------------------------------------------------- */

    if (
      normalizedData.length ===
        0 ||
      normalizedSeries.length ===
        0
    ) {
      return (
        <section
          className={
            rootClassName
          }
          aria-label={`${title} empty state`}
          style={style}
        >
          <div className="titech-financial-trend__frame">
            <header className="titech-financial-trend__header">
              <div>
                <h2 className="titech-financial-trend__title">
                  {title}
                </h2>

                {description ? (
                  <p className="titech-financial-trend__description">
                    {
                      description
                    }
                  </p>
                ) : null}
              </div>

              <span className="titech-financial-trend__currency">
                {currency}
              </span>
            </header>

            <StatePanel
              type="empty"
              title="No financial trend data"
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
          </div>

          <style>
            {getFinancialTrendStyles()}
          </style>
        </section>
      );
    }

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
        style={style}
      >
        <div className="titech-financial-trend__frame">
          {/* --------------------------------------------------------------
              Header
              ------------------------------------------------------------ */}
          <header className="titech-financial-trend__header">
            <div className="titech-financial-trend__header-main">
              <div className="titech-financial-trend__eyebrow">
                Financial analytics
              </div>

              <h2 className="titech-financial-trend__title">
                {title}
              </h2>

              {description ? (
                <p className="titech-financial-trend__description">
                  {description}
                </p>
              ) : null}
            </div>

            <div className="titech-financial-trend__scope">
              {currency}
            </div>
          </header>

          {/* --------------------------------------------------------------
              Summary
              ------------------------------------------------------------ */}
          {showSummary ? (
            <div
              className="titech-financial-trend__summary"
              role="list"
              aria-label={`${title} summary metrics`}
            >
              {summary.map(
                (item) => (
                  <div
                    key={
                      item.key
                    }
                    role="listitem"
                  >
                    <TrendSummaryCard
                      summary={
                        item
                      }
                      currency={
                        currency
                      }
                      locale={
                        locale
                      }
                      compact={
                        compact
                      }
                      valueFormatter={
                        valueFormatter
                      }
                      showChange={
                        showChange
                      }
                      showTotal={
                        showTotal
                      }
                    />
                  </div>
                ),
              )}
            </div>
          ) : null}

          {/* --------------------------------------------------------------
              Chart
              ------------------------------------------------------------ */}
          <div
            className="titech-financial-trend__chart"
            role="img"
            aria-label={`${title}. ${description}`}
            style={{
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
              <AreaChart
                data={
                  normalizedData
                }
                margin={
                  DEFAULT_MARGIN
                }
                onClick={
                  interactive
                    ? handleChartClick
                    : undefined
              }
              >
                {showGrid ? (
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="var(--titech-chart-grid)"
                    opacity={0.42}
                  />
                ) : null}

                {showXAxis ? (
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={
                      formatXAxis
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
                        'var(--titech-chart-axis)',
                    }}
                  />
                ) : null}

                {showYAxis ? (
                  <YAxis
                    yAxisId="primary"
                    tickFormatter={
                      formatPrimaryYAxis
                    }
                    tickLine={false}
                    axisLine={false}
                    width={88}
                    tick={{
                      fontSize: 10,
                      fill:
                        'var(--titech-chart-axis)',
                    }}
                  />
                ) : null}

                {showSecondaryAxis &&
                hasSecondaryAxis ? (
                  <YAxis
                    yAxisId="secondary"
                    orientation="right"
                    tickFormatter={
                      formatSecondaryYAxis
                    }
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    tick={{
                      fontSize: 10,
                      fill:
                        'var(--titech-chart-axis)',
                    }}
                  />
                ) : null}

                <Tooltip
                  content={
                    typeof tooltipFormatter ===
                    'function'
                      ? renderTooltip
                      : undefined
                  }
                />

                {typeof tooltipFormatter !==
                'function' ? (
                  <Tooltip
                    content={
                      <FinancialTrendTooltip
                        series={
                          normalizedSeries
                        }
                        currency={
                          currency
                        }
                        locale={
                          locale
                        }
                        showChange={
                          showChange
                        }
                      />
                    }
                  />
                ) : null}

                {showLegend ? (
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={34}
                    iconType="circle"
                    wrapperStyle={{
                      fontSize: 10,
                      color:
                        'var(--titech-chart-legend)',
                    }}
                    formatter={(
                      value,
                      entry,
                    ) => {
                      const definition =
                        normalizedSeries.find(
                          (
                            item,
                          ) =>
                            item.key ===
                              String(
                                entry?.dataKey,
                              ) ||
                            item.dataKey ===
                              entry?.dataKey,
                        );

                      return (
                        definition?.label ??
                        value
                      );
                    }}
                  />
                ) : null}

                {showZeroLine ? (
                  <ReferenceLine
                    y={0}
                    yAxisId="primary"
                    stroke="var(--titech-chart-zero)"
                    strokeDasharray="4 4"
                    strokeOpacity={
                      0.7
                    }
                  />
                ) : null}

                {normalizedSeries.map(
                  (
                    definition,
                    index,
                  ) => {
                    const isSelected =
                      !resolvedSelectedSeries ||
                      resolvedSelectedSeries ===
                        definition.key;

                    const opacity =
                      isSelected
                        ? 1
                        : 0.18;

                    const axisId =
                      definition.axis ===
                        'secondary' &&
                      showSecondaryAxis &&
                      hasSecondaryAxis
                        ? 'secondary'
                        : 'primary';

                    const commonProps =
                      {
                        key:
                          definition.key,

                        dataKey:
                          definition.key,

                        name:
                          definition.label,

                        yAxisId:
                          axisId,

                        type:
                          effectiveCurve,

                        stroke:
                          definition.color,

                        strokeWidth:
                          definition.strokeWidth ??
                          resolvedStrokeWidth,

                        strokeOpacity:
                          opacity,

                        connectNulls:
                          true,

                        isAnimationActive:
                          Boolean(
                            animate,
                          ),

                        animationDuration:
                          animationDuration,

                        activeDot:
                          activeDot,

                        dot:
                          dot,

                        hide:
                          definition.hidden,

                        onClick:
                          interactive
                            ? () =>
                                onSeriesClick?.(
                                  definition,
                                )
                            : undefined,

                        onMouseEnter:
                          interactive
                            ? () =>
                                onPointMouseEnter?.(
                                  definition,
                                )
                            : undefined,

                        onMouseLeave:
                          interactive
                            ? () =>
                                onPointMouseLeave?.(
                                  definition,
                                )
                            : undefined,
                      };

                    if (
                      definition.chartType ===
                        'area' ||
                      (definition.chartType ===
                        'auto' &&
                        showArea)
                    ) {
                      return (
                        <Area
                          {...commonProps}
                          fill={
                            definition.color
                          }
                          fillOpacity={
                            Number(
                              definition.fillOpacity,
                            ) || 0.06
                          }
                          activeDot={
                            activeDot
                          }
                          cursor={
                            interactive
                              ? 'pointer'
                              : undefined
                          }
                        />
                      );
                    }

                    return (
                      <Line
                        {...commonProps}
                        cursor={
                          interactive
                            ? 'pointer'
                            : undefined
                        }
                      />
                    );
                  },
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* --------------------------------------------------------------
              Footer
              ------------------------------------------------------------ */}
          {showFooter ? (
            <footer className="titech-financial-trend__footer">
              <span>
                {normalizedData.length}{' '}
                reporting point
                {normalizedData.length ===
                1
                  ? ''
                  : 's'}
              </span>

              <span>
                TITech Community Capital · Financial analytics
              </span>
            </footer>
          ) : null}
        </div>

        <style>
          {getFinancialTrendStyles()}
        </style>
      </section>
    );
  });

FinancialTrendChart.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Styles
 * ========================================================================== */

function getFinancialTrendStyles() {
  return `
    .titech-financial-trend {
      --titech-financial-surface:
        var(
          --titech-surface,
          var(--color-white)
        );

      --titech-financial-surface-muted:
        var(
          --titech-surface-muted,
          #f8fafc
        );

      --titech-financial-border:
        var(
          --titech-border,
          #e2e8f0
        );

      --titech-financial-border-strong:
        var(
          --titech-border-strong,
          #cbd5e1
        );

      --titech-financial-text:
        var(
          --titech-text-primary,
          #0f172a
        );

      --titech-financial-text-muted:
        var(
          --titech-text-secondary,
          #64748b
        );

      --titech-financial-primary:
        var(
          --titech-primary,
          #0f172a
        );

      --titech-financial-focus:
        var(
          --titech-focus-ring,
          #2563eb
        );

      --titech-financial-success:
        var(
          --titech-success,
          #047857
        );

      --titech-financial-warning:
        var(
          --titech-warning,
          #b45309
        );

      --titech-financial-danger:
        var(
          --titech-danger,
          #b91c1c
        );

      width: 100%;
      min-width: 0;
      color:
        var(--titech-financial-text);
      font: inherit;
    }

    .titech-financial-trend *,
    .titech-financial-trend
      *::before,
    .titech-financial-trend
      *::after {
      box-sizing: border-box;
    }

    .titech-financial-trend--bordered {
      border: 1px solid
        var(--titech-financial-border);
      border-radius: 16px;
      background:
        var(--titech-financial-surface);
    }

    .titech-financial-trend--elevated {
      box-shadow:
        0 12px 34px
        rgba(
          15,
          23,
          42,
          0.08
        );
    }

    .titech-financial-trend__frame {
      width: 100%;
      min-width: 0;
      padding: 18px;
    }

    /* ------------------------------------------------------------------------
       Header
       ---------------------------------------------------------------------- */

    .titech-financial-trend__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }

    .titech-financial-trend__header-main {
      min-width: 0;
      flex: 1 1 auto;
    }

    .titech-financial-trend__eyebrow {
      margin-bottom: 4px;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 9px;
      line-height: 1.25;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .titech-financial-trend__title {
      margin: 0;
      color:
        var(
          --titech-financial-text
        );
      font-size: 18px;
      line-height: 1.3;
      font-weight: 850;
      letter-spacing: -0.015em;
    }

    .titech-financial-trend__description {
      max-width: 760px;
      margin: 5px 0 0;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 11px;
      line-height: 1.55;
    }

    .titech-financial-trend__scope {
      flex: 0 0 auto;
      padding: 6px 9px;
      border: 1px solid
        var(--titech-financial-border);
      border-radius: 8px;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 9px;
      line-height: 1.2;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .titech-financial-trend__currency {
      flex: 0 0 auto;
      padding: 6px 9px;
      border: 1px solid
        var(--titech-financial-border);
      border-radius: 8px;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 9px;
      line-height: 1.2;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* ------------------------------------------------------------------------
       Summary
       ---------------------------------------------------------------------- */

    .titech-financial-trend__summary {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(
            145px,
            1fr
          )
        );
      gap: 10px;
      margin-bottom: 20px;
    }

    .titech-financial-trend__summary-card {
      min-width: 0;
      min-height: 102px;
      padding: 12px;
      border: 1px solid
        var(--titech-financial-border);
      border-radius: 10px;
      background:
        var(
          --titech-financial-surface
        );
    }

    .titech-financial-trend__summary-card--compact {
      min-height: 84px;
      padding: 10px;
    }

    .titech-financial-trend__summary-header {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .titech-financial-trend__summary-indicator {
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius: 50%;
    }

    .titech-financial-trend__summary-label {
      min-width: 0;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 9px;
      line-height: 1.35;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .titech-financial-trend__summary-current {
      margin-top: 8px;
      color:
        var(
          --titech-financial-text
        );
      font-size: 17px;
      line-height: 1.2;
      font-weight: 900;
      font-variant-numeric:
        tabular-nums;
      overflow-wrap: anywhere;
    }

    .titech-financial-trend__summary-card--compact
      .titech-financial-trend__summary-current {
      font-size: 15px;
    }

    .titech-financial-trend__change {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 5px;
      font-size: 9px;
      line-height: 1.25;
      font-weight: 850;
      font-variant-numeric:
        tabular-nums;
    }

    .titech-financial-trend__change--up {
      color:
        var(
          --titech-financial-success
        );
    }

    .titech-financial-trend__change--down {
      color:
        var(
          --titech-financial-danger
        );
    }

    .titech-financial-trend__change--flat {
      color:
        var(
          --titech-financial-text-muted
        );
    }

    .titech-financial-trend__summary-total {
      margin-top: 5px;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 8px;
      line-height: 1.35;
      font-variant-numeric:
        tabular-nums;
    }

    /* ------------------------------------------------------------------------
       Chart
       ---------------------------------------------------------------------- */

    .titech-financial-trend__chart {
      width: 100%;
      min-width: 0;
    }

    .titech-financial-trend
      .recharts-wrapper,
    .titech-financial-trend
      .recharts-surface {
      outline: none;
    }

    .titech-financial-trend
      .recharts-default-tooltip {
      border-radius: 10px;
    }

    /* ------------------------------------------------------------------------
       Footer
       ---------------------------------------------------------------------- */

    .titech-financial-trend__footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid
        var(--titech-financial-border);
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 8px;
      line-height: 1.45;
    }

    /* ------------------------------------------------------------------------
       State
       ---------------------------------------------------------------------- */

    .titech-financial-trend__state {
      display: grid;
      place-items: center;
      align-content: center;
      padding: 28px 22px;
      border: 1px dashed
        var(
          --titech-financial-border-strong
        );
      border-radius: 12px;
      background:
        var(
          --titech-financial-surface-muted
        );
      text-align: center;
    }

    .titech-financial-trend__state--error {
      border-style: solid;
      border-color:
        var(
          --titech-danger-border,
          #fecaca
        );
      background:
        var(
          --titech-danger-surface,
          #fff7f7
        );
    }

    .titech-financial-trend__state-icon {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      margin-bottom: 10px;
      border-radius: 12px;
      background:
        var(
          --titech-financial-surface
        );
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 20px;
      font-weight: 900;
    }

    .titech-financial-trend__state-title {
      margin-bottom: 5px;
      font-size: 13px;
      line-height: 1.35;
      font-weight: 850;
    }

    .titech-financial-trend__state-message {
      max-width: 480px;
      color:
        var(
          --titech-financial-text-muted
        );
      font-size: 10px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }

    .titech-financial-trend__state-action {
      margin-top: 14px;
    }

    .titech-financial-trend__retry {
      min-height: 37px;
      padding: 7px 13px;
      border: 1px solid
        var(
          --titech-financial-primary
        );
      border-radius: 8px;
      background:
        var(
          --titech-financial-primary
        );
      color: var(--color-white);
      font: inherit;
      font-size: 10px;
      font-weight: 850;
      cursor: pointer;
    }

    .titech-financial-trend__retry:focus-visible {
      outline: 3px solid
        var(
          --titech-financial-focus
        );
      outline-offset: 2px;
    }

    /* ------------------------------------------------------------------------
       Loading
       ---------------------------------------------------------------------- */

    .titech-financial-trend__loading {
      padding: 18px;
    }

    .titech-financial-trend__loading-title,
    .titech-financial-trend__loading-description {
      display: block;
      border-radius: 5px;
      background:
        linear-gradient(
          90deg,
          var(
            --titech-skeleton,
            #e2e8f0
          )
          25%,
          var(
            --titech-skeleton-muted,
            #f8fafc
          )
          50%,
          var(
            --titech-skeleton,
            #e2e8f0
          )
          75%
        );
      background-size: 200% 100%;
      animation:
        titech-financial-trend-shimmer
        1.5s
        ease-in-out
        infinite;
    }

    .titech-financial-trend__loading-title {
      width: 30%;
      min-width: 130px;
      height: 17px;
      margin-bottom: 8px;
    }

    .titech-financial-trend__loading-description {
      width: 53%;
      min-width: 190px;
      height: 10px;
      margin-bottom: 18px;
    }

    .titech-financial-trend__loading-chart {
      position: relative;
      width: 100%;
      overflow: hidden;
      border-radius: 12px;
      background:
        var(
          --titech-financial-surface-muted
        );
    }

    .titech-financial-trend__loading-grid {
      position: absolute;
      inset: 20px 20px 45px 65px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .titech-financial-trend__loading-grid
      span {
      width: 100%;
      height: 1px;
      border-top: 1px dashed
        var(
          --titech-financial-border
        );
      opacity: 0.65;
    }

    .titech-financial-trend__loading-bars {
      position: absolute;
      left: 72px;
      right: 20px;
      top: 30px;
      bottom: 44px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 7px;
    }

    .titech-financial-trend__loading-bars
      span {
      width: 100%;
      max-width: 34px;
      min-width: 4px;
      flex: 1 1 0;
      border-radius: 5px 5px 2px 2px;
      background:
        var(
          --titech-skeleton,
          #e2e8f0
        );
      opacity: 0.62;
    }

    @keyframes titech-financial-trend-shimmer {
      0% {
        background-position:
          200% 0;
      }

      100% {
        background-position:
          -200% 0;
      }
    }

    /* ------------------------------------------------------------------------
       Responsive
       ---------------------------------------------------------------------- */

    @media (max-width: 900px) {
      .titech-financial-trend__summary {
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

    @media (max-width: 620px) {
      .titech-financial-trend__frame {
        padding: 14px;
      }

      .titech-financial-trend__header {
        flex-direction: column;
        align-items: stretch;
      }

      .titech-financial-trend__scope,
      .titech-financial-trend__currency {
        align-self: flex-start;
      }

      .titech-financial-trend__summary {
        grid-template-columns:
          1fr;
      }

      .titech-financial-trend
        .recharts-legend-wrapper {
        position: static !important;
        width: 100% !important;
        height: auto !important;
        margin-bottom: 8px;
      }

      .titech-financial-trend__loading-bars {
        left: 54px;
        right: 14px;
      }

      .titech-financial-trend__loading-grid {
        left: 50px;
        right: 14px;
      }
    }

    /* ------------------------------------------------------------------------
       Reduced motion
       ---------------------------------------------------------------------- */

    @media (prefers-reduced-motion: reduce) {
      .titech-financial-trend *,
      .titech-financial-trend
        *::before,
      .titech-financial-trend
        *::after {
        animation: none !important;
        transition: none !important;
      }
    }

    /* ------------------------------------------------------------------------
       Print
       ---------------------------------------------------------------------- */

    @media print {
      .titech-financial-trend {
        break-inside: avoid;
        page-break-inside: avoid;
        box-shadow: none !important;
      }

      .titech-financial-trend__summary-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  `;
}

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  FinancialTrendChart,
  FinancialTrendTooltip,
  TrendSummaryCard,
  StatePanel,
  normalizeSeriesDefinition,
  inferSeriesDefinitions,
  normalizeTrendData,
  calculateSeriesSummary,
  formatNumber,
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
  formatSeriesValue,
  toDisplayNumber,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default FinancialTrendChart;