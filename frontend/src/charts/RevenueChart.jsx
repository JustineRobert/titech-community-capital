'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/RevenueChart.jsx
 *
 * Purpose:
 *   Enterprise-grade revenue analytics for TITech commercial and executive
 *   reporting surfaces.
 *
 * Responsibilities:
 *   - Present revenue trends over time.
 *   - Separate revenue streams such as transaction, subscription and other
 *     commercial revenue.
 *   - Support authoritative backend summaries and reporting time series.
 *   - Normalize common API envelopes and field aliases.
 *   - Safely handle Decimal128-like values and numeric strings.
 *   - Support configurable currency and locale formatting.
 *   - Provide responsive, accessible and keyboard-operable reporting controls.
 *   - Provide deterministic loading, error and empty states.
 *
 * TITech commercial / financial integrity:
 *   - This component is PRESENTATION-ONLY.
 *   - It MUST NOT create revenue entries, assess fees, post journals, mutate
 *     balances, change contributions, perform settlement or trigger billing.
 *   - Contribution principal MUST remain conceptually separate from revenue.
 *   - A fee/revenue chart MUST NOT imply that a member's contribution
 *     principal was reduced merely because revenue was recognized.
 *   - Authoritative revenue recognition, fee assessment, journal posting,
 *     settlement, reconciliation and billing remain backend/domain concerns.
 *   - Client-derived totals, deltas, ratios and margins are display analytics.
 *
 * Supported revenue concepts:
 *   - totalRevenue
 *   - transactionRevenue
 *   - subscriptionRevenue
 *   - saasRevenue
 *   - referralRevenue
 *   - otherRevenue
 *   - assessedFees
 *   - revenueCount
 *
 * Notes:
 *   The reporting API may use any subset of these fields. Consumers can supply
 *   an explicit `series` definition to control the exact presentation.
 *
 * Typical usage:
 *
 *   import RevenueChart from './charts/RevenueChart.jsx';
 *
 *   <RevenueChart
 *     data={revenueResponse}
 *     currency="UGX"
 *     locale="en-UG"
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

export const REVENUE_SERIES = Object.freeze({
  TOTAL: 'totalRevenue',
  TRANSACTION: 'transactionRevenue',
  SUBSCRIPTION: 'subscriptionRevenue',
  SAAS: 'saasRevenue',
  REFERRAL: 'referralRevenue',
  OTHER: 'otherRevenue',
  ASSESSED_FEES: 'assessedFees',
  REVENUE_COUNT: 'revenueCount',
});

export const REVENUE_SERIES_LABELS = Object.freeze({
  [REVENUE_SERIES.TOTAL]: 'Total Revenue',
  [REVENUE_SERIES.TRANSACTION]: 'Transaction Revenue',
  [REVENUE_SERIES.SUBSCRIPTION]: 'Subscription Revenue',
  [REVENUE_SERIES.SAAS]: 'SaaS Revenue',
  [REVENUE_SERIES.REFERRAL]: 'Referral Revenue',
  [REVENUE_SERIES.OTHER]: 'Other Revenue',
  [REVENUE_SERIES.ASSESSED_FEES]: 'Assessed Fees',
  [REVENUE_SERIES.REVENUE_COUNT]: 'Revenue Events',
});

export const REVENUE_FORMATS = Object.freeze({
  CURRENCY: 'currency',
  NUMBER: 'number',
  PERCENT: 'percent',
});

export const DEFAULT_LOCALE = 'en-UG';
export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_HEIGHT = 380;
export const DEFAULT_MAX_POINTS = 48;

const DEFAULT_SERIES = Object.freeze([
  REVENUE_SERIES.TOTAL,
  REVENUE_SERIES.TRANSACTION,
  REVENUE_SERIES.SUBSCRIPTION,
]);

