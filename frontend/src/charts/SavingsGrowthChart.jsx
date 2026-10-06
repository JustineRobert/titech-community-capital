'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/SavingsGrowthChart.jsx
 *
 * Purpose:
 *   Enterprise-grade savings growth analytics for TITech dashboards,
 *   institution reporting, group reporting and executive operational views.
 *
 * Responsibilities:
 *   - Present savings portfolio growth over time.
 *   - Present contributions, withdrawals, interest and closing savings balance
 *     as distinct analytical measures.
 *   - Normalize common backend/API reporting envelopes and field aliases.
 *   - Safely handle numeric strings, Mongo Decimal128-like values and dates.
 *   - Support configurable currency and locale formatting.
 *   - Support interactive presentation-only series visibility.
 *   - Provide deterministic loading, error and empty states.
 *   - Provide responsive Recharts presentation.
 *   - Provide accessible labels and keyboard-operable controls.
 *
 * Savings / financial integrity:
 *   - This component is PRESENTATION-ONLY.
 *   - It MUST NOT create savings transactions, reverse transactions, mutate
 *     member balances, post ledger entries, trigger interest accrual or
 *     perform settlement/reconciliation.
 *   - Authoritative savings balances, double-entry journals, interest
 *     calculations, reversals, corrections, reconciliation and audit records
 *     remain backend/domain responsibilities.
 *   - Client-derived growth rates, contribution ratios and fallback totals are
 *     DISPLAY ANALYTICS only.
 *   - Contributions/savings principal MUST NOT be confused with TITech
 *     transaction revenue or commercial fees.
 *   - A displayed "balance" is only authoritative when supplied by the
 *     approved reporting/backend dataset.
 *
 * Supported analytical concepts:
 *   - totalSavings
 *   - closingBalance
 *   - openingBalance
 *   - contributions
 *   - deposits
 *   - withdrawals
 *   - interest
 *   - interestEarned
 *   - memberSavings
 *   - savingsCount
 *
 * Typical usage:
 *
 *   import SavingsGrowthChart from './charts/SavingsGrowthChart.jsx';
 *
 *   <SavingsGrowthChart
 *     data={savingsResponse}
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

export const SAVINGS_SERIES = Object.freeze({
  BALANCE: 'closingBalance',
  OPENING_BALANCE: 'openingBalance',
  TOTAL_SAVINGS: 'totalSavings',
  CONTRIBUTIONS: 'contributions',
  DEPOSITS: 'deposits',
  WITHDRAWALS: 'withdrawals',
  INTEREST: 'interest',
  INTEREST_EARNED: 'interestEarned',
  MEMBER_SAVINGS: 'memberSavings',
  SAVINGS_COUNT: 'savingsCount',
});

export const SAVINGS_SERIES_LABELS = Object.freeze({
  [SAVINGS_SERIES.BALANCE]: 'Closing Balance',
  [SAVINGS_SERIES.OPENING_BALANCE]: 'Opening Balance',
  [SAVINGS_SERIES.TOTAL_SAVINGS]: 'Total Savings',
  [SAVINGS_SERIES.CONTRIBUTIONS]: 'Contributions',
  [SAVINGS_SERIES.DEPOSITS]: 'Deposits',
  [SAVINGS_SERIES.WITHDRAWALS]: 'Withdrawals',
  [SAVINGS_SERIES.INTEREST]: 'Interest',
  [SAVINGS_SERIES.INTEREST_EARNED]: 'Interest Earned',
  [SAVINGS_SERIES.MEMBER_SAVINGS]: 'Member Savings',
  [SAVINGS_SERIES.SAVINGS_COUNT]: 'Savings Events',
});

export const SAVINGS_FORMATS = Object.freeze({
  CURRENCY: 'currency',
  NUMBER: 'number',
  PERCENT: 'percent',
});

export const DEFAULT_LOCALE = 'en-UG';
export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_HEIGHT = 390;
export const DEFAULT_MAX_POINTS = 48;

