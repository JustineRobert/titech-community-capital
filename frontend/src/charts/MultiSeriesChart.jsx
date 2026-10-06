'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/MultiSeriesChart.jsx
 *
 * Purpose:
 *   Enterprise-grade reusable multi-series analytical chart for TITech.
 *
 * Responsibilities:
 *   - Render multiple analytical series against a shared reporting timeline.
 *   - Support line, area and bar series in one composed chart.
 *   - Support independent left/right Y axes.
 *   - Normalize common API envelopes and dataset shapes.
 *   - Safely format counts, currency values, percentages and generic numbers.
 *   - Provide interactive presentation-only series visibility controls.
 *   - Provide deterministic loading, error and empty states.
 *   - Provide accessible chart descriptions and keyboard-operable controls.
 *   - Provide a reusable tooltip and summary surface.
 *
 * Financial / domain integrity:
 *   - This component is presentation-only.
 *   - It MUST NOT mutate financial, membership, loan, payment, ledger,
 *     settlement, reconciliation or audit state.
 *   - Client-side aggregation and ratios are display analytics only.
 *   - Backend/domain services remain authoritative for financial and domain
 *     truth.
 *   - A visual series MUST NOT be interpreted as authorization, settlement,
 *     accounting or workflow authority.
 *
 * Supported series:
 *   {
 *     dataKey: 'amount',
 *     name: 'Amount',
 *     type: 'line' | 'area' | 'bar',
 *     axis: 'left' | 'right',
 *     format: 'number' | 'currency' | 'percent',
 *     unit: 'UGX',
 *     visible: true,
 *     color: 'var(--titech-chart-series-1)',
 *     strokeWidth: 2,
 *     strokeDasharray: '5 4',
 *   }
 *
 * Typical usage:
 *
 *   import MultiSeriesChart from './charts/MultiSeriesChart.jsx';
 *
 *   const series = [
 *     {
 *       dataKey: 'collections',
 *       name: 'Collections',
 *       type: 'area',
 *       format: 'currency',
 *       unit: 'UGX',
 *     },
 *     {
 *       dataKey: 'transactions',
 *       name: 'Transactions',
 *       type: 'line',
 *       format: 'number',
 *       axis: 'right',
 *     },
 *   ];
 *
 *   <MultiSeriesChart
 *     data={report}
 *     series={series}
 *     title="Collections & Transactions"
 *   />
 *
 * ============================================================================
 */

import React, {
  memo,
  useId,
  useMemo,
  useState,
} from 'react';

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

export const MULTI_SERIES_TYPES = Object.freeze({
  LINE: 'line',
  AREA: 'area',
  BAR: 'bar',
});

export const MULTI_SERIES_FORMATS = Object.freeze({
  NUMBER: 'number',
  CURRENCY: 'currency',
  PERCENT: 'percent',
});

export const MULTI_SERIES_AXES = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
});

export const DEFAULT_LOCALE = 'en-UG';
export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_HEIGHT = 380;

const DEFAULT_MAX_POINTS = 48;

const CSS = Object.freeze({
  primary: 'var(--titech-primary, #146c94)',
  primarySoft:
    'var(--titech-primary-soft, rgba(20,108,148,0.12))',
  surface: 'var(--titech-surface, var(--color-white))',
  surfaceMuted:
    'var(--titech-surface-muted, #f7f9fb)',
  border:
    'var(--titech-border, #d9e1e8)',
  borderStrong:
    'var(--titech-border-strong, #b8c5d0)',
  textPrimary:
    'var(--titech-text-primary, #17212b)',
  textSecondary:
    'var(--titech-text-secondary, #637381)',
  success:
    'var(--titech-success, #1f8f55)',
  warning:
    'var(--titech-warning, #b7791f)',
  danger:
    'var(--titech-danger, #c53a3a)',
  chart1:
    'var(--titech-chart-series-1, #146c94)',
  chart2:
    'var(--titech-chart-series-2, #4f8a8b)',
  chart3:
    'var(--titech-chart-series-3, #b7791f)',
  chart4:
    'var(--titech-chart-series-4, #c53a3a)',
  chart5:
    'var(--titech-chart-series-5, #6b7280)',
  chart6:
    'var(--titech-chart-series-6, #7c5aa6)',
  chart7:
    'var(--titech-chart-series-7, #238b8b)',
  chart8:
    'var(--titech-chart-series-8, #9a6a3a)',
});

const DEFAULT_SERIES_COLORS = Object.freeze([
  CSS.chart1,
  CSS.chart2,
  CSS.chart3,
  CSS.chart4,
  CSS.chart5,
  CSS.chart6,
  CSS.chart7,
  CSS.chart8,
]);

const NUMBER_FORMATTER_CACHE = new Map();
const DATE_FORMATTER_CACHE = new Map();

/* ============================================================================
 * Generic data helpers
 * ========================================================================== */

