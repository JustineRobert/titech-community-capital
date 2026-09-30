'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/CashFlowChart.jsx
 *
 * Purpose:
 *   Enterprise production-grade cash-flow analytics chart for TITech.
 *
 * Design principles:
 *   - Presentation layer only.
 *   - Backend / ledger remains authoritative for all financial values.
 *   - Never treats provider acceptance, queued state, offline state or
 *     pending state as settlement.
 *   - Never mutates financial state.
 *   - Supports heterogeneous API response envelopes.
 *   - Handles Decimal128-like serialized values safely for display.
 *   - Preserves explicit server-provided net cash flow where available.
 *   - Derives net cash flow only when the API does not provide it.
 *   - Accessible loading, empty and error states.
 *   - Responsive on desktop, tablet and mobile.
 *   - Uses TITech theme variables with safe fallbacks.
 *
 * Supported records:
 *
 *   {
 *     date: '2026-09-01',
 *     inflow: 1250000,
 *     outflow: 450000,
 *     net: 800000,
 *   }
 *
 * Common API aliases supported:
 *   inflow / inflows / cashIn / cashInflow / income / credits / receipts
 *   outflow / outflows / cashOut / cashOutflow / expenses / debits / payments
 *   net / netCashFlow / netFlow / cashFlow / netAmount
 *   date / period / timestamp / createdAt / transactionDate / postedAt
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { cashFlow: [] }
 *   { cashFlows: [] }
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
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME = 'TITechCashFlowChart';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_HEIGHT = 360;

const DEFAULT_MIN_HEIGHT = 260;

const DEFAULT_MARGIN = {
  top: 18,
  right: 20,
  left: 8,
  bottom: 8,
};

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const PRECISION_WARNING_THRESHOLD = 9_000_000_000_000_000;

const DEFAULT_TITLE = 'Cash Flow';

const DEFAULT_DESCRIPTION =
  'Cash inflows, cash outflows and net cash flow over time.';

const DEFAULT_EMPTY_MESSAGE =
  'No cash-flow data is available for the selected period.';

/* ============================================================================
 * Numeric helpers
 * ========================================================================== */

function isFiniteNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

/**
 * Converts API-friendly financial representations to a JavaScript number
 * strictly for presentation.
 *
 * Backend financial calculations should remain Decimal128/decimal-based.
 */
function toDisplayNumber(value) {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 0;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(
      value,
      '$numberDecimal',
    )
  ) {
    return toDisplayNumber(value.$numberDecimal);
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/,/g, '')
      .trim();

    if (!normalized) {
      return 0;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.toString === 'function'
  ) {
    const serialized = value.toString();

    if (
      serialized &&
      serialized !== '[object Object]'
    ) {
      const parsed = Number(
        serialized.replace(/,/g, '').trim(),
      );

      return Number.isFinite(parsed)
        ? parsed
        : 0;
    }
  }

  return 0;
}

/**
 * Prevents unsafe integer magnitudes from being represented beyond the
 * JavaScript Number safety boundary.
 *
 * This is not a financial rounding mechanism.
 */
function clampDisplayNumber(value) {
  const number = toDisplayNumber(value);

  if (Math.abs(number) <= MAX_SAFE_INTEGER) {
    return number;
  }

  return number < 0
    ? -MAX_SAFE_INTEGER
    : MAX_SAFE_INTEGER;
}

function hasValue(value) {
  return (
    value !== undefined &&
    value !== null &&
    value !== ''
  );
}

/**
 * Reads the first available alias without imposing an API schema.
 */
function firstDefined(object, keys) {
  if (!object || typeof object !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(object, key) &&
      hasValue(object[key])
    ) {
      return object[key];
    }
  }

  return undefined;
}

/* ============================================================================
 * Date helpers
 * ========================================================================== */

