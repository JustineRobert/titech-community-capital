'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ExecutiveKPIChart.jsx
 *
 * Purpose:
 *   Enterprise executive KPI visualization for TITech dashboards,
 *   management reporting, institution analytics and operational oversight.
 *
 * Responsibilities:
 *   - Render one or more executive KPIs.
 *   - Display current value, target, variance and change.
 *   - Display optional KPI trend sparklines.
 *   - Support financial, operational, customer and platform KPIs.
 *   - Normalize common API response shapes and field aliases.
 *   - Support currency, number, percentage and duration values.
 *   - Support controlled selection of a KPI.
 *   - Support semantic status indicators.
 *   - Support loading, error and empty states.
 *   - Support responsive dashboard layouts.
 *   - Support custom formatting and custom KPI rendering.
 *   - Remain independent of business-domain state management.
 *
 * Financial integrity:
 *   - Presentation-only.
 *   - Does NOT mutate financial records.
 *   - Does NOT alter balances, journals, ledger entries or reconciliation.
 *   - Does NOT infer settlement.
 *   - Does NOT interpret provider acceptance, pending, queued, offline,
 *     processing or UNKNOWN states as settlement.
 *   - KPI calculations supplied by the backend remain authoritative.
 *   - Locally derived display ratios are analytical presentation values only.
 *
 * Typical data:
 *
 *   [
 *     {
 *       key: 'collections',
 *       label: 'Collections',
 *       value: 125000000,
 *       previousValue: 112000000,
 *       target: 135000000,
 *       valueType: 'currency',
 *       trend: [98, 101, 105, 110, 118, 125]
 *     }
 *   ]
 *
 * Supported aliases:
 *
 *   key / id / code / slug
 *   label / name / title
 *   value / currentValue / amount / total / count
 *   previousValue / priorValue / previous / prior
 *   target / targetValue / goal
 *   change / changeValue / delta / variance
 *   changePercent / percentageChange / growthRate / changeRate
 *   trend / history / series / sparkline / values
 *   status / state
 *   valueType / metricType / type
 *   unit
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { kpis: [] }
 *   { metrics: [] }
 *   { series: [] }
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechExecutiveKPIChart';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_TITLE =
  'Executive KPIs';

const DEFAULT_DESCRIPTION =
  'Key performance indicators across the selected TITech reporting scope.';

const DEFAULT_EMPTY_MESSAGE =
  'No executive KPI data is available for the selected period.';

const DEFAULT_ERROR_MESSAGE =
  'Unable to load executive KPI data.';

const DEFAULT_GRID_COLUMNS = 4;

const DEFAULT_SPARKLINE_HEIGHT = 58;

const DEFAULT_MAX_KPIS = 12;

const DEFAULT_COLORS = [
  'var(--titech-kpi-series-1, #2563eb)',
  'var(--titech-kpi-series-2, #0f766e)',
  'var(--titech-kpi-series-3, #b45309)',
  'var(--titech-kpi-series-4, #7c3aed)',
  'var(--titech-kpi-series-5, #be123c)',
  'var(--titech-kpi-series-6, #0891b2)',
  'var(--titech-kpi-series-7, #047857)',
  'var(--titech-kpi-series-8, #4f46e5)',
];

/* ============================================================================
 * Utilities
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

  const normalized =
    value
      .replace(/,/g, '')
      .trim();

  if (!normalized) {
    return false;
  }

  return Number.isFinite(
    Number(normalized),
  );
}

/* ============================================================================
 * Formatting
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
  {
    maximumFractionDigits = 1,
  } = {},
) {
  return `${toDisplayNumber(
    value,
  ).toFixed(
    maximumFractionDigits,
  )}%`;
}

function formatMetricValue(
  value,
  {
    valueType = 'number',
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    unit = null,
    maximumFractionDigits = 0,
    minimumFractionDigits = 0,
    compact = false,
  } = {},
) {
  let formatted;

  switch (
    String(valueType).toLowerCase()
  ) {
    case 'currency':
      formatted = compact
        ? formatCompactCurrency(
            value,
            {
              currency,
              locale,
            },
          )
        : formatCurrency(
            value,
            {
              currency,
              locale,
              maximumFractionDigits,
              minimumFractionDigits,
            },
          );
      break;

    case 'percent':
    case 'percentage':
      formatted =
        formatPercent(
          value,
          {
            maximumFractionDigits,
          },
        );
      break;

    case 'integer':
      formatted =
        formatNumber(
          value,
          {
            locale,
            maximumFractionDigits: 0,
            minimumFractionDigits: 0,
          },
        );
      break;

    case 'number':
    default:
      formatted =
        formatNumber(
          value,
          {
            locale,
            maximumFractionDigits,
            minimumFractionDigits,
          },
        );
      break;
  }

  return unit
    ? `${formatted} ${unit}`
    : formatted;
}

/* ============================================================================
 * Trend normalization
 * ========================================================================== */

function normalizeTrend(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (
        isObject(item)
      ) {
        const numeric =
          firstDefined(item, [
            'value',
            'amount',
            'y',
            'metric',
          ]);

        return {
          index,
          value:
            toDisplayNumber(
              numeric,
            ),
          label:
            item.label ??
            item.date ??
            item.period ??
            `Point ${index + 1}`,
        };
      }

      return {
        index,
        value:
          toDisplayNumber(
            item,
          ),
        label:
          `Point ${index + 1}`,
      };
    });
}