/**
 * Safely unwrap common API response envelopes.
 *
 * Supported:
 *   { data: ... }
 *   { result: ... }
 *   { payload: ... }
 *   { response: ... }
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function unwrapChartPayload(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (
    'data' in input
    && input.data !== null
    && input.data !== undefined
  ) {
    return input.data;
  }

  if (
    'result' in input
    && input.result !== null
    && input.result !== undefined
  ) {
    return input.result;
  }

  if (
    'payload' in input
    && input.payload !== null
    && input.payload !== undefined
  ) {
    return input.payload;
  }

  if (
    'response' in input
    && input.response !== null
    && input.response !== undefined
  ) {
    return input.response;
  }

  return input;
}

/**
 * Safely normalize an array.
 *
 * @param {unknown} value
 * @returns {Array}
 */
function asArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

/**
 * Return first meaningful alias.
 *
 * @param {object} source
 * @param {string[]} aliases
 * @param {unknown} fallback
 * @returns {unknown}
 */
function firstDefined(
  source,
  aliases,
  fallback = undefined,
) {
  if (!source || typeof source !== 'object') {
    return fallback;
  }

  for (const alias of aliases) {
    if (
      Object.prototype.hasOwnProperty.call(
        source,
        alias,
      )
      && source[alias] !== null
      && source[alias] !== undefined
    ) {
      return source[alias];
    }
  }

  return fallback;
}

/**
 * Parse numeric values including common Mongo/Decimal-like structures.
 *
 * This is a display parser only. It is not a financial precision boundary.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseMultiSeriesNumber(
  value,
  fallback = 0,
) {
  if (
    value === null
    || value === undefined
  ) {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/,/g, '')
      .trim();

    if (!normalized) {
      return fallback;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  if (typeof value === 'object') {
    const candidate =
      value.$numberDecimal
      ?? value.$numberLong
      ?? value.$number
      ?? value.value
      ?? value.amount
      ?? value.count;

    if (candidate !== undefined) {
      return parseMultiSeriesNumber(
        candidate,
        fallback,
      );
    }

    if (
      typeof value.toString === 'function'
    ) {
      const stringified =
        value.toString();

      if (
        stringified !==
        '[object Object]'
      ) {
        return parseMultiSeriesNumber(
          stringified,
          fallback,
        );
      }
    }
  }

  return fallback;
}

/**
 * Parse date-like values into timestamps.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();

    return Number.isFinite(time)
      ? time
      : null;
  }

  if (
    typeof value === 'number'
    || typeof value === 'bigint'
  ) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const text = String(value).trim();

  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Format period label.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatChartPeriod(
  value,
  locale = DEFAULT_LOCALE,
) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    const text = String(
      value ?? '',
    ).trim();

    return text || 'Unknown';
  }

  const key =
    `${locale}|month-year`;

  let formatter =
    DATE_FORMATTER_CACHE.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      locale,
      {
        month: 'short',
        year: 'numeric',
      },
    );

    DATE_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  return formatter.format(
    new Date(timestamp),
  );
}

/**
 * Create a cached number formatter.
 *
 * @param {string} locale
 * @param {string} format
 * @param {string} currency
 * @returns {Intl.NumberFormat}
 */
function getNumberFormatter(
  locale,
  format,
  currency,
) {
  const key =
    `${locale}|${format}|${currency}`;

  const cached =
    NUMBER_FORMATTER_CACHE.get(key);

  if (cached) {
    return cached;
  }

  let formatter;

  if (
    format === MULTI_SERIES_FORMATS.CURRENCY
  ) {
    formatter = new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        minimumFractionDigits:
          currency === 'UGX'
            ? 0
            : 2,
        maximumFractionDigits:
          currency === 'UGX'
            ? 0
            : 2,
      },
    );
  } else if (
    format === MULTI_SERIES_FORMATS.PERCENT
  ) {
    formatter = new Intl.NumberFormat(
      locale,
      {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      },
    );
  } else {
    formatter = new Intl.NumberFormat(
      locale,
      {
        maximumFractionDigits: 2,
      },
    );
  }

  NUMBER_FORMATTER_CACHE.set(
    key,
    formatter,
  );

  return formatter;
}

/**
 * Format a chart value.
 *
 * @param {unknown} value
 * @param {object} options
 * @returns {string}
 */
export function formatMultiSeriesValue(
  value,
  {
    format = MULTI_SERIES_FORMATS.NUMBER,
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
  } = {},
) {
  const numericValue =
    parseMultiSeriesNumber(value);

  return getNumberFormatter(
    locale,
    format,
    currency,
  ).format(
    numericValue,
  );
}

/**
 * Create a safe DOM identifier.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeDomId(value) {
  return String(value)
    .replace(
      /[^a-zA-Z0-9_-]/g,
      '-',
    )
    .replace(
      /-+/g,
      '-',
    );
}

/* ============================================================================
 * Series normalization
 * ========================================================================== */

/**
 * Normalize a single series definition.
 *
 * @param {unknown} series
 * @param {number} index
 * @returns {object}
 */
