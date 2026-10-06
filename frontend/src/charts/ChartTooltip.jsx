'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartTooltip.jsx
 *
 * Purpose:
 *   Enterprise-grade, reusable tooltip surface for TITech charts,
 *   analytics dashboards, reporting panels and financial visualizations.
 *
 * Design principles:
 *   - Presentation-only.
 *   - No financial calculations or mutations.
 *   - No ledger/balance/settlement state changes.
 *   - Defensive against malformed chart-library payloads.
 *   - Compatible with Recharts-style tooltip payloads.
 *   - Independent of any specific charting library at the component level.
 *   - Accessible to keyboard and assistive-technology users.
 *   - Supports TITech Community Capital design tokens.
 *   - Supports dark/light themes through CSS variables.
 *   - Supports currency, percentage, integer, decimal and compact values.
 *   - Supports financial transaction-state display without implying settlement.
 *   - Does not use localStorage, sessionStorage or network requests.
 *
 * Financial integrity:
 *   This component only renders values supplied to it by its parent.
 *
 *   It MUST NOT:
 *     - calculate account balances;
 *     - create ledger entries;
 *     - modify transaction state;
 *     - infer settlement;
 *     - infer provider acceptance;
 *     - infer successful payment completion;
 *     - mutate financial records;
 *     - perform provider calls;
 *     - make reconciliation decisions.
 *
 * Typical usage with Recharts:
 *
 *   <Tooltip
 *     content={
 *       <ChartTooltip
 *         valueFormat="currency"
 *         currency="UGX"
 *       />
 *     }
 *   />
 *
 * Or:
 *
 *   <Tooltip
 *     content={
 *       <ChartTooltip
 *         valueFormat="compact"
 *         title="Contribution trend"
 *       />
 *     }
 *   />
 *
 * Custom payload example:
 *
 *   <ChartTooltip
 *     active
 *     label="September"
 *     payload={[
 *       {
 *         name: "Contributions",
 *         value: 1250000,
 *         dataKey: "contributions",
 *       },
 *     ]}
 *   />
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useMemo,
} from 'react';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechChartTooltip';

const DEFAULT_EMPTY_LABEL =
  'No chart data';

const DEFAULT_CURRENCY =
  'UGX';

const DEFAULT_LOCALE =
  'en-UG';

const DEFAULT_MAX_ITEMS =
  20;

const DEFAULT_DECIMAL_PLACES =
  2;

const VALID_FORMATS = new Set([
  'auto',
  'raw',
  'number',
  'integer',
  'decimal',
  'currency',
  'compact',
  'percentage',
]);

const VALID_VARIANTS = new Set([
  'default',
  'compact',
  'detailed',
]);

const FINANCIAL_STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  initiated: 'Initiated',
  submitted: 'Submitted',
  accepted: 'Accepted',
  provider_accepted: 'Provider accepted',
  successful: 'Successful',
  succeeded: 'Successful',
  completed: 'Completed',
  confirmed: 'Confirmed',
  settled: 'Settled',
  reconciled: 'Reconciled',
  failed: 'Failed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  expired: 'Expired',
  reversed: 'Reversed',
  refunded: 'Refunded',
  disputed: 'Disputed',
  offline: 'Offline',
  local_only: 'Local only',
};

/* ============================================================================
 * Utility functions
 * ========================================================================== */

/**
 * Safely joins CSS class names.
 */
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

/**
 * Converts arbitrary input into a finite number.
 *
 * Returns null rather than silently converting invalid values to zero.
 *
 * This is important for financial displays because:
 *
 *   Number(undefined) === NaN
 *   Number(null) === 0
 *
 * Treating null as zero can incorrectly imply a financial value exists.
 */
function toFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const numeric =
    typeof value === 'number'
      ? value
      : Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

/**
 * Safely normalizes text.
 */
function normalizeText(
  value,
  fallback = '',
) {
  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    const text = String(value).trim();

    return text || fallback;
  }

  return fallback;
}

/**
 * Returns true when a value represents a valid chart payload item.
 */
function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Normalizes a supported formatting mode.
 */