/* ============================================================================
 * KPI normalization
 * ========================================================================== */

function normalizeKPI(
  record,
  index,
) {
  const source =
    isObject(record)
      ? record
      : {};

  const key =
    firstDefined(source, [
      'key',
      'id',
      'code',
      'slug',
    ]) ??
    `kpi-${index}`;

  const label =
    firstDefined(source, [
      'label',
      'name',
      'title',
      'metricName',
    ]) ??
    String(key);

  const value =
    toDisplayNumber(
      firstDefined(source, [
        'value',
        'currentValue',
        'amount',
        'total',
        'count',
        'current',
      ]),
    );

  const previousValueRaw =
    firstDefined(source, [
      'previousValue',
      'priorValue',
      'previous',
      'prior',
      'lastPeriodValue',
    ]);

  const targetRaw =
    firstDefined(source, [
      'target',
      'targetValue',
      'goal',
      'benchmark',
    ]);

  const changeRaw =
    firstDefined(source, [
      'change',
      'changeValue',
      'delta',
      'variance',
    ]);

  const changePercentRaw =
    firstDefined(source, [
      'changePercent',
      'percentageChange',
      'growthRate',
      'changeRate',
      'deltaPercent',
    ]);

  const valueType =
    source.valueType ??
    source.metricType ??
    (
      source.type ===
        'currency'
        ? 'currency'
        : 'number'
    );

  const previousValue =
    hasValue(
      previousValueRaw,
    )
      ? toDisplayNumber(
          previousValueRaw,
        )
      : null;

  const target =
    hasValue(
      targetRaw,
    )
      ? toDisplayNumber(
          targetRaw,
        )
      : null;

  const hasServerChange =
    hasValue(changeRaw);

  const hasServerChangePercent =
    hasValue(
      changePercentRaw,
    );

  const change =
    hasServerChange
      ? toDisplayNumber(
          changeRaw,
        )
      : previousValue !==
          null
        ? value -
          previousValue
        : null;

  const changePercent =
    hasServerChangePercent
      ? toDisplayNumber(
          changePercentRaw,
        )
      : previousValue !==
            null &&
          previousValue !== 0
        ? (
            ((value -
              previousValue) /
              Math.abs(
                previousValue,
              )) *
            100
          )
        : null;

  const targetVariance =
    target !== null
      ? value -
        target
      : null;

  const targetAchievementPercent =
    target !== null &&
    target !== 0
      ? (value /
          Math.abs(
            target,
          )) *
        100
      : null;

  const rawTrend =
    firstDefined(source, [
      'trend',
      'history',
      'series',
      'sparkline',
      'values',
    ]);

  const trend =
    normalizeTrend(
      rawTrend,
    );

  const color =
    source.color ??
    source.stroke ??
    DEFAULT_COLORS[
      index %
        DEFAULT_COLORS.length
    ];

  return {
    ...source,

    key: String(key),

    label: String(label),

    value,

    previousValue,

    target,

    change,

    changePercent,

    targetVariance,

    targetAchievementPercent,

    valueType,

    currency:
      source.currency ??
      null,

    unit:
      source.unit ??
      null,

    color,

    trend,

    status:
      source.status ??
      source.state ??
      null,

    description:
      source.description ??
      null,

    helper:
      source.helper ??
      source.subtitle ??
      null,

    direction:
      source.direction ??
      null,

    disabled:
      Boolean(
        source.disabled,
      ),

    raw: record,
  };
}

