'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/DonutChartCard.jsx
 *
 * Purpose:
 *   Enterprise-grade reusable donut chart card for TITech analytics.
 *
 * Responsibilities:
 *   - Display categorical proportions as a donut chart.
 *   - Support absolute values and percentages.
 *   - Support center KPI / aggregate display.
 *   - Support interactive segment selection.
 *   - Support external selected-segment state.
 *   - Support custom legend / labels.
 *   - Support loading, empty and error states.
 *   - Support responsive rendering.
 *   - Support accessible summaries and keyboard interaction.
 *   - Normalize common API data shapes.
 *   - Support currency, number and percentage formatting.
 *   - Preserve backend-provided values as authoritative presentation data.
 *
 * Financial integrity:
 *   - Presentation-only.
 *   - Does NOT mutate balances, wallets, ledgers, journals or transactions.
 *   - Does NOT infer settlement from provider or transaction status.
 *   - Does NOT convert pending, queued, offline, processing or UNKNOWN states
 *     into settled funds.
 *   - Ratios/percentages shown here are analytical display values only.
 *   - Backend-authoritative financial values remain authoritative.
 *
 * Expected data:
 *
 *   [
 *     {
 *       key: 'savings',
 *       label: 'Savings',
 *       value: 6500000,
 *     },
 *     {
 *       key: 'loans',
 *       label: 'Loans',
 *       value: 2500000,
 *     },
 *   ]
 *
 * Supported aliases:
 *   key / id / code / name / category / type
 *   label / name / title / categoryLabel
 *   value / amount / total / count / quantity
 *   color / fill
 *   percentage / percent / share / ratio
 *
 * Supported response envelopes:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { series: [] }
 *   { categories: [] }
 *   { breakdown: [] }
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
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechDonutChartCard';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LOCALE = 'en-UG';

const DEFAULT_HEIGHT = 300;

const DEFAULT_INNER_RADIUS = '62%';

const DEFAULT_OUTER_RADIUS = '82%';

const DEFAULT_START_ANGLE = 90;

const DEFAULT_END_ANGLE = -270;

const DEFAULT_PADDING_ANGLE = 2;

const DEFAULT_EMPTY_MESSAGE =
  'No data is available for the selected period.';

const DEFAULT_ERROR_MESSAGE =
  'Unable to load the chart data.';

const DEFAULT_COLORS = [
  'var(--titech-chart-series-1, #2563eb)',
  'var(--titech-chart-series-2, #0f766e)',
  'var(--titech-chart-series-3, #b45309)',
  'var(--titech-chart-series-4, #7c3aed)',
  'var(--titech-chart-series-5, #be123c)',
  'var(--titech-chart-series-6, #0891b2)',
  'var(--titech-chart-series-7, #4f46e5)',
  'var(--titech-chart-series-8, #047857)',
];

const DEFAULT_MAX_ITEMS = 12;

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
    typeof value.toString === 'function'
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
    locale = DEFAULT_LOCALE,
    maximumFractionDigits = 1,
  } = {},
) {
  const number =
    toDisplayNumber(value);

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'percent',
        maximumFractionDigits,
      },
    ).format(number / 100);
  } catch {
    return `${number.toFixed(
      maximumFractionDigits,
    )}%`;
  }
}

/* ============================================================================
 * Data normalization
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
    data.series,
    data.categories,
    data.breakdown,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeRecord(
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
      'name',
      'category',
      'type',
    ]) ??
    `segment-${index}`;

  const label =
    firstDefined(source, [
      'label',
      'name',
      'title',
      'categoryLabel',
    ]) ??
    String(key);

  const value =
    Math.max(
      0,
      toDisplayNumber(
        firstDefined(
          source,
          [
            'value',
            'amount',
            'total',
            'count',
            'quantity',
          ],
        ),
      ),
    );

  const explicitPercentage =
    firstDefined(source, [
      'percentage',
      'percent',
      'share',
      'ratio',
    ]);

  const color =
    firstDefined(source, [
      'color',
      'fill',
    ]) ??
    DEFAULT_COLORS[
      index %
        DEFAULT_COLORS.length
    ];

  return {
    ...source,

    key: String(key),

    label: String(
      label,
    ),

    value,

    percentage:
      hasValue(
        explicitPercentage,
      )
        ? toDisplayNumber(
            explicitPercentage,
          )
        : null,

    color,

    description:
      source.description ??
      null,

    status:
      source.status ??
      null,

    disabled:
      Boolean(source.disabled),

    raw: record,
  };
}

function normalizeData(
  data,
) {
  return extractRecords(
    data,
  ).map(
    normalizeRecord,
  );
}

/**
 * Derives percentages only for visualization when the source does not provide
 * them. This is not a financial calculation authoritative for accounting.
 */