export function normalizeMultiSeriesDefinition(
  series,
  index = 0,
) {
  const source =
    series && typeof series === 'object'
      ? series
      : {};

  const dataKey = String(
    firstDefined(
      source,
      [
        'dataKey',
        'key',
        'field',
        'id',
      ],
      '',
    ),
  ).trim();

  const type =
    [
      MULTI_SERIES_TYPES.LINE,
      MULTI_SERIES_TYPES.AREA,
      MULTI_SERIES_TYPES.BAR,
    ].includes(source.type)
      ? source.type
      : MULTI_SERIES_TYPES.LINE;

  const axis =
    source.axis ===
      MULTI_SERIES_AXES.RIGHT
      || source.yAxisId === 'right'
      || source.yAxisId === 1
      ? MULTI_SERIES_AXES.RIGHT
      : MULTI_SERIES_AXES.LEFT;

  const format =
    [
      MULTI_SERIES_FORMATS.NUMBER,
      MULTI_SERIES_FORMATS.CURRENCY,
      MULTI_SERIES_FORMATS.PERCENT,
    ].includes(source.format)
      ? source.format
      : MULTI_SERIES_FORMATS.NUMBER;

  return {
    id:
      String(
        firstDefined(
          source,
          [
            'id',
            'seriesId',
            'name',
            'dataKey',
          ],
          `series-${index + 1}`,
        ),
      ),

    dataKey,

    name:
      String(
        firstDefined(
          source,
          [
            'name',
            'label',
            'title',
            'dataKey',
          ],
          dataKey ||
            `Series ${index + 1}`,
        ),
      ),

    type,
    axis,
    format,

    currency:
      String(
        firstDefined(
          source,
          [
            'currency',
            'unit',
          ],
          DEFAULT_CURRENCY,
        ),
      ),

    color:
      source.color
      || DEFAULT_SERIES_COLORS[
        index
        % DEFAULT_SERIES_COLORS.length
      ],

    visible:
      source.visible !== false,

    connectNulls:
      source.connectNulls !== false,

    strokeWidth:
      Number.isFinite(
        Number(
          source.strokeWidth,
        ),
      )
        ? Number(
            source.strokeWidth,
          )
        : type ===
            MULTI_SERIES_TYPES.AREA
          ? 2
          : 2,

    strokeDasharray:
      source.strokeDasharray
      || undefined,

    stackId:
      source.stackId
      || undefined,

    barSize:
      Number.isFinite(
        Number(source.barSize),
      )
        ? Number(source.barSize)
        : undefined,

    fillOpacity:
      Number.isFinite(
        Number(
          source.fillOpacity,
        ),
      )
        ? Math.max(
            0,
            Math.min(
              1,
              Number(
                source.fillOpacity,
              ),
            ),
          )
        : 0.18,

    raw: source,
  };
}

/**
 * Deduplicate series definitions by data key.
 *
 * @param {Array} series
 * @returns {Array}
 */
function deduplicateSeries(
  series,
) {
  const seen = new Set();
  const output = [];

  for (const item of series) {
    if (!item.dataKey) {
      continue;
    }

    if (
      seen.has(item.dataKey)
    ) {
      continue;
    }

    seen.add(item.dataKey);
    output.push(item);
  }

  return output;
}

/**
 * Infer generic series from the first data record.
 *
 * This is intentionally conservative: fields that look like dates, labels
 * or obvious identifiers are excluded.
 *
 * @param {Array} rows
 * @returns {Array}
 */
function inferSeriesFromData(rows) {
  if (!rows.length) {
    return [];
  }

  const first =
    rows.find(
      (item) =>
        item
        && typeof item === 'object',
    );

  if (!first) {
    return [];
  }

  const excluded = new Set([
    'id',
    '_id',
    'key',
    'date',
    'period',
    'month',
    'year',
    'label',
    'name',
    'timestamp',
    'createdAt',
    'updatedAt',
  ]);

  return Object.keys(first)
    .filter(
      (key) =>
        !excluded.has(key)
        && Number.isFinite(
          parseMultiSeriesNumber(
            first[key],
            NaN,
          ),
        ),
    )
    .slice(0, 8)
    .map(
      (key, index) =>
        normalizeMultiSeriesDefinition(
          {
            dataKey: key,
            name: key,
            type:
              index === 0
                ? MULTI_SERIES_TYPES.AREA
                : MULTI_SERIES_TYPES.LINE,
          },
          index,
        ),
    );
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

/**
 * Normalize chart rows.
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   rows: Array,
 *   series: Array,
 *   hasData: boolean
 * }}
 */
export function normalizeMultiSeriesData(
  input,
  {
    locale = DEFAULT_LOCALE,
    series = [],
    periodKey = null,
  } = {},
) {
  const payload =
    unwrapChartPayload(input);

  let rawRows = [];

  if (Array.isArray(payload)) {
    rawRows = payload;
  } else if (
    payload
    && typeof payload === 'object'
  ) {
    rawRows = firstDefined(
      payload,
      [
        'seriesData',
        'trend',
        'trends',
        'timeSeries',
        'timeline',
        'history',
        'historical',
        'rows',
        'records',
        'items',
        'data',
      ],
      [],
    );

    if (!Array.isArray(rawRows)) {
      rawRows = [];
    }
  }

  const normalizedRows =
    rawRows.map(
      (item, index) => {
        const source =
          item
          && typeof item === 'object'
            ? item
            : {};

        const rawPeriod =
          periodKey
            ? source[periodKey]
            : firstDefined(
                source,
                [
                  'period',
                  'date',
                  'month',
                  'label',
                  'reportingPeriod',
                  'timestamp',
                  'createdAt',
                ],
                `Period ${index + 1}`,
              );

        const row = {
          ...source,
          __id: String(
            firstDefined(
              source,
              [
                'id',
                '_id',
                'key',
              ],
              `row-${index + 1}`,
            ),
          ),
          __period:
            rawPeriod,
          __label:
            formatChartPeriod(
              rawPeriod,
              locale,
            ),
        };

        return row;
      },
    );

  const normalizedSeries =
    deduplicateSeries(
      asArray(series).map(
        normalizeMultiSeriesDefinition,
      ),
    );

  const resolvedSeries =
    normalizedSeries.length > 0
      ? normalizedSeries
      : inferSeriesFromData(
          normalizedRows,
        );

  return {
    rows: normalizedRows,
    series: resolvedSeries,
    hasData:
      normalizedRows.length > 0
      && resolvedSeries.length > 0,
  };
}

/**
 * Detect whether a series has at least one numeric value.
 *
 * @param {Array} rows
 * @param {string} dataKey
 * @returns {boolean}
 */
function seriesHasValues(
  rows,
  dataKey,
) {
  return rows.some(
    (row) =>
      Number.isFinite(
        parseMultiSeriesNumber(
          row?.[dataKey],
          NaN,
        ),
      ),
  );
}

/**
 * Build a normalized display row where every declared series value is
 * represented numerically or as null.
 *
 * @param {object} row
 * @param {Array} series
 * @returns {object}
 */
function normalizeDisplayRow(
  row,
  series,
) {
  const output = {
    ...row,
  };

  for (const definition of series) {
    const value =
      row?.[definition.dataKey];

    const numeric =
      parseMultiSeriesNumber(
        value,
        NaN,
      );

    output[
      definition.dataKey
    ] = Number.isFinite(numeric)
      ? numeric
      : null;
  }

  return output;
}

/* ============================================================================
 * Summary helpers
 * ========================================================================== */

/**
 * Calculate summary information for display.
 *
 * @param {Array} rows
 * @param {Array} series
 * @returns {Array}
 */
function buildSeriesSummaries(
  rows,
  series,
) {
  return series.map(
    (definition) => {
      const numericValues =
        rows
          .map(
            (row) =>
              parseMultiSeriesNumber(
                row?.[
                  definition.dataKey
                ],
                NaN,
              ),
          )
          .filter(
            Number.isFinite,
          );

      const first =
        numericValues[0] ?? 0;

      const latest =
        numericValues[
          numericValues.length - 1
        ] ?? 0;

      const total =
        numericValues.reduce(
          (sum, value) =>
            sum + value,
          0,
        );

      const delta =
        latest - first;

      const deltaRate =
        first !== 0
          ? delta / Math.abs(first)
          : 0;

      return {
        ...definition,
        count: numericValues.length,
        first,
        latest,
        total,
        delta,
        deltaRate,
      };
    },
  );
}

function SummaryCard({
  summary,
  locale,
}) {
  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${CSS.border}`,
        borderRadius: 11,
        background: CSS.surface,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          minWidth: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            flex: '0 0 auto',
            borderRadius: 999,
            background:
              summary.color,
          }}
        />

        <span
          style={{
            minWidth: 0,
            color: CSS.textSecondary,
            fontSize: 11,
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary.name}
        </span>
      </div>

      <div
        style={{
          marginTop: 7,
          color: CSS.textPrimary,
          fontSize: 18,
          fontWeight: 800,
          lineHeight: 1.2,
          overflowWrap: 'anywhere',
        }}
      >
        {formatMultiSeriesValue(
          summary.latest,
          {
            format:
              summary.format,
            currency:
              summary.currency,
            locale,
          },
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: 5,
        }}
      >
        <span
          style={{
            color:
              summary.delta > 0
                ? CSS.success
                : summary.delta < 0
                  ? CSS.warning
                  : CSS.textSecondary,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {summary.delta > 0
            ? '+'
            : ''}
          {formatMultiSeriesValue(
            summary.delta,
            {
              format:
                summary.format,
              currency:
                summary.currency,
              locale,
            },
          )}
        </span>

        <span
          style={{
            color: CSS.textSecondary,
            fontSize: 10,
          }}
        >
          vs first point
        </span>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

export function MultiSeriesTooltip({
  active,
  payload,
  label,
  locale = DEFAULT_LOCALE,
  currency = DEFAULT_CURRENCY,
  series = [],
}) {
  if (
    !active
    || !Array.isArray(payload)
    || payload.length === 0
  ) {
    return null;
  }

  const definitionMap =
    new Map(
      series.map(
        (definition) => [
          definition.dataKey,
          definition,
        ],
      ),
    );

  return (
    <div
      role="tooltip"
      style={{
        minWidth: 230,
        maxWidth: 360,
        border: `1px solid ${CSS.borderStrong}`,
        borderRadius: 12,
        background: CSS.surface,
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.10)',
        padding: 12,
      }}
    >
      <div
        style={{
          marginBottom: 9,
          color: CSS.textPrimary,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 7,
        }}
      >
        {payload
          .filter(
            (entry) =>
              entry
              && entry.value !== null
              && entry.value !== undefined,
          )
          .map(
            (entry) => {
              const definition =
                definitionMap.get(
                  entry.dataKey,
                );

              const format =
                definition?.format
                ?? MULTI_SERIES_FORMATS.NUMBER;

              const valueCurrency =
                definition?.currency
                || currency;

              return (
                <div
                  key={`${entry.dataKey}`}
                  style={{
                    display: 'flex',
                    alignItems:
                      'center',
                    justifyContent:
                      'space-between',
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      gap: 7,
                      minWidth: 0,
                      color:
                        CSS.textSecondary,
                      fontSize: 12,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        flex: '0 0 auto',
                        borderRadius:
                          999,
                        background:
                          entry.color
                          ?? definition?.color
                          ?? CSS.chart1,
                      }}
                    />

                    <span
                      style={{
                        overflow:
                          'hidden',
                        textOverflow:
                          'ellipsis',
                        whiteSpace:
                          'nowrap',
                      }}
                    >
                      {definition?.name
                        ?? entry.name
                        ?? entry.dataKey}
                    </span>
                  </span>

                  <strong
                    style={{
                      flex: '0 0 auto',
                      color:
                        CSS.textPrimary,
                      fontSize: 12,
                    }}
                  >
                    {formatMultiSeriesValue(
                      entry.value,
                      {
                        format,
                        currency:
                          valueCurrency,
                        locale,
                      },
                    )}
                  </strong>
                </div>
              );
            },
          )}
      </div>
    </div>
  );
}

/* ============================================================================
 * Empty / loading / error
 * ========================================================================== */

function StatePanel({
  type,
  message,
  onRetry,
}) {
  if (type === 'loading') {
    return (
      <div
        aria-live="polite"
        aria-busy="true"
        style={{
          display: 'grid',
          gap: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            width: '30%',
            height: 14,
            borderRadius: 8,
            background:
              CSS.primarySoft,
          }}
        />

        <div
          style={{
            width: '100%',
            height: 230,
            borderRadius: 12,
            background:
              'linear-gradient(90deg, rgba(20,108,148,0.05), rgba(20,108,148,0.12), rgba(20,108,148,0.05))',
          }}
        />

        <div
          style={{
            width: '68%',
            height: 12,
            borderRadius: 8,
            background:
              CSS.primarySoft,
          }}
        />
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div
        role="alert"
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: 240,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <div
            style={{
              color: CSS.danger,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            Unable to load chart data
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 520,
              color:
                CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {message
              || 'The analytics could not be displayed.'}
          </div>

          {typeof onRetry ===
          'function' ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginTop: 14,
                border: `1px solid ${CSS.borderStrong}`,
                borderRadius: 8,
                background: CSS.surface,
                color: CSS.textPrimary,
                padding:
                  '8px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: 240,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <div
          style={{
            color: CSS.textPrimary,
            fontSize: 15,
            fontWeight: 800,
          }}
        >
          No chart data
        </div>

        <div
          style={{
            marginTop: 6,
            maxWidth: 520,
            color:
              CSS.textSecondary,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message
            || 'Analytics will appear when data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Series controls
 * ========================================================================== */

function SeriesControl({
  definition,
  visible,
  onToggle,
}) {
  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={`${
        visible
          ? 'Hide'
          : 'Show'
      } ${definition.name}`}
      onClick={() =>
        onToggle(
          definition.dataKey,
        )
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minHeight: 31,
        border: `1px solid ${
          visible
            ? CSS.borderStrong
            : CSS.border
        }`,
        borderRadius: 999,
        background:
          visible
            ? CSS.surface
            : CSS.surfaceMuted,
        color:
          visible
            ? CSS.textPrimary
            : CSS.textSecondary,
        padding:
          '5px 10px',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        opacity:
          visible ? 1 : 0.75,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          flex: '0 0 auto',
          borderRadius: 999,
          background:
            definition.color,
          opacity:
            visible ? 1 : 0.4,
        }}
      />

      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {definition.name}
      </span>
    </button>
  );
}

/* ============================================================================
 * Main component
 * ========================================================================== */

function MultiSeriesChartComponent({
  data = null,

  title = 'Multi-Series Analytics',
  description =
    'Comparative trend analytics across multiple reporting series.',

  series = [],

  periodKey = null,
  locale = DEFAULT_LOCALE,
  currency = DEFAULT_CURRENCY,

  height = DEFAULT_HEIGHT,
  maxPoints = DEFAULT_MAX_POINTS,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showSeriesControls = true,

  showLegend = true,
  showGrid = true,

  emptyMessage =
    'No analytical series are available for the selected scope and period.',

  className = '',
  style = {},
  ariaLabel = null,

  /**
   * Presentation options.
   */
  curveType = 'monotone',
  xAxisTickFormatter = null,
  yAxisLeftLabel = null,
  yAxisRightLabel = null,

  /**
   * Optional custom value formatter for specialized non-financial display.
   * Signature:
   *   ({ value, series, locale, currency }) => string
   */
  valueFormatter = null,

  /**
   * Controls whether the area series should be rendered with a gradient.
   * The default remains brand-neutral and uses TITech CSS tokens.
   */
  useAreaGradient = true,

  /**
   * Accessibility-friendly chart description.
   */
  accessibilitySummary = null,
}) {
  const chartId = useId();

  const normalized = useMemo(
    () =>
      normalizeMultiSeriesData(
        data,
        {
          locale,
          series,
          periodKey,
        },
      ),
    [
      data,
      locale,
      periodKey,
      series,
    ],
  );

  const rows = useMemo(() => {
    const source =
      normalized.rows;

    let selected =
      source;

    if (
      Number.isFinite(
        Number(maxPoints),
      )
      && Number(maxPoints) > 0
      && source.length
        > Number(maxPoints)
    ) {
      selected =
        source.slice(
          -Math.floor(
            Number(maxPoints),
          ),
        );
    }

    return selected.map(
      (row) =>
        normalizeDisplayRow(
          row,
          normalized.series,
        ),
    );
  }, [
    maxPoints,
    normalized.rows,
    normalized.series,
  ]);

  /*
   * UI state only. It never changes the supplied reporting data.
   */
  const initialVisibleKeys =
    useMemo(
      () =>
        normalized.series
          .filter(
            (definition) =>
              definition.visible
              && seriesHasValues(
                rows,
                definition.dataKey,
              ),
          )
          .map(
            (definition) =>
              definition.dataKey,
          ),
      [
        normalized.series,
        rows,
      ],
    );

  const [
    visibleKeys,
    setVisibleKeys,
  ] = useState(
    initialVisibleKeys,
  );

  const availableSeries =
    useMemo(
      () =>
        normalized.series.filter(
          (definition) =>
            seriesHasValues(
              rows,
              definition.dataKey,
            ),
        ),
      [
        normalized.series,
        rows,
      ],
    );

  /*
   * Keep externally added/removed series definitions synchronized with
   * presentation state without making the chart controlled by hidden state.
   */
  const effectiveVisibleKeys =
    useMemo(() => {
      const allowed =
        new Set(
          availableSeries.map(
            (definition) =>
              definition.dataKey,
          ),
        );

      const retained =
        visibleKeys.filter(
          (key) => allowed.has(key),
        );

      if (retained.length > 0) {
        return retained;
      }

      return availableSeries
        .slice(0, 1)
        .map(
          (definition) =>
            definition.dataKey,
        );
    }, [
      availableSeries,
      visibleKeys,
    ]);

  const visibleSeries =
    useMemo(
      () =>
        availableSeries.filter(
          (definition) =>
            effectiveVisibleKeys.includes(
              definition.dataKey,
            ),
        ),
      [
        availableSeries,
        effectiveVisibleKeys,
      ],
    );

  const summaries =
    useMemo(
      () =>
        buildSeriesSummaries(
          rows,
          visibleSeries,
        ),
      [
        rows,
        visibleSeries,
      ],
    );

  const hasAnyData =
    normalized.hasData
    && rows.length > 0;

  const leftSeries =
    visibleSeries.filter(
      (definition) =>
        definition.axis ===
        MULTI_SERIES_AXES.LEFT,
    );

  const rightSeries =
    visibleSeries.filter(
      (definition) =>
        definition.axis ===
        MULTI_SERIES_AXES.RIGHT,
    );

  const headingId =
    `multi-series-heading-${safeDomId(
      chartId,
    )}`;

  const chartDescription =
    ariaLabel
    || accessibilitySummary
    || `${title}. ${description}`;

  const toggleSeries =
    (dataKey) => {
      setVisibleKeys(
        (current) => {
          if (
            current.includes(dataKey)
          ) {
            const next =
              current.filter(
                (key) =>
                  key !== dataKey,
              );

            /*
             * Always keep one visual series visible.
             */
            if (next.length === 0) {
              return [
                dataKey,
              ];
            }

            return next;
          }

          return [
            ...current,
            dataKey,
          ];
        },
      );
    };

  const renderValue =
    (
      value,
      definition,
    ) => {
      if (
        typeof valueFormatter ===
        'function'
      ) {
        return valueFormatter({
          value,
          series: definition,
          locale,
          currency:
            definition.currency
            || currency,
        });
      }

      return formatMultiSeriesValue(
        value,
        {
          format:
            definition.format,
          currency:
            definition.currency
            || currency,
          locale,
        },
      );
    };

  const renderSeriesElement =
    (definition) => {
      const dataKey =
        definition.dataKey;

      const name =
        definition.name;

      const commonProps = {
        key:
          `${dataKey}-${definition.type}`,
        dataKey,
        name,
        stroke:
          definition.color,
        strokeWidth:
          definition.strokeWidth,
        strokeDasharray:
          definition.strokeDasharray,
        connectNulls:
          definition.connectNulls,
        isAnimationActive: true,
        animationDuration: 600,
      };

      if (
        definition.type ===
        MULTI_SERIES_TYPES.BAR
      ) {
        return (
          <Bar
            {...commonProps}
            yAxisId={
              definition.axis
            }
            fill={
              definition.color
            }
            fillOpacity={
              definition.fillOpacity
            }
            radius={[
              4,
              4,
              0,
              0,
            ]}
            barSize={
              definition.barSize
            }
            stackId={
              definition.stackId
            }
          />
        );
      }

      if (
        definition.type ===
        MULTI_SERIES_TYPES.AREA
      ) {
        return (
          <Area
            {...commonProps}
            yAxisId={
              definition.axis
            }
            type={
              curveType
            }
            fill={
              useAreaGradient
                ? `url(#${safeDomId(
                    chartId,
                  )}-${safeDomId(
                    dataKey,
                  )}-gradient)`
                : definition.color
            }
            fillOpacity={
              useAreaGradient
                ? 1
                : definition.fillOpacity
            }
            dot={false}
            activeDot={{
              r: 4,
            }}
          />
        );
      }

      return (
        <Line
          {...commonProps}
          yAxisId={
            definition.axis
          }
          type={
            curveType
          }
          dot={false}
          activeDot={{
            r: 4,
          }}
        />
      );
    };

  return (
    <section
      className={className}
      aria-labelledby={headingId}
      aria-label={chartDescription}
      style={{
        minWidth: 0,
        border:
          `1px solid ${CSS.border}`,
        borderRadius: 16,
        background:
          CSS.surface,
        boxShadow:
          '0 2px 10px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems:
            'flex-start',
          justifyContent:
            'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding:
            '18px 18px 14px',
          borderBottom:
            `1px solid ${CSS.border}`,
        }}
      >
        <div
          style={{
            minWidth: 0,
            flex:
              '1 1 320px',
          }}
        >
          <div
            id={headingId}
            style={{
              color:
                CSS.textPrimary,
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.25,
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 780,
              color:
                CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>

          <div
            style={{
              marginTop: 8,
              color:
                CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            Analytical presentation only. Authoritative domain and financial
            state remains owned by TITech backend services.
          </div>
        </div>

        {showSeriesControls
        && !loading
        && !error
        && availableSeries.length > 0 ? (
          <div
            role="group"
            aria-label="Chart series visibility"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent:
                'flex-end',
              gap: 7,
              maxWidth: 700,
            }}
          >
            {availableSeries.map(
              (definition) => (
                <SeriesControl
                  key={
                    definition.dataKey
                  }
                  definition={
                    definition
                  }
                  visible={effectiveVisibleKeys.includes(
                    definition.dataKey,
                  )}
                  onToggle={
                    toggleSeries
                  }
                />
              ),
            )}
          </div>
        ) : null}
      </div>

      {/* Summary */}
      {showSummary
      && !loading
      && !error
      && hasAnyData
      && summaries.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(165px, 1fr))',
            gap: 9,
            padding: 14,
            background:
              CSS.surfaceMuted,
            borderBottom:
              `1px solid ${CSS.border}`,
          }}
        >
          {summaries.map(
            (summary) => (
              <SummaryCard
                key={
                  summary.dataKey
                }
                summary={summary}
                locale={
                  locale
                }
              />
            ),
          )}
        </div>
      ) : null}

      {/* Body */}
      {loading ? (
        <StatePanel type="loading" />
      ) : error ? (
        <StatePanel
          type="error"
          message={
            typeof error ===
            'string'
              ? error
              : error?.message
          }
          onRetry={onRetry}
        />
      ) : !hasAnyData ? (
        <StatePanel
          type="empty"
          message={
            emptyMessage
          }
        />
      ) : (
        <div
          style={{
            padding: 14,
          }}
        >
          {/* Chart */}
          <div
            role="img"
            aria-label={
              chartDescription
            }
            style={{
              width: '100%',
              height,
              minHeight: 260,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <ComposedChart
                data={rows}
                margin={{
                  top: 12,
                  right:
                    rightSeries.length
                      > 0
                      ? 18
                      : 8,
                  left:
                    leftSeries.length
                      > 0
                      ? 8
                      : 0,
                  bottom: 8,
                }}
              >
                <defs>
                  {visibleSeries
                    .filter(
                      (definition) =>
                        definition.type ===
                        MULTI_SERIES_TYPES.AREA,
                    )
                    .map(
                      (definition) => (
                        <linearGradient
                          key={
                            definition.dataKey
                          }
                          id={`${safeDomId(
                            chartId,
                          )}-${safeDomId(
                            definition.dataKey,
                          )}-gradient`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={
                              definition.color
                            }
                            stopOpacity={
                              definition.fillOpacity
                              * 1.35
                            }
                          />

                          <stop
                            offset="100%"
                            stopColor={
                              definition.color
                            }
                            stopOpacity={
                              0.03
                            }
                          />
                        </linearGradient>
                      ),
                    )}
                </defs>

                {showGrid ? (
                  <CartesianGrid
                    stroke={
                      CSS.border
                    }
                    strokeDasharray={
                      '3 4'
                    }
                    vertical={
                      false
                    }
                  />
                ) : null}

                <XAxis
                  dataKey="__label"
                  tick={{
                    fill:
                      CSS.textSecondary,
                    fontSize: 11,
                  }}
                  tickLine={
                    false
                  }
                  axisLine={{
                    stroke:
                      CSS.border,
                  }}
                  minTickGap={
                    22
                  }
                  tickFormatter={
                    typeof xAxisTickFormatter ===
                    'function'
                      ? (
                          value,
                        ) =>
                          xAxisTickFormatter(
                            value,
                          )
                      : undefined
                  }
                />

                {leftSeries.length >
                0 ? (
                  <YAxis
                    yAxisId={
                      MULTI_SERIES_AXES.LEFT
                    }
                    orientation="left"
                    tick={{
                      fill:
                        CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={
                      false
                    }
                    axisLine={
                      false
                    }
                    width={78}
                    label={
                      yAxisLeftLabel
                        ? {
                            value:
                              yAxisLeftLabel,
                            angle:
                              -90,
                            position:
                              'insideLeft',
                            fill:
                              CSS.textSecondary,
                            fontSize: 11,
                          }
                        : undefined
                    }
                    tickFormatter={(
                      value,
                    ) => {
                      const definition =
                        leftSeries[0];

                      return formatMultiSeriesValue(
                        value,
                        {
                          format:
                            definition?.format
                            ?? MULTI_SERIES_FORMATS.NUMBER,
                          currency:
                            definition?.currency
                            || currency,
                          locale,
                        },
                      );
                    }}
                  />
                ) : null}

                {rightSeries.length >
                0 ? (
                  <YAxis
                    yAxisId={
                      MULTI_SERIES_AXES.RIGHT
                    }
                    orientation="right"
                    tick={{
                      fill:
                        CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={
                      false
                    }
                    axisLine={
                      false
                    }
                    width={84}
                    label={
                      yAxisRightLabel
                        ? {
                            value:
                              yAxisRightLabel,
                            angle:
                              90,
                            position:
                              'insideRight',
                            fill:
                              CSS.textSecondary,
                            fontSize: 11,
                          }
                        : undefined
                    }
                    tickFormatter={(
                      value,
                    ) => {
                      const definition =
                        rightSeries[0];

                      return formatMultiSeriesValue(
                        value,
                        {
                          format:
                            definition?.format
                            ?? MULTI_SERIES_FORMATS.NUMBER,
                          currency:
                            definition?.currency
                            || currency,
                          locale,
                        },
                      );
                    }}
                  />
                ) : null}

                <Tooltip
                  cursor={{
                    stroke:
                      CSS.borderStrong,
                    strokeDasharray:
                      '4 4',
                  }}
                  content={
                    <MultiSeriesTooltip
                      locale={
                        locale
                      }
                      currency={
                        currency
                      }
                      series={
                        visibleSeries
                      }
                    />
                  }
                />

                {visibleSeries.map(
                  renderSeriesElement,
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          {showLegend
          && visibleSeries.length >
            0 ? (
            <div
              role="list"
              aria-label="Chart series legend"
              style={{
                display: 'flex',
                alignItems:
                  'center',
                flexWrap: 'wrap',
                gap: 12,
                marginTop: 12,
                paddingTop: 12,
                borderTop:
                  `1px solid ${CSS.border}`,
              }}
            >
              {visibleSeries.map(
                (definition) => (
                  <div
                    role="listitem"
                    key={
                      definition.dataKey
                    }
                    style={{
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      gap: 7,
                      color:
                        CSS.textSecondary,
                      fontSize: 11,
                      fontWeight: 650,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 9,
                        height: 3,
                        borderRadius: 999,
                        background:
                          definition.color,
                      }}
                    />

                    {definition.name}

                    {definition.axis ===
                    MULTI_SERIES_AXES.RIGHT ? (
                      <span
                        style={{
                          color:
                            CSS.textSecondary,
                          fontSize: 9,
                        }}
                      >
                        right axis
                      </span>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          ) : null}

          {/* Data status */}
          <div
            style={{
              display: 'flex',
              alignItems:
                'flex-start',
              justifyContent:
                'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginTop: 12,
              color:
                CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            <span>
              Showing {rows.length}{' '}
              reporting point
              {rows.length === 1
                ? ''
                : 's'}
              {' '}
              across{' '}
              {
                visibleSeries.length
              }{' '}
              visible series.
            </span>

            <span>
              Client-side summaries are presentation analytics and are not
              authoritative accounting or domain records.
            </span>
          </div>

          {typeof renderValue ===
          'function' ? null : null}
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Public defaults / metadata
 * ========================================================================== */

export const MULTI_SERIES_DEFAULTS =
  Object.freeze({
    locale:
      DEFAULT_LOCALE,
    currency:
      DEFAULT_CURRENCY,
    height:
      DEFAULT_HEIGHT,
    maxPoints:
      DEFAULT_MAX_POINTS,
    curveType:
      'monotone',
    showSummary:
      true,
    showSeriesControls:
      true,
    showLegend:
      true,
    showGrid:
      true,
    useAreaGradient:
      true,
  });

/**
 * Public helper for consumers that need to build a standard TITech series
 * definition programmatically.
 *
 * @param {object} input
 * @returns {object}
 */
export function createMultiSeriesDefinition(
  input = {},
) {
  return normalizeMultiSeriesDefinition(
    input,
    0,
  );
}

/* ============================================================================
 * Public component
 * ========================================================================== */

export const MultiSeriesChart = memo(
  MultiSeriesChartComponent,
);

MultiSeriesChart.displayName =
  'MultiSeriesChart';

export default MultiSeriesChart;