function parseDate(value) {
  if (!hasValue(value)) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function formatDateLabel(
  value,
  locale = DEFAULT_LOCALE,
) {
  if (!hasValue(value)) {
    return '';
  }

  const date = parseDate(value);

  if (!date) {
    return String(value);
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return String(value);
  }
}

function formatAxisDate(
  value,
  locale = DEFAULT_LOCALE,
) {
  if (!hasValue(value)) {
    return '';
  }

  const date = parseDate(value);

  if (!date) {
    const text = String(value);

    return text.length > 16
      ? `${text.slice(0, 16)}…`
      : text;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
    }).format(date);
  } catch {
    return String(value);
  }
}

/* ============================================================================
 * Currency / number formatting
 * ========================================================================== */

function formatCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const number = clampDisplayNumber(value);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(number);
  } catch {
    return `${currency} ${Math.round(number).toLocaleString(
      locale,
    )}`;
  }
}

function formatCompactCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const number = clampDisplayNumber(value);
  const absolute = Math.abs(number);

  let maximumFractionDigits = 0;

  if (absolute >= 1_000_000_000) {
    maximumFractionDigits = 1;
  } else if (absolute >= 1_000_000) {
    maximumFractionDigits = 1;
  } else if (absolute >= 1_000) {
    maximumFractionDigits = 0;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits,
    }).format(number);
  } catch {
    return formatCurrency(
      number,
      currency,
      locale,
    );
  }
}

/* ============================================================================
 * Data extraction / normalization
 * ========================================================================== */