function calculatePercentages(
  records,
) {
  const total = records.reduce(
    (sum, record) =>
      sum +
      toDisplayNumber(
        record.value,
      ),
    0,
  );

  return records.map(
    (record) => ({
      ...record,
      computedPercentage:
        record.percentage !==
        null
          ? record.percentage
          : total > 0
            ? (
                (record.value /
                  total) *
                100
              )
            : 0,
    }),
  );
}

/* ============================================================================
 * Icons
 * ========================================================================== */

const DonutIcon = memo(
  function DonutIcon() {
    return (
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M12 3A9 9 0 1 0 21 12H12V3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        <path
          d="M14.5 3.35A9 9 0 0 1 20.65 9.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  },
);

DonutIcon.displayName =
  'DonutIcon';

/* ============================================================================
 * Tooltip
 * ========================================================================== */

const DonutTooltip = memo(
  function DonutTooltip({
    active,
    payload,
    currency,
    locale,
    valueType,
    showPercentage,
  }) {
    if (
      !active ||
      !Array.isArray(payload) ||
      payload.length === 0
    ) {
      return null;
    }

    const point =
      payload[0]?.payload ??
      {};

    const displayValue =
      valueType === 'number'
        ? formatNumber(
            point.value,
            {
              locale,
            },
          )
        : formatCurrency(
            point.value,
            {
              currency,
              locale,
            },
          );

    const percentage =
      toDisplayNumber(
        point.computedPercentage,
      );

    return (
      <div
        role="dialog"
        aria-label={`${point.label || 'Chart segment'} details`}
        style={{
          minWidth: 210,
          padding: 13,
          border:
            '1px solid var(--titech-border, #e2e8f0)',
          borderRadius: 12,
          background:
            'var(--titech-surface, var(--color-white))',
          color:
            'var(--titech-text-primary, #0f172a)',
          boxShadow:
            '0 14px 38px rgba(15, 23, 42, 0.14)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 9,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              flex: '0 0 auto',
              borderRadius: '50%',
              background:
                point.color,
            }}
          />

          <strong
            style={{
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {point.label}
          </strong>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 7,
          }}
        >
          <TooltipRow
            label="Value"
            value={
              displayValue
            }
          />

          {showPercentage ? (
            <TooltipRow
              label="Share"
              value={`${percentage.toFixed(1)}%`}
            />
          ) : null}
        </div>
      </div>
    );
  },
);

DonutTooltip.displayName =
  'DonutTooltip';

const TooltipRow = memo(
  function TooltipRow({
    label,
    value,
  }) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent:
            'space-between',
          alignItems:
            'baseline',
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
 * Legend item
 * ========================================================================== */

const DonutLegendItem = memo(
  function DonutLegendItem({
    item,
    selected,
    interactive,
    onSelect,
    valueType,
    currency,
    locale,
    showValues,
    showPercentage,
    valueFormatter,
  }) {
    const valueText =
      typeof valueFormatter ===
      'function'
        ? valueFormatter(
            item.value,
            item,
          )
        : valueType ===
          'number'
          ? formatNumber(
              item.value,
              {
                locale,
              },
            )
          : formatCompactCurrency(
              item.value,
              {
                currency,
                locale,
              },
            );

    const percentText =
      `${toDisplayNumber(
        item.computedPercentage,
      ).toFixed(1)}%`;

    const content = (
      <>
        <span
          className="titech-donut-card__legend-marker"
          aria-hidden="true"
          style={{
            background:
              item.color,
            opacity:
              selected
                ? 1
                : 0.45,
          }}
        />

        <span className="titech-donut-card__legend-label">
          {item.label}
        </span>

        {showValues ? (
          <span className="titech-donut-card__legend-value">
            {valueText}
          </span>
        ) : null}

        {showPercentage ? (
          <span className="titech-donut-card__legend-percent">
            {percentText}
          </span>
        ) : null}
      </>
    );

    if (
      interactive
    ) {
      return (
        <button
          type="button"
          className={classNames(
            'titech-donut-card__legend-item',
            selected &&
              'titech-donut-card__legend-item--selected',
            !selected &&
              'titech-donut-card__legend-item--muted',
          )}
          aria-pressed={
            selected
          }
          aria-label={`${selected ? 'Hide' : 'Show'} ${item.label}`}
          disabled={
            item.disabled
          }
          onClick={() =>
            onSelect?.(
              item,
            )
          }
        >
          {content}
        </button>
      );
    }

    return (
      <div
        className="titech-donut-card__legend-item"
        role="listitem"
      >
        {content}
      </div>
    );
  },
);

DonutLegendItem.displayName =
  'DonutLegendItem';

/* ============================================================================
 * Summary center
 * ========================================================================== */

const DonutCenterLabel = memo(
  function DonutCenterLabel({
    total,
    currency,
    locale,
    valueType,
    centerLabel,
    centerSubLabel,
    centerValueFormatter,
  }) {
    const formattedTotal =
      typeof centerValueFormatter ===
      'function'
        ? centerValueFormatter(
            total,
          )
        : valueType ===
          'number'
          ? formatNumber(
              total,
              {
                locale,
              },
            )
          : formatCompactCurrency(
              total,
              {
                currency,
                locale,
              },
            );

    return (
      <div
        className="titech-donut-card__center"
        aria-hidden="true"
      >
        <div className="titech-donut-card__center-label">
          {centerLabel}
        </div>

        <div className="titech-donut-card__center-value">
          {formattedTotal}
        </div>

        {centerSubLabel ? (
          <div className="titech-donut-card__center-sub-label">
            {centerSubLabel}
          </div>
        ) : null}
      </div>
    );
  },
);

DonutCenterLabel.displayName =
  'DonutCenterLabel';

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
      <div className="titech-donut-card__summary-metric">
        <div className="titech-donut-card__summary-label">
          {label}
        </div>

        <div className="titech-donut-card__summary-value">
          {value}
        </div>

        {helper ? (
          <div className="titech-donut-card__summary-helper">
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
 * State frame
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
          'titech-donut-card__state',
          type === 'error' &&
            'titech-donut-card__state--error',
        )}
        role={
          type === 'error'
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
          className="titech-donut-card__state-icon"
          aria-hidden="true"
        >
          {type === 'loading'
            ? '…'
            : type === 'error'
              ? '!'
              : '◌'}
        </div>

        <div className="titech-donut-card__state-title">
          {title}
        </div>

        <div className="titech-donut-card__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-donut-card__state-action">
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
 * Main component
 * ========================================================================== */

const DonutChartCard = memo(
  function DonutChartCard({
    data = [],

    title = 'Distribution',

    description = null,

    eyebrow = null,

    currency =
      DEFAULT_CURRENCY,

    locale =
      DEFAULT_LOCALE,

    valueType = 'currency',

    height =
      DEFAULT_HEIGHT,

    innerRadius =
      DEFAULT_INNER_RADIUS,

    outerRadius =
      DEFAULT_OUTER_RADIUS,

    startAngle =
      DEFAULT_START_ANGLE,

    endAngle =
      DEFAULT_END_ANGLE,

    paddingAngle =
      DEFAULT_PADDING_ANGLE,

    maxItems =
      DEFAULT_MAX_ITEMS,

    loading = false,

    error = null,

    emptyMessage =
      DEFAULT_EMPTY_MESSAGE,

    emptyAction = null,

    onRetry = null,

    selectedKey = null,

    defaultSelectedKey = null,

    onSelect = null,

    interactive = true,

    showLegend = true,

    showValues = true,

    showPercentage = true,

    showSummary = true,

    showCenterLabel = true,

    centerLabel =
      'Total',

    centerSubLabel = null,

    centerValueFormatter =
      null,

    valueFormatter =
      null,

    labelFormatter =
      null,

    showFooter = false,

    footer = null,

    footerNote = null,

    sort = 'none',

    sortDirection = 'desc',

    showOther = false,

    otherLabel = 'Other',

    otherColor =
      'var(--titech-chart-other, #94a3b8)',

    labelMaxLength = 36,

    legendMaxHeight = 250,

    summaryLabels = {
      total: 'Total',
      segments: 'Segments',
      top: 'Largest segment',
    },

    className = '',

    style = undefined,

    bordered = true,

    elevated = false,

    compact = false,

    hideCardHeader = false,

    ariaLabel =
      'TITech donut chart',

    testId = null,
  }) {
    const normalizedData =
      useMemo(
        () =>
          normalizeData(
            data,
          ),
        [data],
      );

    const processedData =
      useMemo(() => {
        let records =
          normalizedData;

        if (
          Number.isFinite(
            Number(maxItems),
          ) &&
          Number(maxItems) >
            0
        ) {
          const maximum =
            Math.floor(
              Number(maxItems),
            );

          if (
            records.length >
            maximum
          ) {
            const visible =
              records.slice(
                0,
                maximum -
                  (showOther
                    ? 1
                    : 0),
              );

            if (
              showOther
            ) {
              const otherValue =
                records
                  .slice(
                    maximum -
                      1,
                  )
                  .reduce(
                    (
                      sum,
                      item,
                    ) =>
                      sum +
                      item.value,
                    0,
                  );

              if (
                otherValue >
                0
              ) {
                visible.push({
                  key: '__other__',
                  label:
                    otherLabel,
                  value:
                    otherValue,
                  percentage:
                    null,
                  color:
                    otherColor,
                  description:
                    'Aggregated remainder',
                  status:
                    null,
                  disabled:
                    false,
                  raw: null,
                });
              }
            }

            records =
              visible;
          } else {
            records =
              records.slice(
                0,
                maximum,
              );
          }
        }

        if (
          sort !== 'none'
        ) {
          records = [
            ...records,
          ].sort(
            (a, b) => {
              if (
                sort === 'value'
              ) {
                const difference =
                  a.value -
                  b.value;

                return sortDirection ===
                  'asc'
                  ? difference
                  : -difference;
              }

              if (
                sort ===
                'label'
              ) {
                const difference =
                  a.label.localeCompare(
                    b.label,
                  );

                return sortDirection ===
                  'asc'
                  ? difference
                  : -difference;
              }

              return 0;
            },
          );
        }

        return calculatePercentages(
          records,
        );
      }, [
        normalizedData,
        maxItems,
        showOther,
        otherLabel,
        otherColor,
        sort,
        sortDirection,
      ]);

    const total =
      useMemo(
        () =>
          processedData.reduce(
            (sum, item) =>
              sum + item.value,
            0,
          ),
        [processedData],
      );

    const topSegment =
      useMemo(
        () =>
          processedData.reduce(
            (maximum, item) =>
              item.value >
              (maximum?.value ??
                0)
                ? item
                : maximum,
            null,
          ),
        [processedData],
      );

    const initialSelectedKey =
      selectedKey ??
      defaultSelectedKey ??
      null;

    const [
      internalSelectedKey,
      setInternalSelectedKey,
    ] = useState(
      initialSelectedKey,
    );

    const effectiveSelectedKey =
      selectedKey !==
      null
        ? selectedKey
        : internalSelectedKey;

    const handleSelect =
      useCallback(
        (item) => {
          if (
            !interactive ||
            item.disabled
          ) {
            return;
          }

          const nextKey =
            effectiveSelectedKey ===
            item.key
              ? null
              : item.key;

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
            item,
          );
        },
        [
          interactive,
          effectiveSelectedKey,
          selectedKey,
          onSelect,
        ],
      );

    const handlePieClick =
      useCallback(
        (entry) => {
          const item =
            entry?.payload;

          if (
            item &&
            interactive
          ) {
            handleSelect(
              item,
            );
          }
        },
        [
          interactive,
          handleSelect,
        ],
      );

    const visibleCount =
      processedData.length;

    const labelFor =
      useCallback(
        (item) => {
          const label =
            typeof labelFormatter ===
            'function'
              ? labelFormatter(
                  item.label,
                  item,
                )
              : item.label;

          const text =
            String(label);

          return text.length >
            labelMaxLength
            ? `${text.slice(
                0,
                Math.max(
                  1,
                  labelMaxLength -
                    1,
                ),
              )}…`
            : text;
        },
        [
          labelFormatter,
          labelMaxLength,
        ],
      );

    const rootClassName =
      classNames(
        'titech-donut-card',
        bordered &&
          'titech-donut-card--bordered',
        elevated &&
          'titech-donut-card--elevated',
        compact &&
          'titech-donut-card--compact',
        className,
      );

    const resolvedHeight =
      Number.isFinite(
        Number(height),
      ) &&
      Number(height) > 0
        ? Number(height)
        : DEFAULT_HEIGHT;

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
          <CardShell
            title={title}
            description={
              description
            }
            eyebrow={eyebrow}
            hideHeader={
              hideCardHeader
            }
          >
            <StatePanel
              type="loading"
              title="Loading distribution"
              message="Preparing the latest TITech analytics data."
              height={
                resolvedHeight
              }
            />
          </CardShell>
        </section>
      );
    }

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
          <CardShell
            title={title}
            description={
              description
            }
            eyebrow={eyebrow}
            hideHeader={
              hideCardHeader
            }
          >
            <StatePanel
              type="error"
              title="Unable to load distribution"
              message={
                message
              }
              action={
                typeof onRetry ===
                'function' ? (
                  <button
                    type="button"
                    onClick={
                      onRetry
                    }
                    className="titech-donut-card__retry"
                  >
                    Retry
                  </button>
                ) : null
              }
              height={
                resolvedHeight
              }
            />
          </CardShell>
        </section>
      );
    }

    if (
      processedData.length ===
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
          <CardShell
            title={title}
            description={
              description
            }
            eyebrow={eyebrow}
            hideHeader={
              hideCardHeader
            }
          >
            <StatePanel
              type="empty"
              title="No distribution data"
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
          </CardShell>
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
        <CardShell
          title={title}
          description={
            description
          }
          eyebrow={eyebrow}
          hideHeader={
            hideCardHeader
          }
          currency={
            currency
          }
        >
          {/* --------------------------------------------------------------
              Summary
              ------------------------------------------------------------ */}
          {showSummary ? (
            <div className="titech-donut-card__summary">
              <SummaryMetric
                label={
                  summaryLabels.total
                }
                value={
                  valueType ===
                  'number'
                    ? formatNumber(
                        total,
                        {
                          locale,
                        },
                      )
                    : formatCurrency(
                        total,
                        {
                          currency,
                          locale,
                        },
                      )
                }
                helper="Aggregate value"
              />

              <SummaryMetric
                label={
                  summaryLabels.segments
                }
                value={
                  formatNumber(
                    visibleCount,
                    {
                      locale,
                      maximumFractionDigits: 0,
                    },
                  )
                }
                helper="Displayed categories"
              />

              <SummaryMetric
                label={
                  summaryLabels.top
                }
                value={
                  topSegment
                    ? `${topSegment.label}`
                    : '—'
                }
                helper={
                  topSegment
                    ? `${toDisplayNumber(topSegment.computedPercentage).toFixed(1)}% of total`
                    : null
                }
              />
            </div>
          ) : null}

          {/* --------------------------------------------------------------
              Main visualization
              ------------------------------------------------------------ */}
          <div className="titech-donut-card__body">
            <div
              className="titech-donut-card__chart"
              role="img"
              aria-label={`${title}. ${visibleCount} categories.`}
              style={{
                height:
                  resolvedHeight,
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
              >
                <PieChart>
                  <Pie
                    data={
                      processedData
                    }
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={
                      innerRadius
                    }
                    outerRadius={
                      outerRadius
                    }
                    startAngle={
                      startAngle
                    }
                    endAngle={
                      endAngle
                    }
                    paddingAngle={
                      paddingAngle
                    }
                    stroke="var(--titech-surface, var(--color-white))"
                    strokeWidth={
                      2
                    }
                    isAnimationActive={
                      false
                    }
                    onClick={
                      interactive
                        ? handlePieClick
                        : undefined
                    }
                    onMouseEnter={
                      undefined
                    }
                    labelLine={
                      false
                    }
                  >
                    {processedData.map(
                      (
                        item,
                        index,
                      ) => {
                        const isSelected =
                          !effectiveSelectedKey ||
                          effectiveSelectedKey ===
                            item.key;

                        return (
                          <Cell
                            key={`${item.key}-${index}`}
                            fill={
                              item.color ||
                              DEFAULT_COLORS[
                                index %
                                  DEFAULT_COLORS.length
                              ]
                            }
                            opacity={
                              isSelected
                                ? 1
                                : 0.28
                            }
                            style={{
                              cursor:
                                interactive
                                  ? 'pointer'
                                  : 'default',
                              outline:
                                'none',
                            }}
                          />
                        );
                      },
                    )}
                  </Pie>

                  <Tooltip
                    content={
                      <DonutTooltip
                        currency={
                          currency
                        }
                        locale={
                          locale
                        }
                        valueType={
                          valueType
                        }
                        showPercentage={
                          showPercentage
                        }
                      />
                    }
                  />

                  {showCenterLabel ? (
                    <DonutCenterLabel
                      total={
                        effectiveSelectedKey
                          ? processedData.find(
                              (
                                item,
                              ) =>
                                item.key ===
                                effectiveSelectedKey,
                            )
                              ?.value ??
                            total
                          : total
                      }
                      currency={
                        currency
                      }
                      locale={
                        locale
                      }
                      valueType={
                        valueType
                      }
                      centerLabel={
                        effectiveSelectedKey
                          ? processedData.find(
                              (
                                item,
                              ) =>
                                item.key ===
                                effectiveSelectedKey,
                            )
                              ?.label ??
                            centerLabel
                          : centerLabel
                      }
                      centerSubLabel={
                        centerSubLabel
                      }
                      centerValueFormatter={
                        centerValueFormatter
                      }
                    />
                  ) : null}
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* ------------------------------------------------------------
                Legend
                ---------------------------------------------------------- */}
            {showLegend ? (
              <div
                className="titech-donut-card__legend"
                role="list"
                aria-label={`${title} categories`}
                style={{
                  maxHeight:
                    legendMaxHeight,
                }}
              >
                {processedData.map(
                  (item) => (
                    <DonutLegendItem
                      key={
                        item.key
                      }
                      item={{
                        ...item,
                        label:
                          labelFor(
                            item,
                          ),
                      }}
                      selected={
                        !effectiveSelectedKey ||
                        effectiveSelectedKey ===
                          item.key
                      }
                      interactive={
                        interactive
                      }
                      onSelect={
                        handleSelect
                      }
                      valueType={
                        valueType
                      }
                      currency={
                        currency
                      }
                      locale={
                        locale
                      }
                      showValues={
                        showValues
                      }
                      showPercentage={
                        showPercentage
                      }
                      valueFormatter={
                        valueFormatter
                      }
                    />
                  ),
                )}
              </div>
            ) : null}
          </div>

          {/* --------------------------------------------------------------
              Footer
              ------------------------------------------------------------ */}
          {showFooter ||
          footer ||
          footerNote ? (
            <footer className="titech-donut-card__footer">
              {footer ? (
                <div>
                  {footer}
                </div>
              ) : null}

              {footerNote ? (
                <div>
                  {footerNote}
                </div>
              ) : null}
            </footer>
          ) : null}

          <style>
            {`
              .titech-donut-card {
                --titech-donut-surface:
                  var(
                    --titech-surface,
                    var(--color-white)
                  );

                --titech-donut-surface-muted:
                  var(
                    --titech-surface-muted,
                    #f8fafc
                  );

                --titech-donut-border:
                  var(
                    --titech-border,
                    #e2e8f0
                  );

                --titech-donut-border-strong:
                  var(
                    --titech-border-strong,
                    #cbd5e1
                  );

                --titech-donut-text:
                  var(
                    --titech-text-primary,
                    #0f172a
                  );

                --titech-donut-text-muted:
                  var(
                    --titech-text-secondary,
                    #64748b
                  );

                --titech-donut-primary:
                  var(
                    --titech-primary,
                    #0f172a
                  );

                --titech-donut-focus:
                  var(
                    --titech-focus-ring,
                    #2563eb
                  );

                width: 100%;
                min-width: 0;
                color:
                  var(--titech-donut-text);
                font: inherit;
              }

              .titech-donut-card *,
              .titech-donut-card
                *::before,
              .titech-donut-card
                *::after {
                box-sizing: border-box;
              }

              .titech-donut-card--bordered {
                border: 1px solid
                  var(--titech-donut-border);
                border-radius: 16px;
                background:
                  var(
                    --titech-donut-surface
                  );
              }

              .titech-donut-card--elevated {
                box-shadow:
                  0 10px 30px
                  rgba(
                    15,
                    23,
                    42,
                    0.08
                  );
              }

              .titech-donut-card--compact {
                font-size: 0.95em;
              }

              /* ----------------------------------------------------------
                 Header
                 -------------------------------------------------------- */

              .titech-donut-card__header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 16px;
                flex-wrap: wrap;
                padding: 18px 18px 0;
              }

              .titech-donut-card__header-main {
                min-width: 0;
                flex: 1 1 auto;
              }

              .titech-donut-card__eyebrow {
                margin-bottom: 5px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 9px;
                line-height: 1.3;
                font-weight: 800;
                letter-spacing:
                  0.08em;
                text-transform:
                  uppercase;
              }

              .titech-donut-card__title {
                margin: 0;
                color:
                  var(
                    --titech-donut-text
                  );
                font-size: 17px;
                line-height: 1.3;
                font-weight: 800;
                letter-spacing:
                  -0.012em;
              }

              .titech-donut-card__description {
                max-width: 700px;
                margin: 5px 0 0;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 11px;
                line-height: 1.5;
              }

              .titech-donut-card__currency {
                flex: 0 0 auto;
                padding: 5px 8px;
                border: 1px solid
                  var(
                    --titech-donut-border
                  );
                border-radius: 7px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 9px;
                line-height: 1.2;
                font-weight: 800;
                letter-spacing:
                  0.05em;
              }

              /* ----------------------------------------------------------
                 Summary
                 -------------------------------------------------------- */

              .titech-donut-card__summary {
                display: grid;
                grid-template-columns:
                  repeat(
                    auto-fit,
                    minmax(
                      125px,
                      1fr
                    )
                  );
                gap: 10px;
                margin: 18px;
                margin-bottom: 4px;
              }

              .titech-donut-card__summary-metric {
                min-width: 0;
              }

              .titech-donut-card__summary-label {
                margin-bottom: 4px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 9px;
                line-height: 1.2;
                font-weight: 800;
                text-transform:
                  uppercase;
                letter-spacing:
                  0.04em;
              }

              .titech-donut-card__summary-value {
                color:
                  var(
                    --titech-donut-text
                  );
                font-size: 15px;
                line-height: 1.3;
                font-weight: 850;
                font-variant-numeric:
                  tabular-nums;
                overflow-wrap:
                  anywhere;
              }

              .titech-donut-card__summary-helper {
                margin-top: 3px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 8px;
                line-height: 1.35;
              }

              /* ----------------------------------------------------------
                 Body
                 -------------------------------------------------------- */

              .titech-donut-card__body {
                display: grid;
                grid-template-columns:
                  minmax(
                    250px,
                    1.15fr
                  )
                  minmax(
                    190px,
                    0.85fr
                  );
                align-items: center;
                gap: 8px;
                padding: 10px 18px 18px;
              }

              .titech-donut-card__chart {
                position: relative;
                width: 100%;
                min-width: 0;
              }

              /* ----------------------------------------------------------
                 Center label
                 -------------------------------------------------------- */

              .titech-donut-card__center {
                position: absolute;
                left: 50%;
                top: 50%;
                display: flex;
                width: 42%;
                min-width: 100px;
                transform:
                  translate(
                    -50%,
                    -50%
                  );
                flex-direction:
                  column;
                align-items: center;
                justify-content: center;
                pointer-events:
                  none;
                text-align: center;
              }

              .titech-donut-card__center-label {
                max-width: 100%;
                margin-bottom: 4px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 9px;
                line-height: 1.25;
                font-weight: 700;
                overflow-wrap:
                  anywhere;
              }

              .titech-donut-card__center-value {
                max-width: 100%;
                color:
                  var(
                    --titech-donut-text
                  );
                font-size: 18px;
                line-height: 1.2;
                font-weight: 850;
                font-variant-numeric:
                  tabular-nums;
                overflow-wrap:
                  anywhere;
              }

              .titech-donut-card__center-sub-label {
                max-width: 100%;
                margin-top: 4px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 8px;
                line-height: 1.35;
                overflow-wrap:
                  anywhere;
              }

              /* ----------------------------------------------------------
                 Legend
                 -------------------------------------------------------- */

              .titech-donut-card__legend {
                display: flex;
                flex-direction: column;
                gap: 5px;
                min-width: 0;
                overflow-y: auto;
                padding-right: 3px;
                scrollbar-width: thin;
              }

              .titech-donut-card__legend-item {
                display: grid;
                grid-template-columns:
                  auto
                  minmax(
                    0,
                    1fr
                  )
                  auto
                  auto;
                align-items: center;
                gap: 7px;
                width: 100%;
                min-width: 0;
                min-height: 33px;
                padding: 6px 7px;
                border: 1px solid
                  transparent;
                border-radius: 8px;
                background:
                  transparent;
                color:
                  var(
                    --titech-donut-text
                  );
                font: inherit;
                font-size: 10px;
                line-height: 1.25;
                text-align: left;
              }

              button.titech-donut-card__legend-item {
                cursor: pointer;
              }

              button.titech-donut-card__legend-item:hover:not(
                :disabled
              ) {
                border-color:
                  var(
                    --titech-donut-border
                  );
                background:
                  var(
                    --titech-donut-surface-muted
                  );
              }

              .titech-donut-card__legend-item:focus-visible {
                outline: 3px solid
                  var(
                    --titech-donut-focus
                  );
                outline-offset: 2px;
              }

              .titech-donut-card__legend-item--muted {
                opacity: 0.48;
              }

              .titech-donut-card__legend-item:disabled {
                cursor:
                  not-allowed;
                opacity: 0.4;
              }

              .titech-donut-card__legend-marker {
                display: block;
                width: 8px;
                height: 8px;
                flex: 0 0 auto;
                border-radius:
                  50%;
              }

              .titech-donut-card__legend-label {
                min-width: 0;
                overflow-wrap:
                  anywhere;
              }

              .titech-donut-card__legend-value {
                min-width: 0;
                color:
                  var(
                    --titech-donut-text
                  );
                font-variant-numeric:
                  tabular-nums;
                font-weight: 750;
                text-align:
                  right;
              }

              .titech-donut-card__legend-percent {
                min-width: 42px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-variant-numeric:
                  tabular-nums;
                font-weight: 700;
                text-align:
                  right;
              }

              /* ----------------------------------------------------------
                 States
                 -------------------------------------------------------- */

              .titech-donut-card__state {
                display: grid;
                place-items: center;
                align-content: center;
                min-width: 0;
                padding: 28px 22px;
                border:
                  1px dashed
                  var(
                    --titech-donut-border-strong
                  );
                border-radius: 11px;
                background:
                  var(
                    --titech-donut-surface-muted
                  );
                color:
                  var(
                    --titech-donut-text
                  );
                text-align: center;
              }

              .titech-donut-card__state--error {
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

              .titech-donut-card__state-icon {
                display: grid;
                place-items: center;
                width: 46px;
                height: 46px;
                margin-bottom: 9px;
                border-radius: 12px;
                background:
                  var(
                    --titech-donut-surface
                  );
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 20px;
                font-weight: 800;
              }

              .titech-donut-card__state-title {
                margin-bottom: 5px;
                font-size: 13px;
                line-height: 1.35;
                font-weight: 800;
              }

              .titech-donut-card__state-message {
                max-width: 460px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 10px;
                line-height: 1.55;
                overflow-wrap:
                  anywhere;
              }

              .titech-donut-card__state-action {
                margin-top: 14px;
              }

              .titech-donut-card__retry {
                min-height: 36px;
                padding:
                  7px 13px;
                border: 1px solid
                  var(
                    --titech-primary,
                    #0f172a
                  );
                border-radius: 8px;
                background:
                  var(
                    --titech-primary,
                    #0f172a
                  );
                color:
                  var(--color-white);
                font: inherit;
                font-size: 10px;
                font-weight: 800;
                cursor: pointer;
              }

              .titech-donut-card__retry:focus-visible {
                outline: 3px solid
                  var(
                    --titech-focus-ring,
                    #2563eb
                  );
                outline-offset: 2px;
              }

              /* ----------------------------------------------------------
                 Footer
                 -------------------------------------------------------- */

              .titech-donut-card__footer {
                display: flex;
                justify-content:
                  space-between;
                align-items:
                  center;
                gap: 12px;
                flex-wrap:
                  wrap;
                padding:
                  0 18px 15px;
                color:
                  var(
                    --titech-donut-text-muted
                  );
                font-size: 9px;
                line-height: 1.45;
              }

              /* ----------------------------------------------------------
                 Compact mode
                 -------------------------------------------------------- */

              .titech-donut-card--compact
                .titech-donut-card__body {
                grid-template-columns:
                  minmax(
                    200px,
                    1fr
                  )
                  minmax(
                    165px,
                    0.9fr
                  );
                gap: 0;
                padding:
                  6px 14px 14px;
              }

              .titech-donut-card--compact
                .titech-donut-card__summary {
                margin:
                  12px 14px
                  2px;
              }

              /* ----------------------------------------------------------
                 Responsive
                 -------------------------------------------------------- */

              @media (max-width: 760px) {
                .titech-donut-card__body {
                  grid-template-columns:
                    1fr;
                }

                .titech-donut-card__legend {
                  max-height:
                    none;
                }

                .titech-donut-card__chart {
                  max-width:
                    480px;
                  margin:
                    0 auto;
                }
              }

              @media (max-width: 480px) {
                .titech-donut-card__summary {
                  grid-template-columns:
                    1fr;
                }

                .titech-donut-card__header {
                  padding:
                    14px 14px 0;
                }

                .titech-donut-card__body {
                  padding:
                    6px 14px 14px;
                }

                .titech-donut-card__legend-item {
                  grid-template-columns:
                    auto
                    minmax(
                      0,
                      1fr
                    )
                    auto;
                }

                .titech-donut-card__legend-value {
                  display:
                    none;
                }

                .titech-donut-card__center-value {
                  font-size:
                    16px;
                }
              }

              @media (prefers-reduced-motion: reduce) {
                .titech-donut-card *,
                .titech-donut-card
                  *::before,
                .titech-donut-card
                  *::after {
                  animation:
                    none !important;
                  transition:
                    none !important;
                }
              }

              @media print {
                .titech-donut-card {
                  break-inside:
                    avoid;
                  page-break-inside:
                    avoid;
                  box-shadow:
                    none !important;
                }
              }
            `}
          </style>
        </CardShell>
      </section>
    );
  },
);

