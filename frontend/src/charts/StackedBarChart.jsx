'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/StackedBarChart.jsx
 *
 * Purpose:
 *   Enterprise-grade reusable stacked-bar analytics component for TITech.
 *
 * Responsibilities:
 *   - Render multiple categorical series in stacked bars.
 *   - Support multiple independent stack groups.
 *   - Support horizontal and vertical layouts.
 *   - Support signed values without silently converting them to absolute values.
 *   - Support optional right-axis series for heterogeneous measurements.
 *   - Normalize common backend/API reporting envelopes.
 *   - Safely process numeric strings and Decimal128-like values for display.
 *   - Provide interactive, presentation-only series visibility controls.
 *   - Provide deterministic loading, error and empty states.
 *   - Provide accessible labels, keyboard controls and responsive layout.
 *
 * Financial / domain integrity:
 *   - This component is PRESENTATION-ONLY.
 *   - It MUST NOT mutate savings, loans, payments, revenue, member records,
 *     journals, balances, settlements, reconciliation records or audit state.
 *   - Stacking changes only the visual representation of supplied values.
 *   - Client-derived totals and percentages are reporting analytics only.
 *   - Authoritative financial and domain values remain backend-controlled.
 *   - A negative displayed value remains a signed analytical value; the chart
 *     MUST NOT silently reinterpret it as an accounting reversal, refund,
 *     settlement or correction.
 *
 * Typical usage:
 *
 *   import StackedBarChart from './charts/StackedBarChart.jsx';
 *
 *   const series = [
 *     {
 *       dataKey: 'memberSavings',
 *       name: 'Member Savings',
 *       stackId: 'savings',
 *       format: 'currency',
 *     },
 *     {
 *       dataKey: 'loanPortfolio',
 *       name: 'Loan Portfolio',
 *       stackId: 'portfolio',
 *       format: 'currency',
 *     },
 *     {
 *       dataKey: 'members',
 *       name: 'Members',
 *       stackId: 'population',
 *       format: 'number',
 *       axis: 'right',
 *     },
 *   ];
 *
 *   <StackedBarChart
 *     data={report}
 *     series={series}
 *     categoryKey="period"
 *     title="Portfolio Composition"
 *     currency="UGX"
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
  Bar,
  CartesianGrid,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

export const STACKED_BAR_TYPES = Object.freeze({
  BAR: 'bar',
});

export const STACKED_BAR_FORMATS = Object.freeze({
  CURRENCY: 'currency',
  NUMBER: 'number',
  PERCENT: 'percent',
});

export const STACKED_BAR_AXES = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
});

export const STACKED_BAR_LAYOUTS = Object.freeze({
  VERTICAL: 'vertical',
  HORIZONTAL: 'horizontal',
});

export const DEFAULT_LOCALE = 'en-UG';
export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_HEIGHT = 390;
export const DEFAULT_MAX_POINTS = 36;
export const DEFAULT_STACK_ID = 'default';

const DEFAULT_COLORS = Object.freeze([
  'var(--titech-chart-series-1)',
  'var(--titech-chart-series-2)',
  'var(--titech-chart-series-3)',
  'var(--titech-chart-series-4)',
  'var(--titech-chart-series-5)',
  'var(--titech-chart-series-6)',
  'var(--titech-chart-series-7)',
  'var(--titech-chart-series-8)',
]);

const CSS = Object.freeze({
  primary:
    'var(--titech-primary)',
  primarySoft:
    'var(--titech-primary-soft)',
  surface:
    'var(--titech-surface)',
  surfaceMuted:
    'var(--titech-surface-muted)',
  border:
    'var(--titech-border)',
  borderStrong:
    'var(--titech-border-strong)',
  textPrimary:
    'var(--titech-text-primary)',
  textSecondary:
    'var(--titech-text-secondary)',
  success:
    'var(--titech-success)',
  warning:
    'var(--titech-warning)',
  danger:
    'var(--titech-danger)',
});

const NUMBER_FORMATTER_CACHE = new Map();
const DATE_FORMATTER_CACHE = new Map();

/* ============================================================================
 * Generic helpers
 * ========================================================================== */

/**
 * Safely unwrap common API envelopes.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function unwrapStackedBarPayload(
  input,
) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      'data',
    )
    && input.data !== null
    && input.data !== undefined
  ) {
    return input.data;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      'result',
    )
    && input.result !== null
    && input.result !== undefined
  ) {
    return input.result;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      'payload',
    )
    && input.payload !== null
    && input.payload !== undefined
  ) {
    return input.payload;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      'response',
    )
    && input.response !== null
    && input.response !== undefined
  ) {
    return input.response;
  }

  return input;
}

/**
 * Normalize an unknown value into an array.
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
 * Get the first defined field from aliases.
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
  if (
    !source
    || typeof source !== 'object'
  ) {
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
 * Parse a numeric value for presentation.
 *
 * This supports common Mongo/JSON numeric wrappers but is not the financial
 * precision boundary.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseStackedBarNumber(
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

  if (
    typeof value === 'object'
    && value !== null
  ) {
    const candidate =
      value.$numberDecimal
      ?? value.$numberLong
      ?? value.$number
      ?? value.value
      ?? value.amount
      ?? value.total;

    if (candidate !== undefined) {
      return parseStackedBarNumber(
        candidate,
        fallback,
      );
    }

    if (
      typeof value.toString ===
      'function'
    ) {
      const stringified =
        value.toString();

      if (
        stringified !==
        '[object Object]'
      ) {
        return parseStackedBarNumber(
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
    const timestamp =
      value.getTime();

    return Number.isFinite(timestamp)
      ? timestamp
      : null;
  }

  if (
    typeof value === 'number'
    || typeof value === 'bigint'
  ) {
    const numeric =
      Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const text =
    String(value).trim();

  if (
    /^\d{10,13}$/.test(text)
  ) {
    const numeric =
      Number(text);

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const parsed =
    Date.parse(text);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Create a safe DOM id.
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
 * Formatting
 * ========================================================================== */