const CSS = Object.freeze({
  primary:
    'var(--titech-primary, #146c94)',
  primarySoft:
    'var(--titech-primary-soft, rgba(20,108,148,0.12))',
  surface:
    'var(--titech-surface, var(--color-white))',
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
 * Primitive helpers
 * ========================================================================== */

/**
 * Safely unwrap common API envelopes.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function unwrapRevenuePayload(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (
    input.data !== null
    && input.data !== undefined
    && Object.prototype.hasOwnProperty.call(input, 'data')
  ) {
    return input.data;
  }

  if (
    input.result !== null
    && input.result !== undefined
    && Object.prototype.hasOwnProperty.call(input, 'result')
  ) {
    return input.result;
  }

  if (
    input.payload !== null
    && input.payload !== undefined
    && Object.prototype.hasOwnProperty.call(input, 'payload')
  ) {
    return input.payload;
  }

  if (
    input.response !== null
    && input.response !== undefined
    && Object.prototype.hasOwnProperty.call(input, 'response')
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
  return Array.isArray(value) ? value : [];
}

/**
 * Return the first defined field from a set of aliases.
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
      Object.prototype.hasOwnProperty.call(source, alias)
      && source[alias] !== null
      && source[alias] !== undefined
    ) {
      return source[alias];
    }
  }

  return fallback;
}

/**
 * Parse numeric values for presentation.
 *
 * Supports:
 *   - number
 *   - numeric string
 *   - bigint
 *   - Mongo Decimal128-like objects
 *   - common API wrappers
 *
 * This is NOT an accounting precision implementation.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseRevenueNumber(
  value,
  fallback = 0,
) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/,/g, '')
      .trim();

    if (!normalized) {
      return fallback;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (typeof value === 'object') {
    const candidate =
      value.$numberDecimal
      ?? value.$numberLong
      ?? value.$number
      ?? value.value
      ?? value.amount
      ?? value.total;

    if (candidate !== undefined) {
      return parseRevenueNumber(
        candidate,
        fallback,
      );
    }

    if (typeof value.toString === 'function') {
      const stringified = value.toString();

      if (stringified !== '[object Object]') {
        return parseRevenueNumber(
          stringified,
          fallback,
        );
      }
    }
  }

  return fallback;
}

/**
 * Safely normalize a positive display amount.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeRevenueAmount(value) {
  return Math.max(
    0,
    parseRevenueNumber(value),
  );
}

/**
 * Safely normalize a display count.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeRevenueCount(value) {
  return Math.max(
    0,
    Math.round(
      parseRevenueNumber(value),
    ),
  );
}

/**
 * Safe presentation ratio.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function safeRatio(
  numerator,
  denominator,
) {
  if (
    !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || denominator <= 0
  ) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Convert date-like values to timestamps.
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
    const result = value.getTime();

    return Number.isFinite(result)
      ? result
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
 * Format a reporting period.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatRevenuePeriod(
  value,
  locale = DEFAULT_LOCALE,
) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    const text = String(value ?? '').trim();
    return text || 'Current';
  }

  const key = `${locale}|revenue-period`;

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
 * Format currency.
 *
 * @param {unknown} value
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
export function formatRevenueAmount(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|currency|${currency}`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        minimumFractionDigits:
          currency === 'UGX' ? 0 : 2,
        maximumFractionDigits:
          currency === 'UGX' ? 0 : 2,
      },
    );

    NUMBER_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  return formatter.format(
    normalizeRevenueAmount(value),
  );
}

/**
 * Format count.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatRevenueCount(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key = `${locale}|revenue-count`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(
      locale,
      {
        maximumFractionDigits: 0,
      },
    );

    NUMBER_FORMATTER_CACHE.set(
      key,
      formatter,
    );
  }

  return formatter.format(
    normalizeRevenueCount(value),
  );
}

/**
 * Format a 0..1 percentage ratio.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatRevenueRate(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key = `${locale}|revenue-rate`;

  let formatter =
    NUMBER_FORMATTER_CACHE.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(
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
    parseRevenueNumber(value);

  /*
   * Accept APIs that return either:
   *   0.15 -> 15%
   *   15   -> 15%
   */
  if (normalized > 1) {
    normalized /= 100;
  }

  return formatter.format(
    Math.max(0, normalized),
  );
}

/**
 * Build a safe DOM identifier.
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
 * Revenue series helpers
 * ========================================================================== */

/**
 * Return canonical label.
 *
 * @param {string} dataKey
 * @returns {string}
 */
export function getRevenueSeriesLabel(
  dataKey,
) {
  return (
    REVENUE_SERIES_LABELS[dataKey]
    ?? String(dataKey || 'Revenue')
  );
}

/**
 * Return a default TITech chart color.
 *
 * @param {number} index
 * @returns {string}
 */
function getRevenueSeriesColor(index) {
  return DEFAULT_SERIES_COLORS[
    index % DEFAULT_SERIES_COLORS.length
  ];
}

/**
 * Normalize one series definition.
 *
 * @param {unknown} input
 * @param {number} index
 * @returns {object}
 */
export function normalizeRevenueSeries(
  input,
  index = 0,
) {
  const source =
    input && typeof input === 'object'
      ? input
      : {};

  const dataKey = String(
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

  const requestedType =
    String(
      source.type
      ?? 'line',
    ).toLowerCase();

  const type =
    requestedType === 'area'
    || requestedType === 'bar'
      ? requestedType
      : 'line';

  const requestedFormat =
    String(
      source.format
      ?? 'currency',
    ).toLowerCase();

  const format =
    Object.values(
      REVENUE_FORMATS,
    ).includes(
      requestedFormat,
    )
      ? requestedFormat
      : REVENUE_FORMATS.CURRENCY;

  return {
    id: String(
      firstDefined(
        source,
        [
          'id',
          'seriesId',
          'dataKey',
          'key',
        ],
        `revenue-series-${index + 1}`,
      ),
    ),

    dataKey,

    name: String(
      firstDefined(
        source,
        [
          'name',
          'label',
          'title',
        ],
        getRevenueSeriesLabel(
          dataKey,
        ),
      ),
    ),

    type,

    format,

    currency: String(
      firstDefined(
        source,
        [
          'currency',
        ],
        DEFAULT_CURRENCY,
      ),
    ),

    axis:
      source.axis === 'right'
      || source.yAxisId === 'right'
      || source.yAxisId === 1
        ? 'right'
        : 'left',

    color:
      source.color
      || getRevenueSeriesColor(index),

    visible:
      source.visible !== false,

    strokeWidth:
      Number.isFinite(
        Number(
          source.strokeWidth,
        ),
      )
        ? Number(
            source.strokeWidth,
          )
        : type === 'area'
          ? 2.5
          : 2,

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

    strokeDasharray:
      source.strokeDasharray
      || undefined,

    connectNulls:
      source.connectNulls !== false,

    stackId:
      source.stackId
      || undefined,

    raw: source,
  };
}

/**
 * Default aliases for known revenue fields.
 */
const REVENUE_FIELD_ALIASES = Object.freeze({
  [REVENUE_SERIES.TOTAL]: [
    'totalRevenue',
    'revenue',
    'total',
    'recognizedRevenue',
    'netRevenue',
  ],

  [REVENUE_SERIES.TRANSACTION]: [
    'transactionRevenue',
    'transactionFees',
    'transactionFeeRevenue',
    'paymentRevenue',
    'paymentFeeRevenue',
    'transactionIncome',
  ],

  [REVENUE_SERIES.SUBSCRIPTION]: [
    'subscriptionRevenue',
    'subscriptionIncome',
    'subscriptionFees',
    'billingRevenue',
  ],

  [REVENUE_SERIES.SAAS]: [
    'saasRevenue',
    'saasIncome',
    'platformRevenue',
    'platformFees',
  ],

  [REVENUE_SERIES.REFERRAL]: [
    'referralRevenue',
    'referralFees',
    'referralIncome',
  ],

  [REVENUE_SERIES.OTHER]: [
    'otherRevenue',
    'otherIncome',
    'miscRevenue',
    'miscellaneousRevenue',
  ],

  [REVENUE_SERIES.ASSESSED_FEES]: [
    'assessedFees',
    'feesAssessed',
    'assessedFeeRevenue',
    'feeRevenue',
  ],

  [REVENUE_SERIES.REVENUE_COUNT]: [
    'revenueCount',
    'transactionCount',
    'eventCount',
    'count',
  ],
});

/**
 * Return aliases for a series.
 *
 * @param {string} dataKey
 * @returns {string[]}
 */
function getRevenueAliases(dataKey) {
  return (
    REVENUE_FIELD_ALIASES[
      dataKey
    ]
    ?? [dataKey]
  );
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

/**
 * Normalize one historical revenue point.
 *
 * @param {unknown} input
 * @param {number} index
 * @param {string} locale
 * @returns {object}
 */
function normalizeRevenueRow(
  input,
  index,
  locale,
) {
  const source =
    input && typeof input === 'object'
      ? input
      : {};

  const rawPeriod =
    firstDefined(
      source,
      [
        'period',
        'month',
        'date',
        'reportingPeriod',
        'snapshotDate',
        'timestamp',
        'createdAt',
        'label',
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
          'periodKey',
          'key',
        ],
        `revenue-period-${index + 1}`,
      ),
    ),

    __period: rawPeriod,

    __label:
      formatRevenuePeriod(
        rawPeriod,
        locale,
      ),
  };

  for (
    const [
      dataKey,
      aliases,
    ] of Object.entries(
      REVENUE_FIELD_ALIASES,
    )
  ) {
    row[dataKey] =
      parseRevenueNumber(
        firstDefined(
          source,
          aliases,
          0,
        ),
      );
  }

  return row;
}

/**
 * Infer numeric revenue series when no explicit series definition is supplied.
 *
 * @param {Array} rows
 * @returns {Array}
 */
function inferRevenueSeries(
  rows,
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

  const excluded = new Set([
    'id',
    '_id',
    'key',
    'period',
    'month',
    'date',
    'label',
    'timestamp',
    'createdAt',
    'updatedAt',
    '__id',
    '__period',
    '__label',
  ]);

  const candidateKeys =
    Object.keys(first)
      .filter(
        (key) =>
          !excluded.has(key)
          && Number.isFinite(
            parseRevenueNumber(
              first[key],
              NaN,
            ),
          ),
      )
      .slice(0, 8);

  return candidateKeys.map(
    (dataKey, index) =>
      normalizeRevenueSeries(
        {
          dataKey,
          name:
            getRevenueSeriesLabel(
              dataKey,
            ),
          type:
            index === 0
              ? 'area'
              : 'line',
          format:
            dataKey ===
            REVENUE_SERIES.REVENUE_COUNT
              ? REVENUE_FORMATS.NUMBER
              : REVENUE_FORMATS.CURRENCY,
        },
        index,
      ),
  );
}

/**
 * Normalize complete revenue chart input.
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   rows: Array,
 *   series: Array,
 *   summary: object,
 *   hasData: boolean,
 *   authoritative: boolean
 * }}
 */
export function normalizeRevenueData(
  input,
  {
    locale = DEFAULT_LOCALE,
    series = [],
  } = {},
) {
  const payload =
    unwrapRevenuePayload(
      input,
    );

  if (
    payload === null
    || payload === undefined
  ) {
    return {
      rows: [],
      series: [],
      summary: {},
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

  const rawRows =
    Array.isArray(payload)
      ? payload
      : firstDefined(
          source,
          [
            'trend',
            'trends',
            'seriesData',
            'timeSeries',
            'timeline',
            'historical',
            'history',
            'rows',
            'records',
            'items',
            'data',
          ],
          [],
        );

  const rows =
    asArray(rawRows).map(
      (item, index) =>
        normalizeRevenueRow(
          item,
          index,
          locale,
        ),
    );

  const normalizedSeries =
    asArray(series)
      .map(
        normalizeRevenueSeries,
      )
      .filter(
        (definition) =>
          definition.dataKey,
      );

  const effectiveSeries =
    normalizedSeries.length > 0
      ? normalizedSeries
      : inferRevenueSeries(
          rows,
        );

  const summarySource =
    source.summary
    && typeof source.summary === 'object'
      ? source.summary
      : source.metrics
        && typeof source.metrics === 'object'
          ? source.metrics
          : {};

  const latest =
    rows.length > 0
      ? rows[rows.length - 1]
      : null;

  const explicitTotal =
    firstDefined(
      summarySource,
      [
        'totalRevenue',
        'revenue',
        'recognizedRevenue',
        'netRevenue',
      ],
      undefined,
    );

  const derivedTotal =
    effectiveSeries
      .filter(
        (definition) =>
          definition.dataKey !==
          REVENUE_SERIES.TOTAL,
      )
      .reduce(
        (total, definition) =>
          total
          + parseRevenueNumber(
            latest?.[
              definition.dataKey
            ],
          ),
        0,
      );

  const latestTotal =
    explicitTotal !== undefined
      ? normalizeRevenueAmount(
          explicitTotal,
        )
      : normalizeRevenueAmount(
          latest?.[
            REVENUE_SERIES.TOTAL
          ],
        );

  const fallbackTotal =
    latestTotal > 0
      ? latestTotal
      : derivedTotal;

  return {
    rows,
    series:
      effectiveSeries,
    summary: {
      totalRevenue:
        fallbackTotal,

      transactionRevenue:
        normalizeRevenueAmount(
          firstDefined(
            summarySource,
            REVENUE_FIELD_ALIASES[
              REVENUE_SERIES.TRANSACTION
            ],
            latest?.[
              REVENUE_SERIES.TRANSACTION
            ] ?? 0,
          ),
        ),

      subscriptionRevenue:
        normalizeRevenueAmount(
          firstDefined(
            summarySource,
            REVENUE_FIELD_ALIASES[
              REVENUE_SERIES.SUBSCRIPTION
            ],
            latest?.[
              REVENUE_SERIES.SUBSCRIPTION
            ] ?? 0,
          ),
        ),

      saasRevenue:
        normalizeRevenueAmount(
          firstDefined(
            summarySource,
            REVENUE_FIELD_ALIASES[
              REVENUE_SERIES.SAAS
            ],
            latest?.[
              REVENUE_SERIES.SAAS
            ] ?? 0,
          ),
        ),

      assessedFees:
        normalizeRevenueAmount(
          firstDefined(
            summarySource,
            REVENUE_FIELD_ALIASES[
              REVENUE_SERIES.ASSESSED_FEES
            ],
            latest?.[
              REVENUE_SERIES.ASSESSED_FEES
            ] ?? 0,
          ),
        ),

      revenueCount:
        normalizeRevenueCount(
          firstDefined(
            summarySource,
            REVENUE_FIELD_ALIASES[
              REVENUE_SERIES.REVENUE_COUNT
            ],
            latest?.[
              REVENUE_SERIES.REVENUE_COUNT
            ] ?? 0,
          ),
        ),
    },

    hasData:
      rows.length > 0
      && effectiveSeries.length > 0,

    authoritative:
      Boolean(
        source.summary
        || source.metrics
        || source.trend
        || source.timeSeries
        || source.seriesData
        || source.historical,
      ),
  };
}

/* ============================================================================
 * Summary helpers
 * ========================================================================== */

/**
 * Calculate a presentation-only change between first and latest points.
 *
 * @param {Array} rows
 * @param {string} dataKey
 * @returns {{
 *   first: number,
 *   latest: number,
 *   delta: number,
 *   rate: number
 * }}
 */
function getSeriesChange(
  rows,
  dataKey,
) {
  const values = rows
    .map(
      (row) =>
        parseRevenueNumber(
          row?.[dataKey],
          NaN,
        ),
    )
    .filter(
      Number.isFinite,
    );

  if (!values.length) {
    return {
      first: 0,
      latest: 0,
      delta: 0,
      rate: 0,
    };
  }

  const first = values[0];
  const latest =
    values[values.length - 1];

  const delta =
    latest - first;

  return {
    first,
    latest,
    delta,
    rate: safeRatio(
      delta,
      Math.abs(first),
    ),
  };
}

/**
 * Summary card.
 */
function RevenueMetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}) {
  const toneColor =
    tone === 'success'
      ? CSS.success
      : tone === 'warning'
        ? CSS.warning
        : tone === 'danger'
          ? CSS.danger
          : tone === 'info'
            ? CSS.primary
            : CSS.textPrimary;

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
          color:
            CSS.textSecondary,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing:
            '0.04em',
          textTransform:
            'uppercase',
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 6,
          color: toneColor,
          fontSize: 19,
          fontWeight: 800,
          lineHeight: 1.2,
          overflowWrap:
            'anywhere',
        }}
      >
        {value}
      </div>

      {helper ? (
        <div
          style={{
            marginTop: 5,
            color:
              CSS.textSecondary,
            fontSize: 11,
            lineHeight:
              1.45,
          }}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

export function RevenueTooltip({
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

  const definitions =
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
        minWidth: 240,
        maxWidth: 380,
        border:
          `1px solid ${CSS.borderStrong}`,
        borderRadius: 12,
        background:
          CSS.surface,
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.10)',
        padding: 12,
      }}
    >
      <div
        style={{
          marginBottom: 9,
          color:
            CSS.textPrimary,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          display:
            'grid',
          gap: 7,
        }}
      >
        {payload
          .filter(
            (entry) =>
              entry
              && entry.value !==
                null
              && entry.value !==
                undefined,
          )
          .map(
            (entry) => {
              const definition =
                definitions.get(
                  entry.dataKey,
                );

              const format =
                definition?.format
                ?? REVENUE_FORMATS.CURRENCY;

              const displayCurrency =
                definition?.currency
                || currency;

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
                        flex:
                          '0 0 auto',
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
                        ?? getRevenueSeriesLabel(
                          entry.dataKey,
                        )}
                    </span>
                  </span>

                  <strong
                    style={{
                      flex:
                        '0 0 auto',
                      color:
                        CSS.textPrimary,
                      fontSize: 12,
                    }}
                  >
                    {format ===
                    REVENUE_FORMATS.CURRENCY
                      ? formatRevenueAmount(
                          entry.value,
                          displayCurrency,
                          locale,
                        )
                      : format ===
                          REVENUE_FORMATS.PERCENT
                        ? formatRevenueRate(
                            entry.value,
                            locale,
                          )
                        : formatRevenueCount(
                            entry.value,
                            locale,
                          )}
                  </strong>
                </div>
              );
            },
          )}
      </div>

      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop:
            `1px solid ${CSS.border}`,
          color:
            CSS.textSecondary,
          fontSize: 10,
          lineHeight: 1.45,
        }}
      >
        Display analytics only; authoritative revenue recognition remains
        server-side.
      </div>
    </div>
  );
}