function normalizeFormat(value) {
  if (
    typeof value === 'string' &&
    VALID_FORMATS.has(value)
  ) {
    return value;
  }

  return 'auto';
}

/**
 * Normalizes the component variant.
 */
function normalizeVariant(value) {
  if (
    typeof value === 'string' &&
    VALID_VARIANTS.has(value)
  ) {
    return value;
  }

  return 'default';
}

/**
 * Normalizes a maximum item count.
 */
function normalizeMaxItems(value) {
  const numeric = Number(value);

  if (
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    return DEFAULT_MAX_ITEMS;
  }

  return Math.min(
    Math.floor(numeric),
    100,
  );
}

/**
 * Converts internal/status values into user-facing labels.
 *
 * Status values remain descriptive. This component does not determine
 * whether the status is financially authoritative.
 */
function formatStatusLabel(value) {
  const normalized =
    normalizeText(value)
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

  if (
    FINANCIAL_STATUS_LABELS[
      normalized
    ]
  ) {
    return FINANCIAL_STATUS_LABELS[
      normalized
    ];
  }

  if (!normalized) {
    return '';
  }

  return normalized
    .split('_')
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(' ');
}

/**
 * Returns a semantic status class.
 */
function resolveStatusTone(status) {
  const normalized =
    normalizeText(status)
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

  if (
    [
      'successful',
      'succeeded',
      'completed',
      'confirmed',
      'settled',
      'reconciled',
    ].includes(normalized)
  ) {
    return 'success';
  }

  if (
    [
      'failed',
      'rejected',
      'cancelled',
      'canceled',
      'expired',
      'disputed',
    ].includes(normalized)
  ) {
    return 'danger';
  }

  if (
    [
      'pending',
      'processing',
      'initiated',
      'submitted',
      'accepted',
      'provider_accepted',
      'offline',
      'local_only',
    ].includes(normalized)
  ) {
    return 'warning';
  }

  if (
    [
      'reversed',
      'refunded',
    ].includes(normalized)
  ) {
    return 'neutral';
  }

  return 'neutral';
}

/**
 * Resolves a locale without throwing when an invalid locale is supplied.
 */
function resolveLocale(locale) {
  const candidate =
    normalizeText(
      locale,
      DEFAULT_LOCALE,
    );

  try {
    new Intl.NumberFormat(
      candidate,
    );

    return candidate;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Creates an Intl.NumberFormat instance safely.
 */
function createNumberFormatter({
  locale,
  format,
  currency,
  minimumFractionDigits,
  maximumFractionDigits,
}) {
  const resolvedLocale =
    resolveLocale(locale);

  const safeFormat =
    normalizeFormat(format);

  const fractionMin =
    Number.isFinite(
      minimumFractionDigits,
    )
      ? Math.max(
          0,
          Math.floor(
            minimumFractionDigits,
          ),
        )
      : undefined;

  const fractionMax =
    Number.isFinite(
      maximumFractionDigits,
    )
      ? Math.max(
          0,
          Math.floor(
            maximumFractionDigits,
          ),
        )
      : undefined;

  try {
    switch (safeFormat) {
      case 'integer':
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            maximumFractionDigits: 0,
          },
        );

      case 'decimal':
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            minimumFractionDigits:
              fractionMin ??
              DEFAULT_DECIMAL_PLACES,
            maximumFractionDigits:
              fractionMax ??
              DEFAULT_DECIMAL_PLACES,
          },
        );

      case 'currency':
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            style: 'currency',
            currency:
              normalizeText(
                currency,
                DEFAULT_CURRENCY,
              ),
            minimumFractionDigits:
              fractionMin,
            maximumFractionDigits:
              fractionMax,
          },
        );

      case 'compact':
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            notation: 'compact',
            maximumFractionDigits:
              fractionMax ??
              2,
          },
        );

      case 'percentage':
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            style: 'percent',
            minimumFractionDigits:
              fractionMin,
            maximumFractionDigits:
              fractionMax ??
              2,
          },
        );

      case 'number':
      case 'raw':
      case 'auto':
      default:
        return new Intl.NumberFormat(
          resolvedLocale,
          {
            minimumFractionDigits:
              fractionMin,
            maximumFractionDigits:
              fractionMax,
          },
        );
    }
  } catch {
    return new Intl.NumberFormat(
      DEFAULT_LOCALE,
      {
        maximumFractionDigits:
          fractionMax ?? 2,
      },
    );
  }
}