function extractRecords(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const envelopes = [
    data.data,
    data.items,
    data.results,
    data.cashFlow,
    data.cashFlows,
    data.series,
  ];

  for (const candidate of envelopes) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeCashFlowRecord(
  record,
  index,
  locale,
) {
  const source =
    record && typeof record === 'object'
      ? record
      : {};

  const rawDate = firstDefined(source, [
    'date',
    'period',
    'timestamp',
    'createdAt',
    'transactionDate',
    'postedAt',
    'label',
    'name',
  ]);

  const rawInflow = firstDefined(source, [
    'inflow',
    'inflows',
    'cashIn',
    'cashInflow',
    'income',
    'credits',
    'credit',
    'receipts',
    'receiptsAmount',
    'totalInflow',
  ]);

  const rawOutflow = firstDefined(source, [
    'outflow',
    'outflows',
    'cashOut',
    'cashOutflow',
    'expenses',
    'debits',
    'debit',
    'payments',
    'paymentAmount',
    'totalOutflow',
  ]);

  const rawNet = firstDefined(source, [
    'net',
    'netCashFlow',
    'netFlow',
    'cashFlow',
    'netAmount',
  ]);

  const inflow = Math.max(
    0,
    clampDisplayNumber(rawInflow),
  );

  const outflow = Math.max(
    0,
    clampDisplayNumber(rawOutflow),
  );

  const hasExplicitNet = hasValue(rawNet);

  const net = hasExplicitNet
    ? clampDisplayNumber(rawNet)
    : inflow - outflow;

  const timestamp = hasValue(rawDate)
    ? String(rawDate)
    : '';

  const label = timestamp
    ? formatDateLabel(timestamp, locale)
    : `Period ${index + 1}`;

  return {
    id:
      source.id ??
      source._id ??
      source.key ??
      `${COMPONENT_NAME}-${index}-${timestamp || 'period'}`,

    timestamp,

    label,

    inflow,

    outflow,

    net,

    raw: record,
  };
}

function normalizeCashFlowData(
  data,
  locale = DEFAULT_LOCALE,
) {
  return extractRecords(data).map(
    (record, index) =>
      normalizeCashFlowRecord(
        record,
        index,
        locale,
      ),
  );
}

/* ============================================================================
 * Summary
 * ========================================================================== */

function summarizeCashFlow(data) {
  let totalInflow = 0;
  let totalOutflow = 0;
  let totalNet = 0;
  let peakInflow = 0;
  let peakOutflow = 0;

  let positivePeriods = 0;
  let negativePeriods = 0;
  let neutralPeriods = 0;

  data.forEach((item) => {
    totalInflow += clampDisplayNumber(item.inflow);
    totalOutflow += clampDisplayNumber(item.outflow);
    totalNet += clampDisplayNumber(item.net);

    peakInflow = Math.max(
      peakInflow,
      clampDisplayNumber(item.inflow),
    );

    peakOutflow = Math.max(
      peakOutflow,
      clampDisplayNumber(item.outflow),
    );

    if (item.net > 0) {
      positivePeriods += 1;
    } else if (item.net < 0) {
      negativePeriods += 1;
    } else {
      neutralPeriods += 1;
    }
  });

  return {
    totalInflow,
    totalOutflow,
    totalNet,
    peakInflow,
    peakOutflow,
    positivePeriods,
    negativePeriods,
    neutralPeriods,
    periods: data.length,
  };
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

const CashFlowTooltipContent = memo(
  function CashFlowTooltipContent({
    active,
    payload,
    label,
    currency,
    locale,
    showRawDate,
  }) {
    if (
      !active ||
      !Array.isArray(payload) ||
      payload.length === 0
    ) {
      return null;
    }

    const point = payload[0]?.payload ?? {};

    const inflow = clampDisplayNumber(
      point.inflow,
    );

    const outflow = clampDisplayNumber(
      point.outflow,
    );

    const net = clampDisplayNumber(point.net);

    return (
      <div
        role="dialog"
        aria-label={`Cash flow details for ${label || 'selected period'}`}
        style={{
          minWidth: 235,
          maxWidth: 320,
          border:
            '1px solid var(--titech-border, #e2e8f0)',
          borderRadius: 12,
          padding: 14,
          background:
            'var(--titech-surface, #ffffff)',
          color:
            'var(--titech-text-primary, #0f172a)',
          boxShadow:
            '0 14px 40px rgba(15, 23, 42, 0.14)',
        }}
      >
        <div
          style={{
            marginBottom: 8,
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {label || 'Cash flow'}
        </div>

        {showRawDate && point.timestamp ? (
          <div
            style={{
              marginBottom: 10,
              fontSize: 11,
              lineHeight: 1.4,
              opacity: 0.62,
              overflowWrap: 'anywhere',
            }}
          >
            {point.timestamp}
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gap: 8,
          }}
        >
          <TooltipRow
            label="Cash inflow"
            value={formatCurrency(
              inflow,
              currency,
              locale,
            )}
          />

          <TooltipRow
            label="Cash outflow"
            value={formatCurrency(
              outflow,
              currency,
              locale,
            )}
          />

          <div
            style={{
              borderTop:
                '1px solid var(--titech-border, #e2e8f0)',
              paddingTop: 8,
              marginTop: 2,
            }}
          >
            <TooltipRow
              label="Net cash flow"
              value={formatCurrency(
                net,
                currency,
                locale,
              )}
              strong
            />
          </div>
        </div>
      </div>
    );
  },
);

CashFlowTooltipContent.displayName =
  'CashFlowTooltipContent';

const TooltipRow = memo(
  function TooltipRow({
    label,
    value,
    strong = false,
  }) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          fontSize: 12,
          fontWeight: strong ? 800 : 500,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            textAlign: 'right',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      </div>
    );
  },
);

TooltipRow.displayName = 'TooltipRow';

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
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            opacity: 0.62,
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 17,
            lineHeight: 1.25,
            fontWeight: 800,
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </div>

        {helper ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              lineHeight: 1.4,
              opacity: 0.56,
            }}
          >
            {helper}
          </div>
        ) : null}
      </div>
    );
  },
);

SummaryMetric.displayName = 'SummaryMetric';

/* ============================================================================
 * Loading state
 * ========================================================================== */