function extractRecords(
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
    data.kpis,
    data.metrics,
    data.series,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeKPIData(
  data,
) {
  return extractRecords(
    data,
  ).map(
    normalizeKPI,
  );
}

/* ============================================================================
 * Status
 * ========================================================================== */

function normalizeStatus(
  kpi,
) {
  if (
    kpi.status
  ) {
    const status =
      String(
        kpi.status,
      ).toLowerCase();

    switch (status) {
      case 'success':
      case 'healthy':
      case 'good':
      case 'on-track':
      case 'on_track':
      case 'live':
        return 'positive';

      case 'warning':
      case 'delayed':
      case 'at-risk':
      case 'at_risk':
        return 'warning';

      case 'error':
      case 'failed':
      case 'critical':
        return 'negative';

      default:
        return 'neutral';
    }
  }

  if (
    kpi.target !==
      null &&
    kpi.target !==
      undefined &&
    kpi.target !==
      0
  ) {
    return kpi.value >=
      kpi.target
      ? 'positive'
      : 'warning';
  }

  if (
    kpi.changePercent !==
      null &&
    kpi.changePercent !==
      undefined
  ) {
    return kpi.changePercent >=
      0
      ? 'positive'
      : 'negative';
  }

  return 'neutral';
}

function statusLabel(
  status,
) {
  switch (status) {
    case 'positive':
      return 'On track';

    case 'warning':
      return 'Needs attention';

    case 'negative':
      return 'Negative movement';

    default:
      return 'Informational';
  }
}

/* ============================================================================
 * Trend direction
 * ========================================================================== */

function resolveTrendDirection(
  kpi,
) {
  if (
    kpi.direction ===
      'up' ||
    kpi.direction ===
      'positive'
  ) {
    return 'up';
  }

  if (
    kpi.direction ===
      'down' ||
    kpi.direction ===
      'negative'
  ) {
    return 'down';
  }

  if (
    kpi.changePercent !==
      null &&
    kpi.changePercent !==
      undefined
  ) {
    if (
      kpi.changePercent >
      0
    ) {
      return 'up';
    }

    if (
      kpi.changePercent <
      0
    ) {
      return 'down';
    }
  }

  return 'flat';
}

/* ============================================================================
 * Default icons
 * ========================================================================== */

const KPIIcon = memo(
  function KPIIcon() {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 19V5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        <path
          d="M4 19H20"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        <path
          d="M7 15L10.5 11.5L13.5 13.5L19 7.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  },
);

KPIIcon.displayName =
  'KPIIcon';

/* ============================================================================
 * KPI tooltip
 * ========================================================================== */

const KPISparklineTooltip =
  memo(
    function KPISparklineTooltip({
      active,
      payload,
      kpi,
      currency,
      locale,
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

      const value =
        payload[0]?.value ??
        0;

      const point =
        payload[0]?.payload ??
        {};

      return (
        <div
          role="dialog"
          aria-label={`${kpi.label} trend detail`}
          style={{
            padding: 9,
            border:
              '1px solid var(--titech-border, #e2e8f0)',
            borderRadius: 8,
            background:
              'var(--titech-surface, #ffffff)',
            boxShadow:
              '0 10px 28px rgba(15, 23, 42, 0.12)',
            color:
              'var(--titech-text-primary, #0f172a)',
          }}
        >
          <div
            style={{
              marginBottom: 4,
              fontSize: 9,
              opacity: 0.65,
            }}
          >
            {point.label}
          </div>

          <strong
            style={{
              fontSize: 11,
              fontVariantNumeric:
                'tabular-nums',
            }}
          >
            {formatMetricValue(
              value,
              {
                valueType:
                  kpi.valueType,
                currency:
                  kpi.currency ??
                  currency,
                locale,
                unit:
                  kpi.unit,
                compact: true,
              },
            )}
          </strong>
        </div>
      );
    },
  );

KPISparklineTooltip.displayName =
  'KPISparklineTooltip';

/* ============================================================================
 * Sparkline
 * ========================================================================== */

const KPISparkline =
  memo(function KPISparkline({
    kpi,
    height =
      DEFAULT_SPARKLINE_HEIGHT,
    currency,
    locale,
    color,
    animate = false,
  }) {
    if (
      !Array.isArray(
        kpi.trend,
      ) ||
      kpi.trend.length <
        2
    ) {
      return (
        <div
          className="titech-executive-kpi__sparkline-placeholder"
          aria-hidden="true"
        />
      );
    }

    return (
      <div
        className="titech-executive-kpi__sparkline"
        aria-hidden="true"
        style={{
          height,
        }}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <AreaChart
            data={
              kpi.trend
            }
            margin={{
              top: 4,
              right: 2,
              bottom: 2,
              left: 2,
            }}
          >
            <defs>
              <linearGradient
                id={`titech-kpi-gradient-${kpi.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={
                    color
                  }
                  stopOpacity={
                    0.24
                  }
                />

                <stop
                  offset="100%"
                  stopColor={
                    color
                  }
                  stopOpacity={
                    0.02
                  }
                />
              </linearGradient>
            </defs>

            <Tooltip
              content={
                <KPISparklineTooltip
                  kpi={kpi}
                  currency={
                    currency
                  }
                  locale={locale}
                />
              }
            />

            <Area
              type="monotone"
              dataKey="value"
              stroke={
                color
              }
              strokeWidth={
                2
              }
              fill={`url(#titech-kpi-gradient-${kpi.key})`}
              fillOpacity={
                1
              }
              dot={false}
              activeDot={{
                r: 3,
              }}
              isAnimationActive={
                animate
              }
              animationDuration={
                450
              }
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  });

KPISparkline.displayName =
  'KPISparkline';

/* ============================================================================
 * KPI card
 * ========================================================================== */

const KPICard = memo(
  function KPICard({
    kpi,
    index,
    selected,
    interactive,
    currency,
    locale,
    showTrend,
    showTarget,
    showChange,
    showDescription,
    showStatus,
    compact,
    animate,
    cardValueFormatter,
    onSelect,
    renderIcon,
    renderMeta,
  }) {
    const effectiveCurrency =
      kpi.currency ??
      currency;

    const formattedValue =
      typeof cardValueFormatter ===
      'function'
        ? cardValueFormatter(
            kpi.value,
            kpi,
          )
        : formatMetricValue(
            kpi.value,
            {
              valueType:
                kpi.valueType,
              currency:
                effectiveCurrency,
              locale,
              unit:
                kpi.unit,
              compact: true,
            },
          );

    const formattedTarget =
      kpi.target !==
      null
        ? formatMetricValue(
            kpi.target,
            {
              valueType:
                kpi.valueType,
              currency:
                effectiveCurrency,
              locale,
              unit:
                kpi.unit,
              compact: true,
            },
          )
        : null;

    const status =
      normalizeStatus(
        kpi,
      );

    const direction =
      resolveTrendDirection(
        kpi,
      );

    const changeText =
      kpi.changePercent !==
        null &&
      kpi.changePercent !==
        undefined
        ? `${kpi.changePercent > 0 ? '+' : ''}${formatPercent(kpi.changePercent)}`
        : kpi.change !==
              null &&
          kpi.change !==
              undefined
        ? formatMetricValue(
            kpi.change,
            {
              valueType:
                kpi.valueType,
              currency:
                effectiveCurrency,
              locale,
              unit:
                kpi.unit,
              compact: true,
            },
          )
        : null;

    const targetAchievementText =
      kpi.targetAchievementPercent !==
        null &&
      kpi.targetAchievementPercent !==
        undefined
        ? `${kpi.targetAchievementPercent.toFixed(1)}% of target`
        : null;

    const content = (
      <>
        <div className="titech-executive-kpi__card-header">
          <div className="titech-executive-kpi__label-group">
            <span
              className="titech-executive-kpi__icon"
              aria-hidden="true"
            >
              {typeof renderIcon ===
              'function'
                ? renderIcon(
                    kpi,
                    index,
                  )
                : (
                  <KPIIcon />
                )}
            </span>

            <div className="titech-executive-kpi__heading">
              <div className="titech-executive-kpi__label">
                {kpi.label}
              </div>

              {showDescription &&
              kpi.description ? (
                <div className="titech-executive-kpi__description">
                  {
                    kpi.description
                  }
                </div>
              ) : null}
            </div>
          </div>

          {showStatus ? (
            <span
              className={classNames(
                'titech-executive-kpi__status',
                `titech-executive-kpi__status--${status}`,
              )}
            >
              <span
                className="titech-executive-kpi__status-dot"
                aria-hidden="true"
              />

              {statusLabel(
                status,
              )}
            </span>
          ) : null}
        </div>

        <div className="titech-executive-kpi__value-row">
          <div
            className="titech-executive-kpi__value"
            title={
              formattedValue
            }
          >
            {formattedValue}
          </div>

          {showChange &&
          changeText ? (
            <span
              className={classNames(
                'titech-executive-kpi__change',
                `titech-executive-kpi__change--${direction}`,
              )}
            >
              <span
                aria-hidden="true"
              >
                {direction ===
                'up'
                  ? '↑'
                  : direction ===
                      'down'
                    ? '↓'
                    : '→'}
              </span>

              {changeText}
            </span>
          ) : null}
        </div>

        {showTarget &&
        formattedTarget ? (
          <div className="titech-executive-kpi__target">
            <div className="titech-executive-kpi__target-row">
              <span>
                Target
              </span>

              <strong>
                {
                  formattedTarget
                }
              </strong>
            </div>

            {targetAchievementText ? (
              <div className="titech-executive-kpi__target-progress">
                <span
                  className="titech-executive-kpi__target-track"
                  aria-hidden="true"
                >
                  <span
                    className="titech-executive-kpi__target-fill"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          kpi.targetAchievementPercent,
                          100,
                        ),
                      )}%`,
                      background:
                        kpi.color,
                    }}
                  />
                </span>

                <span>
                  {
                    targetAchievementText
                  }
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {renderMeta ? (
          <div className="titech-executive-kpi__meta">
            {renderMeta(
              kpi,
            )}
          </div>
        ) : kpi.helper ? (
          <div className="titech-executive-kpi__helper">
            {kpi.helper}
          </div>
        ) : null}

        {showTrend ? (
          <KPISparkline
            kpi={kpi}
            currency={
              effectiveCurrency
            }
            locale={locale}
            color={
              kpi.color
            }
            animate={
              animate
            }
          />
        ) : null}
      </>
    );

    const commonClassName =
      classNames(
        'titech-executive-kpi__card',
        compact &&
          'titech-executive-kpi__card--compact',
        selected &&
          'titech-executive-kpi__card--selected',
        !selected &&
          interactive &&
          'titech-executive-kpi__card--selectable',
        `titech-executive-kpi__card--${status}`,
      );

    if (
      interactive
    ) {
      return (
        <button
          type="button"
          className={
            commonClassName
          }
          aria-pressed={
            selected
          }
          aria-label={`${selected ? 'Selected' : 'Select'} ${kpi.label}. Current value ${formattedValue}.`}
          disabled={
            kpi.disabled
          }
          onClick={() =>
            onSelect?.(
              kpi,
            )
          }
        >
          {content}
        </button>
      );
    }

    return (
      <article
        className={
          commonClassName
        }
        aria-label={`${kpi.label}: ${formattedValue}`}
      >
        {content}
      </article>
    );
  },
);

KPICard.displayName =
  'KPICard';

/* ============================================================================
 * State components
 * ========================================================================== */

const KPIState = memo(
  function KPIState({
    type,
    title,
    message,
    action,
  }) {
    return (
      <div
        className={classNames(
          'titech-executive-kpi__state',
          type ===
            'error' &&
            'titech-executive-kpi__state--error',
        )}
        role={
          type ===
          'error'
            ? 'alert'
            : 'status'
        }
      >
        <div
          className="titech-executive-kpi__state-icon"
          aria-hidden="true"
        >
          {type ===
          'loading'
            ? '…'
            : type ===
                'error'
              ? '!'
              : '◌'}
        </div>

        <div className="titech-executive-kpi__state-title">
          {title}
        </div>

        <div className="titech-executive-kpi__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-executive-kpi__state-action">
            {action}
          </div>
        ) : null}
      </div>
    );
  },
);

KPIState.displayName =
  'KPIState';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ExecutiveKPIChart =
  memo(function ExecutiveKPIChart({
    data = [],

    title =
      DEFAULT_TITLE,

    description =
      DEFAULT_DESCRIPTION,

    currency =
      DEFAULT_CURRENCY,

    locale =
      DEFAULT_LOCALE,

    loading = false,

    error = null,

    emptyMessage =
      DEFAULT_EMPTY_MESSAGE,

    emptyAction = null,

    onRetry = null,

    selectedKey =
      null,

    defaultSelectedKey =
      null,

    onSelect = null,

    interactive = false,

    maxKpis =
      DEFAULT_MAX_KPIS,

    columns =
      DEFAULT_GRID_COLUMNS,

    showTrend = true,

    showTarget = true,

    showChange = true,

    showDescription = false,

    showStatus = true,

    showHeader = true,

    showFooter = false,

    footer = null,

    compact = false,

    elevated = false,

    bordered = true,

    animate = false,

    cardValueFormatter =
      null,

    renderIcon = null,

    renderMeta = null,

    sort = 'none',

    sortDirection =
      'desc',

    className = '',

    style = undefined,

    ariaLabel =
      'TITech executive KPI dashboard',

    testId = null,
  }) {
    const normalizedData =
      useMemo(
        () =>
          normalizeKPIData(
            data,
          ),
        [data],
      );

    const sortedData =
      useMemo(() => {
        let next =
          [...normalizedData];

        if (
          sort ===
          'value'
        ) {
          next.sort(
            (a, b) => {
              const difference =
                a.value -
                b.value;

              return sortDirection ===
                'asc'
                ? difference
                : -difference;
            },
          );
        }

        if (
          sort ===
          'label'
        ) {
          next.sort(
            (a, b) => {
              const difference =
                a.label.localeCompare(
                  b.label,
                );

              return sortDirection ===
                'asc'
                ? difference
                : -difference;
            },
          );
        }

        if (
          sort ===
          'change'
        ) {
          next.sort(
            (a, b) => {
              const aChange =
                a.changePercent ??
                a.change ??
                0;

              const bChange =
                b.changePercent ??
                b.change ??
                0;

              const difference =
                aChange -
                bChange;

              return sortDirection ===
                'asc'
                ? difference
                : -difference;
            },
          );
        }

        const limit =
          Number(
            maxKpis,
          );

        if (
          Number.isFinite(
            limit,
          ) &&
          limit > 0
        ) {
          next =
            next.slice(
              0,
              Math.floor(
                limit,
              ),
            );
        }

        return next;
      }, [
        normalizedData,
        sort,
        sortDirection,
        maxKpis,
      ]);

    const initialSelection =
      selectedKey ??
      defaultSelectedKey ??
      null;

    const [
      internalSelectedKey,
      setInternalSelectedKey,
    ] = useState(
      initialSelection,
    );

    const effectiveSelectedKey =
      selectedKey !==
      null
        ? selectedKey
        : internalSelectedKey;

    const handleSelect =
      useCallback(
        (kpi) => {
          if (
            !interactive ||
            kpi.disabled
          ) {
            return;
          }

          const nextKey =
            effectiveSelectedKey ===
            kpi.key
              ? null
              : kpi.key;

          if (
            selectedKey ===
            null
          ) {
            setInternalSelectedKey(
              nextKey,
            );
          }

          onSelect?.(
            nextKey,
            kpi,
          );
        },
        [
          interactive,
          effectiveSelectedKey,
          selectedKey,
          onSelect,
        ],
      );

    const resolvedColumns =
      useMemo(() => {
        const number =
          Number(columns);

        if (
          !Number.isFinite(
            number,
          ) ||
          number <= 0
        ) {
          return DEFAULT_GRID_COLUMNS;
        }

        return Math.max(
          1,
          Math.min(
            Math.floor(
              number,
            ),
            6,
          ),
        );
      }, [columns]);

    const rootClassName =
      classNames(
        'titech-executive-kpi',
        compact &&
          'titech-executive-kpi--compact',
        elevated &&
          'titech-executive-kpi--elevated',
        bordered &&
          'titech-executive-kpi--bordered',
        interactive &&
          'titech-executive-kpi--interactive',
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
          <KPIState
            type="loading"
            title="Loading executive KPIs"
            message="Preparing the latest TITech management metrics."
          />

          <style>
            {getExecutiveKPIStyles()}
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
          <KPIState
            type="error"
            title="Unable to load executive KPIs"
            message={message}
            action={
              typeof onRetry ===
              'function' ? (
                <button
                  type="button"
                  className="titech-executive-kpi__retry"
                  onClick={
                    onRetry
                  }
                >
                  Retry
                </button>
              ) : null
            }
          />

          <style>
            {getExecutiveKPIStyles()}
          </style>
        </section>
      );
    }

    if (
      sortedData.length ===
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
          <KPIState
            type="empty"
            title="No executive KPI data"
            message={
              emptyMessage
            }
            action={
              emptyAction
            }
          />

          <style>
            {getExecutiveKPIStyles()}
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
        style={{
          '--titech-kpi-columns':
            resolvedColumns,
          ...style,
        }}
      >
        {/* --------------------------------------------------------------
            Header
            ------------------------------------------------------------ */}
        {showHeader ? (
          <header className="titech-executive-kpi__header">
            <div className="titech-executive-kpi__header-main">
              <div className="titech-executive-kpi__eyebrow">
                Executive analytics
              </div>

              <h2 className="titech-executive-kpi__title">
                {title}
              </h2>

              {description ? (
                <p className="titech-executive-kpi__description">
                  {description}
                </p>
              ) : null}
            </div>

            <div
              className="titech-executive-kpi__scope"
              aria-label={`Reporting currency ${currency}`}
            >
              {currency}
            </div>
          </header>
        ) : null}

        {/* --------------------------------------------------------------
            KPI grid
            ------------------------------------------------------------ */}
        <div
          className="titech-executive-kpi__grid"
          role="list"
          aria-label={`${title} metrics`}
        >
          {sortedData.map(
            (kpi, index) => (
              <div
                key={
                  kpi.key
                }
                role="listitem"
              >
                <KPICard
                  kpi={kpi}
                  index={
                    index
                  }
                  selected={
                    !effectiveSelectedKey ||
                    effectiveSelectedKey ===
                      kpi.key
                  }
                  interactive={
                    interactive
                  }
                  currency={
                    currency
                  }
                  locale={locale}
                  showTrend={
                    showTrend
                  }
                  showTarget={
                    showTarget
                  }
                  showChange={
                    showChange
                  }
                  showDescription={
                    showDescription
                  }
                  showStatus={
                    showStatus
                  }
                  compact={
                    compact
                  }
                  animate={
                    animate
                  }
                  cardValueFormatter={
                    cardValueFormatter
                  }
                  onSelect={
                    handleSelect
                  }
                  renderIcon={
                    renderIcon
                  }
                  renderMeta={
                    renderMeta
                  }
                />
              </div>
            ),
          )}
        </div>

        {/* --------------------------------------------------------------
            Footer
            ------------------------------------------------------------ */}
        {showFooter ||
        footer ? (
          <footer className="titech-executive-kpi__footer">
            {footer ||
              'TITech Community Capital · Executive analytics'}
          </footer>
        ) : null}

        {/* --------------------------------------------------------------
            Accessibility and responsive styling
            ------------------------------------------------------------ */}
        <style>
          {getExecutiveKPIStyles()}
        </style>
      </section>
    );
  });

ExecutiveKPIChart.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Styles
 * ========================================================================== */

function getExecutiveKPIStyles() {
  return `
    .titech-executive-kpi {
      --titech-kpi-surface:
        var(
          --titech-surface,
          #ffffff
        );

      --titech-kpi-surface-muted:
        var(
          --titech-surface-muted,
          #f8fafc
        );

      --titech-kpi-border:
        var(
          --titech-border,
          #e2e8f0
        );

      --titech-kpi-border-strong:
        var(
          --titech-border-strong,
          #cbd5e1
        );

      --titech-kpi-text:
        var(
          --titech-text-primary,
          #0f172a
        );

      --titech-kpi-text-muted:
        var(
          --titech-text-secondary,
          #64748b
        );

      --titech-kpi-primary:
        var(
          --titech-primary,
          #0f172a
        );

      --titech-kpi-focus:
        var(
          --titech-focus-ring,
          #2563eb
        );

      --titech-kpi-positive:
        var(
          --titech-success,
          #047857
        );

      --titech-kpi-warning:
        var(
          --titech-warning,
          #b45309
        );

      --titech-kpi-negative:
        var(
          --titech-danger,
          #b91c1c
        );

      width: 100%;
      min-width: 0;
      color:
        var(--titech-kpi-text);
      font: inherit;
    }

    .titech-executive-kpi *,
    .titech-executive-kpi
      *::before,
    .titech-executive-kpi
      *::after {
      box-sizing:
        border-box;
    }

    .titech-executive-kpi--bordered {
      padding: 18px;
      border: 1px solid
        var(--titech-kpi-border);
      border-radius: 16px;
      background:
        var(--titech-kpi-surface);
    }

    .titech-executive-kpi--elevated {
      box-shadow:
        0 12px 32px
        rgba(
          15,
          23,
          42,
          0.08
        );
    }

    /* ------------------------------------------------------------------------
       Header
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__header {
      display:
        flex;
      justify-content:
        space-between;
      align-items:
        flex-start;
      gap: 16px;
      margin-bottom: 16px;
    }

    .titech-executive-kpi__header-main {
      min-width: 0;
      flex: 1 1 auto;
    }

    .titech-executive-kpi__eyebrow {
      margin-bottom: 4px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 9px;
      line-height: 1.25;
      font-weight: 850;
      letter-spacing:
        0.08em;
      text-transform:
        uppercase;
    }

    .titech-executive-kpi__title {
      margin: 0;
      color:
        var(--titech-kpi-text);
      font-size: 18px;
      line-height: 1.3;
      font-weight: 850;
      letter-spacing:
        -0.015em;
    }

    .titech-executive-kpi__description {
      max-width: 760px;
      margin: 5px 0 0;
      color:
        var(--titech-kpi-text-muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .titech-executive-kpi__scope {
      flex: 0 0 auto;
      padding:
        6px 9px;
      border: 1px solid
        var(--titech-kpi-border);
      border-radius: 8px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 9px;
      line-height: 1.2;
      font-weight: 850;
      letter-spacing:
        0.06em;
      text-transform:
        uppercase;
    }

    /* ------------------------------------------------------------------------
       Grid
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__grid {
      display:
        grid;
      grid-template-columns:
        repeat(
          var(
            --titech-kpi-columns,
            4
          ),
          minmax(
            0,
            1fr
          )
        );
      gap: 12px;
      min-width: 0;
    }

    /* ------------------------------------------------------------------------
       Card
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__card {
      position: relative;
      display:
        flex;
      width: 100%;
      min-width: 0;
      min-height: 176px;
      flex-direction:
        column;
      padding: 14px;
      overflow: hidden;
      border: 1px solid
        var(--titech-kpi-border);
      border-radius: 12px;
      background:
        var(--titech-kpi-surface);
      color:
        var(--titech-kpi-text);
      font: inherit;
      text-align:
        left;
    }

    button.titech-executive-kpi__card {
      cursor: pointer;
    }

    .titech-executive-kpi__card--selectable:hover:not(
      :disabled
    ) {
      border-color:
        var(
          --titech-kpi-border-strong
        );
      box-shadow:
        0 7px 20px
        rgba(
          15,
          23,
          42,
          0.07
        );
      transform:
        translateY(-1px);
    }

    .titech-executive-kpi__card--selected {
      border-color:
        var(--titech-kpi-primary);
    }

    .titech-executive-kpi__card--positive {
      --titech-kpi-status-color:
        var(
          --titech-kpi-positive
        );
    }

    .titech-executive-kpi__card--warning {
      --titech-kpi-status-color:
        var(
          --titech-kpi-warning
        );
    }

    .titech-executive-kpi__card--negative {
      --titech-kpi-status-color:
        var(
          --titech-kpi-negative
        );
    }

    .titech-executive-kpi__card:focus-visible {
      outline: 3px solid
        var(
          --titech-kpi-focus
        );
      outline-offset: 2px;
    }

    .titech-executive-kpi__card:disabled {
      cursor:
        not-allowed;
      opacity:
        0.58;
    }

    /* ------------------------------------------------------------------------
       Card header
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__card-header {
      display:
        flex;
      justify-content:
        space-between;
      align-items:
        flex-start;
      gap: 8px;
      min-width: 0;
    }

    .titech-executive-kpi__label-group {
      display:
        flex;
      align-items:
        flex-start;
      min-width: 0;
      gap: 8px;
    }

    .titech-executive-kpi__icon {
      display:
        grid;
      place-items:
        center;
      width: 31px;
      height: 31px;
      flex: 0 0 auto;
      border-radius: 8px;
      background:
        var(
          --titech-kpi-surface-muted
        );
      color:
        var(
          --titech-kpi-status-color,
          var(
            --titech-kpi-primary
          )
        );
    }

    .titech-executive-kpi__heading {
      min-width: 0;
    }

    .titech-executive-kpi__label {
      color:
        var(--titech-kpi-text);
      font-size: 10px;
      line-height: 1.35;
      font-weight: 800;
      overflow-wrap:
        anywhere;
    }

    .titech-executive-kpi__description {
      margin-top: 2px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 8px;
      line-height: 1.35;
    }

    .titech-executive-kpi__status {
      display:
        inline-flex;
      align-items:
        center;
      gap: 4px;
      flex: 0 0 auto;
      min-height: 20px;
      padding:
        3px 6px;
      border-radius:
        999px;
      color:
        var(
          --titech-kpi-status-color,
          var(
            --titech-kpi-text-muted
          )
        );
      font-size: 7px;
      line-height: 1.2;
      font-weight: 850;
      white-space:
        nowrap;
    }

    .titech-executive-kpi__status-dot {
      width: 5px;
      height: 5px;
      flex: 0 0 auto;
      border-radius:
        50%;
      background:
        currentColor;
    }

    /* ------------------------------------------------------------------------
       Value
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__value-row {
      display:
        flex;
      justify-content:
        space-between;
      align-items:
        baseline;
      gap: 8px;
      min-width: 0;
      margin-top: 13px;
    }

    .titech-executive-kpi__value {
      min-width: 0;
      color:
        var(--titech-kpi-text);
      font-size: 22px;
      line-height: 1.15;
      font-weight: 900;
      font-variant-numeric:
        tabular-nums;
      letter-spacing:
        -0.02em;
      overflow-wrap:
        anywhere;
    }

    .titech-executive-kpi__change {
      display:
        inline-flex;
      align-items:
        center;
      flex: 0 0 auto;
      gap: 3px;
      font-size: 9px;
      line-height: 1.2;
      font-weight: 850;
      font-variant-numeric:
        tabular-nums;
      white-space:
        nowrap;
    }

    .titech-executive-kpi__change--up {
      color:
        var(--titech-kpi-positive);
    }

    .titech-executive-kpi__change--down {
      color:
        var(--titech-kpi-negative);
    }

    .titech-executive-kpi__change--flat {
      color:
        var(--titech-kpi-text-muted);
    }

    /* ------------------------------------------------------------------------
       Target
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__target {
      margin-top: 10px;
    }

    .titech-executive-kpi__target-row {
      display:
        flex;
      justify-content:
        space-between;
      align-items:
        baseline;
      gap: 8px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 8px;
      line-height: 1.3;
    }

    .titech-executive-kpi__target-row strong {
      color:
        var(--titech-kpi-text);
      font-variant-numeric:
        tabular-nums;
    }

    .titech-executive-kpi__target-progress {
      display:
        flex;
      align-items:
        center;
      gap: 7px;
      margin-top: 5px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 7px;
      line-height: 1.2;
    }

    .titech-executive-kpi__target-track {
      display:
        block;
      height: 4px;
      flex: 1 1 auto;
      overflow: hidden;
      border-radius:
        999px;
      background:
        var(
          --titech-kpi-border
        );
    }

    .titech-executive-kpi__target-fill {
      display:
        block;
      height: 100%;
      border-radius:
        inherit;
      transition:
        width 180ms ease;
    }

    /* ------------------------------------------------------------------------
       Helper / meta
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__helper,
    .titech-executive-kpi__meta {
      min-height: 14px;
      margin-top: 8px;
      color:
        var(--titech-kpi-text-muted);
      font-size: 8px;
      line-height: 1.35;
    }

    /* ------------------------------------------------------------------------
       Sparkline
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__sparkline {
      width: 100%;
      min-width: 0;
      margin-top: auto;
      padding-top: 7px;
    }

    .titech-executive-kpi__sparkline-placeholder {
      width: 100%;
      height: 58px;
      margin-top: auto;
      padding-top: 7px;
    }

    /* ------------------------------------------------------------------------
       State
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__state {
      display:
        grid;
      place-items:
        center;
      align-content:
        center;
      min-height: 220px;
      padding: 28px 22px;
      border:
        1px dashed
        var(
          --titech-kpi-border-strong
        );
      border-radius:
        12px;
      background:
        var(
          --titech-kpi-surface-muted
        );
      text-align:
        center;
    }

    .titech-executive-kpi__state--error {
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

    .titech-executive-kpi__state-icon {
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
          --titech-kpi-surface
        );
      color:
        var(
          --titech-kpi-text-muted
        );
      font-size:
        21px;
      font-weight:
        850;
    }

    .titech-executive-kpi__state-title {
      margin-bottom: 5px;
      font-size:
        13px;
      line-height:
        1.35;
      font-weight:
        850;
    }

    .titech-executive-kpi__state-message {
      max-width:
        470px;
      color:
        var(
          --titech-kpi-text-muted
        );
      font-size:
        10px;
      line-height:
        1.55;
      overflow-wrap:
        anywhere;
    }

    .titech-executive-kpi__state-action {
      margin-top:
        14px;
    }

    .titech-executive-kpi__retry {
      min-height:
        37px;
      padding:
        7px 13px;
      border:
        1px solid
        var(
          --titech-kpi-primary
        );
      border-radius:
        8px;
      background:
        var(
          --titech-kpi-primary
        );
      color:
        #ffffff;
      font: inherit;
      font-size:
        10px;
      font-weight:
        850;
      cursor:
        pointer;
    }

    .titech-executive-kpi__retry:focus-visible {
      outline:
        3px solid
        var(
          --titech-kpi-focus
        );
      outline-offset:
        2px;
    }

    /* ------------------------------------------------------------------------
       Footer
       ---------------------------------------------------------------------- */

    .titech-executive-kpi__footer {
      margin-top:
        12px;
      padding-top:
        10px;
      border-top:
        1px solid
        var(
          --titech-kpi-border
        );
      color:
        var(
          --titech-kpi-text-muted
        );
      font-size:
        8px;
      line-height:
        1.4;
    }

    /* ------------------------------------------------------------------------
       Compact
       ---------------------------------------------------------------------- */

    .titech-executive-kpi--compact {
      padding:
        12px;
    }

    .titech-executive-kpi--compact
      .titech-executive-kpi__grid {
      gap:
        8px;
    }

    .titech-executive-kpi--compact
      .titech-executive-kpi__card {
      min-height:
        145px;
      padding:
        11px;
    }

    .titech-executive-kpi--compact
      .titech-executive-kpi__value {
      font-size:
        18px;
    }

    /* ------------------------------------------------------------------------
       Responsive
       ---------------------------------------------------------------------- */

    @media (max-width: 1100px) {
      .titech-executive-kpi__grid {
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
      .titech-executive-kpi__header {
        flex-direction:
          column;
        align-items:
          stretch;
      }

      .titech-executive-kpi__scope {
        align-self:
          flex-start;
      }

      .titech-executive-kpi__grid {
        grid-template-columns:
          1fr;
      }

      .titech-executive-kpi__value {
        font-size:
          20px;
      }
    }

    /* ------------------------------------------------------------------------
       Reduced motion
       ---------------------------------------------------------------------- */

    @media (prefers-reduced-motion: reduce) {
      .titech-executive-kpi *,
      .titech-executive-kpi
        *::before,
      .titech-executive-kpi
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
      .titech-executive-kpi {
        break-inside:
          avoid;
        page-break-inside:
          avoid;
        box-shadow:
          none !important;
      }

      .titech-executive-kpi__card {
        break-inside:
          avoid;
        page-break-inside:
          avoid;
        box-shadow:
          none !important;
      }
    }
  `;
}

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ExecutiveKPIChart,
  KPICard,
  KPIIcon,
  KPIState,
  KPISparkline,
  KPISparklineTooltip,
  normalizeKPI,
  normalizeKPIData,
  normalizeTrend,
  normalizeStatus,
  resolveTrendDirection,
  formatNumber,
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
  formatMetricValue,
  toDisplayNumber,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ExecutiveKPIChart;