'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/PortfolioAtRiskChart.jsx
 *
 * Purpose:
 *   Enterprise-grade Portfolio at Risk (PAR) analytics for TITech.
 *
 * Responsibilities:
 *   - Present portfolio-at-risk amounts and rates by delinquency threshold.
 *   - Support common PAR buckets such as PAR 1, PAR 30, PAR 60 and PAR 90.
 *   - Support authoritative backend summary/trend payloads.
 *   - Safely normalize common API envelopes and field aliases.
 *   - Support Decimal128-like / numeric-string values for presentation.
 *   - Provide a controlled DPD threshold view.
 *   - Provide accessible loading, empty and error states.
 *   - Provide responsive Recharts visualization.
 *   - Provide presentation-only summary calculations when the backend payload
 *     does not already contain the required summary.
 *
 * Credit / financial integrity:
 *   - This component is PRESENTATION-ONLY.
 *   - It does not classify a loan as delinquent, defaulted, fraudulent or
 *     impaired.
 *   - It does not determine provisioning, write-off, restructuring,
 *     collections treatment or credit eligibility.
 *   - It does not mutate loans, repayments, balances, ledgers, settlements,
 *     reconciliations or audit records.
 *   - Backend/domain services remain authoritative for DPD, outstanding
 *     principal, loan state, provisioning and accounting.
 *   - A client-derived ratio is a DISPLAY ANALYTIC, not an accounting record.
 *   - If authoritative PAR amounts/rates are supplied by the backend, they
 *     are preferred over client-derived fallback calculations.
 *
 * PAR semantics:
 *   PAR threshold typically means exposure associated with loans that have
 *   reached or exceeded a supplied days-past-due (DPD) threshold.
 *
 *   Example:
 *     PAR 30 = outstanding exposure associated with loans where DPD >= 30.
 *
 *   The exact regulatory/accounting definition used by a deployment belongs
 *   to the institution's approved credit/reporting policy and backend
 *   implementation. This chart intentionally does not impose such policy.
 *
 * Typical usage:
 *
 *   import PortfolioAtRiskChart from './charts/PortfolioAtRiskChart.jsx';
 *
 *   <PortfolioAtRiskChart
 *     data={portfolioAtRiskResponse}
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

export const PAR_THRESHOLDS = Object.freeze([
  1,
  30,
  60,
  90,
]);

export const PAR_FORMATS = Object.freeze({
  AMOUNT: 'amount',
  RATE: 'rate',
  BOTH: 'both',
});

export const DEFAULT_LOCALE = 'en-UG';
export const DEFAULT_CURRENCY = 'UGX';
export const DEFAULT_HEIGHT = 390;

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
});

const PAR_COLORS = Object.freeze({
  1: CSS.chart1,
  30: CSS.chart2,
  60: CSS.chart3,
  90: CSS.chart4,
});

/* ============================================================================
 * Formatter caches
 * ========================================================================== */

const NUMBER_FORMATTER_CACHE = new Map();
const DATE_FORMATTER_CACHE = new Map();

/* ============================================================================
 * Primitive helpers
 * ========================================================================== */

/**
 * Parse numeric values, including common Mongo/Decimal-like representations.
 *
 * This is intentionally a PRESENTATION parser.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parsePortfolioAtRiskNumber(
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
      .replace(/%$/, '')
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
      ?? value.rate;

    if (
      candidate !== undefined
    ) {
      return parsePortfolioAtRiskNumber(
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
        return parsePortfolioAtRiskNumber(
          stringified,
          fallback,
        );
      }
    }
  }

  return fallback;
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
  if (
    !source
    || typeof source !== 'object'
  ) {
    return fallback;
  }

  for (
    const alias of aliases
  ) {
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
 * Safely unwrap common API envelopes.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function unwrapPortfolioAtRiskPayload(
  input,
) {
  if (
    !input
    || typeof input !== 'object'
  ) {
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
 * Normalize array.
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
 * Clamp an amount to a non-negative display amount.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeAmount(value) {
  return Math.max(
    0,
    parsePortfolioAtRiskNumber(value),
  );
}

/**
 * Normalize ratio values.
 *
 * Accepted display inputs:
 *   0.15 => 15%
 *   15   => 15%
 *
 * @param {unknown} value
 * @returns {number}
 */
export function normalizePortfolioAtRiskRate(
  value,
) {
  const numeric =
    parsePortfolioAtRiskNumber(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  /*
   * Most APIs represent rates as 0..1, while some reporting endpoints expose
   * percentages as 0..100. Values above 1 are therefore interpreted as
   * percentage points and normalized for Intl percent formatting.
   */
  return numeric > 1
    ? numeric / 100
    : Math.max(0, numeric);
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
 * Normalize a DPD threshold.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeParThreshold(
  value,
  fallback = 30,
) {
  const parsed = Math.round(
    parsePortfolioAtRiskNumber(
      value,
      fallback,
    ),
  );

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(
    0,
    parsed,
  );
}

/**
 * Create DOM-safe ID.
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
 * Intl formatting
 * ========================================================================== */

/**
 * Cached currency formatter.
 *
 * @param {string} locale
 * @param {string} currency
 * @returns {Intl.NumberFormat}
 */
function getCurrencyFormatter(
  locale,
  currency,
) {
  const key =
    `${locale}|currency|${currency}`;

  const cached =
    NUMBER_FORMATTER_CACHE.get(key);

  if (cached) {
    return cached;
  }

  const formatter =
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

  return formatter;
}

/**
 * Cached number formatter.
 *
 * @param {string} locale
 * @returns {Intl.NumberFormat}
 */
function getNumberFormatter(
  locale,
) {
  const key =
    `${locale}|number`;

  const cached =
    NUMBER_FORMATTER_CACHE.get(key);

  if (cached) {
    return cached;
  }

  const formatter =
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

  return formatter;
}

/**
 * Cached percentage formatter.
 *
 * @param {string} locale
 * @returns {Intl.NumberFormat}
 */
function getPercentFormatter(
  locale,
) {
  const key =
    `${locale}|percent`;

  const cached =
    NUMBER_FORMATTER_CACHE.get(key);

  if (cached) {
    return cached;
  }

  const formatter =
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

  return formatter;
}

/**
 * Format amount.
 *
 * @param {unknown} value
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
export function formatPortfolioAtRiskAmount(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  return getCurrencyFormatter(
    locale,
    currency,
  ).format(
    normalizeAmount(value),
  );
}

/**
 * Format count.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatPortfolioAtRiskCount(
  value,
  locale = DEFAULT_LOCALE,
) {
  return getNumberFormatter(
    locale,
  ).format(
    Math.max(
      0,
      parsePortfolioAtRiskNumber(
        value,
      ),
    ),
  );
}

/**
 * Format percentage ratio.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatPortfolioAtRiskRate(
  value,
  locale = DEFAULT_LOCALE,
) {
  return getPercentFormatter(
    locale,
  ).format(
    normalizePortfolioAtRiskRate(
      value,
    ),
  );
}

/**
 * Format a date-like value.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
function formatPeriod(
  value,
  locale,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return 'Current';
  }

  const timestamp =
    toTimestamp(value);

  if (timestamp === null) {
    return String(value);
  }

  const key =
    `${locale}|month-year`;

  let formatter =
    DATE_FORMATTER_CACHE.get(key);

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
 * Convert date-like input.
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

  if (
    value instanceof Date
  ) {
    const timestamp =
      value.getTime();

    return Number.isFinite(
      timestamp,
    )
      ? timestamp
      : null;
  }

  if (
    typeof value === 'number'
    || typeof value === 'bigint'
  ) {
    const numeric =
      Number(value);

    if (
      !Number.isFinite(
        numeric,
      )
    ) {
      return null;
    }

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const text =
    String(value).trim();

  if (
    /^\d{10,13}$/.test(
      text,
    )
  ) {
    const numeric =
      Number(text);

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const parsed =
    Date.parse(text);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

/* ============================================================================
 * PAR label helpers
 * ========================================================================== */

/**
 * Return a standard PAR label.
 *
 * @param {number} threshold
 * @returns {string}
 */
export function getParLabel(
  threshold,
) {
  return `PAR ${normalizeParThreshold(
    threshold,
  )}`;
}

/**
 * Return a color token for a threshold.
 *
 * @param {number} threshold
 * @returns {string}
 */
function getParColor(
  threshold,
) {
  const normalized =
    normalizeParThreshold(
      threshold,
    );

  if (
    PAR_COLORS[normalized]
  ) {
    return PAR_COLORS[
      normalized
    ];
  }

  if (
    normalized >= 90
  ) {
    return CSS.danger;
  }

  if (
    normalized >= 60
  ) {
    return CSS.warning;
  }

  if (
    normalized >= 30
  ) {
    return CSS.chart3;
  }

  return CSS.primary;
}

/* ============================================================================
 * PAR row normalization
 * ========================================================================== */

/**
 * Find amount field aliases for one threshold.
 *
 * @param {object} source
 * @param {number} threshold
 * @returns {unknown}
 */
function getThresholdAmount(
  source,
  threshold,
) {
  const t =
    normalizeParThreshold(
      threshold,
    );

  return firstDefined(
    source,
    [
      `par${t}Amount`,
      `par${t}Principal`,
      `par${t}Outstanding`,
      `par_${t}_amount`,
      `par_${t}_principal`,
      `par_${t}_outstanding`,
      `par${t}`,
      `amount`,
      'atRiskAmount',
      'atRiskPrincipal',
      'outstandingAmount',
      'outstandingPrincipal',
    ],
    0,
  );
}

/**
 * Find rate field aliases for one threshold.
 *
 * @param {object} source
 * @param {number} threshold
 * @returns {unknown}
 */
function getThresholdRate(
  source,
  threshold,
) {
  const t =
    normalizeParThreshold(
      threshold,
    );

  return firstDefined(
    source,
    [
      `par${t}Rate`,
      `par${t}Ratio`,
      `par${t}Percentage`,
      `par_${t}_rate`,
      `par_${t}_ratio`,
      `par_${t}_percentage`,
      'parRate',
      'rate',
      'riskRate',
    ],
    undefined,
  );
}

/**
 * Find count aliases for one threshold.
 *
 * @param {object} source,
  * @param {number} threshold
 * @returns {unknown}
 */
function getThresholdCount(
  source,
  threshold,
) {
  const t =
    normalizeParThreshold(
      threshold,
    );

  return firstDefined(
    source,
    [
      `par${t}LoanCount`,
      `par${t}Loans`,
      `par${t}Count`,
      `par_${t}_loan_count`,
      `par_${t}_loans`,
      'loanCount',
      'loans',
      'count',
    ],
    0,
  );
}

/**
 * Normalize one PAR bucket row.
 *
 * @param {unknown} item
 * @param {number} threshold
 * @param {number} index
 * @param {number} totalOutstanding
 * @returns {object}
 */
function normalizeParRow(
  item,
  threshold,
  index,
  totalOutstanding,
) {
  const source =
    item
    && typeof item === 'object'
      ? item
      : {};

  const normalizedThreshold =
    normalizeParThreshold(
      firstDefined(
        source,
        [
          'threshold',
          'dpd',
          'daysPastDue',
          'days',
          'bucket',
          'par',
        ],
        threshold,
      ),
      threshold,
    );

  const amount =
    normalizeAmount(
      getThresholdAmount(
        source,
        normalizedThreshold,
      ),
    );

  const suppliedRate =
    getThresholdRate(
      source,
      normalizedThreshold,
    );

  const rate =
    suppliedRate !== undefined
      ? normalizePortfolioAtRiskRate(
          suppliedRate,
        )
      : safeRatio(
          amount,
          totalOutstanding,
        );

  return {
    id:
      String(
        firstDefined(
          source,
          [
            'id',
            '_id',
            'key',
          ],
          `par-${normalizedThreshold}-${index + 1}`,
        ),
      ),

    threshold:
      normalizedThreshold,

    label:
      getParLabel(
        normalizedThreshold,
      ),

    amount,

    rate,

    loanCount:
      Math.max(
        0,
        parsePortfolioAtRiskNumber(
          getThresholdCount(
            source,
            normalizedThreshold,
          ),
        ),
      ),

    color:
      getParColor(
        normalizedThreshold,
      ),

    raw: source,
  };
}

/* ============================================================================
 * Raw loan fallback aggregation
 * ========================================================================== */

/**
 * Aggregate loan records by PAR threshold.
 *
 * This fallback is only used when the API does not provide explicit PAR
 * analytics and when loan records expose enough DPD/outstanding information
 * to calculate a PRESENTATION-ONLY view.
 *
 * @param {Array} loans
 * @param {number[]} thresholds
 * @returns {{ rows: Array, totalOutstanding: number }}
 */
function aggregateLoansToPar(
  loans,
  thresholds,
) {
  const normalizedLoans =
    asArray(loans).map(
      (loan) => {
        const source =
          loan
          && typeof loan === 'object'
            ? loan
            : {};

        return {
          dpd:
            Math.max(
              0,
              Math.round(
                parsePortfolioAtRiskNumber(
                  firstDefined(
                    source,
                    [
                      'daysPastDue',
                      'dpd',
                      'daysOverdue',
                      'overdueDays',
                      'pastDueDays',
                    ],
                    0,
                  ),
                ),
              ),
            ),

          outstanding:
            normalizeAmount(
              firstDefined(
                source,
                [
                  'outstandingPrincipal',
                  'outstandingAmount',
                  'remainingPrincipal',
                  'balance',
                  'principalOutstanding',
                ],
                0,
              ),
            ),

          id:
            firstDefined(
              source,
              [
                'id',
                '_id',
                'loanId',
              ],
              null,
            ),
        };
      },
    );

  const totalOutstanding =
    normalizedLoans.reduce(
      (sum, loan) =>
        sum + loan.outstanding,
      0,
    );

  const rows =
    thresholds.map(
      (threshold, index) => {
        const normalizedThreshold =
          normalizeParThreshold(
            threshold,
          );

        const atRiskLoans =
          normalizedLoans.filter(
            (loan) =>
              loan.dpd
              >= normalizedThreshold,
          );

        const amount =
          atRiskLoans.reduce(
            (sum, loan) =>
              sum + loan.outstanding,
            0,
          );

        return {
          id:
            `par-${normalizedThreshold}-${index + 1}`,

          threshold:
            normalizedThreshold,

          label:
            getParLabel(
              normalizedThreshold,
            ),

          amount,

          rate:
            safeRatio(
              amount,
              totalOutstanding,
            ),

          loanCount:
            atRiskLoans.length,

          color:
            getParColor(
              normalizedThreshold,
            ),

          derived:
            true,
        };
      },
    );

  return {
    rows,
    totalOutstanding,
  };
}

/* ============================================================================
 * Full data normalization
 * ========================================================================== */

/**
 * Normalize portfolio-at-risk data.
 *
 * Supported payload patterns include:
 *
 *   {
 *     trend: [...],
 *     summary: {...}
 *   }
 *
 *   {
 *     buckets: [...],
 *     totalOutstanding: ...
 *   }
 *
 *   {
 *     par: [...]
 *   }
 *
 *   {
 *     loans: [...]
 *   }
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   rows: Array,
 *   trend: Array,
 *   summary: object,
 *   totalOutstanding: number,
 *   authoritative: boolean,
 *   derived: boolean
 * }}
 */
export function normalizePortfolioAtRiskData(
  input,
  {
    thresholds = PAR_THRESHOLDS,
    locale = DEFAULT_LOCALE,
  } = {},
) {
  const payload =
    unwrapPortfolioAtRiskPayload(
      input,
    );

  const normalizedThresholds = [
    ...new Set(
      asArray(thresholds)
        .map(
          (threshold) =>
            normalizeParThreshold(
              threshold,
            ),
        )
        .filter(
          Number.isFinite,
        ),
    ),
  ].sort(
    (left, right) =>
      left - right,
  );

  if (
    normalizedThresholds.length ===
    0
  ) {
    normalizedThresholds.push(
      ...PAR_THRESHOLDS,
    );
  }

  if (
    !payload
    || typeof payload !== 'object'
  ) {
    return {
      rows: [],
      trend: [],
      summary: {},
      totalOutstanding: 0,
      authoritative: false,
      derived: false,
    };
  }

  const source =
    Array.isArray(payload)
      ? {}
      : payload;

  const summarySource =
    source.summary
    && typeof source.summary ===
      'object'
      ? source.summary
      : (
          source.metrics
          && typeof source.metrics ===
            'object'
            ? source.metrics
            : {}
        );

  const totalOutstanding =
    normalizeAmount(
      firstDefined(
        summarySource,
        [
          'totalOutstanding',
          'totalOutstandingPrincipal',
          'portfolioOutstanding',
          'outstandingAmount',
        ],
        firstDefined(
          source,
          [
            'totalOutstanding',
            'totalOutstandingPrincipal',
            'portfolioOutstanding',
            'outstandingAmount',
          ],
          0,
        ),
      ),
    );

  const rawBucketData =
    Array.isArray(payload)
      ? payload
      : firstDefined(
          source,
          [
            'buckets',
            'par',
            'portfolioAtRisk',
            'portfolioAtRiskBuckets',
            'breakdown',
            'distribution',
          ],
          [],
        );

  const rawTrend =
    Array.isArray(payload)
      ? []
      : firstDefined(
          source,
          [
            'trend',
            'trends',
            'timeSeries',
            'historical',
            'history',
          ],
          [],
        );

  let rows = [];

  if (
    asArray(
      rawBucketData,
    ).length > 0
  ) {
    rows =
      asArray(
        rawBucketData,
      )
        .map(
          (
            item,
            index,
          ) =>
            normalizeParRow(
              item,
              normalizedThresholds[
                index
              ]
              ?? normalizedThresholds[
                0
              ],
              index,
              totalOutstanding,
            ),
        )
        .filter(
          (row) =>
            normalizedThresholds.includes(
              row.threshold,
            ),
        )
        .sort(
          (left, right) =>
            left.threshold
            - right.threshold,
        );
  }

  const loans =
    asArray(
      firstDefined(
        source,
        [
          'loans',
          'loanRecords',
          'records',
          'items',
        ],
        [],
      ),
    );

  let effectiveTotalOutstanding =
    totalOutstanding;

  let derived = false;

  if (
    rows.length === 0
    && loans.length > 0
  ) {
    const fallback =
      aggregateLoansToPar(
        loans,
        normalizedThresholds,
      );

    rows =
      fallback.rows;

    if (
      effectiveTotalOutstanding
      <= 0
    ) {
      effectiveTotalOutstanding =
        fallback.totalOutstanding;
    }

    derived = true;
  }

  /*
   * Build trend records when supplied. Trend rows retain a generic period
   * label plus per-threshold amount/rate fields.
   */
  const trend = asArray(
    rawTrend,
  ).map(
    (item, index) => {
      const trendSource =
        item
        && typeof item === 'object'
          ? item
          : {};

      const period =
        firstDefined(
          trendSource,
          [
            'period',
            'month',
            'date',
            'label',
            'reportingPeriod',
            'snapshotDate',
            'timestamp',
          ],
          `Period ${index + 1}`,
        );

      const normalizedTrendRow = {
        id:
          String(
            firstDefined(
              trendSource,
              [
                'id',
                '_id',
                'key',
              ],
              `trend-${index + 1}`,
            ),
          ),

        period,

        label:
          formatPeriod(
            period,
            locale,
          ),
      };

      for (
        const threshold of
          normalizedThresholds
      ) {
        const amount =
          normalizeAmount(
            getThresholdAmount(
              trendSource,
              threshold,
            ),
          );

        const suppliedRate =
          getThresholdRate(
            trendSource,
            threshold,
          );

        normalizedTrendRow[
          `par${threshold}Amount`
        ] = amount;

        normalizedTrendRow[
          `par${threshold}Rate`
        ] =
          suppliedRate !== undefined
            ? normalizePortfolioAtRiskRate(
                suppliedRate,
              )
            : safeRatio(
                amount,
                normalizeAmount(
                  firstDefined(
                    trendSource,
                    [
                      'totalOutstanding',
                      'outstandingPrincipal',
                      'portfolioOutstanding',
                    ],
                    effectiveTotalOutstanding,
                  ),
                ),
              );

        normalizedTrendRow[
          `par${threshold}LoanCount`
        ] = Math.max(
          0,
          parsePortfolioAtRiskNumber(
            getThresholdCount(
              trendSource,
              threshold,
            ),
          ),
        );
      }

      return normalizedTrendRow;
    },
  );

  const latestTrend =
    trend.length > 0
      ? trend[
          trend.length - 1
        ]
      : null;

  /*
   * Prefer explicitly supplied summary metrics. Otherwise use the latest
   * authoritative PAR bucket values. Final fallback is derived presentation
   * analytics.
   */
  const summaryRows =
    normalizedThresholds.map(
      (threshold, index) => {
        const bucket =
          rows.find(
            (row) =>
              row.threshold ===
              threshold,
          );

        const trendAmount =
          latestTrend?.[
            `par${threshold}Amount`
          ];

        const trendRate =
          latestTrend?.[
            `par${threshold}Rate`
          ];

        const suppliedAmount =
          firstDefined(
            summarySource,
            [
              `par${threshold}Amount`,
              `par${threshold}Principal`,
              `par${threshold}Outstanding`,
            ],
            undefined,
          );

        const suppliedRate =
          firstDefined(
            summarySource,
            [
              `par${threshold}Rate`,
              `par${threshold}Ratio`,
              `par${threshold}Percentage`,
            ],
            undefined,
          );

        const amount =
          suppliedAmount !== undefined
            ? normalizeAmount(
                suppliedAmount,
              )
            : trendAmount !==
                  undefined
              ? normalizeAmount(
                  trendAmount,
                )
              : bucket?.amount
                ?? 0;

        const rate =
          suppliedRate !== undefined
            ? normalizePortfolioAtRiskRate(
                suppliedRate,
              )
            : trendRate !==
                  undefined
              ? normalizePortfolioAtRiskRate(
                  trendRate,
                )
              : bucket?.rate
                ?? safeRatio(
                  amount,
                  effectiveTotalOutstanding,
                );

        return {
          id:
            `summary-par-${threshold}-${index}`,

          threshold,
          label:
            getParLabel(
              threshold,
            ),

          amount,
          rate,

          loanCount:
            bucket?.loanCount
            ?? 0,

          color:
            getParColor(
              threshold,
            ),
        };
      },
    );

  const authoritative =
    rows.length > 0
    && !derived;

  const latestPar30 =
    summaryRows.find(
      (row) =>
        row.threshold === 30,
    );

  const latestPar90 =
    summaryRows.find(
      (row) =>
        row.threshold === 90,
    );

  const explicitOverallRate =
    firstDefined(
      summarySource,
      [
        'parRate',
        'portfolioAtRiskRate',
        'riskRate',
      ],
      undefined,
    );

  return {
    rows: summaryRows,

    trend,

    summary: {
      totalOutstanding:
        effectiveTotalOutstanding,

      parRate:
        explicitOverallRate !==
        undefined
          ? normalizePortfolioAtRiskRate(
              explicitOverallRate,
            )
          : latestPar30?.rate
            ?? 0,

      par30Amount:
        latestPar30?.amount ?? 0,

      par30Rate:
        latestPar30?.rate ?? 0,

      par90Amount:
        latestPar90?.amount ?? 0,

      par90Rate:
        latestPar90?.rate ?? 0,

      sourceMode:
        authoritative
          ? 'authoritative'
          : derived
            ? 'derived'
            : 'unavailable',
    },

    totalOutstanding:
      effectiveTotalOutstanding,

    authoritative,
    derived,
  };
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

export function PortfolioAtRiskTooltip({
  active,
  payload,
  label,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
  thresholds = PAR_THRESHOLDS,
}) {
  if (
    !active
    || !Array.isArray(payload)
    || payload.length === 0
  ) {
    return null;
  }

  const thresholdSet =
    new Set(
      asArray(
        thresholds,
      ).map(
        normalizeParThreshold,
      ),
    );

  return (
    <div
      role="tooltip"
      style={{
        minWidth: 230,
        maxWidth: 370,
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
          display: 'grid',
          gap: 8,
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
              const match =
                /^par(\d+)(Amount|Rate)$/.exec(
                  String(
                    entry.dataKey,
                  ),
                );

              if (
                !match
                || !thresholdSet.has(
                  Number(match[1]),
                )
              ) {
                return null;
              }

              const threshold =
                Number(
                  match[1],
                );

              const kind =
                match[2];

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
                    gap: 18,
                  }}
                >
                  <span
                    style={{
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      gap: 7,
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
                        borderRadius:
                          999,
                        background:
                          getParColor(
                            threshold,
                          ),
                      }}
                    />

                    {getParLabel(
                      threshold,
                    )}{' '}
                    {kind === 'Amount'
                      ? 'Amount'
                      : 'Rate'}
                  </span>

                  <strong
                    style={{
                      color:
                        CSS.textPrimary,
                      fontSize: 12,
                    }}
                  >
                    {kind === 'Amount'
                      ? formatPortfolioAtRiskAmount(
                          entry.value,
                          currency,
                          locale,
                        )
                      : formatPortfolioAtRiskRate(
                          entry.value,
                          locale,
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
 * Presentation components
 * ========================================================================== */

function MetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}) {
  const toneColor =
    tone === 'danger'
      ? CSS.danger
      : tone === 'warning'
        ? CSS.warning
        : tone === 'success'
          ? CSS.success
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
            lineHeight: 1.45,
          }}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

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
            width: '70%',
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
              color:
                CSS.danger,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            Unable to load PAR analytics
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
              || 'The portfolio-at-risk analytics could not be displayed.'}
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
            color:
              CSS.textPrimary,
            fontSize: 15,
            fontWeight: 800,
          }}
        >
          No portfolio-at-risk data
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
            || 'PAR analytics will appear when the reporting dataset is available.'}
        </div>
      </div>
    </div>
  );
}

function ThresholdButton({
  threshold,
  active,
  onSelect,
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Show ${getParLabel(
        threshold,
      )}`}
      onClick={() =>
        onSelect(
          threshold,
        )
      }
      style={{
        minHeight: 32,
        border:
          `1px solid ${
            active
              ? CSS.borderStrong
              : CSS.border
          }`,
        borderRadius: 999,
        background:
          active
            ? CSS.surface
            : CSS.surfaceMuted,
        color:
          active
            ? CSS.textPrimary
            : CSS.textSecondary,
        padding:
          '5px 10px',
        cursor:
          'pointer',
        fontSize: 11,
        fontWeight: 750,
      }}
    >
      {getParLabel(
        threshold,
      )}
    </button>
  );
}

/* ============================================================================
 * Main component
 * ========================================================================== */

function PortfolioAtRiskChartComponent({
  data = null,

  title =
    'Portfolio at Risk',
  description =
    'Outstanding exposure associated with supplied days-past-due thresholds.',

  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,

  thresholds = PAR_THRESHOLDS,

  height = DEFAULT_HEIGHT,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showTrend = true,
  showThresholdControls = true,
  showDataMode = true,

  defaultThreshold = 30,

  maxTrendPoints = 36,

  emptyMessage =
    'No portfolio-at-risk data is available for the selected scope and period.',

  className = '',
  style = {},
  ariaLabel = null,

  /**
   * Optional explicit display mode.
   *
   * "amount" = PAR amount only
   * "rate"   = PAR rate only
   * "both"   = PAR amount and rate
   */
  displayMode = PAR_FORMATS.BOTH,
}) {
  const chartId =
    useId();

  const normalized =
    useMemo(
      () =>
        normalizePortfolioAtRiskData(
          data,
          {
            thresholds,
            locale,
          },
        ),
      [
        data,
        locale,
        thresholds,
      ],
    );

  const availableThresholds =
    useMemo(
      () => [
        ...new Set(
          asArray(
            thresholds,
          )
            .map(
              normalizeParThreshold,
            )
            .filter(
              Number.isFinite,
            ),
        ),
      ].sort(
        (left, right) =>
          left - right,
      ),
      [thresholds],
    );

  const safeDefaultThreshold =
    availableThresholds.includes(
      normalizeParThreshold(
        defaultThreshold,
      ),
    )
      ? normalizeParThreshold(
          defaultThreshold,
        )
      : (
          availableThresholds[0]
          ?? 30
        );

  /*
   * Presentation-only UI state.
   */
  const [
    selectedThreshold,
    setSelectedThreshold,
  ] = useState(
    safeDefaultThreshold,
  );

  const effectiveThreshold =
    availableThresholds.includes(
      selectedThreshold,
    )
      ? selectedThreshold
      : safeDefaultThreshold;

  const selectedRow =
    normalized.rows.find(
      (row) =>
        row.threshold ===
        effectiveThreshold,
    )
    ?? null;

  const trend =
    useMemo(() => {
      const source =
        normalized.trend;

      if (
        maxTrendPoints ===
          null
        || maxTrendPoints ===
          undefined
        || maxTrendPoints <= 0
      ) {
        return source;
      }

      if (
        source.length <=
        maxTrendPoints
      ) {
        return source;
      }

      return source.slice(
        -Math.floor(
          maxTrendPoints,
        ),
      );
    }, [
      maxTrendPoints,
      normalized.trend,
    ]);

  const hasTrend =
    showTrend
    && trend.length >
      0;

  const hasBucketData =
    normalized.rows.length >
      0;

  const hasAnyData =
    hasTrend
    || hasBucketData;

  const selectedParRate =
    selectedRow?.rate
    ?? 0;

  const selectedParAmount =
    selectedRow?.amount
    ?? 0;

  const totalOutstanding =
    normalized.totalOutstanding;

  const explicitPar30 =
    normalized.summary
      .par30Rate
    ?? 0;

  const explicitPar90 =
    normalized.summary
      .par90Rate
    ?? 0;

  const headingId =
    `par-heading-${safeDomId(
      chartId,
    )}`;

  const descriptionText =
    ariaLabel
    || `${title}. ${description}`;

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
        borderRadius: 16,
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
              '1 1 330px',
          }}
        >
          <div
            id={
              headingId
            }
            style={{
              color:
                CSS.textPrimary,
              fontSize: 18,
              fontWeight: 800,
              lineHeight:
                1.25,
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
              lineHeight:
                1.5,
            }}
          >
            {description}
          </div>

          <div
            style={{
              marginTop: 8,
              maxWidth: 840,
              color:
                CSS.textSecondary,
              fontSize: 11,
              lineHeight:
                1.45,
            }}
          >
            PAR figures are reporting analytics from the supplied dataset;
            credit policy, loan classification and accounting authority remain
            server-side.
          </div>
        </div>

        {showThresholdControls
        && !loading
        && !error
        && availableThresholds.length >
          0 ? (
          <div
            role="group"
            aria-label="Portfolio at risk threshold"
            style={{
              display:
                'flex',
              flexWrap:
                'wrap',
              justifyContent:
                'flex-end',
              gap: 7,
            }}
          >
            {availableThresholds.map(
              (
                threshold,
              ) => (
                <ThresholdButton
                  key={
                    threshold
                  }
                  threshold={
                    threshold
                  }
                  active={
                    effectiveThreshold ===
                    threshold
                  }
                  onSelect={
                    setSelectedThreshold
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
      && hasAnyData ? (
        <div
          style={{
            display:
              'grid',
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
          <MetricCard
            label="Portfolio Outstanding"
            value={formatPortfolioAtRiskAmount(
              totalOutstanding,
              currency,
              locale,
            )}
            helper="Supplied outstanding exposure"
            tone="info"
          />

          <MetricCard
            label={`PAR ${effectiveThreshold}`}
            value={
              displayMode ===
                PAR_FORMATS.RATE
                ? formatPortfolioAtRiskRate(
                    selectedParRate,
                    locale,
                  )
                : displayMode ===
                    PAR_FORMATS.AMOUNT
                  ? formatPortfolioAtRiskAmount(
                      selectedParAmount,
                      currency,
                      locale,
                    )
                  : `${formatPortfolioAtRiskAmount(
                      selectedParAmount,
                      currency,
                      locale,
                    )} · ${formatPortfolioAtRiskRate(
                      selectedParRate,
                      locale,
                    )}`
            }
            helper={
              selectedRow?.loanCount
                ? `${formatPortfolioAtRiskCount(
                    selectedRow.loanCount,
                    locale,
                  )} supplied loan(s) in this bucket`
                : `Exposure at or above ${effectiveThreshold} DPD`
            }
            tone={
              effectiveThreshold >=
              90
                ? 'danger'
                : effectiveThreshold >=
                    30
                  ? 'warning'
                  : 'info'
            }
          />

          <MetricCard
            label="PAR 30"
            value={formatPortfolioAtRiskRate(
              explicitPar30,
              locale,
            )}
            helper="Supplied or derived PAR 30 rate"
            tone={
              explicitPar30 >
              0
                ? 'warning'
                : 'success'
            }
          />

          <MetricCard
            label="PAR 90"
            value={formatPortfolioAtRiskRate(
              explicitPar90,
              locale,
            )}
            helper="Supplied or derived PAR 90 rate"
            tone={
              explicitPar90 >
              0
                ? 'danger'
                : 'success'
            }
          />
        </div>
      ) : null}

      {/* State handling */}
      {loading ? (
        <StatePanel
          type="loading"
        />
      ) : error ? (
        <StatePanel
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
          {/* Historical trend */}
          {hasTrend ? (
            <div
              role="img"
              aria-label={`${title} trend showing PAR amount and rate across reporting periods`}
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
                    trend
                  }
                  margin={{
                    top: 12,
                    right: 22,
                    left: 8,
                    bottom: 8,
                  }}
                >
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
                    dataKey="label"
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
                  />

                  <YAxis
                    yAxisId="amount"
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
                    width={90}
                    tickFormatter={(
                      value,
                    ) =>
                      formatPortfolioAtRiskAmount(
                        value,
                        currency,
                        locale,
                      )
                    }
                  />

                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[
                      0,
                      'auto',
                    ]}
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
                    width={62}
                    tickFormatter={(
                      value,
                    ) =>
                      formatPortfolioAtRiskRate(
                        value,
                        locale,
                      )
                    }
                  />

                  <Tooltip
                    cursor={{
                      stroke:
                        CSS.borderStrong,
                      strokeDasharray:
                        '4 4',
                    }}
                    content={
                      <PortfolioAtRiskTooltip
                        currency={
                          currency
                        }
                        locale={
                          locale
                        }
                        thresholds={
                          availableThresholds
                        }
                      />
                    }
                  />

                  {displayMode !==
                  PAR_FORMATS.RATE
                    ? (
                        <Bar
                          yAxisId="amount"
                          dataKey={`par${effectiveThreshold}Amount`}
                          name={`${getParLabel(
                            effectiveThreshold,
                          )} Amount`}
                          fill={
                            getParColor(
                              effectiveThreshold,
                            )
                          }
                          fillOpacity={
                            0.72
                          }
                          radius={[
                            5,
                            5,
                            0,
                            0,
                          ]}
                          barSize={
                            24
                          }
                          isAnimationActive
                          animationDuration={
                            600
                          }
                        />
                      )
                    : null}

                  {displayMode !==
                  PAR_FORMATS.AMOUNT
                    ? (
                        <Line
                          yAxisId="rate"
                          type="monotone"
                          dataKey={`par${effectiveThreshold}Rate`}
                          name={`${getParLabel(
                            effectiveThreshold,
                          )} Rate`}
                          stroke={
                            getParColor(
                              effectiveThreshold,
                            )
                          }
                          strokeWidth={
                            2.5
                          }
                          dot={false}
                          activeDot={{
                            r: 4,
                          }}
                          isAnimationActive
                          animationDuration={
                            600
                          }
                        />
                      )
                    : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* Threshold snapshot */}
          {hasBucketData ? (
            <div
              style={{
                marginTop:
                  hasTrend
                    ? 14
                    : 0,
                paddingTop:
                  hasTrend
                    ? 14
                    : 0,
                borderTop:
                  hasTrend
                    ? `1px solid ${CSS.border}`
                    : 'none',
              }}
            >
              <div
                style={{
                  display:
                    'flex',
                  alignItems:
                    'center',
                  justifyContent:
                    'space-between',
                  gap: 12,
                  flexWrap:
                    'wrap',
                  marginBottom:
                    9,
                }}
              >
                <div
                  style={{
                    color:
                      CSS.textPrimary,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  PAR Threshold Snapshot
                </div>

                {showDataMode ? (
                  <span
                    style={{
                      display:
                        'inline-flex',
                      alignItems:
                        'center',
                      minHeight:
                        25,
                      borderRadius:
                        999,
                      border:
                        `1px solid ${
                          normalized.derived
                            ? CSS.warning
                            : CSS.borderStrong
                        }`,
                      background:
                        CSS.surfaceMuted,
                      color:
                        normalized.derived
                          ? CSS.warning
                          : CSS.textSecondary,
                      padding:
                        '3px 8px',
                      fontSize: 10,
                      fontWeight: 750,
                    }}
                  >
                    {normalized.authoritative
                      ? 'Reporting data'
                      : normalized.derived
                        ? 'Presentation-derived fallback'
                        : 'Unavailable'}
                  </span>
                ) : null}
              </div>

              <div
                style={{
                  display:
                    'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 9,
                }}
              >
                {normalized.rows.map(
                  (row) => (
                    <button
                      key={
                        row.id
                      }
                      type="button"
                      onClick={() =>
                        setSelectedThreshold(
                          row.threshold,
                        )
                      }
                      aria-pressed={
                        row.threshold ===
                        effectiveThreshold
                      }
                      style={{
                        display:
                          'grid',
                        gap: 7,
                        minWidth:
                          0,
                        border:
                          `1px solid ${
                            row.threshold ===
                            effectiveThreshold
                              ? row.color
                              : CSS.border
                          }`,
                        borderRadius:
                          11,
                        background:
                          row.threshold ===
                          effectiveThreshold
                            ? CSS.primarySoft
                            : CSS.surfaceMuted,
                        color:
                          CSS.textPrimary,
                        padding:
                          11,
                        cursor:
                          'pointer',
                        textAlign:
                          'left',
                      }}
                    >
                      <div
                        style={{
                          display:
                            'flex',
                          alignItems:
                            'center',
                          justifyContent:
                            'space-between',
                          gap: 10,
                        }}
                      >
                        <span
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
                              700,
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
                                row.color,
                            }}
                          />

                          {
                            row.label
                          }
                        </span>

                        <strong
                          style={{
                            color:
                              CSS.textPrimary,
                            fontSize:
                              12,
                          }}
                        >
                          {formatPortfolioAtRiskRate(
                            row.rate,
                            locale,
                          )}
                        </strong>
                      </div>

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
                        {formatPortfolioAtRiskAmount(
                          row.amount,
                          currency,
                          locale,
                        )}
                      </div>

                      <div
                        style={{
                          color:
                            CSS.textSecondary,
                          fontSize:
                            10,
                          lineHeight:
                            1.4,
                        }}
                      >
                        {row.loanCount
                          > 0
                          ? `${formatPortfolioAtRiskCount(
                              row.loanCount,
                              locale,
                            )} supplied loan(s)`
                          : 'Outstanding exposure in bucket'}
                      </div>
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null}

          {/* Interpretation note */}
          <div
            style={{
              marginTop:
                14,
              color:
                CSS.textSecondary,
              fontSize:
                11,
              lineHeight:
                1.5,
            }}
          >
            {getParLabel(
              effectiveThreshold,
            )}{' '}
            represents exposure associated with the supplied
            delinquency threshold. The chart does not independently determine
            delinquency, default, impairment, provisioning or credit treatment.
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Public defaults / metadata
 * ========================================================================== */

export const PORTFOLIO_AT_RISK_DEFAULTS =
  Object.freeze({
    locale:
      DEFAULT_LOCALE,
    currency:
      DEFAULT_CURRENCY,
    height:
      DEFAULT_HEIGHT,
    thresholds:
      PAR_THRESHOLDS,
    defaultThreshold:
      30,
    displayMode:
      PAR_FORMATS.BOTH,
    showSummary:
      true,
    showTrend:
      true,
    showThresholdControls:
      true,
    showDataMode:
      true,
  });

/* ============================================================================
 * Public component
 * ========================================================================== */

export const PortfolioAtRiskChart =
  memo(
    PortfolioAtRiskChartComponent,
  );

PortfolioAtRiskChart.displayName =
  'PortfolioAtRiskChart';

export default PortfolioAtRiskChart;