function CashFlowLoadingState({
  title,
  description,
  height,
  className,
  style,
}) {
  return (
    <section
      className={className}
      aria-busy="true"
      aria-label={`${title} loading`}
      style={{
        width: '100%',
        minWidth: 0,
        ...style,
      }}
    >
      <div
        style={{
          width: '100%',
          border:
            '1px solid var(--titech-border, #e2e8f0)',
          borderRadius: 16,
          padding: 20,
          background:
            'var(--titech-surface, #ffffff)',
        }}
      >
        <div
          style={{
            width: '27%',
            height: 18,
            borderRadius: 6,
            background:
              'var(--titech-skeleton, #e2e8f0)',
            marginBottom: 10,
          }}
        />

        <div
          style={{
            width: '52%',
            height: 12,
            borderRadius: 6,
            background:
              'var(--titech-skeleton-muted, #f1f5f9)',
            marginBottom: 22,
          }}
        />

        <div
          style={{
            width: '100%',
            height: Math.max(
              height,
              DEFAULT_MIN_HEIGHT,
            ),
            borderRadius: 12,
            background:
              'linear-gradient(90deg, var(--titech-skeleton, #e2e8f0) 25%, var(--titech-skeleton-muted, #f8fafc) 50%, var(--titech-skeleton, #e2e8f0) 75%)',
            backgroundSize: '200% 100%',
            animation:
              'titech-cash-flow-skeleton 1.5s ease-in-out infinite',
          }}
        />

        <style>
          {`
            @keyframes titech-cash-flow-skeleton {
              0% {
                background-position: 200% 0;
              }

              100% {
                background-position: -200% 0;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .titech-cash-flow-skeleton,
              .titech-cash-flow-skeleton * {
                animation: none !important;
              }
            }
          `}
        </style>
      </div>
    </section>
  );
}

/* ============================================================================
 * Error state
 * ========================================================================== */

function CashFlowErrorState({
  title,
  error,
  onRetry,
  className,
  style,
}) {
  const message =
    typeof error === 'string'
      ? error
      : error?.message ||
        'An unexpected error occurred while loading cash-flow data.';

  return (
    <section
      className={className}
      role="alert"
      aria-label={`${title} error`}
      style={{
        width: '100%',
        minWidth: 0,
        ...style,
      }}
    >
      <div
        style={{
          border:
            '1px solid var(--titech-danger-border, #fecaca)',
          borderRadius: 16,
          padding: 20,
          background:
            'var(--titech-danger-surface, #fff7f7)',
          color:
            'var(--titech-text-primary, #0f172a)',
        }}
      >
        <div
          style={{
            marginBottom: 6,
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          Unable to load cash-flow data
        </div>

        <div
          style={{
            marginBottom:
              typeof onRetry === 'function'
                ? 14
                : 0,
            fontSize: 13,
            lineHeight: 1.55,
            opacity: 0.76,
            overflowWrap: 'anywhere',
          }}
        >
          {message}
        </div>

        {typeof onRetry === 'function' ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 38,
              border: 0,
              borderRadius: 8,
              padding: '8px 14px',
              cursor: 'pointer',
              background:
                'var(--titech-primary, #0f172a)',
              color:
                'var(--titech-on-primary, #ffffff)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Retry
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ============================================================================
 * Empty state
 * ========================================================================== */

function CashFlowEmptyState({
  title,
  description,
  emptyMessage,
  emptyAction,
  height,
  className,
  style,
}) {
  return (
    <section
      className={className}
      aria-label={`${title} empty state`}
      style={{
        width: '100%',
        minWidth: 0,
        ...style,
      }}
    >
      <div
        style={{
          border:
            '1px solid var(--titech-border, #e2e8f0)',
          borderRadius: 16,
          padding: 20,
          background:
            'var(--titech-surface, #ffffff)',
        }}
      >
        <header
          style={{
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              lineHeight: 1.3,
              fontWeight: 800,
            }}
          >
            {title}
          </h2>

          {description ? (
            <p
              style={{
                margin: '6px 0 0',
                maxWidth: 720,
                fontSize: 13,
                lineHeight: 1.55,
                opacity: 0.66,
              }}
            >
              {description}
            </p>
          ) : null}
        </header>

        <div
          style={{
            minHeight: Math.max(
              220,
              Math.min(height, 320),
            ),
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            border:
              '1px dashed var(--titech-border-strong, #cbd5e1)',
            borderRadius: 12,
            background:
              'var(--titech-surface-muted, #f8fafc)',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              aria-hidden="true"
              style={{
                marginBottom: 10,
                fontSize: 34,
                lineHeight: 1,
                opacity: 0.35,
              }}
            >
              ◌
            </div>

            <div
              style={{
                maxWidth: 440,
                fontSize: 13,
                lineHeight: 1.55,
                fontWeight: 650,
              }}
            >
              {emptyMessage}
            </div>

            {emptyAction ? (
              <div style={{ marginTop: 14 }}>
                {emptyAction}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
 * Main chart
 * ========================================================================== */

const CashFlowChart = memo(
  function CashFlowChart({
    data = [],

    title = DEFAULT_TITLE,

    description = DEFAULT_DESCRIPTION,

    currency = DEFAULT_CURRENCY,

    locale = DEFAULT_LOCALE,

    height = DEFAULT_HEIGHT,

    minHeight = DEFAULT_MIN_HEIGHT,

    loading = false,

    error = null,

    emptyMessage = DEFAULT_EMPTY_MESSAGE,

    emptyAction = null,

    onRetry = null,

    className = '',

    style,

    showSummary = true,

    showLegend = true,

    showGrid = true,

    showXAxis = true,

    showYAxis = true,

    showZeroLine = true,

    showRawDate = false,

    showFooter = true,

    animate = false,

    animationDuration = 600,

    ariaLabel = 'TITech cash flow chart',

    xAxisFormatter,

    yAxisFormatter,

    tooltipFormatter,
  }) {
    const normalizedData = useMemo(
      () =>
        normalizeCashFlowData(
          data,
          locale,
        ),
      [data, locale],
    );

    const summary = useMemo(
      () =>
        summarizeCashFlow(
          normalizedData,
        ),
      [normalizedData],
    );

    const precisionWarning = useMemo(
      () =>
        normalizedData.some(
          (item) =>
            Math.abs(item.inflow) >
              PRECISION_WARNING_THRESHOLD ||
            Math.abs(item.outflow) >
              PRECISION_WARNING_THRESHOLD ||
            Math.abs(item.net) >
              PRECISION_WARNING_THRESHOLD,
        ),
      [normalizedData],
    );

    const rootClassName = [
      'titech-cash-flow-chart',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const computedHeight = Math.max(
      Number.isFinite(Number(height))
        ? Number(height)
        : DEFAULT_HEIGHT,
      Number.isFinite(Number(minHeight))
        ? Number(minHeight)
        : DEFAULT_MIN_HEIGHT,
    );

    const formatXAxisTick = useCallback(
      (value) => {
        if (typeof xAxisFormatter === 'function') {
          return xAxisFormatter(
            value,
            locale,
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

    const formatYAxisTick = useCallback(
      (value) => {
        if (typeof yAxisFormatter === 'function') {
          return yAxisFormatter(
            value,
            currency,
            locale,
          );
        }

        return formatCompactCurrency(
          value,
          currency,
          locale,
        );
      },
      [
        yAxisFormatter,
        currency,
        locale,
      ],
    );

    const renderTooltipContent = useCallback(
      (props) => {
        if (
          typeof tooltipFormatter ===
          'function'
        ) {
          return tooltipFormatter({
            ...props,
            currency,
            locale,
          });
        }

        return (
          <CashFlowTooltipContent
            {...props}
            currency={currency}
            locale={locale}
            showRawDate={showRawDate}
          />
        );
      },
      [
        tooltipFormatter,
        currency,
        locale,
        showRawDate,
      ],
    );

    if (loading) {
      return (
        <CashFlowLoadingState
          title={title}
          description={description}
          height={computedHeight}
          className={rootClassName}
          style={style}
        />
      );
    }

    if (error) {
      return (
        <CashFlowErrorState
          title={title}
          error={error}
          onRetry={onRetry}
          className={rootClassName}
          style={style}
        />
      );
    }

    if (normalizedData.length === 0) {
      return (
        <CashFlowEmptyState
          title={title}
          description={description}
          emptyMessage={emptyMessage}
          emptyAction={emptyAction}
          height={computedHeight}
          className={rootClassName}
          style={style}
        />
      );
    }

    return (
      <section
        className={rootClassName}
        aria-label={ariaLabel}
        style={{
          width: '100%',
          minWidth: 0,
          ...style,
        }}
      >
        <div
          style={{
            width: '100%',
            minWidth: 0,
            border:
              '1px solid var(--titech-border, #e2e8f0)',
            borderRadius: 16,
            padding: 20,
            background:
              'var(--titech-surface, #ffffff)',
            color:
              'var(--titech-text-primary, #0f172a)',
          }}
        >
          {/* ----------------------------------------------------------------
              Header
              -------------------------------------------------------------- */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
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
                  letterSpacing: '-0.015em',
                }}
              >
                {title}
              </h2>

              {description ? (
                <p
                  style={{
                    margin: '6px 0 0',
                    maxWidth: 760,
                    fontSize: 13,
                    lineHeight: 1.55,
                    opacity: 0.66,
                  }}
                >
                  {description}
                </p>
              ) : null}
            </div>

            <div
              aria-label={`Reporting currency ${currency}`}
              style={{
                flexShrink: 0,
                border:
                  '1px solid var(--titech-border, #e2e8f0)',
                borderRadius: 8,
                padding: '6px 9px',
                fontSize: 10,
                lineHeight: 1.2,
                fontWeight: 800,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              {currency}
            </div>
          </header>

          {/* ----------------------------------------------------------------
              Summary metrics
              -------------------------------------------------------------- */}
          {showSummary ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(145px, 1fr))',
                gap: 12,
                marginBottom: 22,
              }}
            >
              <SummaryMetric
                label="Total inflow"
                value={formatCurrency(
                  summary.totalInflow,
                  currency,
                  locale,
                )}
                helper="Cash received / credited"
              />

              <SummaryMetric
                label="Total outflow"
                value={formatCurrency(
                  summary.totalOutflow,
                  currency,
                  locale,
                )}
                helper="Cash paid / debited"
              />

              <SummaryMetric
                label="Net cash flow"
                value={formatCurrency(
                  summary.totalNet,
                  currency,
                  locale,
                )}
                helper={
                  summary.totalNet >= 0
                    ? 'Aggregate positive movement'
                    : 'Aggregate negative movement'
                }
              />

              <SummaryMetric
                label="Peak inflow"
                value={formatCurrency(
                  summary.peakInflow,
                  currency,
                  locale,
                )}
                helper="Highest reporting period"
              />
            </div>
          ) : null}

          {/* ----------------------------------------------------------------
              Precision notice
              -------------------------------------------------------------- */}
          {precisionWarning ? (
            <div
              role="status"
              style={{
                marginBottom: 14,
                border:
                  '1px solid var(--titech-warning-border, #fde68a)',
                borderRadius: 9,
                padding: '9px 12px',
                background:
                  'var(--titech-warning-surface, #fffbeb)',
                color:
                  'var(--titech-warning-text, #92400e)',
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              One or more displayed amounts exceed
              JavaScript&apos;s exact integer precision
              range. The chart is for visualization only;
              authoritative financial amounts remain
              server-side.
            </div>
          ) : null}

          {/* ----------------------------------------------------------------
              Chart
              -------------------------------------------------------------- */}
          <div
            role="img"
            aria-label={`${title}. ${description}`}
            style={{
              width: '100%',
              minWidth: 0,
              height: computedHeight,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={minHeight}
            >
              <AreaChart
                data={normalizedData}
                margin={DEFAULT_MARGIN}
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
                      formatXAxisTick
                    }
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                    dy={8}
                    tick={{
                      fontSize: 11,
                      fill:
                        'var(--titech-chart-axis, #64748b)',
                    }}
                  />
                ) : null}

                {showYAxis ? (
                  <YAxis
                    tickFormatter={
                      formatYAxisTick
                    }
                    tickLine={false}
                    axisLine={false}
                    width={88}
                    tick={{
                      fontSize: 11,
                      fill:
                        'var(--titech-chart-axis, #64748b)',
                    }}
                  />
                ) : null}

                <Tooltip
                  content={
                    renderTooltipContent
                  }
                  cursor={{
                    stroke:
                      'var(--titech-chart-cursor, #94a3b8)',
                    strokeDasharray:
                      '4 4',
                  }}
                />

                {showLegend ? (
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={34}
                    iconType="circle"
                    wrapperStyle={{
                      fontSize: 12,
                      color:
                        'var(--titech-chart-legend, #475569)',
                    }}
                  />
                ) : null}

                {showZeroLine ? (
                  <ReferenceLine
                    y={0}
                    stroke="var(--titech-chart-zero, #94a3b8)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                  />
                ) : null}

                {/* ------------------------------------------------------------
                    Inflow
                    ---------------------------------------------------------- */}
                <Area
                  type="monotone"
                  dataKey="inflow"
                  name="Cash inflow"
                  stroke="var(--titech-chart-inflow, #0f766e)"
                  fill="var(--titech-chart-inflow-fill, #0f766e)"
                  fillOpacity={0.11}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={animate}
                  animationDuration={
                    animationDuration
                  }
                />

                {/* ------------------------------------------------------------
                    Outflow
                    ---------------------------------------------------------- */}
                <Area
                  type="monotone"
                  dataKey="outflow"
                  name="Cash outflow"
                  stroke="var(--titech-chart-outflow, #b45309)"
                  fill="var(--titech-chart-outflow-fill, #b45309)"
                  fillOpacity={0.08}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={animate}
                  animationDuration={
                    animationDuration
                  }
                />

                {/* ------------------------------------------------------------
                    Net cash flow
                    ---------------------------------------------------------- */}
                <Area
                  type="monotone"
                  dataKey="net"
                  name="Net cash flow"
                  stroke="var(--titech-chart-net, #2563eb)"
                  fill="var(--titech-chart-net-fill, #2563eb)"
                  fillOpacity={0.045}
                  strokeWidth={2.75}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={animate}
                  animationDuration={
                    animationDuration
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* ----------------------------------------------------------------
              Footer
              -------------------------------------------------------------- */}
          {showFooter ? (
            <footer
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                marginTop: 14,
                fontSize: 10,
                lineHeight: 1.4,
                opacity: 0.58,
              }}
            >
              <span>
                {summary.periods}{' '}
                reporting period
                {summary.periods === 1
                  ? ''
                  : 's'}
                {' · '}
                {summary.positivePeriods}{' '}
                positive
                {' · '}
                {summary.negativePeriods}{' '}
                negative
              </span>

              <span>
                TITech Community Capital · Financial
                analytics
              </span>
            </footer>
          ) : null}
        </div>

        {/* --------------------------------------------------------------
            Component-local responsive / accessibility behavior
            -------------------------------------------------------------- */}
        <style>
          {`
            .titech-cash-flow-chart,
            .titech-cash-flow-chart *,
            .titech-cash-flow-chart *::before,
            .titech-cash-flow-chart *::after {
              box-sizing: border-box;
            }

            .titech-cash-flow-chart {
              contain: layout paint;
            }

            .titech-cash-flow-chart button:focus-visible {
              outline: 3px solid
                var(--titech-focus-ring, #2563eb);
              outline-offset: 2px;
            }

            @media (max-width: 640px) {
              .titech-cash-flow-chart {
                font-size: 14px;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .titech-cash-flow-chart *,
              .titech-cash-flow-chart *::before,
              .titech-cash-flow-chart *::after {
                animation: none !important;
                transition: none !important;
                scroll-behavior: auto !important;
              }
            }

            @media print {
              .titech-cash-flow-chart {
                break-inside: avoid;
                page-break-inside: avoid;
              }

              .titech-cash-flow-chart button {
                display: none !important;
              }
            }
          `}
        </style>
      </section>
    );
  },
);

CashFlowChart.displayName = 'CashFlowChart';

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  CashFlowChart,
  CashFlowTooltipContent,
  formatCurrency,
  formatCompactCurrency,
  normalizeCashFlowData,
  normalizeCashFlowRecord,
  summarizeCashFlow,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default CashFlowChart;