/**
 * Formats a chart value without converting invalid/null financial values
 * into zero.
 */
function formatChartValue(
  value,
  {
    format = 'auto',
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    minimumFractionDigits,
    maximumFractionDigits,
    valuePrefix = '',
    valueSuffix = '',
    percentageScale = 'fraction',
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  const numeric =
    toFiniteNumber(value);

  if (numeric === null) {
    return normalizeText(
      value,
      '—',
    );
  }

  const normalizedFormat =
    normalizeFormat(format);

  let displayValue =
    numeric;

  /**
   * Percentage handling is explicit.
   *
   * By default:
   *   0.25 => 25%
   *
   * If the parent already supplies percentage points:
   *   25 => 25%
   *
   * use percentageScale="points".
   */
  if (
    normalizedFormat ===
      'percentage' &&
    percentageScale === 'points'
  ) {
    displayValue =
      numeric / 100;
  }

  const formatter =
    createNumberFormatter({
      locale,
      format: normalizedFormat,
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    });

  let formatted;

  try {
    formatted =
      formatter.format(
        displayValue,
      );
  } catch {
    formatted =
      String(displayValue);
  }

  return `${valuePrefix || ''}${formatted}${valueSuffix || ''}`;
}

/**
 * Resolves a display label from a payload item.
 */
function resolvePayloadName(item) {
  if (!isObject(item)) {
    return '';
  }

  return normalizeText(
    item.name ??
      item.label ??
      item.dataKey ??
      item.key,
    '',
  );
}

/**
 * Resolves a display value from a payload item.
 */
function resolvePayloadValue(item) {
  if (!isObject(item)) {
    return null;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      item,
      'value',
    )
  ) {
    return item.value;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      item,
      'payload',
    ) &&
    isObject(item.payload)
  ) {
    if (
      item.dataKey &&
      Object.prototype.hasOwnProperty.call(
        item.payload,
        item.dataKey,
      )
    ) {
      return item.payload[
        item.dataKey
      ];
    }
  }

  return null;
}

/**
 * Resolves a stable key for React rendering.
 */
function resolvePayloadKey(
  item,
  index,
) {
  if (!isObject(item)) {
    return `tooltip-item-${index}`;
  }

  return normalizeText(
    item.dataKey ??
      item.name ??
      item.key,
    `tooltip-item-${index}`,
  );
}

/**
 * Removes duplicate payload entries while preserving order.
 */
