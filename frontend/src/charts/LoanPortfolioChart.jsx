'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/LoanPortfolioChart.jsx
 *
 * Purpose:
 *   Enterprise-grade loan portfolio analytics for TITech dashboards,
 *   institution views, group views and operational reporting surfaces.
 *
 * Responsibilities:
 *   - Present loan portfolio trends and lifecycle-state distribution.
 *   - Normalize common backend/API response envelopes.
 *   - Safely format money, rates, dates and counts.
 *   - Support Decimal128-like / numeric-string financial values.
 *   - Preserve separation between presentation analytics and financial truth.
 *   - Provide deterministic loading, error and empty states.
 *   - Provide accessible labels and reduced-motion behavior.
 *
 * Financial integrity:
 *   - This component is presentation-only.
 *   - It MUST NOT mutate loans, balances, ledger entries, repayments,
 *     settlements, reconciliation records or accounting state.
 *   - Frontend-derived ratios/totals are display analytics only.
 *   - Backend/domain services remain authoritative for loan state,
 *     principal, interest, repayment, delinquency, provisioning and accounting.
 *   - "Approved" MUST NOT be represented as "disbursed".
 *   - "Queued", "processing" or "provider accepted" MUST NOT be represented
 *     as settled financial state.
 *   - Default/overdue labels describe supplied domain state; the chart does not
 *     independently determine credit status or fraud.
 *
 * Expected lifecycle states supported:
 *   pending_application
 *   approved
 *   rejected
 *   canceled
 *   disbursed
 *   active
 *   overdue
 *   defaulted
 *   closed
 *
 * Typical usage:
 *
 *   import LoanPortfolioChart from './charts/LoanPortfolioChart.jsx';
 *
 *   <LoanPortfolioChart
 *     data={loanPortfolioResponse}
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

const DEFAULT_CURRENCY = 'UGX';
const DEFAULT_LOCALE = 'en-UG';
const DEFAULT_HEIGHT = 380;

const NUMBER_FORMATTER_CACHE = new Map();

export const LOAN_STATUS = Object.freeze({
  PENDING_APPLICATION: 'pending_application',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELED: 'canceled',
  DISBURSED: 'disbursed',
  ACTIVE: 'active',
  OVERDUE: 'overdue',
  DEFAULTED: 'defaulted',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
});

export const LOAN_STATUS_LABELS = Object.freeze({
  [LOAN_STATUS.PENDING_APPLICATION]: 'Pending Application',
  [LOAN_STATUS.APPROVED]: 'Approved',
  [LOAN_STATUS.REJECTED]: 'Rejected',
  [LOAN_STATUS.CANCELED]: 'Canceled',
  [LOAN_STATUS.DISBURSED]: 'Disbursed',
  [LOAN_STATUS.ACTIVE]: 'Active',
  [LOAN_STATUS.OVERDUE]: 'Overdue',
  [LOAN_STATUS.DEFAULTED]: 'Defaulted',
  [LOAN_STATUS.CLOSED]: 'Closed',
  [LOAN_STATUS.UNKNOWN]: 'Unknown',
});

const STATUS_ORDER = Object.freeze([
  LOAN_STATUS.PENDING_APPLICATION,
  LOAN_STATUS.APPROVED,
  LOAN_STATUS.DISBURSED,
  LOAN_STATUS.ACTIVE,
  LOAN_STATUS.OVERDUE,
  LOAN_STATUS.DEFAULTED,
  LOAN_STATUS.CLOSED,
  LOAN_STATUS.REJECTED,
  LOAN_STATUS.CANCELED,
  LOAN_STATUS.UNKNOWN,
]);

const STATUS_TONES = Object.freeze({
  [LOAN_STATUS.PENDING_APPLICATION]: 'neutral',
  [LOAN_STATUS.APPROVED]: 'info',
  [LOAN_STATUS.DISBURSED]: 'info',
  [LOAN_STATUS.ACTIVE]: 'success',
  [LOAN_STATUS.OVERDUE]: 'warning',
  [LOAN_STATUS.DEFAULTED]: 'danger',
  [LOAN_STATUS.CLOSED]: 'neutral',
  [LOAN_STATUS.REJECTED]: 'danger',
  [LOAN_STATUS.CANCELED]: 'neutral',
  [LOAN_STATUS.UNKNOWN]: 'neutral',
});

const CSS = Object.freeze({
  primary: 'var(--titech-primary)',
  primarySoft: 'var(--titech-primary-soft)',
  surface: 'var(--titech-surface)',
  surfaceMuted: 'var(--titech-surface-muted)',
  border: 'var(--titech-border)',
  borderStrong: 'var(--titech-border-strong)',
  textPrimary: 'var(--titech-text-primary)',
  textSecondary: 'var(--titech-text-secondary)',
  success: 'var(--titech-success)',
  warning: 'var(--titech-warning)',
  danger: 'var(--titech-danger)',
  focus: 'var(--titech-focus-ring)',
  chart1: 'var(--titech-chart-series-1)',
  chart2: 'var(--titech-chart-series-2)',
  chart3: 'var(--titech-chart-series-3)',
  chart4: 'var(--titech-chart-series-4)',
  chart5: 'var(--titech-chart-series-5)',
});

/* ============================================================================
 * Generic helpers
 * ========================================================================== */

/**
 * Safely unwrap common API response envelopes.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
function unwrapPayload(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const source = input;

  if ('data' in source && source.data && typeof source.data === 'object') {
    return source.data;
  }

  if ('result' in source && source.result && typeof source.result === 'object') {
    return source.result;
  }

  if (
    'payload' in source
    && source.payload
    && typeof source.payload === 'object'
  ) {
    return source.payload;
  }

  if (
    'response' in source
    && source.response
    && typeof source.response === 'object'
  ) {
    return source.response;
  }

  return source;
}

/**
 * Convert Decimal128-like values, objects and numeric strings into a number.
 *
 * This is intentionally a display parser. It is NOT an accounting conversion.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseLoanNumber(value, fallback = 0) {
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
    const normalized = value.replace(/,/g, '').trim();

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
      ?? value.value
      ?? value.amount
      ?? value.$number;

    if (candidate !== undefined) {
      return parseLoanNumber(candidate, fallback);
    }

    if (typeof value.toString === 'function') {
      const stringified = value.toString();

      if (stringified !== '[object Object]') {
        return parseLoanNumber(stringified, fallback);
      }
    }
  }

  return fallback;
}

/**
 * Safely normalize an unknown array.
 *
 * @param {unknown} value
 * @returns {Array}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Convert a value into a finite non-negative display amount.
 *
 * @param {unknown} value
 * @returns {number}
 */
function parseDisplayAmount(value) {
  return Math.max(0, parseLoanNumber(value));
}

/**
 * Normalize a status into the canonical supported values.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeLoanStatus(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return LOAN_STATUS.UNKNOWN;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const aliases = {
    pending: LOAN_STATUS.PENDING_APPLICATION,
    pending_application: LOAN_STATUS.PENDING_APPLICATION,
    application_pending: LOAN_STATUS.PENDING_APPLICATION,

    approved: LOAN_STATUS.APPROVED,

    rejected: LOAN_STATUS.REJECTED,
    declined: LOAN_STATUS.REJECTED,

    canceled: LOAN_STATUS.CANCELED,
    cancelled: LOAN_STATUS.CANCELED,

    disbursed: LOAN_STATUS.DISBURSED,
    funded: LOAN_STATUS.DISBURSED,

    active: LOAN_STATUS.ACTIVE,
    current: LOAN_STATUS.ACTIVE,

    overdue: LOAN_STATUS.OVERDUE,
    delinquent: LOAN_STATUS.OVERDUE,

    defaulted: LOAN_STATUS.DEFAULTED,
    default: LOAN_STATUS.DEFAULTED,

    closed: LOAN_STATUS.CLOSED,
    completed: LOAN_STATUS.CLOSED,
    paid: LOAN_STATUS.CLOSED,
  };

  return aliases[normalized] ?? LOAN_STATUS.UNKNOWN;
}

/**
 * Human-readable loan status.
 *
 * @param {unknown} status
 * @returns {string}
 */
export function formatLoanStatus(status) {
  const canonicalStatus = normalizeLoanStatus(status);

  return (
    LOAN_STATUS_LABELS[canonicalStatus]
    ?? LOAN_STATUS_LABELS[LOAN_STATUS.UNKNOWN]
  );
}

/**
 * Normalize date-like values to a display-safe timestamp.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();

    return Number.isFinite(time) ? time : null;
  }

  const numeric = parseLoanNumber(value, NaN);

  if (Number.isFinite(numeric) && String(value).length <= 13) {
    return numeric < 10000000000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Format a period/date label.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
function formatPeriod(value, locale) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    const text = String(value ?? '').trim();

    return text || 'Unknown';
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Reuse Intl formatters.
 *
 * @param {string} locale
 * @param {string} currency
 * @param {'currency'|'number'|'percent'} style
 * @returns {Intl.NumberFormat}
 */
function getNumberFormatter(locale, currency, style) {
  const key = `${locale}|${currency}|${style}`;

  if (NUMBER_FORMATTER_CACHE.has(key)) {
    return NUMBER_FORMATTER_CACHE.get(key);
  }

  let formatter;

  if (style === 'currency') {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'UGX' ? 0 : 2,
      maximumFractionDigits: currency === 'UGX' ? 0 : 2,
    });
  } else if (style === 'percent') {
    formatter = new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } else {
    formatter = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
    });
  }

  NUMBER_FORMATTER_CACHE.set(key, formatter);

  return formatter;
}

/**
 * Format a monetary display value.
 *
 * @param {unknown} value
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
export function formatLoanAmount(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  return getNumberFormatter(
    locale,
    currency,
    'currency',
  ).format(parseLoanNumber(value));
}

/**
 * Format a count.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
function formatCount(value, locale) {
  return getNumberFormatter(
    locale,
    DEFAULT_CURRENCY,
    'number',
  ).format(Math.max(0, parseLoanNumber(value)));
}

/**
 * Format a percentage expressed as a ratio, e.g. 0.125 => 12.5%.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
function formatLoanPercent(value, locale = DEFAULT_LOCALE) {
  return getNumberFormatter(
    locale,
    DEFAULT_CURRENCY,
    'percent',
  ).format(Math.max(0, parseLoanNumber(value)));
}

/**
 * Calculate a presentation-only ratio.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return 0;
  }

  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Return the first defined value in an object for a set of aliases.
 *
 * @param {object} object
 * @param {string[]} aliases
 * @param {unknown} fallback
 * @returns {unknown}
 */
function firstDefined(object, aliases, fallback = undefined) {
  for (const alias of aliases) {
    if (
      object
      && Object.prototype.hasOwnProperty.call(object, alias)
      && object[alias] !== null
      && object[alias] !== undefined
    ) {
      return object[alias];
    }
  }

  return fallback;
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

/**
 * Normalize one raw loan record.
 *
 * @param {unknown} loan
 * @param {number} index
 * @returns {object}
 */
function normalizeLoanRecord(loan, index) {
  const record = loan && typeof loan === 'object' ? loan : {};

  const status = normalizeLoanStatus(
    firstDefined(record, [
      'status',
      'loanStatus',
      'state',
      'lifecycleStatus',
      'workflowStatus',
    ]),
  );

  const outstandingAmount = parseDisplayAmount(
    firstDefined(record, [
      'outstandingPrincipal',
      'outstandingAmount',
      'remainingPrincipal',
      'balance',
      'principalOutstanding',
    ]),
  );

  const principalAmount = parseDisplayAmount(
    firstDefined(record, [
      'principal',
      'principalAmount',
      'loanAmount',
      'amount',
      'approvedAmount',
      'disbursedAmount',
    ]),
  );

  const disbursedAmount = parseDisplayAmount(
    firstDefined(record, [
      'disbursedPrincipal',
      'disbursedAmount',
      'fundedAmount',
    ]),
  );

  const overdueAmount = parseDisplayAmount(
    firstDefined(record, [
      'overdueAmount',
      'overduePrincipal',
      'delinquentAmount',
    ]),
  );

  const defaultedAmount = parseDisplayAmount(
    firstDefined(record, [
      'defaultedAmount',
      'defaultAmount',
      'defaultedPrincipal',
    ]),
  );

  const approvedAmount = parseDisplayAmount(
    firstDefined(record, [
      'approvedAmount',
      'approvedPrincipal',
      'approvalAmount',
    ]),
  );

  const createdAt = firstDefined(record, [
    'createdAt',
    'applicationDate',
    'appliedAt',
    'date',
    'timestamp',
  ]);

  const period = firstDefined(record, [
    'period',
    'month',
    'reportingPeriod',
    'date',
    'createdAt',
    'applicationDate',
  ]);

  return {
    id:
      firstDefined(record, [
        'id',
        '_id',
        'loanId',
        'reference',
        'loanReference',
      ]) ?? `loan-${index + 1}`,

    status,

    principalAmount,
    outstandingAmount,
    disbursedAmount,
    overdueAmount,
    defaultedAmount,
    approvedAmount,

    interestAmount: parseDisplayAmount(
      firstDefined(record, [
        'interestAmount',
        'interest',
        'accruedInterest',
      ]),
    ),

    period,

    createdAt,

    raw: record,
  };
}

/**
 * Normalize trend records.
 *
 * @param {Array} items
 * @param {string} locale
 * @returns {Array}
 */
function normalizeTrendRecords(items, locale) {
  return asArray(items)
    .map((item, index) => {
      const record = item && typeof item === 'object' ? item : {};

      const rawPeriod = firstDefined(record, [
        'period',
        'month',
        'date',
        'label',
        'reportingPeriod',
        'createdAt',
      ]);

      const periodLabel = formatPeriod(rawPeriod, locale);

      return {
        id: String(
          firstDefined(record, ['id', '_id', 'periodKey'])
          ?? `period-${index + 1}`,
        ),

        period: rawPeriod ?? periodLabel,
        label: periodLabel,

        outstandingAmount: parseDisplayAmount(
          firstDefined(record, [
            'outstandingAmount',
            'outstandingPrincipal',
            'portfolioOutstanding',
            'balance',
            'remainingPrincipal',
          ]),
        ),

        disbursedAmount: parseDisplayAmount(
          firstDefined(record, [
            'disbursedAmount',
            'disbursedPrincipal',
            'fundedAmount',
            'disbursementAmount',
          ]),
        ),

        overdueAmount: parseDisplayAmount(
          firstDefined(record, [
            'overdueAmount',
            'overduePrincipal',
            'delinquentAmount',
          ]),
        ),

        defaultedAmount: parseDisplayAmount(
          firstDefined(record, [
            'defaultedAmount',
            'defaultAmount',
            'defaultedPrincipal',
          ]),
        ),

        approvedAmount: parseDisplayAmount(
          firstDefined(record, [
            'approvedAmount',
            'approvedPrincipal',
            'approvalAmount',
          ]),
        ),

        loanCount: Math.max(
          0,
          parseLoanNumber(
            firstDefined(record, [
              'loanCount',
              'count',
              'loans',
              'numberOfLoans',
            ]),
          ),
        ),
      };
    })
    .sort((left, right) => {
      const leftTime = toTimestamp(left.period);
      const rightTime = toTimestamp(right.period);

      if (leftTime !== null && rightTime !== null) {
        return leftTime - rightTime;
      }

      return String(left.label).localeCompare(String(right.label));
    });
}

/**
 * Build a status distribution from raw loan records.
 *
 * @param {Array} loans
 * @returns {Array}
 */
function buildStatusDistribution(loans) {
  const bucket = new Map(
    STATUS_ORDER.map((status) => [
      status,
      {
        status,
        count: 0,
        amount: 0,
        outstandingAmount: 0,
        disbursedAmount: 0,
      },
    ]),
  );

  for (const loan of loans) {
    const status = normalizeLoanStatus(loan.status);

    const target = bucket.get(status) ?? bucket.get(LOAN_STATUS.UNKNOWN);

    target.count += 1;

    target.amount += loan.principalAmount;

    target.outstandingAmount += loan.outstandingAmount;

    target.disbursedAmount += loan.disbursedAmount;
  }

  return STATUS_ORDER
    .map((status) => bucket.get(status))
    .filter((entry) => entry && entry.count > 0);
}

/**
 * Build a fallback trend from loan records when the API did not provide
 * a dedicated time-series structure.
 *
 * This is a presentation fallback only.
 *
 * @param {Array} loans
 * @param {string} locale
 * @returns {Array}
 */
function buildTrendFromLoans(loans, locale) {
  const grouped = new Map();

  for (const loan of loans) {
    const timestamp = toTimestamp(loan.period ?? loan.createdAt);

    if (timestamp === null) {
      continue;
    }

    const date = new Date(timestamp);

    const key = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        period: date.toISOString(),
        label: formatPeriod(date, locale),
        outstandingAmount: 0,
        disbursedAmount: 0,
        overdueAmount: 0,
        defaultedAmount: 0,
        approvedAmount: 0,
        loanCount: 0,
      });
    }

    const bucket = grouped.get(key);

    bucket.outstandingAmount += loan.outstandingAmount;
    bucket.disbursedAmount += loan.disbursedAmount;
    bucket.overdueAmount += loan.overdueAmount;
    bucket.defaultedAmount += loan.defaultedAmount;
    bucket.approvedAmount += loan.approvedAmount;
    bucket.loanCount += 1;
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const leftTime = toTimestamp(left.period) ?? 0;
      const rightTime = toTimestamp(right.period) ?? 0;

      return leftTime - rightTime;
    });
}

/**
 * Normalize the complete portfolio payload.
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   loans: Array,
 *   trend: Array,
 *   statuses: Array,
 *   summary: object,
 *   hasTrend: boolean,
 *   hasStatusData: boolean
 * }}
 */
export function normalizeLoanPortfolioData(
  input,
  {
    locale = DEFAULT_LOCALE,
  } = {},
) {
  const payload = unwrapPayload(input);

  if (!payload || typeof payload !== 'object') {
    return {
      loans: [],
      trend: [],
      statuses: [],
      summary: {},
      hasTrend: false,
      hasStatusData: false,
    };
  }

  const rawLoans = firstDefined(payload, [
    'loans',
    'items',
    'records',
    'portfolio',
    'loanPortfolio',
    'loanRecords',
  ]);

  const loans = asArray(rawLoans).map(normalizeLoanRecord);

  const rawTrend = firstDefined(payload, [
    'trend',
    'trends',
    'series',
    'timeSeries',
    'portfolioTrend',
    'historical',
    'history',
  ]);

  let trend = normalizeTrendRecords(
    asArray(rawTrend),
    locale,
  );

  if (trend.length === 0 && loans.length > 0) {
    trend = buildTrendFromLoans(loans, locale);
  }

  const rawStatuses = firstDefined(payload, [
    'statuses',
    'statusDistribution',
    'distribution',
    'breakdown',
    'loanStatusBreakdown',
  ]);

  let statuses = asArray(rawStatuses)
    .map((item) => {
      const record = item && typeof item === 'object' ? item : {};

      const status = normalizeLoanStatus(
        firstDefined(record, [
          'status',
          'loanStatus',
          'state',
          'label',
          'name',
        ]),
      );

      return {
        status,
        count: Math.max(
          0,
          parseLoanNumber(
            firstDefined(record, [
              'count',
              'loanCount',
              'loans',
              'numberOfLoans',
            ]),
          ),
        ),
        amount: parseDisplayAmount(
          firstDefined(record, [
            'amount',
            'principalAmount',
            'portfolioAmount',
            'loanAmount',
          ]),
        ),
        outstandingAmount: parseDisplayAmount(
          firstDefined(record, [
            'outstandingAmount',
            'outstandingPrincipal',
            'balance',
          ]),
        ),
        disbursedAmount: parseDisplayAmount(
          firstDefined(record, [
            'disbursedAmount',
            'disbursedPrincipal',
            'fundedAmount',
          ]),
        ),
      };
    })
    .filter((entry) => entry.count > 0 || entry.amount > 0);

  if (statuses.length === 0 && loans.length > 0) {
    statuses = buildStatusDistribution(loans);
  }

  const suppliedSummary = firstDefined(payload, [
    'summary',
    'totals',
    'metrics',
    'kpis',
    'portfolioSummary',
  ]);

  const summarySource =
    suppliedSummary && typeof suppliedSummary === 'object'
      ? suppliedSummary
      : {};

  const computedPrincipal = loans.reduce(
    (total, loan) => total + loan.principalAmount,
    0,
  );

  const computedOutstanding = loans.reduce(
    (total, loan) => total + loan.outstandingAmount,
    0,
  );

  const computedDisbursed = loans.reduce(
    (total, loan) => total + loan.disbursedAmount,
    0,
  );

  const computedOverdue = loans.reduce(
    (total, loan) => total + loan.overdueAmount,
    0,
  );

  const computedDefaulted = loans.reduce(
    (total, loan) => total + loan.defaultedAmount,
    0,
  );

  const activeLoanCount = loans.filter(
    (loan) => loan.status === LOAN_STATUS.ACTIVE,
  ).length;

  const overdueLoanCount = loans.filter(
    (loan) => loan.status === LOAN_STATUS.OVERDUE,
  ).length;

  const defaultedLoanCount = loans.filter(
    (loan) => loan.status === LOAN_STATUS.DEFAULTED,
  ).length;

  const summary = {
    totalLoanCount: Math.max(
      0,
      parseLoanNumber(
        firstDefined(summarySource, [
          'totalLoanCount',
          'loanCount',
          'totalLoans',
          'count',
          'numberOfLoans',
        ]),
        loans.length,
      ),
    ),

    totalPrincipal: parseDisplayAmount(
      firstDefined(summarySource, [
        'totalPrincipal',
        'principalAmount',
        'totalLoanAmount',
        'portfolioAmount',
      ]),
    ) || computedPrincipal,

    outstandingPrincipal: parseDisplayAmount(
      firstDefined(summarySource, [
        'outstandingPrincipal',
        'outstandingAmount',
        'portfolioOutstanding',
        'remainingPrincipal',
      ]),
    ) || computedOutstanding,

    disbursedPrincipal: parseDisplayAmount(
      firstDefined(summarySource, [
        'disbursedPrincipal',
        'disbursedAmount',
        'totalDisbursed',
        'fundedAmount',
      ]),
    ) || computedDisbursed,

    overdueAmount: parseDisplayAmount(
      firstDefined(summarySource, [
        'overdueAmount',
        'overduePrincipal',
        'delinquentAmount',
      ]),
    ) || computedOverdue,

    defaultedAmount: parseDisplayAmount(
      firstDefined(summarySource, [
        'defaultedAmount',
        'defaultAmount',
        'defaultedPrincipal',
      ]),
    ) || computedDefaulted,

    activeLoanCount: Math.max(
      0,
      parseLoanNumber(
        firstDefined(summarySource, [
          'activeLoanCount',
          'activeLoans',
          'currentLoans',
        ]),
        activeLoanCount,
      ),
    ),

    overdueLoanCount: Math.max(
      0,
      parseLoanNumber(
        firstDefined(summarySource, [
          'overdueLoanCount',
          'overdueLoans',
          'delinquentLoans',
        ]),
        overdueLoanCount,
      ),
    ),

    defaultedLoanCount: Math.max(
      0,
      parseLoanNumber(
        firstDefined(summarySource, [
          'defaultedLoanCount',
          'defaultedLoans',
          'defaultLoans',
        ]),
        defaultedLoanCount,
      ),
    ),

    parRate:
      firstDefined(summarySource, [
        'parRate',
        'portfolioAtRiskRate',
        'portfolioAtRisk',
        'riskRate',
      ]) !== undefined
        ? parseLoanNumber(
            firstDefined(summarySource, [
              'parRate',
              'portfolioAtRiskRate',
              'portfolioAtRisk',
              'riskRate',
            ]),
          )
        : safeRatio(
            computedOverdue + computedDefaulted,
            computedOutstanding,
          ),
  };

  return {
    loans,
    trend,
    statuses,
    summary,
    hasTrend: trend.length > 0,
    hasStatusData: statuses.length > 0,
  };
}

/* ============================================================================
 * Styling helpers
 * ========================================================================== */

function toneColor(tone) {
  switch (tone) {
    case 'success':
      return CSS.success;
    case 'warning':
      return CSS.warning;
    case 'danger':
      return CSS.danger;
    case 'info':
      return CSS.primary;
    default:
      return CSS.textSecondary;
  }
}

function MetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}) {
  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${CSS.border}`,
        borderRadius: 12,
        background: CSS.surface,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          color: CSS.textSecondary,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.4,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 6,
          color: toneColor(tone),
          fontSize: 20,
          fontWeight: 750,
          lineHeight: 1.2,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>

      {helper ? (
        <div
          style={{
            marginTop: 5,
            color: CSS.textSecondary,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }) {
  const canonicalStatus = normalizeLoanStatus(status);
  const tone = STATUS_TONES[canonicalStatus] ?? 'neutral';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 24,
        borderRadius: 999,
        border: `1px solid ${toneColor(tone)}`,
        padding: '2px 8px',
        color: toneColor(tone),
        background: CSS.surfaceMuted,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {formatLoanStatus(canonicalStatus)}
    </span>
  );
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

export function LoanPortfolioTooltip({
  active,
  payload,
  label,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
}) {
  if (!active || !Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  return (
    <div
      role="tooltip"
      style={{
        minWidth: 220,
        maxWidth: 320,
        border: `1px solid ${CSS.borderStrong}`,
        borderRadius: 12,
        background: CSS.surface,
        boxShadow: '0 10px 30px rgba(0,0,0,0.10)',
        padding: 12,
      }}
    >
      <div
        style={{
          color: CSS.textPrimary,
          fontSize: 13,
          fontWeight: 750,
          marginBottom: 9,
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
          .filter((entry) => entry && entry.value !== undefined)
          .map((entry) => {
            const numericValue = parseLoanNumber(entry.value);

            const isCount =
              entry.dataKey === 'loanCount'
              || entry.dataKey === 'count';

            return (
              <div
                key={`${entry.dataKey}-${entry.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    color: CSS.textSecondary,
                    fontSize: 12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        entry.color
                        ?? CSS.chart1,
                      flex: '0 0 auto',
                    }}
                  />
                  {entry.name ?? entry.dataKey}
                </span>

                <strong
                  style={{
                    color: CSS.textPrimary,
                    fontSize: 12,
                  }}
                >
                  {isCount
                    ? formatCount(numericValue, locale)
                    : formatLoanAmount(
                        numericValue,
                        currency,
                        locale,
                      )}
                </strong>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ============================================================================
 * Chart states
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
          padding: 16,
        }}
      >
        <div
          style={{
            height: 14,
            width: '32%',
            borderRadius: 8,
            background: CSS.primarySoft,
          }}
        />

        <div
          style={{
            height: 230,
            borderRadius: 12,
            background:
              'linear-gradient(90deg, rgba(20,108,148,0.06), rgba(20,108,148,0.12), rgba(20,108,148,0.06))',
          }}
        />

        <div
          style={{
            height: 12,
            width: '76%',
            borderRadius: 8,
            background: CSS.primarySoft,
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
              fontWeight: 750,
            }}
          >
            Unable to load loan portfolio
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 520,
              color: CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {message || 'The portfolio analytics could not be displayed.'}
          </div>

          {typeof onRetry === 'function' ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginTop: 14,
                border: `1px solid ${CSS.borderStrong}`,
                borderRadius: 8,
                background: CSS.surface,
                color: CSS.textPrimary,
                padding: '8px 12px',
                cursor: 'pointer',
                fontWeight: 700,
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
            fontWeight: 750,
          }}
        >
          No loan portfolio data
        </div>

        <div
          style={{
            marginTop: 6,
            maxWidth: 520,
            color: CSS.textSecondary,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message || 'Portfolio analytics will appear when loan data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Component
 * ========================================================================== */

function LoanPortfolioChartComponent({
  data = null,
  loans = null,

  title = 'Loan Portfolio',
  description = 'Portfolio position, funding activity and lifecycle-state analytics.',
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,

  height = DEFAULT_HEIGHT,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showTrend = true,
  showStatusBreakdown = true,

  emptyMessage =
    'No loan portfolio records are available for the selected scope and period.',

  className = '',
  style = {},
  ariaLabel = null,

  statusBreakdownHeight = 260,

  /**
   * Controls the initial visual focus.
   * Supported values: "trend", "status".
   */
  initialView = 'trend',

  /**
   * Optional controlled view.
   */
  view,
  onViewChange,
}) {
  const chartId = useId();

  const normalized = useMemo(
    () =>
      normalizeLoanPortfolioData(
        loans !== null
          ? {
              ...(
                data && typeof data === 'object'
                  ? data
                  : {}
              ),
              loans,
            }
          : data,
        {
          locale,
        },
      ),
    [data, loans, locale],
  );

  const [internalView, setInternalView] = useState(
    initialView === 'status' ? 'status' : 'trend',
  );

  const currentView =
    view === 'status' || view === 'trend'
      ? view
      : internalView;

  const changeView = (nextView) => {
    if (nextView !== 'trend' && nextView !== 'status') {
      return;
    }

    if (typeof onViewChange === 'function') {
      onViewChange(nextView);
    }

    if (view === undefined) {
      setInternalView(nextView);
    }
  };

  const summary = normalized.summary;

  const summaryMetrics = useMemo(() => {
    const portfolioAtRiskRate = Math.max(
      0,
      parseLoanNumber(summary.parRate),
    );

    return [
      {
        key: 'total-loans',
        label: 'Total Loans',
        value: formatCount(
          summary.totalLoanCount,
          locale,
        ),
        helper: 'Loan records in the selected scope',
        tone: 'neutral',
      },
      {
        key: 'outstanding',
        label: 'Outstanding Principal',
        value: formatLoanAmount(
          summary.outstandingPrincipal,
          currency,
          locale,
        ),
        helper: 'Supplied portfolio position',
        tone: 'info',
      },
      {
        key: 'active',
        label: 'Active Loans',
        value: formatCount(
          summary.activeLoanCount,
          locale,
        ),
        helper: 'Currently active lifecycle state',
        tone: 'success',
      },
      {
        key: 'overdue',
        label: 'Overdue Amount',
        value: formatLoanAmount(
          summary.overdueAmount,
          currency,
          locale,
        ),
        helper: `${formatCount(
          summary.overdueLoanCount,
          locale,
        )} overdue loan(s)`,
        tone: 'warning',
      },
      {
        key: 'defaulted',
        label: 'Defaulted Amount',
        value: formatLoanAmount(
          summary.defaultedAmount,
          currency,
          locale,
        ),
        helper: `${formatCount(
          summary.defaultedLoanCount,
          locale,
        )} defaulted loan(s)`,
        tone: 'danger',
      },
      {
        key: 'par-rate',
        label: 'Risk Signal Rate',
        value: formatLoanPercent(
          portfolioAtRiskRate,
          locale,
        ),
        helper:
          'Presentation ratio from supplied overdue/defaulted data',
        tone: portfolioAtRiskRate > 0 ? 'warning' : 'success',
      },
    ];
  }, [
    currency,
    locale,
    summary.activeLoanCount,
    summary.defaultedAmount,
    summary.defaultedLoanCount,
    summary.overdueAmount,
    summary.overdueLoanCount,
    summary.outstandingPrincipal,
    summary.parRate,
    summary.totalLoanCount,
  ]);

  const hasAnyData =
    normalized.hasTrend
    || normalized.hasStatusData
    || normalized.loans.length > 0;

  const canShowTrend =
    showTrend && normalized.hasTrend;

  const canShowStatus =
    showStatusBreakdown && normalized.hasStatusData;

  const statusChartData = useMemo(
    () =>
      normalized.statuses.map((entry) => ({
        ...entry,
        label: formatLoanStatus(entry.status),
      })),
    [normalized.statuses],
  );

  const headingId = `loan-portfolio-heading-${chartId.replace(/:/g, '')}`;

  const chartDescription =
    ariaLabel
    || `${title}. ${description}`;

  return (
    <section
      className={className}
      aria-labelledby={headingId}
      aria-label={chartDescription}
      style={{
        minWidth: 0,
        border: `1px solid ${CSS.border}`,
        borderRadius: 16,
        background: CSS.surface,
        boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${CSS.border}`,
        }}
      >
        <div
          style={{
            minWidth: 0,
            flex: '1 1 320px',
          }}
        >
          <div
            style={{
              color: CSS.textPrimary,
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.25,
            }}
            id={headingId}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 6,
              color: CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
              maxWidth: 760,
            }}
          >
            {description}
          </div>

          <div
            style={{
              marginTop: 9,
              color: CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            Financial values and loan states are displayed from the supplied
            authoritative dataset; this chart does not alter financial state.
          </div>
        </div>

        <div
          role="group"
          aria-label="Loan portfolio chart view"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            border: `1px solid ${CSS.border}`,
            borderRadius: 9,
            background: CSS.surfaceMuted,
            padding: 3,
          }}
        >
          {canShowTrend ? (
            <button
              type="button"
              aria-pressed={currentView === 'trend'}
              onClick={() => changeView('trend')}
              style={{
                border: 0,
                borderRadius: 7,
                background:
                  currentView === 'trend'
                    ? CSS.surface
                    : 'transparent',
                color:
                  currentView === 'trend'
                    ? CSS.textPrimary
                    : CSS.textSecondary,
                boxShadow:
                  currentView === 'trend'
                    ? '0 1px 3px rgba(0,0,0,0.08)'
                    : 'none',
                padding: '7px 10px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Trend
            </button>
          ) : null}

          {canShowStatus ? (
            <button
              type="button"
              aria-pressed={currentView === 'status'}
              onClick={() => changeView('status')}
              style={{
                border: 0,
                borderRadius: 7,
                background:
                  currentView === 'status'
                    ? CSS.surface
                    : 'transparent',
                color:
                  currentView === 'status'
                    ? CSS.textPrimary
                    : CSS.textSecondary,
                boxShadow:
                  currentView === 'status'
                    ? '0 1px 3px rgba(0,0,0,0.08)'
                    : 'none',
                padding: '7px 10px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Status
            </button>
          ) : null}
        </div>
      </div>

      {/* Summary */}
      {showSummary && !loading && !error && hasAnyData ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(155px, 1fr))',
            gap: 10,
            padding: 14,
            background: CSS.surfaceMuted,
            borderBottom: `1px solid ${CSS.border}`,
          }}
        >
          {summaryMetrics.map((metric) => (
            <MetricCard
              key={metric.key}
              label={metric.label}
              value={metric.value}
              helper={metric.helper}
              tone={metric.tone}
            />
          ))}
        </div>
      ) : null}

      {/* Body */}
      {loading ? (
        <StatePanel type="loading" />
      ) : error ? (
        <StatePanel
          type="error"
          message={
            typeof error === 'string'
              ? error
              : error?.message
          }
          onRetry={onRetry}
        />
      ) : !hasAnyData ? (
        <StatePanel
          type="empty"
          message={emptyMessage}
        />
      ) : (
        <div
          style={{
            padding: 14,
          }}
        >
          {/* Trend view */}
          {currentView === 'trend' && canShowTrend ? (
            <div
              role="img"
              aria-label={`${title} trend showing outstanding, disbursed, overdue and defaulted amounts over time`}
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
                  data={normalized.trend}
                  margin={{
                    top: 12,
                    right: 18,
                    left: 8,
                    bottom: 8,
                  }}
                >
                  <defs>
                    <linearGradient
                      id={`${chartId}-outstanding-fill`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={CSS.chart1}
                        stopOpacity={0.26}
                      />
                      <stop
                        offset="100%"
                        stopColor={CSS.chart1}
                        stopOpacity={0.03}
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    stroke={CSS.border}
                    strokeDasharray="3 4"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="label"
                    tick={{
                      fill: CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={false}
                    axisLine={{
                      stroke: CSS.border,
                    }}
                    minTickGap={22}
                  />

                  <YAxis
                    yAxisId="amount"
                    tick={{
                      fill: CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      formatLoanAmount(
                        value,
                        currency,
                        locale,
                      )
                    }
                    width={90}
                  />

                  <Tooltip
                    cursor={{
                      stroke: CSS.borderStrong,
                      strokeDasharray: '4 4',
                    }}
                    content={
                      <LoanPortfolioTooltip
                        currency={currency}
                        locale={locale}
                      />
                    }
                  />

                  <Area
                    type="monotone"
                    dataKey="outstandingAmount"
                    name="Outstanding Principal"
                    yAxisId="amount"
                    stroke={CSS.chart1}
                    fill={`url(#${chartId}-outstanding-fill)`}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{
                      r: 4,
                    }}
                    isAnimationActive
                    animationDuration={650}
                  />

                  <Line
                    type="monotone"
                    dataKey="disbursedAmount"
                    name="Disbursed"
                    yAxisId="amount"
                    stroke={CSS.chart2}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{
                      r: 4,
                    }}
                    isAnimationActive
                    animationDuration={650}
                  />

                  <Line
                    type="monotone"
                    dataKey="overdueAmount"
                    name="Overdue"
                    yAxisId="amount"
                    stroke={CSS.chart3}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{
                      r: 4,
                    }}
                    isAnimationActive
                    animationDuration={650}
                  />

                  <Line
                    type="monotone"
                    dataKey="defaultedAmount"
                    name="Defaulted"
                    yAxisId="amount"
                    stroke={CSS.chart4}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{
                      r: 4,
                    }}
                    isAnimationActive
                    animationDuration={650}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* Status view */}
          {currentView === 'status' && canShowStatus ? (
            <div
              role="img"
              aria-label={`${title} status distribution showing loan counts and amounts by lifecycle state`}
              style={{
                width: '100%',
                height: statusBreakdownHeight,
                minHeight: 240,
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <ComposedChart
                  data={statusChartData}
                  layout="vertical"
                  margin={{
                    top: 8,
                    right: 20,
                    left: 10,
                    bottom: 8,
                  }}
                >
                  <CartesianGrid
                    stroke={CSS.border}
                    strokeDasharray="3 4"
                    horizontal={false}
                  />

                  <XAxis
                    type="number"
                    tick={{
                      fill: CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={false}
                    axisLine={{
                      stroke: CSS.border,
                    }}
                    tickFormatter={(value) =>
                      formatLoanAmount(
                        value,
                        currency,
                        locale,
                      )
                    }
                  />

                  <YAxis
                    type="category"
                    dataKey="label"
                    width={122}
                    tick={{
                      fill: CSS.textSecondary,
                      fontSize: 11,
                    }}
                    tickLine={false}
                    axisLine={false}
                  />

                  <Tooltip
                    cursor={{
                      fill: CSS.primarySoft,
                    }}
                    content={
                      <LoanPortfolioTooltip
                        currency={currency}
                        locale={locale}
                      />
                    }
                  />

                  <Bar
                    dataKey="amount"
                    name="Loan Amount"
                    fill={CSS.chart1}
                    radius={[0, 6, 6, 0]}
                    barSize={22}
                    isAnimationActive
                    animationDuration={600}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* Supplementary status list */}
          {showStatusBreakdown && normalized.hasStatusData ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 8,
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${CSS.border}`,
              }}
            >
              {normalized.statuses.map((entry) => (
                <div
                  key={entry.status}
                  style={{
                    display: 'grid',
                    gap: 8,
                    minWidth: 0,
                    border: `1px solid ${CSS.border}`,
                    borderRadius: 10,
                    padding: 10,
                    background: CSS.surfaceMuted,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <StatusBadge status={entry.status} />

                    <span
                      style={{
                        color: CSS.textPrimary,
                        fontSize: 12,
                        fontWeight: 750,
                      }}
                    >
                      {formatCount(
                        entry.count,
                        locale,
                      )}
                    </span>
                  </div>

                  <div
                    style={{
                      color: CSS.textPrimary,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {formatLoanAmount(
                      entry.outstandingAmount || entry.amount,
                      currency,
                      locale,
                    )}
                  </div>

                  <div
                    style={{
                      color: CSS.textSecondary,
                      fontSize: 11,
                    }}
                  >
                    Displayed portfolio amount
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Data provenance / scope note */}
          <div
            style={{
              marginTop: 14,
              color: CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            Analytics shown here are derived from the dataset supplied to the
            frontend. Authoritative loan status, repayment, ledger, settlement
            and reconciliation state remains server-side.
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Public component
 * ========================================================================== */

export const LoanPortfolioChart = memo(
  LoanPortfolioChartComponent,
);

LoanPortfolioChart.displayName = 'LoanPortfolioChart';

export default LoanPortfolioChart;