export const DEFAULT_SAVINGS_SERIES = Object.freeze([
  SAVINGS_SERIES.BALANCE,
  SAVINGS_SERIES.CONTRIBUTIONS,
  SAVINGS_SERIES.WITHDRAWALS,
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
  chart1:
    'var(--titech-chart-series-1)',
  chart2:
    'var(--titech-chart-series-2)',
  chart3:
    'var(--titech-chart-series-3)',
  chart4:
    'var(--titech-chart-series-4)',
  chart5:
    'var(--titech-chart-series-5)',
  chart6:
    'var(--titech-chart-series-6)',
  chart7:
    'var(--titech-chart-series-7)',
  chart8:
    'var(--titech-chart-series-8)',
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
 * Generic helpers
 * ========================================================================== */

/**
 * Safely unwrap common API envelopes.
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
export function unwrapSavingsPayload(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'data')
    && input.data !== null
    && input.data !== undefined
  ) {
    return input.data;
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'result')
    && input.result !== null
    && input.result !== undefined
  ) {
    return input.result;
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'payload')
    && input.payload !== null
    && input.payload !== undefined
  ) {
    return input.payload;
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'response')
    && input.response !== null
    && input.response !== undefined
  ) {
    return input.response;
  }

  return input;
}

/**
 * Normalize any unknown value into an array.
 *
 * @param {unknown} value
 * @returns {Array}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Get the first defined field from an alias set.
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
 * Parse numeric values for display.
 *
 * Supports:
 *   - number
 *   - numeric string
 *   - bigint
 *   - Decimal128-like objects
 *   - common JSON numeric wrappers
 *
 * This function is NOT the financial precision boundary.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseSavingsNumber(
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
      ?? value.balance
      ?? value.total;

    if (candidate !== undefined) {
      return parseSavingsNumber(
        candidate,
        fallback,
      );
    }

    if (typeof value.toString === 'function') {
      const stringified = value.toString();

      if (stringified !== '[object Object]') {
        return parseSavingsNumber(
          stringified,
          fallback,
        );
      }
    }
  }

  return fallback;
}

/**
 * Normalize an amount.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSavingsAmount(value) {
  return Math.max(
    0,
    parseSavingsNumber(value),
  );
}

/**
 * Normalize a count.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSavingsCount(value) {
  return Math.max(
    0,
    Math.round(
      parseSavingsNumber(value),
    ),
  );
}

/**
 * Calculate a presentation-only ratio.
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
 * Convert date-like input into timestamp.
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
 * Format period label.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatSavingsPeriod(
  value,
  locale = DEFAULT_LOCALE,
) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    const text = String(value ?? '').trim();

    return text || 'Current';
  }

  const key = `${locale}|savings-period`;

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
 * Format savings amount.
 *
 * @param {unknown} value
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
export function formatSavingsAmount(
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
    normalizeSavingsAmount(value),
  );
}

/**
 * Format count.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatSavingsCount(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|savings-count`;

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
    normalizeSavingsCount(value),
  );
}

/**
 * Format ratio / percentage.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatSavingsRate(
  value,
  locale = DEFAULT_LOCALE,
) {
  const key =
    `${locale}|savings-rate`;

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
    parseSavingsNumber(value);

  if (normalized > 1) {
    normalized /= 100;
  }

  return formatter.format(
    Math.max(0, normalized),
  );
}

/**
 * Create DOM-safe identifier.
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
 * Series aliases
 * ========================================================================== */

const SAVINGS_FIELD_ALIASES = Object.freeze({
  [SAVINGS_SERIES.BALANCE]: [
    'closingBalance',
    'balance',
    'endingBalance',
    'endingSavings',
    'totalSavings',
    'savingsBalance',
  ],

  [SAVINGS_SERIES.OPENING_BALANCE]: [
    'openingBalance',
    'openingSavings',
    'startBalance',
    'beginningBalance',
  ],

  [SAVINGS_SERIES.TOTAL_SAVINGS]: [
    'totalSavings',
    'savings',
    'savingsBalance',
    'portfolioSavings',
    'memberSavings',
  ],

  [SAVINGS_SERIES.CONTRIBUTIONS]: [
    'contributions',
    'contributionAmount',
    'totalContributions',
    'memberContributions',
    'savingsContributions',
  ],

  [SAVINGS_SERIES.DEPOSITS]: [
    'deposits',
    'depositAmount',
    'totalDeposits',
    'savingsDeposits',
  ],

  [SAVINGS_SERIES.WITHDRAWALS]: [
    'withdrawals',
    'withdrawalAmount',
    'totalWithdrawals',
    'savingsWithdrawals',
  ],

  [SAVINGS_SERIES.INTEREST]: [
    'interest',
    'interestAmount',
    'interestEarned',
    'accruedInterest',
    'savingsInterest',
  ],

  [SAVINGS_SERIES.INTEREST_EARNED]: [
    'interestEarned',
    'interest',
    'interestAmount',
    'accruedInterest',
  ],

  [SAVINGS_SERIES.MEMBER_SAVINGS]: [
    'memberSavings',
    'memberSavingsAmount',
    'totalMemberSavings',
  ],

  [SAVINGS_SERIES.SAVINGS_COUNT]: [
    'savingsCount',
    'transactionCount',
    'contributionCount',
    'depositCount',
    'eventCount',
    'count',
  ],
});

/* ============================================================================
 * Series helpers
 * ========================================================================== */

/**
 * Return human-readable series label.
 *
 * @param {string} dataKey
 * @returns {string}
 */
export function getSavingsSeriesLabel(
  dataKey,
) {
  return (
    SAVINGS_SERIES_LABELS[dataKey]
    ?? String(dataKey || 'Savings')
  );
}

/**
 * Normalize one savings series definition.
 *
 * @param {unknown} input
 * @param {number} index
 * @returns {object}
 */
export function normalizeSavingsSeries(
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
      source.type ?? 'line',
    ).toLowerCase();

  const type =
    requestedType === 'area'
    || requestedType === 'bar'
      ? requestedType
      : 'line';

  const requestedFormat =
    String(
      source.format ?? 'currency',
    ).toLowerCase();

  const format =
    Object.values(
      SAVINGS_FORMATS,
    ).includes(
      requestedFormat,
    )
      ? requestedFormat
      : SAVINGS_FORMATS.CURRENCY;

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
        `savings-series-${index + 1}`,
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
        getSavingsSeriesLabel(
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
      || DEFAULT_SERIES_COLORS[
        index
        % DEFAULT_SERIES_COLORS.length
      ],

    visible:
      source.visible !== false,

    strokeWidth:
      Number.isFinite(
        Number(source.strokeWidth),
      )
        ? Number(source.strokeWidth)
        : type === 'area'
          ? 2.5
          : 2,

    fillOpacity:
      Number.isFinite(
        Number(source.fillOpacity),
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

/* ============================================================================
 * Row normalization
 * ========================================================================== */

/**
 * Normalize one reporting row.
 *
 * @param {unknown} input
 * @param {number} index
 * @param {string} locale
 * @returns {object}
 */
function normalizeSavingsRow(
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
        `savings-period-${index + 1}`,
      ),
    ),

    __period: rawPeriod,

    __label:
      formatSavingsPeriod(
        rawPeriod,
        locale,
      ),
  };

  for (
    const [
      dataKey,
      aliases,
    ] of Object.entries(
      SAVINGS_FIELD_ALIASES,
    )
  ) {
    row[dataKey] =
      parseSavingsNumber(
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
 * Infer numeric series if the caller did not provide explicit definitions.
 *
 * @param {Array} rows
 * @returns {Array}
 */
function inferSavingsSeries(
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

  const numericKeys =
    Object.keys(first)
      .filter(
        (key) =>
          !excluded.has(key)
          && Number.isFinite(
            parseSavingsNumber(
              first[key],
              NaN,
            ),
          ),
      )
      .slice(0, 8);

  return numericKeys.map(
    (
      dataKey,
      index,
    ) =>
      normalizeSavingsSeries(
        {
          dataKey,
          name:
            getSavingsSeriesLabel(
              dataKey,
            ),
          type:
            index === 0
              ? 'area'
              : 'line',
          format:
            dataKey ===
            SAVINGS_SERIES.SAVINGS_COUNT
              ? SAVINGS_FORMATS.NUMBER
              : SAVINGS_FORMATS.CURRENCY,
        },
        index,
      ),
  );
}

/* ============================================================================
 * Member / transaction fallback aggregation
 * ========================================================================== */

/**
 * Aggregate raw savings records when a reporting time series is unavailable.
 *
 * This fallback is strictly presentation analytics. It does not attempt to
 * rebuild or replace the authoritative savings ledger.
 *
 * @param {Array} records
 * @param {string} locale
 * @returns {Array}
 */
function aggregateSavingsRecords(
  records,
  locale,
) {
  const normalized =
    asArray(records)
      .map(
        (record, index) => {
          const source =
            record
            && typeof record === 'object'
              ? record
              : {};

          const timestamp =
            toTimestamp(
              firstDefined(
                source,
                [
                  'createdAt',
                  'transactionDate',
                  'date',
                  'period',
                  'timestamp',
                ],
                null,
              ),
            );

          const contributions =
            normalizeSavingsAmount(
              firstDefined(
                source,
                [
                  'contributions',
                  'contributionAmount',
                  'deposit',
                  'depositAmount',
                  'amount',
                ],
                0,
              ),
            );

          const withdrawals =
            normalizeSavingsAmount(
              firstDefined(
                source,
                [
                  'withdrawals',
                  'withdrawalAmount',
                  'withdrawal',
                  'withdrawAmount',
                ],
                0,
              ),
            );

          const interest =
            normalizeSavingsAmount(
              firstDefined(
                source,
                [
                  'interest',
                  'interestAmount',
                  'interestEarned',
                ],
                0,
              ),
            );

          return {
            id:
              String(
                firstDefined(
                  source,
                  [
                    'id',
                    '_id',
                    'transactionId',
                    'reference',
                  ],
                  `record-${index + 1}`,
                ),
              ),

            timestamp,

            contributions,
            withdrawals,
            interest,
          };
        },
      )
      .filter(
        (item) =>
          item.timestamp !== null,
      );

  if (!normalized.length) {
    return [];
  }

  const buckets = new Map();

  for (const record of normalized) {
    const date =
      new Date(record.timestamp);

    const year =
      date.getUTCFullYear();

    const month =
      String(
        date.getUTCMonth() + 1,
      ).padStart(2, '0');

    const key =
      `${year}-${month}`;

    if (!buckets.has(key)) {
      buckets.set(
        key,
        {
          id: key,
          period:
            date.toISOString(),
          label:
            formatSavingsPeriod(
              date,
              locale,
            ),
          openingBalance: 0,
          closingBalance: 0,
          totalSavings: 0,
          contributions: 0,
          deposits: 0,
          withdrawals: 0,
          interest: 0,
          interestEarned: 0,
          memberSavings: 0,
          savingsCount: 0,
        },
      );
    }

    const bucket =
      buckets.get(key);

    bucket.contributions +=
      record.contributions;

    bucket.deposits +=
      record.contributions;

    bucket.withdrawals +=
      record.withdrawals;

    bucket.interest +=
      record.interest;

    bucket.interestEarned +=
      record.interest;

    bucket.savingsCount += 1;
  }

  /*
   * Because raw transaction records do not necessarily encode the authoritative
   * opening/closing balance, this fallback exposes cumulative net activity as
   * a presentation proxy. It is explicitly non-authoritative.
   */
  let cumulative =
    0;

  return [...buckets.values()]
    .sort(
      (left, right) =>
        (toTimestamp(left.period) ?? 0)
        - (toTimestamp(right.period) ?? 0),
    )
    .map(
      (row) => {
        row.openingBalance =
          cumulative;

        cumulative =
          Math.max(
            0,
            cumulative
              + row.contributions
              - row.withdrawals
              + row.interest,
          );

        row.closingBalance =
          cumulative;

        row.totalSavings =
          cumulative;

        row.memberSavings =
          cumulative;

        return row;
      },
    );
}

/* ============================================================================
 * Complete data normalization
 * ========================================================================== */

/**
 * Normalize savings reporting input.
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   rows: Array,
 *   series: Array,
 *   summary: object,
 *   hasData: boolean,
 *   authoritative: boolean,
 *   derived: boolean
 * }}
 */
export function normalizeSavingsGrowthData(
  input,
  {
    locale = DEFAULT_LOCALE,
    series = [],
  } = {},
) {
  const payload =
    unwrapSavingsPayload(
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
      derived: false,
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
            'snapshots',
            'rows',
            'records',
            'items',
            'data',
          ],
          [],
        );

  let rows =
    asArray(rawRows).map(
      (item, index) =>
        normalizeSavingsRow(
          item,
          index,
          locale,
        ),
    );

  const rawRecords =
    !Array.isArray(payload)
      ? firstDefined(
          source,
          [
            'transactions',
            'savingsTransactions',
            'memberSavings',
            'records',
            'items',
          ],
          [],
        )
      : [];

  let derived = false;

  /*
   * Only use record aggregation when there is no explicit time series.
   */
  if (
    rows.length === 0
    && asArray(rawRecords).length > 0
  ) {
    rows =
      aggregateSavingsRecords(
        rawRecords,
        locale,
      );

    derived = true;
  }

  const normalizedSeries =
    asArray(series)
      .map(
        normalizeSavingsSeries,
      )
      .filter(
        (definition) =>
          definition.dataKey,
      );

  const effectiveSeries =
    normalizedSeries.length > 0
      ? normalizedSeries
      : inferSavingsSeries(
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

  const previous =
    rows.length > 1
      ? rows[rows.length - 2]
      : null;

  const totalSavings =
    normalizeSavingsAmount(
      firstDefined(
        summarySource,
        SAVINGS_FIELD_ALIASES[
          SAVINGS_SERIES.BALANCE
        ],
        latest?.[
          SAVINGS_SERIES.BALANCE
        ] ?? 0,
      ),
    );

  const contributions =
    normalizeSavingsAmount(
      firstDefined(
        summarySource,
        SAVINGS_FIELD_ALIASES[
          SAVINGS_SERIES.CONTRIBUTIONS
        ],
        latest?.[
          SAVINGS_SERIES.CONTRIBUTIONS
        ] ?? 0,
      ),
    );

  const withdrawals =
    normalizeSavingsAmount(
      firstDefined(
        summarySource,
        SAVINGS_FIELD_ALIASES[
          SAVINGS_SERIES.WITHDRAWALS
        ],
        latest?.[
          SAVINGS_SERIES.WITHDRAWALS
        ] ?? 0,
      ),
    );

  const interest =
    normalizeSavingsAmount(
      firstDefined(
        summarySource,
        SAVINGS_FIELD_ALIASES[
          SAVINGS_SERIES.INTEREST
        ],
        latest?.[
          SAVINGS_SERIES.INTEREST
        ] ?? 0,
      ),
    );

  const memberCount =
    normalizeSavingsCount(
      firstDefined(
        summarySource,
        [
          'memberCount',
          'members',
          'totalMembers',
        ],
        0,
      ),
    );

  const savingsCount =
    normalizeSavingsCount(
      firstDefined(
        summarySource,
        SAVINGS_FIELD_ALIASES[
          SAVINGS_SERIES.SAVINGS_COUNT
        ],
        latest?.[
          SAVINGS_SERIES.SAVINGS_COUNT
        ] ?? 0,
      ),
    );

  const growthAmount =
    totalSavings
    - normalizeSavingsAmount(
        previous?.[
          SAVINGS_SERIES.BALANCE
        ],
      );

  const suppliedGrowthRate =
    firstDefined(
      summarySource,
      [
        'growthRate',
        'savingsGrowthRate',
        'periodGrowthRate',
      ],
      undefined,
    );

  const growthRate =
    suppliedGrowthRate !==
      undefined
      ? parseSavingsNumber(
          suppliedGrowthRate,
        ) > 1
        ? parseSavingsNumber(
            suppliedGrowthRate,
          ) / 100
        : parseSavingsNumber(
            suppliedGrowthRate,
          )
      : safeRatio(
          growthAmount,
          previous?.[
            SAVINGS_SERIES.BALANCE
          ] ?? 0,
        );

  const withdrawalRate =
    safeRatio(
      withdrawals,
      contributions,
    );

  return {
    rows,
    series:
      effectiveSeries,

    summary: {
      totalSavings,
      closingBalance:
        totalSavings,

      openingBalance:
        normalizeSavingsAmount(
          firstDefined(
            summarySource,
            SAVINGS_FIELD_ALIASES[
              SAVINGS_SERIES.OPENING_BALANCE
            ],
            rows[0]?.[
              SAVINGS_SERIES.OPENING_BALANCE
            ] ?? 0,
          ),
        ),

      contributions,
      withdrawals,
      interest,

      memberCount,
      savingsCount,

      growthAmount,
      growthRate,
      withdrawalRate,
    },

    hasData:
      rows.length > 0
      && effectiveSeries.length > 0,

    authoritative:
      Boolean(
        !derived
        && (
          source.summary
          || source.metrics
          || source.trend
          || source.timeSeries
          || source.seriesData
          || source.historical
          || source.snapshots
        ),
      ),

    derived,
  };
}

/* ============================================================================
 * Summary helper
 * ========================================================================== */

/**
 * Calculate a presentation-only series change.
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
  const values =
    rows
      .map(
        (row) =>
          parseSavingsNumber(
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

  const first =
    values[0];

  const latest =
    values[
      values.length - 1
    ];

  const delta =
    latest - first;

  return {
    first,
    latest,
    delta,
    rate:
      safeRatio(
        delta,
        Math.abs(first),
      ),
  };
}

/**
 * Summary metric card.
 */
function SavingsMetricCard({
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
        borderRadius:
          11,
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

/**
 * TITech savings chart tooltip.
 */
export function SavingsGrowthTooltip({
  active,
  payload,
  label,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
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
        minWidth:
          240,
        maxWidth:
          380,
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
                definitionMap.get(
                  entry.dataKey,
                );

              const format =
                definition?.format
                ?? SAVINGS_FORMATS.CURRENCY;

              const valueCurrency =
                definition?.currency
                || currency;

              let displayValue;

              if (
                format ===
                SAVINGS_FORMATS.NUMBER
              ) {
                displayValue =
                  formatSavingsCount(
                    entry.value,
                    locale,
                  );
              } else if (
                format ===
                SAVINGS_FORMATS.PERCENT
              ) {
                displayValue =
                  formatSavingsRate(
                    entry.value,
                    locale,
                  );
              } else {
                displayValue =
                  formatSavingsAmount(
                    entry.value,
                    valueCurrency,
                    locale,
                  );
              }

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
                        ?? getSavingsSeriesLabel(
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
                      fontSize:
                        12,
                    }}
                  >
                    {displayValue}
                  </strong>
                </div>
              );
            },
          )}
      </div>

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
        Savings figures are presented from the reporting dataset; authoritative
        balances and ledger state remain server-side.
      </div>
    </div>
  );
}

/* ============================================================================
 * State panels
 * ========================================================================== */

function SavingsStatePanel({
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
              '31%',
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
            Unable to load savings analytics
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
              || 'The savings reporting dataset could not be displayed.'}
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
          No savings growth data
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
            || 'Savings analytics will appear when the reporting data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Series control
 * ========================================================================== */

function SavingsSeriesButton({
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

function SavingsGrowthChartComponent({
  data = null,

  title =
    'Savings Growth',
  description =
    'Savings balance, contributions, withdrawals and interest performance over time.',

  series =
    DEFAULT_SAVINGS_SERIES,

  currency =
    DEFAULT_CURRENCY,
  locale =
    DEFAULT_LOCALE,

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
  showDataMode =
    true,
  showIntegrityNote =
    true,

  className =
    '',
  style =
    {},
  ariaLabel =
    null,

  emptyMessage =
    'No savings reporting data is available for the selected scope and period.',

  xAxisTickFormatter =
    null,

  /**
   * Optional presentation-only formatter.
   *
   * Signature:
   *   ({ value, series, locale, currency }) => string
   */
  valueFormatter =
    null,

  primarySeriesKey =
    SAVINGS_SERIES.BALANCE,
}) {
  const chartId =
    useId();

  const normalized =
    useMemo(
      () =>
        normalizeSavingsGrowthData(
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
          maxPoints ===
            null
          || maxPoints ===
            undefined
          || Number(maxPoints) <=
            0
          || source.length <=
            Number(maxPoints)
        ) {
          return source;
        }

        return source.slice(
          -Math.floor(
            Number(maxPoints),
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
                  parseSavingsNumber(
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

  const totalSavings =
    normalized.summary
      .totalSavings;

  const contributions =
    normalized.summary
      .contributions;

  const withdrawals =
    normalized.summary
      .withdrawals;

  const interest =
    normalized.summary
      .interest;

  const memberCount =
    normalized.summary
      .memberCount;

  const savingsCount =
    normalized.summary
      .savingsCount;

  const withdrawalRate =
    normalized.summary
      .withdrawalRate;

  const hasData =
    normalized.hasData
    && rows.length > 0
    && visibleSeries.length > 0;

  const headingId =
    `savings-heading-${safeDomId(
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

  const formatValue =
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
        SAVINGS_FORMATS.NUMBER
      ) {
        return formatSavingsCount(
          value,
          locale,
        );
      }

      if (
        definition.format ===
        SAVINGS_FORMATS.PERCENT
      ) {
        return formatSavingsRate(
          value,
          locale,
        );
      }

      return formatSavingsAmount(
        value,
        definition.currency
          || currency,
        locale,
      );
    };

  const isDecrease =
    primaryChange.delta < 0;

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
                  880,
                color:
                  CSS.textSecondary,
                fontSize:
                  11,
                lineHeight:
                  1.5,
              }}
            >
              Savings analytics are reporting views. Contributions,
              withdrawals, interest, balances and ledger state remain
              authoritative in TITech backend services.
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
            aria-label="Savings series visibility"
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
                740,
            }}
          >
            {availableSeries.map(
              (
                definition,
              ) => (
                <SavingsSeriesButton
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
      && hasData ? (
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
          <SavingsMetricCard
            label="Savings Balance"
            value={formatSavingsAmount(
              totalSavings,
              currency,
              locale,
            )}
            helper="Latest supplied savings balance"
            tone="info"
          />

          <SavingsMetricCard
            label="Contributions"
            value={formatSavingsAmount(
              contributions,
              currency,
              locale,
            )}
            helper="Latest reported contribution activity"
            tone="success"
          />

          <SavingsMetricCard
            label="Withdrawals"
            value={formatSavingsAmount(
              withdrawals,
              currency,
              locale,
            )}
            helper="Latest reported withdrawal activity"
            tone={
              withdrawals >
              0
                ? 'warning'
                : 'neutral'
            }
          />

          <SavingsMetricCard
            label="Interest"
            value={formatSavingsAmount(
              interest,
              currency,
              locale,
            )}
            helper="Supplied savings interest metric"
            tone="success"
          />

          <SavingsMetricCard
            label="Withdrawal / Contribution"
            value={formatSavingsRate(
              withdrawalRate,
              locale,
            )}
            helper="Presentation ratio only"
            tone={
              withdrawalRate >
              1
                ? 'danger'
                : 'warning'
            }
          />

          <SavingsMetricCard
            label="Members"
            value={formatSavingsCount(
              memberCount,
              locale,
            )}
            helper="Supplied member coverage"
            tone="neutral"
          />

          <SavingsMetricCard
            label="Savings Events"
            value={formatSavingsCount(
              savingsCount,
              locale,
            )}
            helper="Supplied reporting event count"
            tone="neutral"
          />

          {primaryDefinition ? (
            <SavingsMetricCard
              label="Primary Trend"
              value={formatValue(
                primaryChange.latest,
                primaryDefinition,
              )}
              helper={`${primaryDefinition.name} latest reporting point`}
              tone={
                isDecrease
                  ? 'warning'
                  : 'success'
              }
            />
          ) : null}
        </div>
      ) : null}

      {/* State handling */}
      {loading ? (
        <SavingsStatePanel
          type="loading"
        />
      ) : error ? (
        <SavingsStatePanel
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
        <SavingsStatePanel
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
          {/* Main chart */}
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
                280,
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
                    22,
                  left:
                    8,
                  bottom:
                    8,
                }}
              >
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
                              definition.fillOpacity *
                                1.5,
                            )}
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
                    100
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
                      return formatSavingsAmount(
                        value,
                        currency,
                        locale,
                      );
                    }

                    return formatValue(
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
                        return formatSavingsCount(
                          value,
                          locale,
                        );
                      }

                      return formatValue(
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
                    <SavingsGrowthTooltip
                      currency={
                        currency
                      }
                      locale={
                        locale
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
                          fillOpacity={
                            1
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

                    if (
                      definition.type ===
                      'bar'
                    ) {
                      return (
                        <Bar
                          key={
                            `${definition.dataKey}-bar`
                          }
                          dataKey={
                            definition.dataKey
                          }
                          name={
                            definition.name
                          }
                          yAxisId={
                            yAxisId
                          }
                          fill={
                            definition.color
                          }
                          fillOpacity={
                            definition.fillOpacity
                            + 0.18 >
                            1
                              ? 1
                              : definition.fillOpacity
                                + 0.18
                          }
                          stroke={
                            definition.color
                          }
                          strokeWidth={
                            1
                          }
                          radius={[
                            4,
                            4,
                            0,
                            0,
                          ]}
                          barSize={
                            22
                          }
                          stackId={
                            definition.stackId
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
              aria-label="Savings chart legend"
              style={{
                display:
                  'flex',
                alignItems:
                  'center',
                flexWrap:
                  'wrap',
                gap:
                  12,
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
                      gap:
                        7,
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

          {/* Integrity / source note */}
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
            {showDataMode ? (
              <span>
                Reporting mode:{' '}
                {normalized.authoritative
                  ? 'backend-supplied analytics'
                  : normalized.derived
                    ? 'presentation-derived fallback'
                    : 'available dataset'}
                .
              </span>
            ) : null}

            <span>
              Displayed savings balance is not recalculated from frontend
              activity when an authoritative balance is supplied.
            </span>

            <span>
              Contributions, withdrawals and interest are presented as separate
              reporting measures and must not be interpreted as changes to
              TITech ledger state from the browser.
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

export const SAVINGS_GROWTH_DEFAULTS =
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
      DEFAULT_SAVINGS_SERIES,
    primarySeriesKey:
      SAVINGS_SERIES.BALANCE,
    showSummary:
      true,
    showSeriesControls:
      true,
    showLegend:
      true,
    showDataMode:
      true,
    showIntegrityNote:
      true,
  });

/**
 * Factory for normalized savings-series definitions.
 *
 * @param {object} input
 * @param {number} index
 * @returns {object}
 */
export function createSavingsSeries(
  input = {},
  index = 0,
) {
  return normalizeSavingsSeries(
    input,
    index,
  );
}

/* ============================================================================
 * Public component
 * ========================================================================== */

export const SavingsGrowthChart =
  memo(
    SavingsGrowthChartComponent,
  );

SavingsGrowthChart.displayName =
  'SavingsGrowthChart';

export default SavingsGrowthChart;