function deduplicatePayload(
  payload,
) {
  if (!Array.isArray(payload)) {
    return [];
  }

  const seen = new Set();

  return payload.filter(
    (item) => {
      if (!isObject(item)) {
        return false;
      }

      const key =
        `${resolvePayloadName(item)}::${resolvePayloadValue(item)}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    },
  );
}

/* ============================================================================
 * Tooltip row
 * ========================================================================== */

const ChartTooltipRow = memo(
  function ChartTooltipRow({
    item,
    index,
    valueFormat,
    currency,
    locale,
    minimumFractionDigits,
    maximumFractionDigits,
    valuePrefix,
    valueSuffix,
    percentageScale,
    showIndicator,
    showDataKey,
    statusField,
  }) {
    const name =
      resolvePayloadName(item);

    const value =
      resolvePayloadValue(item);

    const itemFormat =
      normalizeFormat(
        item.valueFormat ||
          valueFormat,
      );

    const itemCurrency =
      item.currency ||
      currency;

    const itemPrefix =
      item.valuePrefix ??
      valuePrefix;

    const itemSuffix =
      item.valueSuffix ??
      valueSuffix;

    const itemPercentageScale =
      item.percentageScale ||
      percentageScale;

    const status =
      statusField &&
      isObject(item.payload)
        ? item.payload[
            statusField
          ]
        : item.status;

    const formattedValue =
      formatChartValue(
        value,
        {
          format: itemFormat,
          currency: itemCurrency,
          locale,
          minimumFractionDigits:
            item.minimumFractionDigits ??
            minimumFractionDigits,
          maximumFractionDigits:
            item.maximumFractionDigits ??
            maximumFractionDigits,
          valuePrefix: itemPrefix,
          valueSuffix: itemSuffix,
          percentageScale:
            itemPercentageScale,
        },
      );

    const statusLabel =
      formatStatusLabel(status);

    const statusTone =
      resolveStatusTone(status);

    const indicatorColor =
      item.color ||
      item.fill ||
      item.stroke ||
      'currentColor';

    return (
      <div
        className="titech-chart-tooltip__row"
        data-index={index}
      >
        <div className="titech-chart-tooltip__row-label">
          {showIndicator ? (
            <span
              className="titech-chart-tooltip__indicator"
              aria-hidden="true"
              style={{
                backgroundColor:
                  indicatorColor,
              }}
            />
          ) : null}

          <span className="titech-chart-tooltip__name">
            {name || 'Value'}
          </span>

          {showDataKey &&
          item.dataKey &&
          item.dataKey !== name ? (
            <span className="titech-chart-tooltip__data-key">
              {String(
                item.dataKey,
              )}
            </span>
          ) : null}
        </div>

        <div className="titech-chart-tooltip__row-value">
          <span>
            {formattedValue}
          </span>

          {statusLabel ? (
            <span
              className={classNames(
                'titech-chart-tooltip__status',
                `titech-chart-tooltip__status--${statusTone}`,
              )}
              aria-label={`Status: ${statusLabel}`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);

ChartTooltipRow.displayName =
  'ChartTooltipRow';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartTooltip = memo(
  forwardRef(
    function ChartTooltip(
      {
        active = false,
        payload = [],
        label = null,

        title = null,
        description = null,

        valueFormat = 'auto',
        currency = DEFAULT_CURRENCY,
        locale = DEFAULT_LOCALE,

        minimumFractionDigits =
          undefined,
        maximumFractionDigits =
          undefined,

        valuePrefix = '',
        valueSuffix = '',

        percentageScale =
          'fraction',

        variant = 'default',

        showIndicator = true,
        showDataKey = false,
        showLabel = true,
        showEmpty = false,
        showTimestamp = false,

        timestamp = null,
        status = null,
        statusField = null,

        maxItems =
          DEFAULT_MAX_ITEMS,

        className = '',
        style = undefined,

        testId = null,

        emptyLabel =
          DEFAULT_EMPTY_LABEL,

        renderLabel = null,
        renderValue = null,
        renderFooter = null,
        children = null,
      },
      forwardedRef,
    ) {
      const normalizedVariant =
        normalizeVariant(
          variant,
        );

      const safeMaxItems =
        normalizeMaxItems(
          maxItems,
        );

      const normalizedPayload =
        useMemo(
          () =>
            deduplicatePayload(
              payload,
            ).slice(
              0,
              safeMaxItems,
            ),
          [
            payload,
            safeMaxItems,
          ],
        );

      const hasPayload =
        normalizedPayload.length >
        0;

      const hasTimestamp =
        showTimestamp &&
        Boolean(timestamp);

      const effectiveStatus =
        status ||
        (
          statusField &&
          normalizedPayload[0] &&
          isObject(
            normalizedPayload[0]
              .payload,
          )
            ? normalizedPayload[0]
                .payload[
                statusField
              ]
            : null
        );

      const statusLabel =
        formatStatusLabel(
          effectiveStatus,
        );

      const statusTone =
        resolveStatusTone(
          effectiveStatus,
        );

      /**
       * Recharts invokes custom tooltip content with active=false while
       * moving away from a chart. Do not render the tooltip in that state
       * unless the caller explicitly requests an empty state.
       */
      if (
        !active &&
        !showEmpty
      ) {
        return null;
      }

      if (
        !hasPayload &&
        !showEmpty
      ) {
        return null;
      }

      const accessibleLabel =
        title ||
        normalizeText(
          label,
          'Chart details',
        );

      return (
        <div
          ref={forwardedRef}
          className={classNames(
            'titech-chart-tooltip',
            `titech-chart-tooltip--${normalizedVariant}`,
            hasPayload &&
              'titech-chart-tooltip--has-data',
            !hasPayload &&
              'titech-chart-tooltip--empty',
            className,
          )}
          role="tooltip"
          aria-label={accessibleLabel}
          data-component={
            COMPONENT_NAME
          }
          data-testid={
            testId || undefined
          }
          style={style}
        >
          <div className="titech-chart-tooltip__surface">
            {title ? (
              <div className="titech-chart-tooltip__title">
                {title}
              </div>
            ) : null}

            {showLabel &&
            label !== null &&
            label !== undefined ? (
              <div className="titech-chart-tooltip__label">
                {typeof renderLabel ===
                'function'
                  ? renderLabel(
                      label,
                    )
                  : normalizeText(
                      label,
                      emptyLabel,
                    )}
              </div>
            ) : null}

            {description ? (
              <div className="titech-chart-tooltip__description">
                {description}
              </div>
            ) : null}

            {hasPayload ? (
              <div className="titech-chart-tooltip__items">
                {normalizedPayload.map(
                  (
                    item,
                    index,
                  ) => (
                    <div
                      key={resolvePayloadKey(
                        item,
                        index,
                      )}
                      className="titech-chart-tooltip__custom-row"
                    >
                      {typeof renderValue ===
                      'function' ? (
                        renderValue({
                          item,
                          index,
                          value:
                            resolvePayloadValue(
                              item,
                            ),
                          name:
                            resolvePayloadName(
                              item,
                            ),
                        })
                      ) : (
                        <ChartTooltipRow
                          item={item}
                          index={index}
                          valueFormat={
                            valueFormat
                          }
                          currency={
                            currency
                          }
                          locale={
                            locale
                          }
                          minimumFractionDigits={
                            minimumFractionDigits
                          }
                          maximumFractionDigits={
                            maximumFractionDigits
                          }
                          valuePrefix={
                            valuePrefix
                          }
                          valueSuffix={
                            valueSuffix
                          }
                          percentageScale={
                            percentageScale
                          }
                          showIndicator={
                            showIndicator
                          }
                          showDataKey={
                            showDataKey
                          }
                          statusField={
                            statusField
                          }
                        />
                      )}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="titech-chart-tooltip__empty-message">
                {emptyLabel}
              </div>
            )}

            {statusLabel ? (
              <div className="titech-chart-tooltip__status-row">
                <span>
                  State
                </span>

                <span
                  className={classNames(
                    'titech-chart-tooltip__status',
                    `titech-chart-tooltip__status--${statusTone}`,
                  )}
                >
                  {statusLabel}
                </span>
              </div>
            ) : null}

            {hasTimestamp ? (
              <div className="titech-chart-tooltip__timestamp">
                {normalizeText(
                  timestamp,
                )}
              </div>
            ) : null}

            {children ? (
              <div className="titech-chart-tooltip__children">
                {children}
              </div>
            ) : null}

            {typeof renderFooter ===
            'function' ? (
              <div className="titech-chart-tooltip__footer">
                {renderFooter({
                  label,
                  payload:
                    normalizedPayload,
                })}
              </div>
            ) : null}
          </div>

          <style>
            {`
              .titech-chart-tooltip {
                --titech-tooltip-surface:
                  var(
                    --titech-surface,
                    var(--color-white)
                  );

                --titech-tooltip-surface-muted:
                  var(
                    --titech-surface-muted,
                    #f8fafc
                  );

                --titech-tooltip-border:
                  var(
                    --titech-border,
                    #e2e8f0
                  );

                --titech-tooltip-text:
                  var(
                    --titech-text-primary,
                    #0f172a
                  );

                --titech-tooltip-text-secondary:
                  var(
                    --titech-text-secondary,
                    #475569
                  );

                --titech-tooltip-text-muted:
                  var(
                    --titech-text-muted,
                    #64748b
                  );

                --titech-tooltip-shadow:
                  var(
                    --titech-shadow-lg,
                    0 12px 32px
                    rgba(
                      15,
                      23,
                      42,
                      0.14
                    )
                  );

                --titech-tooltip-success:
                  var(
                    --titech-success,
                    #15803d
                  );

                --titech-tooltip-warning:
                  var(
                    --titech-warning,
                    #a16207
                  );

                --titech-tooltip-danger:
                  var(
                    --titech-danger,
                    #b91c1c
                  );

                --titech-tooltip-neutral:
                  var(
                    --titech-text-muted,
                    #64748b
                  );

                position: relative;
                z-index: 1000;
                width: max-content;
                max-width:
                  min(
                    360px,
                    calc(
                      100vw - 24px
                    )
                  );

                color:
                  var(
                    --titech-tooltip-text
                  );

                font: inherit;
                pointer-events: none;
              }

              .titech-chart-tooltip *,
              .titech-chart-tooltip
                *::before,
              .titech-chart-tooltip
                *::after {
                box-sizing: border-box;
              }

              .titech-chart-tooltip__surface {
                width: 100%;
                min-width: 180px;
                padding: 12px 14px;

                border: 1px solid
                  var(
                    --titech-tooltip-border
                  );

                border-radius: 10px;

                background:
                  var(
                    --titech-tooltip-surface
                  );

                box-shadow:
                  var(
                    --titech-tooltip-shadow
                  );

                backdrop-filter:
                  blur(8px);
              }

              .titech-chart-tooltip__title {
                margin-bottom: 3px;

                color:
                  var(
                    --titech-tooltip-text
                  );

                font-size: 13px;
                font-weight: 700;
                line-height: 1.35;
              }

              .titech-chart-tooltip__label {
                margin-bottom: 8px;

                color:
                  var(
                    --titech-tooltip-text-secondary
                  );

                font-size: 12px;
                font-weight: 600;
                line-height: 1.4;
              }

              .titech-chart-tooltip__description {
                margin-bottom: 9px;

                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                font-size: 11px;
                line-height: 1.45;
              }

              .titech-chart-tooltip__items {
                display: flex;
                flex-direction: column;
                gap: 7px;
              }

              .titech-chart-tooltip__custom-row {
                min-width: 0;
              }

              .titech-chart-tooltip__row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 18px;
                min-width: 0;
              }

              .titech-chart-tooltip__row-label {
                display: flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
                flex: 1 1 auto;
              }

              .titech-chart-tooltip__indicator {
                width: 8px;
                height: 8px;
                flex: 0 0 8px;
                border-radius: 999px;
              }

              .titech-chart-tooltip__name {
                min-width: 0;

                color:
                  var(
                    --titech-tooltip-text-secondary
                  );

                font-size: 12px;
                line-height: 1.35;
                overflow-wrap: anywhere;
              }

              .titech-chart-tooltip__data-key {
                padding: 1px 5px;

                border: 1px solid
                  var(
                    --titech-tooltip-border
                  );

                border-radius: 4px;

                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                background:
                  var(
                    --titech-tooltip-surface-muted
                  );

                font-size: 9px;
                line-height: 1.3;
              }

              .titech-chart-tooltip__row-value {
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                flex: 0 0 auto;

                color:
                  var(
                    --titech-tooltip-text
                  );

                font-size: 12px;
                font-variant-numeric:
                  tabular-nums;
                font-weight: 700;
                line-height: 1.35;
                text-align: right;
                white-space: nowrap;
              }

              .titech-chart-tooltip__status-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;

                margin-top: 10px;
                padding-top: 8px;

                border-top: 1px solid
                  var(
                    --titech-tooltip-border
                  );

                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                font-size: 10px;
                line-height: 1.4;
              }

              .titech-chart-tooltip__status {
                display: inline-flex;
                align-items: center;

                min-height: 18px;
                padding: 2px 7px;

                border: 1px solid
                  currentColor;

                border-radius: 999px;

                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
                white-space: nowrap;
              }

              .titech-chart-tooltip__status--success {
                color:
                  var(
                    --titech-tooltip-success
                  );
              }

              .titech-chart-tooltip__status--warning {
                color:
                  var(
                    --titech-tooltip-warning
                  );
              }

              .titech-chart-tooltip__status--danger {
                color:
                  var(
                    --titech-tooltip-danger
                  );
              }

              .titech-chart-tooltip__status--neutral {
                color:
                  var(
                    --titech-tooltip-neutral
                  );
              }

              .titech-chart-tooltip__timestamp {
                margin-top: 8px;

                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                font-size: 10px;
                line-height: 1.4;
              }

              .titech-chart-tooltip__empty-message {
                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                font-size: 12px;
                line-height: 1.4;
              }

              .titech-chart-tooltip__children {
                margin-top: 9px;
                padding-top: 9px;

                border-top: 1px solid
                  var(
                    --titech-tooltip-border
                  );
              }

              .titech-chart-tooltip__footer {
                margin-top: 9px;
                padding-top: 8px;

                border-top: 1px solid
                  var(
                    --titech-tooltip-border
                  );

                color:
                  var(
                    --titech-tooltip-text-muted
                  );

                font-size: 10px;
                line-height: 1.4;
              }

              /* ------------------------------------------------------------
                 Compact variant
                 ---------------------------------------------------------- */

              .titech-chart-tooltip--compact
                .titech-chart-tooltip__surface {
                min-width: 150px;
                padding: 8px 10px;
                border-radius: 8px;
              }

              .titech-chart-tooltip--compact
                .titech-chart-tooltip__items {
                gap: 5px;
              }

              .titech-chart-tooltip--compact
                .titech-chart-tooltip__row {
                gap: 12px;
              }

              /* ------------------------------------------------------------
                 Detailed variant
                 ---------------------------------------------------------- */

              .titech-chart-tooltip--detailed
                .titech-chart-tooltip__surface {
                min-width: 230px;
                padding: 14px 16px;
                border-radius: 12px;
              }

              .titech-chart-tooltip--detailed
                .titech-chart-tooltip__items {
                gap: 9px;
              }

              .titech-chart-tooltip--detailed
                .titech-chart-tooltip__row {
                gap: 24px;
              }

              /* ------------------------------------------------------------
                 Empty state
                 ---------------------------------------------------------- */

              .titech-chart-tooltip--empty
                .titech-chart-tooltip__surface {
                min-width: 150px;
              }

              /* ------------------------------------------------------------
                 Dark theme support
                 ---------------------------------------------------------- */

              [data-theme='dark']
                .titech-chart-tooltip {
                --titech-tooltip-surface:
                  var(
                    --titech-surface,
                    #0f172a
                  );

                --titech-tooltip-surface-muted:
                  var(
                    --titech-surface-muted,
                    #1e293b
                  );

                --titech-tooltip-border:
                  var(
                    --titech-border,
                    #334155
                  );

                --titech-tooltip-text:
                  var(
                    --titech-text-primary,
                    #f8fafc
                  );

                --titech-tooltip-text-secondary:
                  var(
                    --titech-text-secondary,
                    #cbd5e1
                  );

                --titech-tooltip-text-muted:
                  var(
                    --titech-text-muted,
                    #94a3b8
                  );
              }

              /* ------------------------------------------------------------
                 Reduced motion
                 ---------------------------------------------------------- */

              @media (prefers-reduced-motion: reduce) {
                .titech-chart-tooltip {
                  scroll-behavior: auto;
                }
              }

              /* ------------------------------------------------------------
                 Mobile
                 ---------------------------------------------------------- */

              @media (max-width: 560px) {
                .titech-chart-tooltip {
                  max-width:
                    calc(
                      100vw - 16px
                    );
                }

                .titech-chart-tooltip__surface {
                  min-width: 150px;
                  padding: 10px 11px;
                }

                .titech-chart-tooltip__row {
                  gap: 10px;
                }

                .titech-chart-tooltip__name {
                  max-width: 155px;
                }
              }

              /* ------------------------------------------------------------
                 Print
                 ---------------------------------------------------------- */

              @media print {
                .titech-chart-tooltip {
                  display: none !important;
                }
              }
            `}
          </style>
        </div>
      );
    },
  ),
);

ChartTooltip.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ChartTooltip,
  ChartTooltipRow,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartTooltip;