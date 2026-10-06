'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/FraudAnalyticsChart.jsx
 *
 * Purpose:
 *   Enterprise-grade fraud and transaction-risk analytics visualization for
 *   TITech operational, financial and executive dashboards.
 *
 * Responsibilities:
 *   - Visualize flagged transaction activity over time.
 *   - Visualize blocked / prevented activity over time.
 *   - Visualize reviewed / confirmed fraud outcomes where supplied by the
 *     authoritative backend.
 *   - Visualize fraud / risk rates as analytical ratios.
 *   - Visualize risk-severity distribution.
 *   - Visualize potential exposure / affected amounts where supplied.
 *   - Support multi-tenant institutional analytics.
 *   - Normalize heterogeneous API response envelopes.
 *   - Support loading, empty and error states.
 *   - Provide accessible chart semantics and summaries.
 *   - Support Recharts composition without coupling the component to the
 *     surrounding application state.
 *
 * Important risk-integrity principle:
 *
 *   This component is PRESENTATION ONLY.
 *
 *   It does NOT:
 *     - decide whether a transaction is fraudulent;
 *     - approve, reject, block or release transactions;
 *     - mutate transaction state;
 *     - mutate balances, wallets or ledger entries;
 *     - create fraud cases;
 *     - determine customer identity;
 *     - calculate settlement;
 *     - infer fraud solely from a visual threshold;
 *     - treat pending / queued / offline / processing / UNKNOWN transactions
 *       as fraud;
 *     - treat provider rejection alone as confirmed fraud.
 *
 *   The authoritative fraud/risk engine, transaction state machine,
 *   investigation workflow, case management system and audit trail remain
 *   outside this component.
 *
 * Supported canonical trend record:
 *
 *   {
 *     date: '2026-09-01',
 *     totalTransactions: 1250,
 *     flaggedTransactions: 18,
 *     blockedTransactions: 9,
 *     confirmedFraudTransactions: 3,
 *     flaggedAmount: 4200000,
 *     blockedAmount: 1600000,
 *     confirmedFraudAmount: 700000,
 *     riskRate: 1.44
 *   }
 *
 * Supported severity record:
 *
 *   {
 *     severity: 'HIGH',
 *     count: 14,
 *     amount: 5200000
 *   }
 *
 * Supported aliases:
 *   totalTransactions / transactionCount / totalCount / transactions
 *   flaggedTransactions / flagged / alerts / alertsCount
 *   blockedTransactions / blocked / prevented / declinedForRisk
 *   confirmedFraudTransactions / confirmedFraud / confirmed / fraudCount
 *   flaggedAmount / flaggedValue / alertAmount / riskAmount
 *   blockedAmount / blockedValue / preventedAmount
 *   confirmedFraudAmount / confirmedFraudValue / fraudAmount
 *   riskRate / fraudRate / alertRate / flaggedRate
 *   date / period / timestamp / createdAt / reportingDate / label
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { trends: [] }
 *   { trend: [] }
 *   { fraudAnalytics: [] }
 *   { riskAnalytics: [] }
 *   { series: [] }
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useMemo,
} from 'react';

import {
  Bar,
  Cell,
  ComposedChart,
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
  'TITechFraudAnalyticsChart';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_HEIGHT = 390;

const DEFAULT_MIN_HEIGHT = 270;

const DEFAULT_TITLE =
  'Fraud & Risk Analytics';

const DEFAULT_DESCRIPTION =
  'Transaction-risk signals, prevention activity and confirmed outcomes over time.';

const DEFAULT_EMPTY_MESSAGE =
  'No fraud or transaction-risk analytics are available for the selected period.';

const DEFAULT_ERROR_MESSAGE =
  'Unable to load fraud and risk analytics.';

const DEFAULT_MAX_POINTS = 500;

const DEFAULT_BAR_SIZE = 22;

const DEFAULT_COLORS = {
  total: 'var(--titech-fraud-total, #64748b)',
  flagged: 'var(--titech-fraud-flagged, #b45309)',
  blocked: 'var(--titech-fraud-blocked, #7c3aed)',
  confirmed: 'var(--titech-fraud-confirmed, #b91c1c)',
  rate: 'var(--titech-fraud-rate, #2563eb)',
};

const SEVERITY_COLORS = {
  LOW: 'var(--titech-risk-low, #0f766e)',
  MEDIUM: 'var(--titech-risk-medium, #b45309)',
  HIGH: 'var(--titech-risk-high, #ea580c)',
  CRITICAL: 'var(--titech-risk-critical, #b91c1c)',
  UNKNOWN: 'var(--titech-risk-unknown, #64748b)',
};

const DEFAULT_MARGIN = {
  top: 16,
  right: 22,
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
    const normalized =
      value
        .replace(/,/g, '')
        .trim();

    if (!normalized) {
      return 0;
    }

    const parsed =
      Number(normalized);

    return Number.isFinite(
      parsed,
    )
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

function clampNonNegative(
  value,
) {
  return Math.max(
    0,
    toDisplayNumber(value),
  );
}

/* ============================================================================
 * Formatting helpers
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
    ).toLocaleString(
      locale,
    )}`;
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
  maximumFractionDigits = 2,
) {
  return `${toDisplayNumber(
    value,
  ).toFixed(
    maximumFractionDigits,
  )}%`;
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
 * Data extraction
 * ========================================================================== */

function extractTrendRecords(
  data,
) {
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
    data.trends,
    data.trend,
    data.fraudAnalytics,
    data.riskAnalytics,
    data.series,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function extractSeverityRecords(
  data,
) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!isObject(data)) {
    return [];
  }

  const candidates = [
    data.severity,
    data.severityDistribution,
    data.riskDistribution,
    data.breakdown,
    data.data,
    data.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

/* ============================================================================
 * Trend normalization
 * ========================================================================== */

function normalizeTrendRecord(
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
      'time',
      'createdAt',
      'reportingDate',
      'label',
    ]);

  const totalTransactions =
    clampNonNegative(
      firstDefined(source, [
        'totalTransactions',
        'transactionCount',
        'totalCount',
        'transactions',
        'volume',
      ]),
    );

  const flaggedTransactions =
    clampNonNegative(
      firstDefined(source, [
        'flaggedTransactions',
        'flagged',
        'alerts',
        'alertCount',
        'flaggedCount',
        'riskAlerts',
      ]),
    );

  const blockedTransactions =
    clampNonNegative(
      firstDefined(source, [
        'blockedTransactions',
        'blocked',
        'prevented',
        'preventedCount',
        'declinedForRisk',
        'blockedCount',
      ]),
    );

  const confirmedFraudTransactions =
    clampNonNegative(
      firstDefined(source, [
        'confirmedFraudTransactions',
        'confirmedFraud',
        'confirmed',
        'fraudCount',
        'confirmedCount',
      ]),
    );

  const flaggedAmount =
    clampNonNegative(
      firstDefined(source, [
        'flaggedAmount',
        'flaggedValue',
        'alertAmount',
        'riskAmount',
        'affectedAmount',
      ]),
    );

  const blockedAmount =
    clampNonNegative(
      firstDefined(source, [
        'blockedAmount',
        'blockedValue',
        'preventedAmount',
        'blockedTransactionAmount',
      ]),
    );

  const confirmedFraudAmount =
    clampNonNegative(
      firstDefined(source, [
        'confirmedFraudAmount',
        'confirmedFraudValue',
        'fraudAmount',
        'confirmedAmount',
      ]),
    );

  const explicitRiskRate =
    firstDefined(source, [
      'riskRate',
      'fraudRate',
      'alertRate',
      'flaggedRate',
    ]);

  /**
   * Only derive an analytical rate where the backend does not provide one.
   *
   * This ratio is not a fraud decision.
   */
  const riskRate = hasValue(
    explicitRiskRate,
  )
    ? toDisplayNumber(
        explicitRiskRate,
      )
    : totalTransactions >
        0
      ? (flaggedTransactions /
          totalTransactions) *
        100
      : 0;

  const timestamp = hasValue(
    rawDate,
  )
    ? String(rawDate)
    : '';

  return {
    id:
      source.id ??
      source._id ??
      source.key ??
      `fraud-trend-${index}`,

    timestamp,

    label: timestamp
      ? formatDateLabel(
          timestamp,
          locale,
        )
      : `Period ${index + 1}`,

    totalTransactions,

    flaggedTransactions,

    blockedTransactions,

    confirmedFraudTransactions,

    flaggedAmount,

    blockedAmount,

    confirmedFraudAmount,

    riskRate,

    status:
      source.status ??
      source.state ??
      null,

    tenantId:
      source.tenantId ??
      source.institutionId ??
      null,

    institutionId:
      source.institutionId ??
      null,

    groupId:
      source.groupId ??
      null,

    raw: record,
  };
}

function normalizeTrendData(
  data,
  locale = DEFAULT_LOCALE,
  maxPoints = DEFAULT_MAX_POINTS,
) {
  return extractTrendRecords(
    data,
  )
    .slice(
      0,
      Math.max(
        1,
        Number(maxPoints) ||
          DEFAULT_MAX_POINTS,
      ),
    )
    .map(
      (
        record,
        index,
      ) =>
        normalizeTrendRecord(
          record,
          index,
          locale,
        ),
    );
}

/* ============================================================================
 * Severity normalization
 * ========================================================================== */

function normalizeSeverityRecord(
  record,
  index,
) {
  const source =
    isObject(record)
      ? record
      : {};

  const rawSeverity =
    firstDefined(source, [
      'severity',
      'riskLevel',
      'risk',
      'level',
      'category',
      'label',
    ]) ??
    'UNKNOWN';

  const severity =
    String(
      rawSeverity,
    )
      .trim()
      .toUpperCase();

  const normalizedSeverity =
    Object.prototype.hasOwnProperty.call(
      SEVERITY_COLORS,
      severity,
    )
      ? severity
      : 'UNKNOWN';

  return {
    id:
      source.id ??
      source.key ??
      `severity-${index}`,

    severity:
      normalizedSeverity,

    label:
      source.label ??
      (
        normalizedSeverity ===
        'UNKNOWN'
          ? 'Unknown'
          : normalizedSeverity
              .charAt(0)
              .concat(
                normalizedSeverity
                  .slice(1)
                  .toLowerCase(),
              )
      ),

    count:
      clampNonNegative(
        firstDefined(
          source,
          [
            'count',
            'total',
            'value',
            'incidents',
            'transactions',
          ],
        ),
      ),

    amount:
      clampNonNegative(
        firstDefined(
          source,
          [
            'amount',
            'valueAmount',
            'exposure',
            'affectedAmount',
          ],
        ),
      ),

    color:
      source.color ??
      SEVERITY_COLORS[
        normalizedSeverity
      ],

    raw: record,
  };
}

function normalizeSeverityData(
  data,
) {
  return extractSeverityRecords(
    data,
  ).map(
    normalizeSeverityRecord,
  );
}

/* ============================================================================
 * Summary
 * ========================================================================== */

function summarizeTrendData(
  data,
) {
  const totals =
    data.reduce(
      (accumulator, item) => {
        accumulator.totalTransactions +=
          item.totalTransactions;

        accumulator.flaggedTransactions +=
          item.flaggedTransactions;

        accumulator.blockedTransactions +=
          item.blockedTransactions;

        accumulator.confirmedFraudTransactions +=
          item.confirmedFraudTransactions;

        accumulator.flaggedAmount +=
          item.flaggedAmount;

        accumulator.blockedAmount +=
          item.blockedAmount;

        accumulator.confirmedFraudAmount +=
          item.confirmedFraudAmount;

        return accumulator;
      },
      {
        totalTransactions: 0,
        flaggedTransactions: 0,
        blockedTransactions: 0,
        confirmedFraudTransactions: 0,
        flaggedAmount: 0,
        blockedAmount: 0,
        confirmedFraudAmount: 0,
      },
    );

  const aggregateRiskRate =
    totals.totalTransactions >
    0
      ? (totals.flaggedTransactions /
          totals.totalTransactions) *
        100
      : 0;

  const preventionRate =
    totals.flaggedTransactions >
    0
      ? (totals.blockedTransactions /
          totals.flaggedTransactions) *
        100
      : 0;

  const confirmationRate =
    totals.flaggedTransactions >
    0
      ? (totals.confirmedFraudTransactions /
          totals.flaggedTransactions) *
        100
      : 0;

  return {
    ...totals,
    aggregateRiskRate,
    preventionRate,
    confirmationRate,
    periods:
      data.length,
  };
}

function summarizeSeverityData(
  data,
) {
  const count =
    data.reduce(
      (sum, item) =>
        sum + item.count,
      0,
    );

  const amount =
    data.reduce(
      (sum, item) =>
        sum + item.amount,
      0,
    );

  const highest =
    data.reduce(
      (maximum, item) =>
        item.count >
        (maximum?.count ??
          0)
          ? item
          : maximum,
      null,
    );

  return {
    count,
    amount,
    highest,
  };
}

/* ============================================================================
 * Summary metric
 * ========================================================================== */

const SummaryMetric = memo(
  function SummaryMetric({
    label,
    value,
    helper,
    status = 'neutral',
  }) {
    return (
      <div
        className={classNames(
          'titech-fraud__summary-card',
          `titech-fraud__summary-card--${status}`,
        )}
      >
        <div className="titech-fraud__summary-label">
          {label}
        </div>

        <div className="titech-fraud__summary-value">
          {value}
        </div>

        {helper ? (
          <div className="titech-fraud__summary-helper">
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
 * Tooltip
 * ========================================================================== */

const FraudAnalyticsTooltip =
  memo(
    function FraudAnalyticsTooltip({
      active,
      payload,
      label,
      currency,
      locale,
      showAmounts,
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
          aria-label={`Fraud and risk analytics for ${label || 'selected period'}`}
          style={{
            minWidth: 250,
            maxWidth: 350,
            padding: 14,
            border:
              '1px solid var(--titech-border, #e2e8f0)',
            borderRadius: 12,
            background:
              'var(--titech-surface, var(--color-white))',
            color:
              'var(--titech-text-primary, #0f172a)',
            boxShadow:
              '0 14px 40px rgba(15, 23, 42, 0.14)',
          }}
        >
          <div
            style={{
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom:
                '1px solid var(--titech-border, #e2e8f0)',
              fontSize: 12,
              fontWeight: 850,
            }}
          >
            {label ||
              'Selected period'}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 8,
            }}
          >
            <TooltipRow
              label="Transactions"
              value={formatNumber(
                point.totalTransactions,
                {
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Flagged"
              value={formatNumber(
                point.flaggedTransactions,
                {
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Blocked / prevented"
              value={formatNumber(
                point.blockedTransactions,
                {
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Confirmed fraud"
              value={formatNumber(
                point.confirmedFraudTransactions,
                {
                  locale,
                },
              )}
            />

            <TooltipRow
              label="Risk signal rate"
              value={formatPercent(
                point.riskRate,
              )}
              emphasized
            />

            {showAmounts &&
            (point.flaggedAmount ||
              point.blockedAmount ||
              point.confirmedFraudAmount) ? (
              <>
                <div
                  style={{
                    marginTop: 2,
                    paddingTop: 8,
                    borderTop:
                      '1px solid var(--titech-border, #e2e8f0)',
                  }}
                />

                <TooltipRow
                  label="Flagged amount"
                  value={formatCurrency(
                    point.flaggedAmount,
                    {
                      currency,
                      locale,
                    },
                  )}
                />

                <TooltipRow
                  label="Blocked amount"
                  value={formatCurrency(
                    point.blockedAmount,
                    {
                      currency,
                      locale,
                    },
                  )}
                />

                <TooltipRow
                  label="Confirmed fraud amount"
                  value={formatCurrency(
                    point.confirmedFraudAmount,
                    {
                      currency,
                      locale,
                    },
                  )}
                />
              </>
            ) : null}
          </div>
        </div>
      );
    },
  );

FraudAnalyticsTooltip.displayName =
  'FraudAnalyticsTooltip';

const TooltipRow = memo(
  function TooltipRow({
    label,
    value,
    emphasized = false,
  }) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent:
            'space-between',
          gap: 14,
          fontSize: 10,
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
          style={{
            fontWeight:
              emphasized
                ? 850
                : 750,
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
 * State panel
 * ========================================================================== */

const StatePanel = memo(
  function StatePanel({
    type,
    title,
    message,
    action,
    height,
  }) {
    return (
      <div
        className={classNames(
          'titech-fraud__state',
          type ===
            'error' &&
            'titech-fraud__state--error',
        )}
        role={
          type ===
          'error'
            ? 'alert'
            : 'status'
        }
        style={{
          minHeight:
            Math.max(
              220,
              Number(height) ||
                DEFAULT_HEIGHT,
            ),
        }}
      >
        <div
          className="titech-fraud__state-icon"
          aria-hidden="true"
        >
          {type === 'loading'
            ? '…'
            : type ===
                'error'
              ? '!'
              : '◌'}
        </div>

        <div className="titech-fraud__state-title">
          {title}
        </div>

        <div className="titech-fraud__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-fraud__state-action">
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
 * Severity distribution
 * ========================================================================== */

const SeverityDistribution =
  memo(
    function SeverityDistribution({
      data,
      currency,
      locale,
      showAmounts,
      showPercentages,
    }) {
      const summary =
        useMemo(
          () =>
            summarizeSeverityData(
              data,
            ),
          [data],
        );

      return (
        <div
          className="titech-fraud__severity"
          aria-label="Risk severity distribution"
        >
          <div className="titech-fraud__severity-header">
            <div>
              <div className="titech-fraud__severity-title">
                Risk severity
              </div>

              <div className="titech-fraud__severity-description">
                Signals grouped by supplied
                risk severity.
              </div>
            </div>

            <div className="titech-fraud__severity-total">
              {formatNumber(
                summary.count,
                {
                  locale,
                },
              )}
            </div>
          </div>

          <div
            className="titech-fraud__severity-list"
            role="list"
          >
            {data.map(
              (item) => {
                const percentage =
                  summary.count >
                  0
                    ? (item.count /
                        summary.count) *
                      100
                    : 0;

                return (
                  <div
                    key={
                      item.id
                    }
                    className="titech-fraud__severity-item"
                    role="listitem"
                  >
                    <div className="titech-fraud__severity-row">
                      <span className="titech-fraud__severity-name">
                        <span
                          className="titech-fraud__severity-dot"
                          aria-hidden="true"
                          style={{
                            background:
                              item.color,
                          }}
                        />

                        {
                          item.label
                        }
                      </span>

                      <strong>
                        {formatNumber(
                          item.count,
                          {
                            locale,
                          },
                        )}
                      </strong>
                    </div>

                    <div className="titech-fraud__severity-bar">
                      <span
                        style={{
                          width: `${Math.min(
                            Math.max(
                              percentage,
                              0,
                            ),
                            100,
                          )}%`,
                          background:
                            item.color,
                        }}
                      />
                    </div>

                    <div className="titech-fraud__severity-meta">
                      {showPercentages
                        ? `${percentage.toFixed(1)}%`
                        : null}

                      {showAmounts &&
                      item.amount >
                        0 ? (
                        <>
                          <span>
                            ·
                          </span>

                          <span>
                            {formatCurrency(
                              item.amount,
                              {
                                currency,
                                locale,
                              },
                            )}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      );
    },
  );

SeverityDistribution.displayName =
  'SeverityDistribution';

/* ============================================================================
 * Main component
 * ========================================================================== */

const FraudAnalyticsChart =
  memo(
    function FraudAnalyticsChart({
      data = [],

      severityData = [],

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

      showSummary = true,

      showLegend = true,

      showGrid = true,

      showXAxis = true,

      showYAxis = true,

      showSecondaryAxis = true,

      showAmounts = true,

      showSeverity = true,

      showPercentages = true,

      showZeroLine = false,

      interactive = true,

      animate = false,

      animationDuration = 450,

      maxPoints =
        DEFAULT_MAX_POINTS,

      barSize =
        DEFAULT_BAR_SIZE,

      totalColor =
        DEFAULT_COLORS.total,

      flaggedColor =
        DEFAULT_COLORS.flagged,

      blockedColor =
        DEFAULT_COLORS.blocked,

      confirmedColor =
        DEFAULT_COLORS.confirmed,

      rateColor =
        DEFAULT_COLORS.rate,

      xAxisFormatter = null,

      yAxisFormatter = null,

      rateFormatter = null,

      tooltipFormatter = null,

      onPointClick = null,

      onSeriesClick = null,

      selectedSeries = null,

      className = '',

      style = undefined,

      bordered = true,

      elevated = false,

      compact = false,

      ariaLabel =
        'TITech fraud and transaction-risk analytics chart',

      testId = null,
    }) {
      const normalizedTrend =
        useMemo(
          () =>
            normalizeTrendData(
              data,
              locale,
              maxPoints,
            ),
          [
            data,
            locale,
            maxPoints,
          ],
        );

      const normalizedSeverity =
        useMemo(
          () =>
            normalizeSeverityData(
              severityData,
            ),
          [
            severityData,
          ],
        );

      const summary =
        useMemo(
          () =>
            summarizeTrendData(
              normalizedTrend,
            ),
          [
            normalizedTrend,
          ],
        );

      const resolvedHeight =
        useMemo(() => {
          const numeric =
            Number(height);

          if (
            !Number.isFinite(
              numeric,
            ) ||
            numeric <= 0
          ) {
            return DEFAULT_HEIGHT;
          }

          return Math.max(
            240,
            numeric,
          );
        }, [height]);

      const primaryYAxisFormatter =
        useCallback(
          (value) => {
            if (
              typeof yAxisFormatter ===
              'function'
            ) {
              return yAxisFormatter(
                value,
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

      const secondaryYAxisFormatter =
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

            return formatPercent(
              value,
              0,
            );
          },
          [rateFormatter],
        );

      const xTickFormatter =
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

      const selectedSeriesKey =
        selectedSeries ===
          null ||
        selectedSeries ===
          undefined
          ? null
          : String(
              selectedSeries,
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

            const point =
              state?.activePayload?.[0]
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

      const renderTooltip =
        useCallback(
          (props) => {
            if (
              typeof tooltipFormatter ===
              'function'
            ) {
              return tooltipFormatter({
                ...props,
                currency,
                locale,
                data:
                  normalizedTrend,
              });
            }

            return (
              <FraudAnalyticsTooltip
                {...props}
                currency={
                  currency
                }
                locale={
                  locale
                }
                showAmounts={
                  showAmounts
                }
              />
            );
          },
          [
            tooltipFormatter,
            currency,
            locale,
            normalizedTrend,
            showAmounts,
          ],
        );

      const rootClassName =
        classNames(
          'titech-fraud-analytics',
          bordered &&
            'titech-fraud-analytics--bordered',
          elevated &&
            'titech-fraud-analytics--elevated',
          compact &&
            'titech-fraud-analytics--compact',
          className,
        );

      if (
        loading
      ) {
        return (
          <section
            className={
              rootClassName
            }
            aria-busy="true"
            aria-label={`${title} loading`}
            style={style}
          >
            <div className="titech-fraud__frame">
              <div className="titech-fraud__loading">
                <span className="titech-fraud__loading-title" />

                <span className="titech-fraud__loading-description" />

                <div
                  className="titech-fraud__loading-chart"
                  style={{
                    minHeight:
                      resolvedHeight,
                  }}
                >
                  <div className="titech-fraud__loading-bars">
                    {Array.from(
                      {
                        length: 12,
                      },
                      (
                        _,
                        index,
                      ) => (
                        <span
                          key={
                            index
                          }
                          style={{
                            height: `${36 + ((index * 17) % 55)}%`,
                          }}
                        />
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <style>
              {getFraudStyles()}
            </style>
          </section>
        );
      }

      if (
        error
      ) {
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
            <div className="titech-fraud__frame">
              <ChartHeader
                title={
                  title
                }
                description={
                  description
                }
                currency={
                  currency
                }
              />

              <StatePanel
                type="error"
                title="Unable to load fraud analytics"
                message={
                  message
                }
                action={
                  typeof onRetry ===
                  'function' ? (
                    <button
                      type="button"
                      className="titech-fraud__retry"
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
              {getFraudStyles()}
            </style>
          </section>
        );
      }

      if (
        normalizedTrend.length ===
          0 &&
        normalizedSeverity.length ===
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
            <div className="titech-fraud__frame">
              <ChartHeader
                title={
                  title
                }
                description={
                  description
                }
                currency={
                  currency
                }
              />

              <StatePanel
                type="empty"
                title="No risk analytics available"
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
              {getFraudStyles()}
            </style>
          </section>
        );
      }

      const showTrendChart =
        normalizedTrend.length >
        0;

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
          <div className="titech-fraud__frame">
            <ChartHeader
              title={
                title
              }
              description={
                description
              }
              currency={
                currency
              }
            />

            {/* ----------------------------------------------------------
                Executive summary
                -------------------------------------------------------- */}
            {showSummary &&
            showTrendChart ? (
              <div
                className="titech-fraud__summary"
                role="list"
                aria-label="Fraud analytics summary"
              >
                <SummaryMetric
                  label="Risk signals"
                  value={formatNumber(
                    summary.flaggedTransactions,
                    {
                      locale,
                    },
                  )}
                  helper={`${formatPercent(summary.aggregateRiskRate)} of transactions`}
                  status={
                    summary.aggregateRiskRate >
                    5
                      ? 'negative'
                      : summary.aggregateRiskRate >
                          2
                        ? 'warning'
                        : 'neutral'
                  }
                />

                <SummaryMetric
                  label="Blocked / prevented"
                  value={formatNumber(
                    summary.blockedTransactions,
                    {
                      locale,
                    },
                  )}
                  helper={`${formatPercent(summary.preventionRate)} of flagged signals`}
                  status="positive"
                />

                <SummaryMetric
                  label="Confirmed outcomes"
                  value={formatNumber(
                    summary.confirmedFraudTransactions,
                    {
                      locale,
                    },
                  )}
                  helper={`${formatPercent(summary.confirmationRate)} of flagged signals`}
                  status={
                    summary.confirmedFraudTransactions >
                    0
                      ? 'negative'
                      : 'positive'
                  }
                />

                {showAmounts ? (
                  <SummaryMetric
                    label="Confirmed amount"
                    value={formatCurrency(
                      summary.confirmedFraudAmount,
                      {
                        currency,
                        locale,
                      },
                    )}
                    helper="Backend-supplied confirmed outcome amount"
                    status={
                      summary.confirmedFraudAmount >
                      0
                        ? 'negative'
                        : 'positive'
                    }
                  />
                ) : null}
              </div>
            ) : null}

            {/* ----------------------------------------------------------
                Trend chart
                -------------------------------------------------------- */}
            {showTrendChart ? (
              <div
                className="titech-fraud__chart"
                role="img"
                aria-label={`${title}. Risk signals, prevention activity and confirmed outcomes over time.`}
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
                  <ComposedChart
                    data={
                      normalizedTrend
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
                        vertical={
                          false
                        }
                        strokeDasharray="3 3"
                        stroke="var(--titech-chart-grid, #cbd5e1)"
                        opacity={
                          0.42
                        }
                      />
                    ) : null}

                    {showXAxis ? (
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={
                          xTickFormatter
                        }
                        tickLine={
                          false
                        }
                        axisLine={
                          false
                        }
                        minTickGap={
                          28
                        }
                        dy={
                          8
                        }
                        tick={{
                          fontSize: 10,
                          fill:
                            'var(--titech-chart-axis, #64748b)',
                        }}
                      />
                    ) : null}

                    {showYAxis ? (
                      <YAxis
                        yAxisId="primary"
                        tickFormatter={
                          primaryYAxisFormatter
                        }
                        tickLine={
                          false
                        }
                        axisLine={
                          false
                        }
                        width={
                          88
                        }
                        tick={{
                          fontSize: 10,
                          fill:
                            'var(--titech-chart-axis, #64748b)',
                        }}
                      />
                    ) : null}

                    {showSecondaryAxis ? (
                      <YAxis
                        yAxisId="rate"
                        orientation="right"
                        domain={[
                          0,
                          'auto',
                        ]}
                        tickFormatter={
                          secondaryYAxisFormatter
                        }
                        tickLine={
                          false
                        }
                        axisLine={
                          false
                        }
                        width={
                          58
                        }
                        tick={{
                          fontSize: 10,
                          fill:
                            'var(--titech-chart-axis, #64748b)',
                        }}
                      />
                    ) : null}

                    <Tooltip
                      content={
                        renderTooltip
                      }
                    />

                    {showLegend ? (
                      <Legend
                        verticalAlign="top"
                        align="right"
                        height={
                          38
                        }
                        iconType="circle"
                        wrapperStyle={{
                          fontSize: 10,
                          color:
                            'var(--titech-chart-legend, #475569)',
                        }}
                      />
                    ) : null}

                    {showZeroLine ? (
                      <ReferenceLine
                        y={
                          0
                        }
                        yAxisId="primary"
                        stroke="var(--titech-chart-zero, #94a3b8)"
                        strokeDasharray="4 4"
                        strokeOpacity={
                          0.65
                        }
                      />
                    ) : null}

                    {/* ------------------------------------------------------
                        Total transactions
                        ---------------------------------------------------- */}
                    <Bar
                      yAxisId="primary"
                      dataKey="totalTransactions"
                      name="Transactions"
                      fill={
                        totalColor
                      }
                      fillOpacity={
                        selectedSeriesKey &&
                        selectedSeriesKey !==
                          'totalTransactions'
                          ? 0.18
                          : 0.38
                      }
                      stroke={
                        totalColor
                      }
                      strokeWidth={
                        1
                      }
                      barSize={
                        barSize
                      }
                      radius={[
                        3,
                        3,
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
                      onClick={
                        interactive
                          ? () =>
                              onSeriesClick?.(
                                'totalTransactions',
                              )
                          : undefined
                      }
                    >
                      {normalizedTrend.map(
                        (
                          item,
                          index,
                        ) => (
                          <Cell
                            key={`total-${item.id}-${index}`}
                            fill={
                              totalColor
                            }
                          />
                        ),
                      )}
                    </Bar>

                    {/* ------------------------------------------------------
                        Flagged
                        ---------------------------------------------------- */}
                    <Bar
                      yAxisId="primary"
                      dataKey="flaggedTransactions"
                      name="Risk signals"
                      fill={
                        flaggedColor
                      }
                      fillOpacity={
                        selectedSeriesKey &&
                        selectedSeriesKey !==
                          'flaggedTransactions'
                          ? 0.18
                          : 0.82
                      }
                      stroke={
                        flaggedColor
                      }
                      strokeWidth={
                        1
                      }
                      barSize={
                        barSize
                      }
                      radius={[
                        3,
                        3,
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
                      onClick={
                        interactive
                          ? () =>
                              onSeriesClick?.(
                                'flaggedTransactions',
                              )
                          : undefined
                      }
                    >
                      {normalizedTrend.map(
                        (
                          item,
                          index,
                        ) => (
                          <Cell
                            key={`flagged-${item.id}-${index}`}
                            fill={
                              flaggedColor
                            }
                          />
                        ),
                      )}
                    </Bar>

                    {/* ------------------------------------------------------
                        Blocked
                        ---------------------------------------------------- */}
                    <Bar
                      yAxisId="primary"
                      dataKey="blockedTransactions"
                      name="Blocked / prevented"
                      fill={
                        blockedColor
                      }
                      fillOpacity={
                        selectedSeriesKey &&
                        selectedSeriesKey !==
                          'blockedTransactions'
                          ? 0.18
                          : 0.82
                      }
                      stroke={
                        blockedColor
                      }
                      strokeWidth={
                        1
                      }
                      barSize={
                        barSize
                      }
                      radius={[
                        3,
                        3,
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
                      onClick={
                        interactive
                          ? () =>
                              onSeriesClick?.(
                                'blockedTransactions',
                              )
                          : undefined
                      }
                    >
                      {normalizedTrend.map(
                        (
                          item,
                          index,
                        ) => (
                          <Cell
                            key={`blocked-${item.id}-${index}`}
                            fill={
                              blockedColor
                            }
                          />
                        ),
                      )}
                    </Bar>

                    {/* ------------------------------------------------------
                        Confirmed fraud
                        ---------------------------------------------------- */}
                    <Bar
                      yAxisId="primary"
                      dataKey="confirmedFraudTransactions"
                      name="Confirmed outcomes"
                      fill={
                        confirmedColor
                      }
                      fillOpacity={
                        selectedSeriesKey &&
                        selectedSeriesKey !==
                          'confirmedFraudTransactions'
                          ? 0.18
                          : 0.86
                      }
                      stroke={
                        confirmedColor
                      }
                      strokeWidth={
                        1
                      }
                      barSize={
                        barSize
                      }
                      radius={[
                        3,
                        3,
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
                      onClick={
                        interactive
                          ? () =>
                              onSeriesClick?.(
                                'confirmedFraudTransactions',
                              )
                          : undefined
                      }
                    >
                      {normalizedTrend.map(
                        (
                          item,
                          index,
                        ) => (
                          <Cell
                            key={`confirmed-${item.id}-${index}`}
                            fill={
                              confirmedColor
                            }
                          />
                        ),
                      )}
                    </Bar>

                    {/* ------------------------------------------------------
                        Risk signal rate
                        ---------------------------------------------------- */}
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="riskRate"
                      name="Risk signal rate"
                      stroke={
                        rateColor
                      }
                      strokeWidth={
                        2.7
                      }
                      strokeOpacity={
                        selectedSeriesKey &&
                        selectedSeriesKey !==
                          'riskRate'
                          ? 0.22
                          : 1
                      }
                      dot={{
                        r: 3,
                        strokeWidth:
                          1.5,
                      }}
                      activeDot={{
                        r: 5,
                        strokeWidth:
                          2,
                      }}
                      connectNulls
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
                      onClick={
                        interactive
                          ? () =>
                              onSeriesClick?.(
                                'riskRate',
                              )
                          : undefined
                      }
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            {/* ----------------------------------------------------------
                Severity distribution
                -------------------------------------------------------- */}
            {showSeverity &&
            normalizedSeverity.length >
              0 ? (
              <SeverityDistribution
                data={
                  normalizedSeverity
                }
                currency={
                  currency
                }
                locale={
                  locale
                }
                showAmounts={
                  showAmounts
                }
                showPercentages={
                  showPercentages
                }
              />
            ) : null}

            {/* ----------------------------------------------------------
                Analytical integrity note
                -------------------------------------------------------- */}
            <div className="titech-fraud__integrity-note">
              <strong>
                Risk analytics only:
              </strong>{' '}
              flagged, blocked and
              confirmed-outcome values are
              displayed according to the
              supplied backend data. Visual
              thresholds in this component do
              not constitute a fraud
              determination or transaction
              decision.
            </div>

            <footer className="titech-fraud__footer">
              <span>
                {summary.periods}{' '}
                reporting period
                {summary.periods ===
                1
                  ? ''
                  : 's'}
              </span>

              <span>
                TITech Community Capital · Risk analytics
              </span>
            </footer>
          </div>

          <style>
            {getFraudStyles()}
          </style>
        </section>
      );
    },
  );

FraudAnalyticsChart.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Header
 * ========================================================================== */

const ChartHeader = memo(
  function ChartHeader({
    title,
    description,
    currency,
  }) {
    return (
      <header className="titech-fraud__header">
        <div className="titech-fraud__header-main">
          <div className="titech-fraud__eyebrow">
            Fraud & risk analytics
          </div>

          <h2 className="titech-fraud__title">
            {title}
          </h2>

          {description ? (
            <p className="titech-fraud__description">
              {description}
            </p>
          ) : null}
        </div>

        {currency ? (
          <span
            className="titech-fraud__currency"
            aria-label={`Reporting currency ${currency}`}
          >
            {currency}
          </span>
        ) : null}
      </header>
    );
  },
);

ChartHeader.displayName =
  'ChartHeader';

/* ============================================================================
 * Styles
 * ========================================================================== */

function getFraudStyles() {
  return `
    .titech-fraud-analytics {
      --titech-fraud-surface:
        var(
          --titech-surface,
          var(--color-white)
        );

      --titech-fraud-surface-muted:
        var(
          --titech-surface-muted,
          #f8fafc
        );

      --titech-fraud-border:
        var(
          --titech-border,
          #e2e8f0
        );

      --titech-fraud-border-strong:
        var(
          --titech-border-strong,
          #cbd5e1
        );

      --titech-fraud-text:
        var(
          --titech-text-primary,
          #0f172a
        );

      --titech-fraud-text-muted:
        var(
          --titech-text-secondary,
          #64748b
        );

      --titech-fraud-primary:
        var(
          --titech-primary,
          #0f172a
        );

      --titech-fraud-focus:
        var(
          --titech-focus-ring,
          #2563eb
        );

      --titech-fraud-positive:
        var(
          --titech-success,
          #047857
        );

      --titech-fraud-warning:
        var(
          --titech-warning,
          #b45309
        );

      --titech-fraud-negative:
        var(
          --titech-danger,
          #b91c1c
        );

      width: 100%;
      min-width: 0;
      color:
        var(--titech-fraud-text);
      font: inherit;
    }

    .titech-fraud-analytics *,
    .titech-fraud-analytics
      *::before,
    .titech-fraud-analytics
      *::after {
      box-sizing:
        border-box;
    }

    .titech-fraud-analytics--bordered {
      border: 1px solid
        var(--titech-fraud-border);
      border-radius: 16px;
      background:
        var(--titech-fraud-surface);
    }

    .titech-fraud-analytics--elevated {
      box-shadow:
        0 12px 34px
        rgba(
          15,
          23,
          42,
          0.08
        );
    }

    .titech-fraud__frame {
      width: 100%;
      min-width: 0;
      padding: 18px;
    }

    /* ------------------------------------------------------------------------
       Header
       ---------------------------------------------------------------------- */

    .titech-fraud__header {
      display: flex;
      justify-content:
        space-between;
      align-items:
        flex-start;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }

    .titech-fraud__header-main {
      min-width: 0;
      flex: 1 1 auto;
    }

    .titech-fraud__eyebrow {
      margin-bottom: 4px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 9px;
      line-height: 1.25;
      font-weight: 850;
      letter-spacing:
        0.08em;
      text-transform:
        uppercase;
    }

    .titech-fraud__title {
      margin: 0;
      color:
        var(--titech-fraud-text);
      font-size: 18px;
      line-height: 1.3;
      font-weight: 900;
      letter-spacing:
        -0.015em;
    }

    .titech-fraud__description {
      max-width: 780px;
      margin: 5px 0 0;
      color:
        var(--titech-fraud-text-muted);
      font-size: 11px;
      line-height: 1.55;
    }

    .titech-fraud__currency {
      flex: 0 0 auto;
      padding: 6px 9px;
      border: 1px solid
        var(--titech-fraud-border);
      border-radius: 8px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 9px;
      line-height: 1.2;
      font-weight: 850;
      letter-spacing:
        0.06em;
      text-transform:
        uppercase;
    }

    /* ------------------------------------------------------------------------
       Summary
       ---------------------------------------------------------------------- */

    .titech-fraud__summary {
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

    .titech-fraud__summary-card {
      min-width: 0;
      min-height: 96px;
      padding: 12px;
      border: 1px solid
        var(--titech-fraud-border);
      border-radius: 10px;
      background:
        var(--titech-fraud-surface);
    }

    .titech-fraud__summary-card--positive {
      border-color:
        color-mix(
          in srgb,
          var(
            --titech-fraud-positive
          )
          25%,
          var(--titech-fraud-border)
        );
    }

    .titech-fraud__summary-card--warning {
      border-color:
        color-mix(
          in srgb,
          var(
            --titech-fraud-warning
          )
          25%,
          var(--titech-fraud-border)
        );
    }

    .titech-fraud__summary-card--negative {
      border-color:
        color-mix(
          in srgb,
          var(
            --titech-fraud-negative
          )
          28%,
          var(--titech-fraud-border)
        );
    }

    .titech-fraud__summary-label {
      margin-bottom: 5px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 9px;
      line-height: 1.25;
      font-weight: 850;
      text-transform:
        uppercase;
      letter-spacing:
        0.04em;
    }

    .titech-fraud__summary-value {
      color:
        var(--titech-fraud-text);
      font-size: 17px;
      line-height: 1.2;
      font-weight: 900;
      font-variant-numeric:
        tabular-nums;
      overflow-wrap:
        anywhere;
    }

    .titech-fraud__summary-helper {
      margin-top: 4px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 8px;
      line-height: 1.4;
    }

    /* ------------------------------------------------------------------------
       Chart
       ---------------------------------------------------------------------- */

    .titech-fraud__chart {
      width: 100%;
      min-width: 0;
    }

    .titech-fraud__chart
      .recharts-wrapper,
    .titech-fraud__chart
      .recharts-surface {
      outline: none;
    }

    /* ------------------------------------------------------------------------
       Severity
       ---------------------------------------------------------------------- */

    .titech-fraud__severity {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid
        var(--titech-fraud-border);
    }

    .titech-fraud__severity-header {
      display: flex;
      justify-content:
        space-between;
      align-items:
        flex-start;
      gap: 14px;
      margin-bottom: 12px;
    }

    .titech-fraud__severity-title {
      font-size: 13px;
      line-height: 1.3;
      font-weight: 850;
    }

    .titech-fraud__severity-description {
      margin-top: 3px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 9px;
      line-height: 1.45;
    }

    .titech-fraud__severity-total {
      flex: 0 0 auto;
      color:
        var(--titech-fraud-text-muted);
      font-size: 13px;
      font-weight: 850;
      font-variant-numeric:
        tabular-nums;
    }

    .titech-fraud__severity-list {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(
            180px,
            1fr
          )
        );
      gap: 11px;
    }

    .titech-fraud__severity-item {
      min-width: 0;
    }

    .titech-fraud__severity-row {
      display: flex;
      justify-content:
        space-between;
      align-items:
        center;
      gap: 10px;
      min-width: 0;
      color:
        var(--titech-fraud-text);
      font-size: 9px;
      line-height: 1.3;
    }

    .titech-fraud__severity-row strong {
      font-variant-numeric:
        tabular-nums;
    }

    .titech-fraud__severity-name {
      display: flex;
      align-items:
        center;
      min-width: 0;
      gap: 6px;
    }

    .titech-fraud__severity-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius:
        50%;
    }

    .titech-fraud__severity-bar {
      width: 100%;
      height: 5px;
      margin-top: 6px;
      overflow:
        hidden;
      border-radius:
        999px;
      background:
        var(
          --titech-fraud-border
        );
    }

    .titech-fraud__severity-bar span {
      display: block;
      height: 100%;
      border-radius:
        inherit;
    }

    .titech-fraud__severity-meta {
      display: flex;
      align-items:
        center;
      gap: 5px;
      margin-top: 4px;
      color:
        var(--titech-fraud-text-muted);
      font-size: 8px;
      line-height: 1.35;
      font-variant-numeric:
        tabular-nums;
    }

    /* ------------------------------------------------------------------------
       Integrity note
       ---------------------------------------------------------------------- */

    .titech-fraud__integrity-note {
      margin-top: 16px;
      padding: 9px 11px;
      border: 1px solid
        var(
          --titech-info-border,
          #bfdbfe
        );
      border-radius: 8px;
      background:
        var(
          --titech-info-surface,
          #eff6ff
        );
      color:
        var(
          --titech-info-text,
          #1e3a8a
        );
      font-size: 9px;
      line-height: 1.55;
    }

    /* ------------------------------------------------------------------------
       Footer
       ---------------------------------------------------------------------- */

    .titech-fraud__footer {
      display: flex;
      justify-content:
        space-between;
      align-items:
        center;
      gap: 12px;
      flex-wrap:
        wrap;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid
        var(--titech-fraud-border);
      color:
        var(--titech-fraud-text-muted);
      font-size: 8px;
      line-height: 1.45;
    }

    /* ------------------------------------------------------------------------
       States
       ---------------------------------------------------------------------- */

    .titech-fraud__state {
      display: grid;
      place-items:
        center;
      align-content:
        center;
      padding: 28px 22px;
      border: 1px dashed
        var(
          --titech-fraud-border-strong
        );
      border-radius: 12px;
      background:
        var(
          --titech-fraud-surface-muted
        );
      text-align:
        center;
    }

    .titech-fraud__state--error {
      border-style:
        solid;
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

    .titech-fraud__state-icon {
      display:
        grid;
      place-items:
        center;
      width: 46px;
      height: 46px;
      margin-bottom: 10px;
      border-radius:
        12px;
      background:
        var(
          --titech-fraud-surface
        );
      color:
        var(
          --titech-fraud-text-muted
        );
      font-size: 20px;
      font-weight:
        900;
    }

    .titech-fraud__state-title {
      margin-bottom: 5px;
      font-size: 13px;
      line-height: 1.35;
      font-weight:
        850;
    }

    .titech-fraud__state-message {
      max-width: 490px;
      color:
        var(
          --titech-fraud-text-muted
        );
      font-size: 10px;
      line-height: 1.55;
      overflow-wrap:
        anywhere;
    }

    .titech-fraud__state-action {
      margin-top:
        14px;
    }

    .titech-fraud__retry {
      min-height:
        37px;
      padding:
        7px 13px;
      border:
        1px solid
        var(
          --titech-fraud-primary
        );
      border-radius:
        8px;
      background:
        var(
          --titech-fraud-primary
        );
      color:
        var(--color-white);
      font: inherit;
      font-size:
        10px;
      font-weight:
        850;
      cursor:
        pointer;
    }

    .titech-fraud__retry:focus-visible {
      outline:
        3px solid
        var(
          --titech-fraud-focus
        );
      outline-offset:
        2px;
    }

    /* ------------------------------------------------------------------------
       Loading
       ---------------------------------------------------------------------- */

    .titech-fraud__loading {
      width:
        100%;
    }

    .titech-fraud__loading-title,
    .titech-fraud__loading-description {
      display:
        block;
      border-radius:
        5px;
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
      background-size:
        200% 100%;
      animation:
        titech-fraud-shimmer
        1.5s
        ease-in-out
        infinite;
    }

    .titech-fraud__loading-title {
      width: 30%;
      min-width:
        140px;
      height:
        17px;
      margin-bottom:
        8px;
    }

    .titech-fraud__loading-description {
      width: 55%;
      min-width:
        200px;
      height:
        10px;
      margin-bottom:
        18px;
    }

    .titech-fraud__loading-chart {
      position:
        relative;
      width:
        100%;
      overflow:
        hidden;
      border-radius:
        12px;
      background:
        var(
          --titech-fraud-surface-muted
        );
    }

    .titech-fraud__loading-bars {
      position:
        absolute;
      left:
        72px;
      right:
        18px;
      top:
        24px;
      bottom:
        34px;
      display:
        flex;
      align-items:
        flex-end;
      justify-content:
        space-between;
      gap:
        6px;
    }

    .titech-fraud__loading-bars
      span {
      display:
        block;
      width:
        100%;
      max-width:
        32px;
      min-width:
        4px;
      flex:
        1 1 0;
      border-radius:
        4px 4px 2px 2px;
      background:
        var(
          --titech-skeleton,
          #e2e8f0
        );
      opacity:
        0.62;
    }

    @keyframes titech-fraud-shimmer {
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
       Compact
       ---------------------------------------------------------------------- */

    .titech-fraud-analytics--compact
      .titech-fraud__frame {
      padding:
        14px;
    }

    .titech-fraud-analytics--compact
      .titech-fraud__summary-card {
      min-height:
        82px;
      padding:
        10px;
    }

    /* ------------------------------------------------------------------------
       Responsive
       ---------------------------------------------------------------------- */

    @media (max-width: 850px) {
      .titech-fraud__summary {
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
      .titech-fraud__frame {
        padding:
          14px;
      }

      .titech-fraud__header {
        flex-direction:
          column;
        align-items:
          stretch;
      }

      .titech-fraud__currency {
        align-self:
          flex-start;
      }

      .titech-fraud__summary {
        grid-template-columns:
          1fr;
      }

      .titech-fraud__severity-list {
        grid-template-columns:
          1fr;
      }

      .titech-fraud__footer {
        align-items:
          flex-start;
      }

      .titech-fraud__loading-bars {
        left:
          54px;
        right:
          14px;
      }

      .titech-fraud-analytics
        .recharts-legend-wrapper {
        position:
          static !important;
        width:
          100% !important;
        height:
          auto !important;
        margin-bottom:
          8px;
      }
    }

    /* ------------------------------------------------------------------------
       Reduced motion
       ---------------------------------------------------------------------- */

    @media (prefers-reduced-motion: reduce) {
      .titech-fraud-analytics *,
      .titech-fraud-analytics
        *::before,
      .titech-fraud-analytics
        *::after {
        animation:
          none !important;
        transition:
          none !important;
      }
    }

    /* ------------------------------------------------------------------------
       Print
       ---------------------------------------------------------------------- */

    @media print {
      .titech-fraud-analytics {
        break-inside:
          avoid;
        page-break-inside:
          avoid;
        box-shadow:
          none !important;
      }

      .titech-fraud__summary-card,
      .titech-fraud__severity {
        break-inside:
          avoid;
        page-break-inside:
          avoid;
      }
    }
  `;
}

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  FraudAnalyticsChart,
  FraudAnalyticsTooltip,
  SeverityDistribution,
  SummaryMetric,
  StatePanel,
  ChartHeader,
  normalizeTrendRecord,
  normalizeTrendData,
  normalizeSeverityRecord,
  normalizeSeverityData,
  summarizeTrendData,
  summarizeSeverityData,
  formatNumber,
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
  toDisplayNumber,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default FraudAnalyticsChart;