/* ============================================================================
 * Loading / error / empty states
 * ========================================================================== */

function RevenueStatePanel({
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
          gap: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            width: '32%',
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
            width: '72%',
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
          display:
            'grid',
          placeItems:
            'center',
          minHeight: 240,
          padding: 24,
          textAlign:
            'center',
        }}
      >
        <div>
          <div
            style={{
              color:
                CSS.danger,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            Unable to load revenue analytics
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 520,
              color:
                CSS.textSecondary,
              fontSize: 13,
              lineHeight:
                1.5,
            }}
          >
            {message
              || 'The revenue reporting dataset could not be displayed.'}
          </div>

          {typeof onRetry ===
          'function' ? (
            <button
              type="button"
              onClick={
                onRetry
              }
              style={{
                marginTop: 14,
                border:
                  `1px solid ${CSS.borderStrong}`,
                borderRadius: 8,
                background:
                  CSS.surface,
                color:
                  CSS.textPrimary,
                padding:
                  '8px 12px',
                cursor:
                  'pointer',
                fontSize: 12,
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
        minHeight: 240,
        padding: 24,
        textAlign:
          'center',
      }}
    >
      <div>
        <div
          style={{
            color:
              CSS.textPrimary,
            fontSize: 15,
            fontWeight: 800,
          }}
        >
          No revenue data
        </div>

        <div
          style={{
            marginTop: 6,
            maxWidth: 520,
            color:
              CSS.textSecondary,
            fontSize: 13,
            lineHeight:
              1.5,
          }}
        >
          {message
            || 'Revenue analytics will appear when the reporting data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Series control
 * ========================================================================== */

function RevenueSeriesButton({
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
        gap: 7,
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
        fontSize: 11,
        fontWeight:
          700,
        opacity:
          visible ? 1 : 0.75,
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
            999,
          background:
            definition.color,
          opacity:
            visible ? 1 : 0.4,
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

function RevenueChartComponent({
  data = null,

  title = 'Revenue',
  description =
    'Commercial revenue performance across the selected reporting period.',

  series = DEFAULT_SERIES,

  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,

  height = DEFAULT_HEIGHT,
  maxPoints = DEFAULT_MAX_POINTS,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showSeriesControls = true,
  showLegend = true,
  showDataMode = true,
  showRevenueIntegrityNote = true,

  className = '',
  style = {},
  ariaLabel = null,

  emptyMessage =
    'No revenue reporting data is available for the selected scope and period.',

  /**
   * Optional custom X-axis formatter.
   */
  xAxisTickFormatter = null,

  /**
   * Optional presentation-only value formatter.
   *
   * Signature:
   *   ({ value, series, locale, currency }) => string
   */
  valueFormatter = null,

  /**
   * Primary series used for the headline trend.
   */
  primarySeriesKey =
    REVENUE_SERIES.TOTAL,
}) {
  const chartId =
    useId();

  const normalized =
    useMemo(
      () =>
        normalizeRevenueData(
          data,
          {
            locale,
            series,
          },
        ),
      [
        data,
        locale,
        series,
      ],
    );

  const rows =
    useMemo(
      () => {
        const source =
          normalized.rows;

        if (
          !Number.isFinite(
            Number(
              maxPoints,
            ),
          )
          || Number(
            maxPoints,
          ) <= 0
          || source.length <=
            Number(
              maxPoints,
            )
        ) {
          return source;
        }

        return source.slice(
          -Math.floor(
            Number(
              maxPoints,
            ),
          ),
        );
      },
      [
        maxPoints,
        normalized.rows,
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
                  parseRevenueNumber(
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
      [availableSeries],
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

        return (
          availableSeries[0]
            ? [
                availableSeries[0]
                  .dataKey,
              ]
            : []
        );
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

  const primaryDefinition =
    visibleSeries.find(
      (definition) =>
        definition.dataKey ===
        primarySeriesKey,
    )
    ?? visibleSeries[0]
    ?? null;

  const primaryChange =
    useMemo(
      () =>
        primaryDefinition
          ? getSeriesChange(
              rows,
              primaryDefinition.dataKey,
            )
          : {
              first: 0,
              latest: 0,
              delta: 0,
              rate: 0,
            },
      [
        primaryDefinition,
        rows,
      ],
    );

  const totalRevenue =
    normalized.summary
      .totalRevenue;

  const transactionRevenue =
    normalized.summary
      .transactionRevenue;

  const subscriptionRevenue =
    normalized.summary
      .subscriptionRevenue;

  const assessedFees =
    normalized.summary
      .assessedFees;

  const revenueCount =
    normalized.summary
      .revenueCount;

  const totalVsComponents =
    transactionRevenue
    + subscriptionRevenue;

  const componentCoverage =
    safeRatio(
      totalVsComponents,
      totalRevenue,
    );

  const headingId =
    `revenue-heading-${safeDomId(
      chartId,
    )}`;

  const descriptionText =
    ariaLabel
    || `${title}. ${description}`;

  const toggleSeries =
    (dataKey) => {
      if (
        !availableSeries.some(
          (definition) =>
            definition.dataKey ===
            dataKey,
        )
      ) {
        return;
      }

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

            /*
             * Prevent an accidental empty visual surface.
             */
            if (
              next.length ===
              0
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
          series:
            definition,
          locale,
          currency:
            definition.currency
            || currency,
        });
      }

      if (
        definition.format ===
        REVENUE_FORMATS.NUMBER
      ) {
        return formatRevenueCount(
          value,
          locale,
        );
      }

      if (
        definition.format ===
        REVENUE_FORMATS.PERCENT
      ) {
        return formatRevenueRate(
          value,
          locale,
        );
      }

      return formatRevenueAmount(
        value,
        definition.currency
          || currency,
        locale,
      );
    };

  const hasData =
    normalized.hasData
    && rows.length > 0
    && visibleSeries.length > 0;

  return (
    <section
      className={className}
      aria-labelledby={
        headingId
      }
      aria-label={
        descriptionText
      }
      style={{
        minWidth: 0,
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
          gap: 16,
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
            minWidth: 0,
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
              marginTop: 6,
              maxWidth:
                800,
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

          {showRevenueIntegrityNote ? (
            <div
              style={{
                marginTop: 8,
                maxWidth:
                  860,
                color:
                  CSS.textSecondary,
                fontSize:
                  11,
                lineHeight:
                  1.5,
              }}
            >
              Revenue analytics are presentation data. Transaction fees or
              revenue recognition shown here do not alter member contribution
              principal; authoritative assessment and ledger posting remain
              server-side.
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
            aria-label="Revenue series visibility"
            style={{
              display:
                'flex',
              flexWrap:
                'wrap',
              justifyContent:
                'flex-end',
              gap: 7,
              maxWidth:
                720,
            }}
          >
            {availableSeries.map(
              (definition) => (
                <RevenueSeriesButton
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

      {/* Summary cards */}
      {showSummary
      && !loading
      && !error
      && hasData ? (
        <div
          style={{
            display:
              'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(165px, 1fr))',
            gap: 9,
            padding:
              14,
            background:
              CSS.surfaceMuted,
            borderBottom:
              `1px solid ${CSS.border}`,
          }}
        >
          <RevenueMetricCard
            label="Total Revenue"
            value={formatRevenueAmount(
              totalRevenue,
              currency,
              locale,
            )}
            helper="Latest supplied revenue total"
            tone="info"
          />

          <RevenueMetricCard
            label="Transaction Revenue"
            value={formatRevenueAmount(
              transactionRevenue,
              currency,
              locale,
            )}
            helper="Revenue associated with transaction fees"
            tone="success"
          />

          <RevenueMetricCard
            label="Subscription Revenue"
            value={formatRevenueAmount(
              subscriptionRevenue,
              currency,
              locale,
            )}
            helper="Subscription/billing revenue"
            tone="success"
          />

          <RevenueMetricCard
            label="Assessed Fees"
            value={formatRevenueAmount(
              assessedFees,
              currency,
              locale,
            )}
            helper="Supplied fee assessment metric"
            tone="warning"
          />

          <RevenueMetricCard
            label="Revenue Events"
            value={formatRevenueCount(
              revenueCount,
              locale,
            )}
            helper="Supplied reporting event count"
            tone="neutral"
          />

          <RevenueMetricCard
            label="Primary Trend"
            value={
              primaryDefinition
                ? (
                    primaryDefinition.format ===
                    REVENUE_FORMATS.CURRENCY
                      ? formatRevenueAmount(
                          primaryChange.latest,
                          primaryDefinition.currency
                            || currency,
                          locale,
                        )
                      : primaryDefinition.format ===
                          REVENUE_FORMATS.NUMBER
                        ? formatRevenueCount(
                            primaryChange.latest,
                            locale,
                          )
                        : formatRevenueRate(
                            primaryChange.latest,
                            locale,
                          )
                  )
                : '—'
            }
            helper={`${primaryDefinition?.name || 'Revenue'} latest point`}
            tone={
              primaryChange.delta >=
              0
                ? 'success'
                : 'warning'
            }
          />
        </div>
      ) : null}

      {/* State handling */}
      {loading ? (
        <RevenueStatePanel
          type="loading"
        />
      ) : error ? (
        <RevenueStatePanel
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
        <RevenueStatePanel
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
          {/* Chart */}
          <div
            role="img"
            aria-label={`${title} trend showing ${visibleSeries
              .map(
                (definition) =>
                  definition.name,
              )
              .join(', ')}`}
            style={{
              width:
                '100%',
              height,
              minHeight:
                270,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <ComposedChart
                data={
                  rows
                }
                margin={{
                  top:
                    12,
                  right:
                    20,
                  left:
                    8,
                  bottom:
                    8,
                }}
              >
                {/* Area gradients */}
                <defs>
                  {visibleSeries
                    .filter(
                      (definition) =>
                        definition.type ===
                        'area',
                    )
                    .map(
                      (
                        definition,
                      ) => (
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
                            stopOpacity={Math.min(
                              0.42,
                              definition.fillOpacity
                              * 1.5,
                            )}
                          />

                          <stop
                            offset="100%"
                            stopColor={
                              definition.color
                            }
                            stopOpacity={0.03}
                          />
                        </linearGradient>
                      ),
                    )}
                </defs>

                <CartesianGrid
                  stroke={
                    CSS.border
                  }
                  strokeDasharray="3 4"
                  vertical={
                    false
                  }
                />

                <XAxis
                  dataKey="__label"
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
                    95
                  }
                  tickFormatter={(
                    value,
                  ) => {
                    const definition =
                      visibleSeries.find(
                        (item) =>
                          item.axis ===
                          'left',
                      )
                      ?? primaryDefinition;

                    if (
                      !definition
                    ) {
                      return formatRevenueAmount(
                        value,
                        currency,
                        locale,
                      );
                    }

                    return renderValue(
                      value,
                      definition,
                    );
                  }}
                />

                {visibleSeries.some(
                  (definition) =>
                    definition.axis ===
                    'right',
                ) ? (
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
                    ) => {
                      const definition =
                        visibleSeries.find(
                          (item) =>
                            item.axis ===
                            'right',
                        );

                      if (
                        !definition
                      ) {
                        return formatRevenueCount(
                          value,
                          locale,
                        );
                      }

                      return renderValue(
                        value,
                        definition,
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
                    <RevenueTooltip
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
                  (
                    definition,
                  ) => {
                    const yAxisId =
                      definition.axis;

                    if (
                      definition.type ===
                      'area'
                    ) {
                      return (
                        <Area
                          key={
                            `${definition.dataKey}-area`
                          }
                          type="monotone"
                          dataKey={
                            definition.dataKey
                          }
                          name={
                            definition.name
                          }
                          yAxisId={
                            yAxisId
                          }
                          stroke={
                            definition.color
                          }
                          strokeWidth={
                            definition.strokeWidth
                          }
                          strokeDasharray={
                            definition.strokeDasharray
                          }
                          fill={`url(#${safeDomId(
                            chartId,
                          )}-${safeDomId(
                            definition.dataKey,
                          )}-gradient)`}
                          fillOpacity={1}
                          dot={
                            false
                          }
                          activeDot={{
                            r: 4,
                          }}
                          connectNulls={
                            definition.connectNulls
                          }
                          isAnimationActive
                          animationDuration={
                            600
                          }
                        />
                      );
                    }

                    /*
                     * Revenue bars are deliberately not used by default but
                     * remain available through an explicit series definition.
                     */
                    if (
                      definition.type ===
                      'bar'
                    ) {
                      /*
                       * Importing Bar only when required would require dynamic
                       * module loading and introduce complexity into this
                       * presentation component. Revenue charts therefore map
                       * explicit bar requests to a line presentation.
                       *
                       * Consumers seeking bar-only presentation can use the
                       * dedicated BarChartCard.
                       */
                      return (
                        <Line
                          key={
                            `${definition.dataKey}-line-fallback`
                          }
                          type="monotone"
                          dataKey={
                            definition.dataKey
                          }
                          name={
                            definition.name
                          }
                          yAxisId={
                            yAxisId
                          }
                          stroke={
                            definition.color
                          }
                          strokeWidth={
                            definition.strokeWidth
                          }
                          strokeDasharray={
                            definition.strokeDasharray
                            || '5 4'
                          }
                          dot={
                            false
                          }
                          activeDot={{
                            r: 4,
                          }}
                          connectNulls={
                            definition.connectNulls
                          }
                          isAnimationActive
                          animationDuration={
                            600
                          }
                        />
                      );
                    }

                    return (
                      <Line
                        key={
                          `${definition.dataKey}-line`
                        }
                        type="monotone"
                        dataKey={
                          definition.dataKey
                        }
                        name={
                          definition.name
                        }
                        yAxisId={
                          yAxisId
                        }
                        stroke={
                          definition.color
                        }
                        strokeWidth={
                          definition.strokeWidth
                        }
                        strokeDasharray={
                          definition.strokeDasharray
                        }
                        dot={
                          false
                        }
                        activeDot={{
                          r: 4,
                        }}
                        connectNulls={
                          definition.connectNulls
                        }
                        isAnimationActive
                        animationDuration={
                          600
                        }
                      />
                    );
                  },
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
              aria-label="Revenue series legend"
              style={{
                display:
                  'flex',
                alignItems:
                  'center',
                flexWrap:
                  'wrap',
                gap: 12,
                marginTop:
                  12,
                paddingTop:
                  12,
                borderTop:
                  `1px solid ${CSS.border}`,
              }}
            >
              {visibleSeries.map(
                (
                  definition,
                ) => (
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
                      fontSize:
                        11,
                      fontWeight:
                        650,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width:
                          10,
                        height:
                          3,
                        borderRadius:
                          999,
                        background:
                          definition.color,
                      }}
                    />

                    {
                      definition.name
                    }
                  </div>
                ),
              )}
            </div>
          ) : null}

          {/* Integrity / coverage note */}
          <div
            style={{
              marginTop:
                12,
              display:
                'grid',
              gap:
                6,
              color:
                CSS.textSecondary,
              fontSize:
                11,
              lineHeight:
                1.5,
            }}
          >
            {normalized.authoritative ? (
              <span>
                Reporting mode: backend-supplied revenue analytics.
              </span>
            ) : (
              <span>
                Reporting mode: presentation-derived analytics from the supplied dataset.
              </span>
            )}

            {totalRevenue > 0 ? (
              <span>
                Transaction + subscription revenue currently accounts for approximately{' '}
                {formatRevenueRate(
                  componentCoverage,
                  locale,
                )}{' '}
                of the displayed total; this is a presentation cross-check,
                not a revenue-recognition rule.
              </span>
            ) : null}

            <span>
              Revenue is displayed independently from member savings or
              contribution principal. Revenue recognition, fee assessment,
              journal posting and reconciliation remain authoritative backend
              responsibilities.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Public defaults / metadata
 * ========================================================================== */

export const REVENUE_CHART_DEFAULTS =
  Object.freeze({
    locale:
      DEFAULT_LOCALE,
    currency:
      DEFAULT_CURRENCY,
    height:
      DEFAULT_HEIGHT,
    maxPoints:
      DEFAULT_MAX_POINTS,
    series:
      DEFAULT_SERIES,
    primarySeriesKey:
      REVENUE_SERIES.TOTAL,
    showSummary:
      true,
    showSeriesControls:
      true,
    showLegend:
      true,
    showDataMode:
      true,
    showRevenueIntegrityNote:
      true,
  });

/**
 * Factory for programmatically creating a normalized TITech revenue series.
 *
 * @param {object} input
 * @param {number} index
 * @returns {object}
 */
export function createRevenueSeries(
  input = {},
  index = 0,
) {
  return normalizeRevenueSeries(
    input,
    index,
  );
}

/* ============================================================================
 * Public component
 * ========================================================================== */

export const RevenueChart =
  memo(
    RevenueChartComponent,
  );

RevenueChart.displayName =
  'RevenueChart';

export default RevenueChart;