DonutChartCard.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Card shell
 * ========================================================================== */

const CardShell = memo(
  function CardShell({
    title,
    description,
    eyebrow,
    currency,
    hideHeader,
    children,
  }) {
    return (
      <div
        style={{
          width: '100%',
          minWidth: 0,
        }}
      >
        {!hideHeader ? (
          <header className="titech-donut-card__header">
            <div className="titech-donut-card__header-main">
              {eyebrow ? (
                <div className="titech-donut-card__eyebrow">
                  {eyebrow}
                </div>
              ) : null}

              <h2 className="titech-donut-card__title">
                {title}
              </h2>

              {description ? (
                <p className="titech-donut-card__description">
                  {description}
                </p>
              ) : null}
            </div>

            {currency ? (
              <span
                className="titech-donut-card__currency"
                aria-label={`Reporting currency ${currency}`}
              >
                {currency}
              </span>
            ) : null}
          </header>
        ) : null}

        {children}
      </div>
    );
  },
);

CardShell.displayName =
  'CardShell';

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DonutChartCard,
  DonutLegendItem,
  DonutTooltip,
  DonutCenterLabel,
  SummaryMetric,
  StatePanel,
  CardShell,
  normalizeData,
  normalizeRecord,
  calculatePercentages,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatCompactCurrency,
  toDisplayNumber,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default DonutChartCard;