/**
 * Format a period.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatStackedBarPeriod(
  value,
  locale = DEFAULT_LOCALE,
) {
  const timestamp =
    toTimestamp(value);

  if (timestamp === null) {
    const text =
      String(value ?? '').trim();

    return text || 'Current';
  }

  const key =
    `${locale}|stacked-bar-period`;

  let formatter =
    DATE_FORMATTER_CACHE.get(
      key,
    );

  if (!formatter) {
    formatter =
      new Intl.DateTimeFormat(
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
 * Format money.
 *
 * @param {unknown} value
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
export function formatStackedBarCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|currency|${currency}`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(
      key,
    );

  if (!formatter) {
    formatter =
      new Intl.NumberFormat(
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

    NUMBER_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  return formatter.format(
    parseStackedBarNumber(
      value,
    ),
  );
}

/**
 * Format a number.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatStackedBarNumber(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|stacked-bar-number`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(
      key,
    );

  if (!formatter) {
    formatter =
      new Intl.NumberFormat(
        locale,
        {
          maximumFractionDigits: 2,
        },
      );

    NUMBER_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  return formatter.format(
    parseStackedBarNumber(
      value,
    ),
  );
}

/**
 * Format percentage.
 *
 * Accepts either:
 *   0.25 -> 25%
 *   25   -> 25%
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatStackedBarPercent(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|stacked-bar-percent`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(
      key,
    );

  if (!formatter) {
    formatter =
      new Intl.NumberFormat(
        locale,
        {
          style: 'percent',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        },
      );

    NUMBER_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  let normalized =
    parseStackedBarNumber(
      value,
    );

  if (normalized > 1) {
    normalized /= 100;
  }

  return formatter.format(
    Math.max(
      0,
      normalized,
    ),
  );
}

/**
 * Format using a normalized series contract.
 *
 * @param {unknown} value
 * @param {object} definition
 * @param {object} options
 * @returns {string}
 */
export function formatStackedBarValue(
  value,
  definition = {},
  {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
  } = {},
) {
  const format =
    definition.format
    ?? STACKED_BAR_FORMATS.NUMBER;

  if (
    format ===
    STACKED_BAR_FORMATS.CURRENCY
  ) {
    return formatStackedBarCurrency(
      value,
      definition.currency
        || currency,
      locale,
    );
  }

  if (
    format ===
    STACKED_BAR_FORMATS.PERCENT
  ) {
    return formatStackedBarPercent(
      value,
      locale,
    );
  }

  return formatStackedBarNumber(
    value,
    locale,
  );
}

/* ============================================================================
 * Series normalization
 * ========================================================================== */

/**
 * Normalize one stack series.
 *
 * @param {unknown} input
 * @param {number} index
 * @returns {object}
 */
export function normalizeStackedBarSeries(
  input,
  index = 0,
) {
  const source =
    input
    && typeof input === 'object'
      ? input
      : {};

  const dataKey =
    String(
      firstDefined(
        source,
        [
          'dataKey',
          'key',
          'field',
        ],
        '',
      ),
    ).trim();

  const format =
    Object.values(
      STACKED_BAR_FORMATS,
    ).includes(
      source.format,
    )
      ? source.format
      : STACKED_BAR_FORMATS.NUMBER;

  const axis =
    source.axis ===
      STACKED_BAR_AXES.RIGHT
    || source.yAxisId === 'right'
    || source.yAxisId === 1
      ? STACKED_BAR_AXES.RIGHT
      : STACKED_BAR_AXES.LEFT;

  const stackId =
    String(
      firstDefined(
        source,
        [
          'stackId',
          'stack',
          'group',
        ],
        DEFAULT_STACK_ID,
      ),
    ).trim()
    || DEFAULT_STACK_ID;

  return {
    id:
      String(
        firstDefined(
          source,
          [
            'id',
            'seriesId',
            'dataKey',
            'key',
          ],
          `stack-series-${index + 1}`,
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
          ],
          dataKey
          || `Series ${index + 1}`,
        ),
      ),

    type:
      STACKED_BAR_TYPES.BAR,

    format,

    currency:
      String(
        firstDefined(
          source,
          ['currency'],
          DEFAULT_CURRENCY,
        ),
      ),

    axis,

    stackId,

    color:
      source.color
      || DEFAULT_COLORS[
        index
        % DEFAULT_COLORS.length
      ],

    visible:
      source.visible !== false,

    opacity:
      Number.isFinite(
        Number(
          source.opacity,
        ),
      )
        ? Math.max(
            0.05,
            Math.min(
              1,
              Number(
                source.opacity,
              ),
            ),
          )
        : 0.92,

    radius:
      Array.isArray(
        source.radius,
      )
        ? source.radius
        : [
            4,
            4,
            0,
            0,
          ],

    barSize:
      Number.isFinite(
        Number(
          source.barSize,
        ),
      )
        ? Math.max(
            4,
            Number(
              source.barSize,
            ),
          )
        : undefined,

    minPointSize:
      Number.isFinite(
        Number(
          source.minPointSize,
        ),
      )
        ? Math.max(
            0,
            Number(
              source.minPointSize,
            ),
          )
        : undefined,

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
  const seen =
    new Set();

  const output =
    [];

  for (
    const definition of
      series
  ) {
    if (
      !definition.dataKey
    ) {
      continue;
    }

    if (
      seen.has(
        definition.dataKey,
      )
    ) {
      continue;
    }

    seen.add(
      definition.dataKey,
    );

    output.push(
      definition,
    );
  }

  return output;
}

/**
 * Infer numeric stack series from data.
 *
 * @param {Array} rows
 * @param {string} categoryKey
 * @returns {Array}
 */
function inferStackedBarSeries(
  rows,
  categoryKey,
) {
  if (!rows.length) {
    return [];
  }

  const first =
    rows.find(
      (row) =>
        row
        && typeof row === 'object',
    );

  if (!first) {
    return [];
  }

  const excluded =
    new Set([
      categoryKey,
      'id',
      '_id',
      'key',
      'period',
      'month',
      'date',
      'label',
      'name',
      'timestamp',
      'createdAt',
      'updatedAt',
      '__id',
      '__label',
      '__period',
    ]);

  return Object.keys(
    first,
  )
    .filter(
      (key) =>
        !excluded.has(key)
        && Number.isFinite(
          parseStackedBarNumber(
            first[key],
            NaN,
          ),
        ),
    )
    .slice(0, 12)
    .map(
      (
        dataKey,
        index,
      ) =>
        normalizeStackedBarSeries(
          {
            dataKey,
            name:
              dataKey,
            stackId:
              DEFAULT_STACK_ID,
            format:
              STACKED_BAR_FORMATS.NUMBER,
          },
          index,
        ),
    );
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

/**
 * Normalize complete stacked-bar data.
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   rows: Array,
 *   series: Array,
 *   hasData: boolean,
 *   authoritative: boolean
 * }}
 */
export function normalizeStackedBarData(
  input,
  {
    series = [],
    locale = DEFAULT_LOCALE,
    categoryKey = null,
  } = {},
) {
  const payload =
    unwrapStackedBarPayload(
      input,
    );

  if (
    payload === null
    || payload === undefined
  ) {
    return {
      rows: [],
      series: [],
      hasData: false,
      authoritative: false,
    };
  }

  const source =
    Array.isArray(payload)
      ? {}
      : (
          payload
          && typeof payload === 'object'
            ? payload
            : {}
        );

  const resolvedCategoryKey =
    String(
      categoryKey
      || firstDefined(
        source,
        [
          'categoryKey',
          'groupBy',
          'dimension',
          'periodKey',
        ],
        'period',
      ),
    );

  const rawRows =
    Array.isArray(payload)
      ? payload
      : firstDefined(
          source,
          [
            'data',
            'rows',
            'items',
            'records',
            'seriesData',
            'trend',
            'timeSeries',
            'breakdown',
            'history',
          ],
          [],
        );

  const rows =
    asArray(rawRows).map(
      (
        item,
        index,
      ) => {
        const row =
          item
          && typeof item ===
            'object'
            ? {
                ...item,
              }
            : {};

        const rawCategory =
          firstDefined(
            row,
            [
              resolvedCategoryKey,
              'period',
              'date',
              'month',
              'label',
              'name',
            ],
            `Category ${index + 1}`,
          );

        return {
          ...row,

          __id:
            String(
              firstDefined(
                row,
                [
                  'id',
                  '_id',
                  'key',
                ],
                `row-${index + 1}`,
              ),
            ),

          __period:
            rawCategory,

          __label:
            formatStackedBarPeriod(
              rawCategory,
              locale,
            ),
        };
      },
    );

  const normalizedSeries =
    deduplicateSeries(
      asArray(series).map(
        normalizeStackedBarSeries,
      ),
    );

  const effectiveSeries =
    normalizedSeries.length > 0
      ? normalizedSeries
      : inferStackedBarSeries(
          rows,
          resolvedCategoryKey,
        );

  return {
    rows,
    series:
      effectiveSeries,
    hasData:
      rows.length > 0
      && effectiveSeries.length > 0,
    authoritative:
      Boolean(
        !Array.isArray(payload)
        && (
          source.rows
          || source.data
          || source.seriesData
          || source.trend
          || source.timeSeries
          || source.breakdown
          || source.history
        ),
      ),
  };
}

/**
 * Normalize individual row values while preserving signed values.
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

  for (
    const definition of
      series
  ) {
    const parsed =
      parseStackedBarNumber(
        row?.[
          definition.dataKey
        ],
        NaN,
      );

    output[
      definition.dataKey
    ] =
      Number.isFinite(parsed)
        ? parsed
        : null;
  }

  return output;
}

/* ============================================================================
 * Summary
 * ========================================================================== */

/**
 * Calculate latest/aggregate summary values.
 *
 * @param {Array} rows
 * @param {Array} series
 * @returns {Array}
 */
function buildSeriesSummaries(
  rows,
  series,
) {
  const latest =
    rows.length > 0
      ? rows[
          rows.length - 1
        ]
      : null;

  return series.map(
    (definition) => {
      const values =
        rows
          .map(
            (row) =>
              parseStackedBarNumber(
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
        values[0] ?? 0;

      const latestValue =
        parseStackedBarNumber(
          latest?.[
            definition.dataKey
          ],
          values[
            values.length - 1
          ] ?? 0,
        );

      const total =
        values.reduce(
          (
            sum,
            value,
          ) =>
            sum + value,
          0,
        );

      const delta =
        latestValue - first;

      const rate =
        first === 0
          ? 0
          : delta /
            Math.abs(first);

      return {
        ...definition,

        latest:
          latestValue,

        first,

        total,

        delta,

        rate,

        count:
          values.length,
      };
    },
  );
}

function SummaryCard({
  summary,
  locale,
  currency,
}) {
  return (
    <div
      style={{
        minWidth: 0,
        border:
          `1px solid ${CSS.border}`,
        borderRadius: 11,
        background:
          CSS.surface,
        padding:
          '12px 14px',
      }}
    >
      <div
        style={{
          display:
            'flex',
          alignItems:
            'center',
          gap:
            7,
          minWidth:
            0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width:
              8,
            height:
              8,
            flex:
              '0 0 auto',
            borderRadius:
              999,
            background:
              summary.color,
          }}
        />

        <span
          style={{
            minWidth:
              0,
            overflow:
              'hidden',
            textOverflow:
              'ellipsis',
            whiteSpace:
              'nowrap',
            color:
              CSS.textSecondary,
            fontSize:
              11,
            fontWeight:
              700,
          }}
        >
          {summary.name}
        </span>
      </div>

      <div
        style={{
          marginTop:
            7,
          color:
            CSS.textPrimary,
          fontSize:
            18,
          fontWeight:
            800,
          lineHeight:
            1.2,
          overflowWrap:
            'anywhere',
        }}
      >
        {formatStackedBarValue(
          summary.latest,
          summary,
          {
            locale,
            currency,
          },
        )}
      </div>

      <div
        style={{
          marginTop:
            5,
          display:
            'flex',
          alignItems:
            'center',
          flexWrap:
            'wrap',
          gap:
            7,
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
            fontSize:
              11,
            fontWeight:
              700,
          }}
        >
          {summary.delta > 0
            ? '+'
            : ''}
          {formatStackedBarValue(
            summary.delta,
            summary,
            {
              locale,
              currency,
            },
          )}
        </span>

        <span
          style={{
            color:
              CSS.textSecondary,
            fontSize:
              10,
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

export function StackedBarTooltip({
  active,
  payload,
  label,
  locale = DEFAULT_LOCALE,
  currency = DEFAULT_CURRENCY,
  series = [],
  showStackTotals = false,
}) {
  if (
    !active
    || !Array.isArray(payload)
    || payload.length === 0
  ) {
    return null;
  }

  const definitions =
    new Map(
      series.map(
        (definition) => [
          definition.dataKey,
          definition,
        ],
      ),
    );

  const visibleEntries =
    payload.filter(
      (entry) =>
        entry
        && entry.value !==
          null
        && entry.value !==
          undefined,
    );

  const stackTotals =
    showStackTotals
      ? visibleEntries.reduce(
          (
            accumulator,
            entry,
          ) => {
            const definition =
              definitions.get(
                entry.dataKey,
              );

            const stackId =
              definition?.stackId
              ?? DEFAULT_STACK_ID;

            if (
              !accumulator[
                stackId
              ]
            ) {
              accumulator[
                stackId
              ] = 0;
            }

            accumulator[
              stackId
            ] += parseStackedBarNumber(
              entry.value,
            );

            return accumulator;
          },
          {},
        )
      : null;

  return (
    <div
      role="tooltip"
      style={{
        minWidth:
          250,
        maxWidth:
          390,
        border:
          `1px solid ${CSS.borderStrong}`,
        borderRadius:
          12,
        background:
          CSS.surface,
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.10)',
        padding:
          12,
      }}
    >
      <div
        style={{
          marginBottom:
            9,
          color:
            CSS.textPrimary,
          fontSize:
            13,
          fontWeight:
            800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          display:
            'grid',
          gap:
            7,
        }}
      >
        {visibleEntries.map(
          (entry) => {
            const definition =
              definitions.get(
                entry.dataKey,
              );

            return (
              <div
                key={
                  String(
                    entry.dataKey,
                  )
                }
                style={{
                  display:
                    'flex',
                  alignItems:
                    'center',
                  justifyContent:
                    'space-between',
                  gap:
                    16,
                }}
              >
                <span
                  style={{
                    display:
                      'inline-flex',
                    alignItems:
                      'center',
                    gap:
                      7,
                    minWidth:
                      0,
                    color:
                      CSS.textSecondary,
                    fontSize:
                      12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width:
                        8,
                      height:
                        8,
                      flex:
                        '0 0 auto',
                      borderRadius:
                        999,
                      background:
                        entry.color
                        ?? definition?.color
                        ?? CSS.primary,
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
                    flex:
                      '0 0 auto',
                    color:
                      CSS.textPrimary,
                    fontSize:
                      12,
                  }}
                >
                  {formatStackedBarValue(
                    entry.value,
                    definition,
                    {
                      locale,
                      currency,
                    },
                  )}
                </strong>
              </div>
            );
          },
        )}
      </div>

      {showStackTotals &&
      stackTotals ? (
        <div
          style={{
            marginTop:
              10,
            paddingTop:
              9,
            borderTop:
              `1px solid ${CSS.border}`,
          }}
        >
          {Object.entries(
            stackTotals,
          ).map(
            (
              [
                stackId,
                total,
              ],
            ) => {
              const definition =
                series.find(
                  (item) =>
                    item.stackId ===
                    stackId,
                );

              return (
                <div
                  key={
                    stackId
                  }
                  style={{
                    display:
                      'flex',
                    alignItems:
                      'center',
                    justifyContent:
                      'space-between',
                    gap:
                      12,
                    marginTop:
                      4,
                  }}
                >
                  <span
                    style={{
                      color:
                        CSS.textSecondary,
                      fontSize:
                        10,
                    }}
                  >
                    {definition
                      ? `${stackId} total`
                      : 'Stack total'}
                  </span>

                  <strong
                    style={{
                      color:
                        CSS.textPrimary,
                      fontSize:
                        11,
                    }}
                  >
                    {formatStackedBarValue(
                      total,
                      definition,
                      {
                        locale,
                        currency,
                      },
                    )}
                  </strong>
                </div>
              );
            },
          )}
        </div>
      ) : null}

      <div
        style={{
          marginTop:
            10,
          paddingTop:
            8,
          borderTop:
            `1px solid ${CSS.border}`,
          color:
            CSS.textSecondary,
          fontSize:
            10,
          lineHeight:
            1.45,
        }}
      >
        Stacking is a visual representation of supplied reporting values only.
      </div>
    </div>
  );
}

/* ============================================================================
 * Loading / error / empty states
 * ========================================================================== */

function StackedBarStatePanel({
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
          display:
            'grid',
          gap:
            12,
          padding:
            18,
        }}
      >
        <div
          style={{
            width:
              '30%',
            height:
              14,
            borderRadius:
              8,
            background:
              CSS.primarySoft,
          }}
        />

        <div
          style={{
            width:
              '100%',
            height:
              230,
            borderRadius:
              12,
            background:
              'linear-gradient(90deg, rgba(20,108,148,0.05), rgba(20,108,148,0.12), rgba(20,108,148,0.05))',
          }}
        />

        <div
          style={{
            width:
              '70%',
            height:
              12,
            borderRadius:
              8,
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
          display:
            'grid',
          placeItems:
            'center',
          minHeight:
            240,
          padding:
            24,
          textAlign:
            'center',
        }}
      >
        <div>
          <div
            style={{
              color:
                CSS.danger,
              fontSize:
                15,
              fontWeight:
                800,
            }}
          >
            Unable to load stacked-bar analytics
          </div>

          <div
            style={{
              marginTop:
                6,
              maxWidth:
                520,
              color:
                CSS.textSecondary,
              fontSize:
                13,
              lineHeight:
                1.5,
            }}
          >
            {message
              || 'The reporting dataset could not be displayed.'}
          </div>

          {typeof onRetry ===
          'function' ? (
            <button
              type="button"
              onClick={
                onRetry
              }
              style={{
                marginTop:
                  14,
                border:
                  `1px solid ${CSS.borderStrong}`,
                borderRadius:
                  8,
                background:
                  CSS.surface,
                color:
                  CSS.textPrimary,
                padding:
                  '8px 12px',
                cursor:
                  'pointer',
                fontSize:
                  12,
                fontWeight:
                  750,
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
        display:
          'grid',
        placeItems:
          'center',
        minHeight:
          240,
        padding:
          24,
        textAlign:
          'center',
      }}
    >
      <div>
        <div
          style={{
            color:
              CSS.textPrimary,
            fontSize:
              15,
            fontWeight:
              800,
          }}
        >
          No stacked-bar data
        </div>

        <div
          style={{
            marginTop:
              6,
            maxWidth:
              520,
            color:
              CSS.textSecondary,
            fontSize:
              13,
            lineHeight:
              1.5,
          }}
        >
          {message
            || 'Stacked analytics will appear when reporting data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Series control
 * ========================================================================== */

function SeriesButton({
  definition,
  visible,
  onToggle,
}) {
  return (
    <button
      type="button"
      aria-pressed={
        visible
      }
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
        display:
          'inline-flex',
        alignItems:
          'center',
        gap:
          7,
        minHeight:
          31,
        border:
          `1px solid ${
            visible
              ? CSS.borderStrong
              : CSS.border
          }`,
        borderRadius:
          999,
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
        cursor:
          'pointer',
        fontSize:
          11,
        fontWeight:
          700,
        opacity:
          visible
            ? 1
            : 0.75,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width:
            8,
          height:
            8,
          flex:
            '0 0 auto',
          borderRadius:
            999,
          background:
            definition.color,
          opacity:
            visible
              ? 1
              : 0.4,
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
        {definition.name}
      </span>
    </button>
  );
}

/* ============================================================================
 * Main component
 * ========================================================================== */

function StackedBarChartComponent({
  data = null,

  title =
    'Stacked Analytics',
  description =
    'Categorical composition and contribution across reporting periods.',

  series = [],

  categoryKey = null,

  currency =
    DEFAULT_CURRENCY,
  locale =
    DEFAULT_LOCALE,

  layout =
    STACKED_BAR_LAYOUTS.VERTICAL,

  height =
    DEFAULT_HEIGHT,

  maxPoints =
    DEFAULT_MAX_POINTS,

  loading =
    false,
  error =
    null,
  onRetry =
    null,

  showSummary =
    true,
  showSeriesControls =
    true,
  showLegend =
    true,
  showStackTotals =
    false,
  showIntegrityNote =
    true,

  className =
    '',
  style =
    {},
  ariaLabel =
    null,

  emptyMessage =
    'No stacked-bar reporting data is available for the selected scope and period.',

  /**
   * Optional custom axis formatter.
   */
  axisValueFormatter =
    null,

  /**
   * Optional custom tooltip/display formatter.
   *
   * Signature:
   *   ({ value, series, locale, currency }) => string
   */
  valueFormatter =
    null,

  /**
   * Minimum category gap.
   */
  barCategoryGap =
    '18%',

  /**
   * Bar gap between independent stack groups.
   */
  barGap =
    4,
}) {
  const chartId =
    useId();

  const normalized =
    useMemo(
      () =>
        normalizeStackedBarData(
          data,
          {
            series,
            locale,
            categoryKey,
          },
        ),
      [
        data,
        locale,
        categoryKey,
        series,
      ],
    );

  const rows =
    useMemo(
      () => {
        const source =
          normalized.rows;

        if (
          maxPoints === null
          || maxPoints === undefined
          || Number(maxPoints) <= 0
          || source.length <=
            Number(maxPoints)
        ) {
          return source.map(
            (row) =>
              normalizeDisplayRow(
                row,
                normalized.series,
              ),
          );
        }

        return source
          .slice(
            -Math.floor(
              Number(maxPoints),
            ),
          )
          .map(
            (row) =>
              normalizeDisplayRow(
                row,
                normalized.series,
              ),
          );
      },
      [
        maxPoints,
        normalized.rows,
        normalized.series,
      ],
    );

  const availableSeries =
    useMemo(
      () =>
        normalized.series.filter(
          (definition) =>
            rows.some(
              (row) =>
                Number.isFinite(
                  parseStackedBarNumber(
                    row?.[
                      definition.dataKey
                    ],
                    NaN,
                  ),
                ),
            ),
          ),
      [
        normalized.series,
        rows,
      ],
    );

  const initialVisible =
    useMemo(
      () =>
        availableSeries
          .filter(
            (definition) =>
              definition.visible,
          )
          .map(
            (definition) =>
              definition.dataKey,
          ),
      [
        availableSeries,
      ],
    );

  const [
    visibleKeys,
    setVisibleKeys,
  ] = useState(
    initialVisible,
  );

  const effectiveVisibleKeys =
    useMemo(
      () => {
        const allowed =
          new Set(
            availableSeries.map(
              (definition) =>
                definition.dataKey,
            ),
          );

        const retained =
          visibleKeys.filter(
            (key) =>
              allowed.has(key),
          );

        if (
          retained.length > 0
        ) {
          return retained;
        }

        return availableSeries[0]
          ? [
              availableSeries[0]
                .dataKey,
            ]
          : [];
      },
      [
        availableSeries,
        visibleKeys,
      ],
    );

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

  const hasData =
    normalized.hasData
    && rows.length > 0
    && visibleSeries.length > 0;

  const leftSeries =
    visibleSeries.filter(
      (definition) =>
        definition.axis ===
        STACKED_BAR_AXES.LEFT,
    );

  const rightSeries =
    visibleSeries.filter(
      (definition) =>
        definition.axis ===
        STACKED_BAR_AXES.RIGHT,
    );

  const headingId =
    `stacked-bar-heading-${safeDomId(
      chartId,
    )}`;

  const chartDescription =
    ariaLabel
    || `${title}. ${description}`;

  const toggleSeries =
    (dataKey) => {
      setVisibleKeys(
        (current) => {
          if (
            current.includes(
              dataKey,
            )
          ) {
            const next =
              current.filter(
                (key) =>
                  key !== dataKey,
              );

            if (
              next.length === 0
            ) {
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

  const displayValue =
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
          series:
            definition,
          locale,
          currency:
            definition?.currency
            || currency,
        });
      }

      return formatStackedBarValue(
        value,
        definition,
        {
          locale,
          currency,
        },
      );
    };

  const leftDefinition =
    leftSeries[0]
    ?? visibleSeries[0]
    ?? null;

  const rightDefinition =
    rightSeries[0]
    ?? null;

  return (
    <section
      className={className}
      aria-labelledby={
        headingId
      }
      aria-label={
        chartDescription
      }
      style={{
        minWidth:
          0,
        border:
          `1px solid ${CSS.border}`,
        borderRadius:
          16,
        background:
          CSS.surface,
        boxShadow:
          '0 2px 10px rgba(0,0,0,0.04)',
        overflow:
          'hidden',
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display:
            'flex',
          alignItems:
            'flex-start',
          justifyContent:
            'space-between',
          gap:
            16,
          flexWrap:
            'wrap',
          padding:
            '18px 18px 14px',
          borderBottom:
            `1px solid ${CSS.border}`,
        }}
      >
        <div
          style={{
            minWidth:
              0,
            flex:
              '1 1 340px',
          }}
        >
          <div
            id={
              headingId
            }
            style={{
              color:
                CSS.textPrimary,
              fontSize:
                18,
              fontWeight:
                800,
              lineHeight:
                1.25,
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop:
                6,
              maxWidth:
                820,
              color:
                CSS.textSecondary,
              fontSize:
                13,
              lineHeight:
                1.5,
            }}
          >
            {description}
          </div>

          {showIntegrityNote ? (
            <div
              style={{
                marginTop:
                  8,
                maxWidth:
                  900,
                color:
                  CSS.textSecondary,
                fontSize:
                  11,
                lineHeight:
                  1.5,
              }}
            >
              Stacking changes only how supplied reporting values are
              visualized; it does not create a second source of financial or
              operational truth.
            </div>
          ) : null}
        </div>

        {showSeriesControls
        && !loading
        && !error
        && availableSeries.length >
          0 ? (
          <div
            role="group"
            aria-label="Stacked-bar series visibility"
            style={{
              display:
                'flex',
              flexWrap:
                'wrap',
              justifyContent:
                'flex-end',
              gap:
                7,
              maxWidth:
                760,
            }}
          >
            {availableSeries.map(
              (
                definition,
              ) => (
                <SeriesButton
                  key={
                    definition.dataKey
                  }
                  definition={
                    definition
                  }
                  visible={
                    effectiveVisibleKeys.includes(
                      definition.dataKey,
                    )
                  }
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
      && hasData
      && summaries.length > 0 ? (
        <div
          style={{
            display:
              'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(165px, 1fr))',
            gap:
              9,
            padding:
              14,
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
                summary={
                  summary
                }
                locale={
                  locale
                }
                currency={
                  currency
                }
              />
            ),
          )}
        </div>
      ) : null}

      {/* States */}
      {loading ? (
        <StackedBarStatePanel
          type="loading"
        />
      ) : error ? (
        <StackedBarStatePanel
          type="error"
          message={
            typeof error ===
            'string'
              ? error
              : error?.message
          }
          onRetry={
            onRetry
          }
        />
      ) : !hasData ? (
        <StackedBarStatePanel
          type="empty"
          message={
            emptyMessage
          }
        />
      ) : (
        <div
          style={{
            padding:
              14,
          }}
        >
          {/* Plot */}
          <div
            role="img"
            aria-label={
              chartDescription
            }
            style={{
              width:
                '100%',
              height,
              minHeight:
                280,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart
                data={
                  rows
                }
                layout={
                  layout ===
                  STACKED_BAR_LAYOUTS.HORIZONTAL
                    ? 'horizontal'
                    : 'vertical'
                }
                margin={{
                  top:
                    12,
                  right:
                    rightSeries.length >
                    0
                      ? 24
                      : 12,
                  left:
                    12,
                  bottom:
                    10,
                }}
                barCategoryGap={
                  barCategoryGap
                }
                barGap={
                  barGap
                }
              >
                <CartesianGrid
                  stroke={
                    CSS.border
                  }
                  strokeDasharray="3 4"
                  vertical={
                    layout ===
                    STACKED_BAR_LAYOUTS.VERTICAL
                  }
                  horizontal={
                    layout !==
                    STACKED_BAR_LAYOUTS.VERTICAL
                  }
                />

                {layout ===
                STACKED_BAR_LAYOUTS.HORIZONTAL ? (
                  <>
                    <XAxis
                      type="number"
                      tick={{
                        fill:
                          CSS.textSecondary,
                        fontSize:
                          11,
                      }}
                      tickLine={
                        false
                      }
                      axisLine={{
                        stroke:
                          CSS.border,
                      }}
                      tickFormatter={(
                        value,
                      ) => {
                        if (
                          typeof axisValueFormatter ===
                          'function'
                        ) {
                          return axisValueFormatter(
                            value,
                          );
                        }

                        return formatStackedBarValue(
                          value,
                          leftDefinition
                            ?? {},
                          {
                            locale,
                            currency,
                          },
                        );
                      }}
                    />

                    <YAxis
                      type="category"
                      dataKey={
                        '__label'
                      }
                      width={
                        110
                      }
                      tick={{
                        fill:
                          CSS.textSecondary,
                        fontSize:
                          11,
                      }}
                      tickLine={
                        false
                      }
                      axisLine={
                        false
                      }
                    />
                  </>
                ) : (
                  <>
                    <XAxis
                      dataKey={
                        '__label'
                      }
                      tick={{
                        fill:
                          CSS.textSecondary,
                        fontSize:
                          11,
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
                    />

                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      tick={{
                        fill:
                          CSS.textSecondary,
                        fontSize:
                          11,
                      }}
                      tickLine={
                        false
                      }
                      axisLine={
                        false
                      }
                      width={
                        98
                      }
                      tickFormatter={(
                        value,
                      ) => {
                        if (
                          typeof axisValueFormatter ===
                          'function'
                        ) {
                          return axisValueFormatter(
                            value,
                          );
                        }

                        return formatStackedBarValue(
                          value,
                          leftDefinition
                            ?? {},
                          {
                            locale,
                            currency,
                          },
                        );
                      }}
                    />

                    {rightSeries.length >
                    0 ? (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{
                          fill:
                            CSS.textSecondary,
                          fontSize:
                            11,
                        }}
                        tickLine={
                          false
                        }
                        axisLine={
                          false
                        }
                        width={
                          84
                        }
                        tickFormatter={(
                          value,
                        ) =>
                          typeof axisValueFormatter ===
                          'function'
                            ? axisValueFormatter(
                                value,
                              )
                            : formatStackedBarValue(
                                value,
                                rightDefinition
                                  ?? {},
                                {
                                  locale,
                                  currency,
                                },
                              )
                        }
                      />
                    ) : null}
                  </>
                )}

                <Tooltip
                  cursor={{
                    fill:
                      CSS.primarySoft,
                  }}
                  content={
                    <StackedBarTooltip
                      locale={
                        locale
                      }
                      currency={
                        currency
                      }
                      series={
                        visibleSeries
                      }
                      showStackTotals={
                        showStackTotals
                      }
                    />
                  }
                />

                {showLegend ? (
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{
                      paddingTop:
                        12,
                      fontSize:
                        11,
                      color:
                        CSS.textSecondary,
                    }}
                  />
                ) : null}

                {visibleSeries.map(
                  (
                    definition,
                  ) => (
                    <Bar
                      key={
                        `${definition.dataKey}-${definition.stackId}`
                      }
                      dataKey={
                        definition.dataKey
                      }
                      name={
                        definition.name
                      }
                      stackId={
                        definition.stackId
                      }
                      yAxisId={
                        layout ===
                        STACKED_BAR_LAYOUTS.HORIZONTAL
                          ? undefined
                          : definition.axis
                      }
                      fill={
                        definition.color
                      }
                      fillOpacity={
                        definition.opacity
                      }
                      stroke={
                        definition.color
                      }
                      strokeWidth={
                        0
                      }
                      radius={
                        definition.radius
                      }
                      barSize={
                        definition.barSize
                      }
                      minPointSize={
                        definition.minPointSize
                      }
                      isAnimationActive
                      animationDuration={
                        550
                      }
                    />
                  ),
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Stack explanation */}
          <div
            style={{
              display:
                'flex',
              alignItems:
                'flex-start',
              justifyContent:
                'space-between',
              gap:
                16,
              flexWrap:
                'wrap',
              marginTop:
                12,
              paddingTop:
                12,
              borderTop:
                `1px solid ${CSS.border}`,
              color:
                CSS.textSecondary,
              fontSize:
                11,
              lineHeight:
                1.5,
            }}
          >
            <span>
              Showing {rows.length}{' '}
              reporting point
              {rows.length ===
              1
                ? ''
                : 's'}{' '}
              across {
                visibleSeries.length
              }{' '}
              visible series.
            </span>

            <span>
              Series sharing a stack ID are visually composited; separate
              stack IDs remain independent groups.
            </span>
          </div>

          {/* Financial integrity note */}
          {showIntegrityNote ? (
            <div
              style={{
                marginTop:
                  9,
                color:
                  CSS.textSecondary,
                fontSize:
                  11,
                lineHeight:
                  1.5,
              }}
            >
              This visualization does not post, reverse, reconcile or settle
              financial records. Any totals, percentages or composition
              interpretations derived by the browser are reporting analytics
              only.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Public defaults / metadata
 * ========================================================================== */

export const STACKED_BAR_DEFAULTS =
  Object.freeze({
    locale:
      DEFAULT_LOCALE,
    currency:
      DEFAULT_CURRENCY,
    height:
      DEFAULT_HEIGHT,
    maxPoints:
      DEFAULT_MAX_POINTS,
    layout:
      STACKED_BAR_LAYOUTS.VERTICAL,
    barCategoryGap:
      '18%',
    barGap:
      4,
    showSummary:
      true,
    showSeriesControls:
      true,
    showLegend:
      true,
    showStackTotals:
      false,
    showIntegrityNote:
      true,
  });

/**
 * Factory for a normalized TITech stacked-bar series.
 *
 * @param {object} input
 * @param {number} index
 * @returns {object}
 */
export function createStackedBarSeries(
  input = {},
  index = 0,
) {
  return normalizeStackedBarSeries(
    input,
    index,
  );
}

/* ============================================================================
 * Public component
 * ========================================================================== */

export const StackedBarChart =
  memo(
    StackedBarChartComponent,
  );

StackedBarChart.displayName =
  'StackedBarChart';

export default StackedBarChart;