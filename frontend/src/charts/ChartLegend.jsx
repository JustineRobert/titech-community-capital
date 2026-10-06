'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartLegend.jsx
 *
 * Purpose:
 *   Canonical enterprise-grade legend component for TITech charts,
 *   analytics, reporting and dashboard visualizations.
 *
 * Responsibilities:
 *   - Render consistent TITech chart legends.
 *   - Support Recharts Legend payloads.
 *   - Support simple application-defined legend items.
 *   - Support controlled and uncontrolled visibility state.
 *   - Allow users to show/hide individual chart series.
 *   - Support active / inactive / warning / error / loading states.
 *   - Support keyboard navigation and accessible semantics.
 *   - Support dense, compact, standard and large variants.
 *   - Support horizontal and vertical layouts.
 *   - Support custom item rendering.
 *   - Provide optional aggregate metadata.
 *   - Preserve chart-library independence.
 *
 * Financial integrity:
 *   - Presentation-only component.
 *   - Never mutates transaction, ledger, balance, settlement or
 *     reconciliation state.
 *   - Never infers financial state from chart visibility.
 *   - Hidden chart series are a UI presentation state only.
 *   - Backend-authoritative financial values remain authoritative.
 *
 * Recharts integration:
 *
 *   <Legend
 *     content={(props) => (
 *       <ChartLegend {...props} />
 *     )}
 *   />
 *
 * Standalone usage:
 *
 *   <ChartLegend
 *     items={[
 *       {
 *         key: 'inflow',
 *         label: 'Cash inflow',
 *         color: 'var(--titech-chart-inflow)',
 *       },
 *       {
 *         key: 'outflow',
 *         label: 'Cash outflow',
 *         color: 'var(--titech-chart-outflow)',
 *       },
 *     ]}
 *   />
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechChartLegend';

const DEFAULT_VARIANT =
  'standard';

const DEFAULT_LAYOUT =
  'horizontal';

const DEFAULT_ALIGN =
  'left';

const DEFAULT_GAP = 10;

const DEFAULT_ITEM_GAP = 7;

const DEFAULT_LABEL_MAX_LENGTH =
  80;

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

const DEFAULT_EMPTY_MESSAGE =
  'No chart series are available.';

const DEFAULT_LOADING_MESSAGE =
  'Loading chart series…';

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

function firstDefined(
  object,
  keys,
) {
  if (!object || typeof object !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        object,
        key,
      ) &&
      object[key] !== undefined &&
      object[key] !== null
    ) {
      return object[key];
    }
  }

  return undefined;
}

function truncateLabel(
  value,
  maxLength = DEFAULT_LABEL_MAX_LENGTH,
) {
  const text = String(
    value ?? '',
  );

  if (
    text.length <= maxLength
  ) {
    return text;
  }

  return `${text.slice(
    0,
    Math.max(1, maxLength - 1),
  )}…`;
}

/* ============================================================================
 * Item normalization
 * ========================================================================== */

/**
 * Supports:
 *
 *   {
 *     key,
 *     label,
 *     color,
 *     inactive,
 *     disabled,
 *     hidden,
 *     value,
 *     dataKey
 *   }
 *
 * Recharts payload commonly contains:
 *
 *   {
 *     value,
 *     type,
 *     color,
 *     dataKey,
 *     inactive
 *   }
 */
function normalizeLegendItem(
  item,
  index,
) {
  const source =
    isObject(item)
      ? item
      : {};

  const key =
    firstDefined(source, [
      'key',
      'id',
      'dataKey',
      'value',
    ]) ??
    `series-${index}`;

  const rawLabel =
    firstDefined(source, [
      'label',
      'value',
      'name',
      'dataKey',
    ]) ??
    key;

  const label = String(
    rawLabel ?? key,
  );

  const color =
    firstDefined(source, [
      'color',
      'stroke',
      'fill',
      'payload.color',
    ]) ??
    DEFAULT_COLORS[
      index %
        DEFAULT_COLORS.length
    ];

  return {
    ...source,

    key: String(key),

    dataKey:
      source.dataKey ??
      key,

    label,

    displayLabel:
      source.displayLabel ??
      label,

    color,

    inactive:
      Boolean(source.inactive),

    hidden:
      Boolean(source.hidden),

    disabled:
      Boolean(source.disabled),

    loading:
      Boolean(source.loading),

    status:
      source.status ??
      null,

    value:
      source.value ?? null,

    type:
      source.type ??
      'line',

    icon:
      source.icon ??
      null,

    description:
      source.description ??
      null,

    meta:
      source.meta ??
      null,

    raw: item,
  };
}

function normalizeLegendItems(
  items,
  payload,
) {
  const source =
    Array.isArray(items) &&
    items.length > 0
      ? items
      : Array.isArray(payload)
        ? payload
        : [];

  return source.map(
    normalizeLegendItem,
  );
}

/* ============================================================================
 * Visibility helpers
 * ========================================================================== */

function normalizeVisibilityMap(
  value,
) {
  if (!isObject(value)) {
    return {};
  }

  return Object.entries(value).reduce(
    (result, [key, visible]) => {
      result[String(key)] =
        Boolean(visible);

      return result;
    },
    {},
  );
}

function isItemVisible(
  item,
  visibility,
) {
  const key = String(
    item.key,
  );

  if (
    Object.prototype.hasOwnProperty.call(
      visibility,
      key,
    )
  ) {
    return Boolean(
      visibility[key],
    );
  }

  if (item.hidden) {
    return false;
  }

  if (item.inactive) {
    return false;
  }

  return true;
}

function createInitialVisibility(
  items,
) {
  return items.reduce(
    (result, item) => {
      result[String(item.key)] =
        !item.hidden &&
        !item.inactive;

      return result;
    },
    {},
  );
}

function countVisibleItems(
  items,
  visibility,
) {
  return items.reduce(
    (count, item) =>
      count +
      (isItemVisible(
        item,
        visibility,
      )
        ? 1
        : 0),
    0,
  );
}

/* ============================================================================
 * Icons
 * ========================================================================== */

const LegendSeriesIcon = memo(
  function LegendSeriesIcon({
    type = 'line',
    color,
    inactive,
  }) {
    const opacity = inactive
      ? 0.35
      : 1;

    if (
      type === 'square' ||
      type === 'rect'
    ) {
      return (
        <span
          className="titech-chart-legend__marker titech-chart-legend__marker--square"
          style={{
            background:
              color,
            opacity,
          }}
          aria-hidden="true"
        />
      );
    }

    if (
      type === 'circle'
    ) {
      return (
        <span
          className="titech-chart-legend__marker titech-chart-legend__marker--circle"
          style={{
            background:
              color,
            opacity,
          }}
          aria-hidden="true"
        />
      );
    }

    if (
      type === 'dashed'
    ) {
      return (
        <span
          className="titech-chart-legend__line titech-chart-legend__line--dashed"
          style={{
            borderTopColor:
              color,
            opacity,
          }}
          aria-hidden="true"
        />
      );
    }

    return (
      <span
        className="titech-chart-legend__line"
        style={{
          borderTopColor:
            color,
          opacity,
        }}
        aria-hidden="true"
      />
    );
  },
);

LegendSeriesIcon.displayName =
  'LegendSeriesIcon';

const LegendCheckIcon = memo(
  function LegendCheckIcon() {
    return (
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M5 12.5L10 17L19 7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  },
);

LegendCheckIcon.displayName =
  'LegendCheckIcon';

/* ============================================================================
 * Status indicator
 * ========================================================================== */

const LegendStatus = memo(
  function LegendStatus({
    status,
  }) {
    if (!status) {
      return null;
    }

    const normalized =
      String(status)
        .toLowerCase()
        .trim();

    const labelMap = {
      active: 'Active',
      healthy: 'Healthy',
      live: 'Live',
      pending: 'Pending',
      delayed: 'Delayed',
      warning: 'Warning',
      error: 'Error',
      failed: 'Failed',
      offline: 'Offline',
    };

    const label =
      labelMap[normalized] ||
      String(status);

    return (
      <span
        className={classNames(
          'titech-chart-legend__status',
          `titech-chart-legend__status--${normalized}`,
        )}
        title={label}
      >
        <span
          className="titech-chart-legend__status-dot"
          aria-hidden="true"
        />

        <span className="titech-chart-legend__status-label">
          {label}
        </span>
      </span>
    );
  },
);

LegendStatus.displayName =
  'LegendStatus';

/* ============================================================================
 * Legend item
 * ========================================================================== */

const LegendItem = memo(
  function LegendItem({
    item,

    visible,

    interactive,

    disabled,

    onToggle,

    customRenderer,

    size,

    labelMaxLength,

    showValues,

    valueFormatter,

    showStatus,

    showDescription,

    onItemFocus,

    onItemBlur,
  }) {
    const effectiveDisabled =
      disabled ||
      item.disabled;

    const displayLabel =
      truncateLabel(
        item.displayLabel ||
          item.label,
        labelMaxLength,
      );

    const valueText =
      showValues &&
      item.value !==
        null &&
      item.value !==
        undefined
        ? typeof valueFormatter ===
          'function'
          ? valueFormatter(
              item.value,
              item,
            )
          : String(item.value)
        : null;

    const handleActivate =
      (event) => {
        if (
          effectiveDisabled ||
          !interactive
        ) {
          return;
        }

        if (
          event.type ===
            'click' ||
          event.key ===
            'Enter' ||
          event.key ===
            ' '
        ) {
          if (
            event.key ===
            ' '
          ) {
            event.preventDefault();
          }

          onToggle?.(
            item,
            !visible,
          );
        }
      };

    const defaultContent = (
      <>
        <span className="titech-chart-legend__indicator">
          <LegendSeriesIcon
            type={item.type}
            color={item.color}
            inactive={
              !visible
            }
          />
        </span>

        <span className="titech-chart-legend__label">
          {displayLabel}
        </span>

        {valueText ? (
          <span className="titech-chart-legend__value">
            {valueText}
          </span>
        ) : null}

        {showStatus ? (
          <LegendStatus
            status={
              item.status
            }
          />
        ) : null}

        {interactive ? (
          <span
            className={classNames(
              'titech-chart-legend__check',
              visible &&
                'titech-chart-legend__check--visible',
            )}
            aria-hidden="true"
          >
            {visible ? (
              <LegendCheckIcon />
            ) : null}
          </span>
        ) : null}
      </>
    );

    if (
      typeof customRenderer ===
      'function'
    ) {
      return customRenderer({
        item,
        visible,
        disabled:
          effectiveDisabled,
        toggle:
          () =>
            onToggle?.(
              item,
              !visible,
            ),
        content:
          defaultContent,
      });
    }

    const commonProps = {
      className: classNames(
        'titech-chart-legend__item',
        visible &&
          'titech-chart-legend__item--visible',
        !visible &&
          'titech-chart-legend__item--inactive',
        effectiveDisabled &&
          'titech-chart-legend__item--disabled',
        `titech-chart-legend__item--${size}`,
      ),
      title:
        item.description
          ? `${item.label}: ${item.description}`
          : item.label,
      onFocus: () =>
        onItemFocus?.(item),
      onBlur: () =>
        onItemBlur?.(item),
    };

    if (
      interactive
    ) {
      return (
        <button
          type="button"
          {...commonProps}
          aria-pressed={
            visible
          }
          aria-label={`${visible ? 'Hide' : 'Show'} ${item.label}`}
          disabled={
            effectiveDisabled
          }
          onClick={
            handleActivate
          }
          onKeyDown={
            handleActivate
          }
        >
          {defaultContent}

          {showDescription &&
          item.description ? (
            <span className="titech-chart-legend__sr-only">
              {item.description}
            </span>
          ) : null}
        </button>
      );
    }

    return (
      <div
        {...commonProps}
        role="listitem"
      >
        {defaultContent}

        {showDescription &&
        item.description ? (
          <span className="titech-chart-legend__sr-only">
            {item.description}
          </span>
        ) : null}
      </div>
    );
  },
);

LegendItem.displayName =
  'LegendItem';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartLegend = memo(
  forwardRef(function ChartLegend(
    {
      payload = [],

      items = null,

      value = undefined,

      visibility: controlledVisibility,

      defaultVisibility = undefined,

      onVisibilityChange = null,

      onToggle = null,

      interactive = false,

      disabled = false,

      loading = false,

      empty = false,

      emptyMessage =
        DEFAULT_EMPTY_MESSAGE,

      loadingMessage =
        DEFAULT_LOADING_MESSAGE,

      title = null,

      description = null,

      showTitle = false,

      showValues = false,

      valueFormatter = null,

      showStatus = false,

      showDescription = false,

      aggregate = null,

      aggregateFormatter = null,

      renderItem = null,

      renderHeader = null,

      renderFooter = null,

      variant =
        DEFAULT_VARIANT,

      layout =
        DEFAULT_LAYOUT,

      align =
        DEFAULT_ALIGN,

      gap = DEFAULT_GAP,

      itemGap =
        DEFAULT_ITEM_GAP,

      size = 'medium',

      labelMaxLength =
        DEFAULT_LABEL_MAX_LENGTH,

      maxItems = null,

      wrap = true,

      showSelectAll = false,

      showClearAll = false,

      selectAllLabel =
        'Show all',

      clearAllLabel =
        'Hide all',

      selectedLabel = null,

      selectedCountLabel = null,

      collapsible = false,

      defaultCollapsed = false,

      collapseLabel =
        'Toggle chart legend',

      className = '',

      style = undefined,

      listClassName = '',

      listStyle = undefined,

      testId = null,

      id = null,

      ariaLabel =
        'Chart legend',

      role = 'list',

      onItemFocus = null,

      onItemBlur = null,

    },
    forwardedRef,
  ) {
    const generatedId =
      useId();

    const rootRef =
      useRef(null);

    const [internalVisibility, setInternalVisibility] =
      useState({});

    const [collapsed, setCollapsed] =
      useState(
        Boolean(
          defaultCollapsed,
        ),
      );

    const normalizedItems =
      useMemo(
        () =>
          normalizeLegendItems(
            items,
            payload,
          ),
        [items, payload],
      );

    /**
     * Apply optional item limiting without changing the original payload.
     */
    const displayedItems =
      useMemo(() => {
        if (
          !Number.isFinite(
            Number(maxItems),
          ) ||
          Number(maxItems) <=
            0
        ) {
          return normalizedItems;
        }

        return normalizedItems.slice(
          0,
          Number(maxItems),
        );
      }, [
        normalizedItems,
        maxItems,
      ]);

    const initialVisibility =
      useMemo(() => {
        if (
          controlledVisibility &&
          isObject(
            controlledVisibility,
          )
        ) {
          return normalizeVisibilityMap(
            controlledVisibility,
          );
        }

        if (
          defaultVisibility &&
          isObject(
            defaultVisibility,
          )
        ) {
          return normalizeVisibilityMap(
            defaultVisibility,
          );
        }

        return createInitialVisibility(
          displayedItems,
        );
      }, [
        controlledVisibility,
        defaultVisibility,
        displayedItems,
      ]);

    /**
     * Keep uncontrolled state synchronized when a new legend payload appears.
     * Existing explicit user visibility selections are retained.
     */
    useEffect(() => {
      if (
        controlledVisibility !==
        undefined
      ) {
        return;
      }

      setInternalVisibility(
        (previous) => {
          const next = {
            ...initialVisibility,
            ...previous,
          };

          displayedItems.forEach(
            (item) => {
              const key =
                String(
                  item.key,
                );

              if (
                !Object.prototype.hasOwnProperty.call(
                  next,
                  key,
                )
              ) {
                next[key] =
                  isItemVisible(
                    item,
                    next,
                  );
              }
            },
          );

          return next;
        },
      );
    }, [
      controlledVisibility,
      initialVisibility,
      displayedItems,
    ]);

    const visibility =
      controlledVisibility !==
      undefined
        ? normalizeVisibilityMap(
            controlledVisibility,
          )
        : internalVisibility;

    const selectedCount =
      useMemo(
        () =>
          countVisibleItems(
            displayedItems,
            visibility,
          ),
        [
          displayedItems,
          visibility,
        ],
      );

    const allSelected =
      displayedItems.length >
        0 &&
      selectedCount ===
        displayedItems.length;

    const noneSelected =
      displayedItems.length >
        0 &&
      selectedCount === 0;

    const rootId =
      id ||
      generatedId;

    const updateVisibility =
      useCallback(
        (nextVisibility) => {
          const normalized =
            normalizeVisibilityMap(
              nextVisibility,
            );

          if (
            controlledVisibility ===
            undefined
          ) {
            setInternalVisibility(
              normalized,
            );
          }

          onVisibilityChange?.(
            normalized,
          );

          return normalized;
        },
        [
          controlledVisibility,
          onVisibilityChange,
        ],
      );

    const toggleItem =
      useCallback(
        (
          item,
          nextVisible,
        ) => {
          if (
            disabled ||
            loading ||
            item.disabled
          ) {
            return;
          }

          const key = String(
            item.key,
          );

          const normalizedNext =
            nextVisible ??
            !isItemVisible(
              item,
              visibility,
            );

          const nextVisibility =
            {
              ...visibility,
              [key]:
                Boolean(
                  normalizedNext,
                ),
            };

          updateVisibility(
            nextVisibility,
          );

          onToggle?.(
            item,
            Boolean(
              normalizedNext,
            ),
            nextVisibility,
          );
        },
        [
          disabled,
          loading,
          visibility,
          updateVisibility,
          onToggle,
        ],
      );

    const showAll =
      useCallback(() => {
        if (
          disabled ||
          loading
        ) {
          return;
        }

        const next =
          displayedItems.reduce(
            (result, item) => {
              result[
                String(item.key)
              ] =
                !item.disabled;

              return result;
            },
            {},
          );

        updateVisibility(
          next,
        );
      }, [
        disabled,
        loading,
        displayedItems,
        updateVisibility,
      ]);

    const clearAll =
      useCallback(() => {
        if (
          disabled ||
          loading
        ) {
          return;
        }

        const next =
          displayedItems.reduce(
            (result, item) => {
              result[
                String(item.key)
              ] = false;

              return result;
            },
            {},
          );

        updateVisibility(
          next,
        );
      }, [
        disabled,
        loading,
        displayedItems,
        updateVisibility,
      ]);

    const listItems = useMemo(
      () =>
        displayedItems.map(
          (item) => ({
            ...item,
            visible:
              isItemVisible(
                item,
                visibility,
              ),
          }),
        ),
      [
        displayedItems,
        visibility,
      ],
    );

    const aggregateText =
      aggregate !==
        null &&
      aggregate !==
        undefined
        ? typeof aggregateFormatter ===
          'function'
          ? aggregateFormatter(
              aggregate,
              listItems,
            )
          : String(
              aggregate,
            )
        : null;

    const selectedText =
      typeof selectedCountLabel ===
      'function'
        ? selectedCountLabel(
            selectedCount,
            displayedItems.length,
          )
        : selectedLabel ||
          `${selectedCount} of ${displayedItems.length} visible`;

    const rootClasses =
      classNames(
        'titech-chart-legend',
        `titech-chart-legend--${variant}`,
        `titech-chart-legend--${layout}`,
        `titech-chart-legend--${align}`,
        `titech-chart-legend--${size}`,
        wrap &&
          'titech-chart-legend--wrap',
        collapsed &&
          'titech-chart-legend--collapsed',
        disabled &&
          'titech-chart-legend--disabled',
        className,
      );

    const listClasses =
      classNames(
        'titech-chart-legend__list',
        listClassName,
      );

    const resolvedHeightGap =
      typeof gap ===
      'number'
        ? `${gap}px`
        : gap;

    const resolvedItemGap =
      typeof itemGap ===
      'number'
        ? `${itemGap}px`
        : itemGap;

    const setRootRef =
      useCallback(
        (node) => {
          rootRef.current =
            node;

          if (
            typeof forwardedRef ===
            'function'
          ) {
            forwardedRef(node);
          } else if (
            forwardedRef
          ) {
            forwardedRef.current =
              node;
          }
        },
        [forwardedRef],
      );

    if (
      loading
    ) {
      return (
        <section
          ref={setRootRef}
          className={
            rootClasses
          }
          aria-label={
            ariaLabel
          }
          aria-busy="true"
          data-testid={
            testId ||
            undefined
          }
          style={style}
        >
          <div className="titech-chart-legend__state">
            <span className="titech-chart-legend__loading-dot" />
            <span>
              {loadingMessage}
            </span>
          </div>

          <style>
            {getLegendStyles()}
          </style>
        </section>
      );
    }

    if (
      empty ||
      displayedItems.length ===
        0
    ) {
      return (
        <section
          ref={setRootRef}
          className={
            rootClasses
          }
          aria-label={
            ariaLabel
          }
          data-testid={
            testId ||
            undefined
          }
          style={style}
        >
          {showTitle ||
          title ? (
            <div className="titech-chart-legend__header">
              {typeof renderHeader ===
              'function'
                ? renderHeader({
                    title,
                    description,
                  })
                : (
                  <>
                    {title ? (
                      <div className="titech-chart-legend__title">
                        {title}
                      </div>
                    ) : null}

                    {description ? (
                      <div className="titech-chart-legend__description">
                        {
                          description
                        }
                      </div>
                    ) : null}
                  </>
                )}
            </div>
          ) : null}

          <div
            className="titech-chart-legend__state"
            role="status"
          >
            <span>
              {emptyMessage}
            </span>
          </div>

          <style>
            {getLegendStyles()}
          </style>
        </section>
      );
    }

    return (
      <section
        ref={setRootRef}
        className={rootClasses}
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
        {/* ------------------------------------------------------------------
            Header
            ---------------------------------------------------------------- */}
        {showTitle ||
        title ||
        description ||
        aggregateText ? (
          <div className="titech-chart-legend__header">
            {typeof renderHeader ===
            'function'
              ? renderHeader({
                  title,
                  description,
                  aggregate:
                    aggregateText,
                  selectedCount,
                  totalCount:
                    displayedItems.length,
                })
              : (
                <div className="titech-chart-legend__header-content">
                  <div className="titech-chart-legend__header-main">
                    {title ? (
                      <div className="titech-chart-legend__title">
                        {title}
                      </div>
                    ) : null}

                    {description ? (
                      <div className="titech-chart-legend__description">
                        {
                          description
                        }
                      </div>
                    ) : null}
                  </div>

                  {aggregateText ? (
                    <div className="titech-chart-legend__aggregate">
                      {aggregateText}
                    </div>
                  ) : null}
                </div>
              )}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------
            Controls
            ---------------------------------------------------------------- */}
        {(interactive ||
          showSelectAll ||
          showClearAll ||
          selectedLabel) &&
        !collapsed ? (
          <div className="titech-chart-legend__controls">
            {interactive &&
            selectedLabel ? (
              <span
                className="titech-chart-legend__selection"
                aria-live="polite"
              >
                {selectedText}
              </span>
            ) : null}

            {showSelectAll ? (
              <button
                type="button"
                className="titech-chart-legend__control-button"
                disabled={
                  disabled ||
                  loading ||
                  allSelected
                }
                onClick={
                  showAll
                }
              >
                {selectAllLabel}
              </button>
            ) : null}

            {showClearAll ? (
              <button
                type="button"
                className="titech-chart-legend__control-button"
                disabled={
                  disabled ||
                  loading ||
                  noneSelected
                }
                onClick={
                  clearAll
                }
              >
                {clearAllLabel}
              </button>
            ) : null}

            {collapsible ? (
              <button
                type="button"
                className="titech-chart-legend__control-button titech-chart-legend__control-button--collapse"
                aria-expanded={
                  !collapsed
                }
                aria-label={
                  collapseLabel
                }
                onClick={() =>
                  setCollapsed(
                    (previous) =>
                      !previous,
                  )
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  style={{
                    transform:
                      collapsed
                        ? 'rotate(-90deg)'
                        : 'rotate(0deg)',
                    transition:
                      'transform 160ms ease',
                  }}
                >
                  <path
                    d="M6 9L12 15L18 9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>

                <span>
                  {collapseLabel}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------
            Legend list
            ---------------------------------------------------------------- */}
        {!collapsed ? (
          <div
            className={listClasses}
            role={role}
            aria-label={
              title
                ? `${title} series`
                : ariaLabel
            }
            style={{
              '--titech-legend-gap':
                resolvedHeightGap,

              '--titech-legend-item-gap':
                resolvedItemGap,

              ...listStyle,
            }}
          >
            {listItems.map(
              (item) => (
                <LegendItem
                  key={
                    String(
                      item.key,
                    )
                  }
                  item={
                    item
                  }
                  visible={
                    item.visible
                  }
                  interactive={
                    interactive
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                  onToggle={
                    toggleItem
                  }
                  customRenderer={
                    renderItem
                  }
                  size={size}
                  labelMaxLength={
                    labelMaxLength
                  }
                  showValues={
                    showValues
                  }
                  valueFormatter={
                    valueFormatter
                  }
                  showStatus={
                    showStatus
                  }
                  showDescription={
                    showDescription
                  }
                  onItemFocus={
                    onItemFocus
                  }
                  onItemBlur={
                    onItemBlur
                  }
                />
              ),
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------
            Footer
            ---------------------------------------------------------------- */}
        {typeof renderFooter ===
        'function' ? (
          <div className="titech-chart-legend__footer">
            {renderFooter({
              items: listItems,
              visibleCount:
                selectedCount,
              totalCount:
                displayedItems.length,
              allSelected,
              noneSelected,
            })}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------
            Accessibility description
            ---------------------------------------------------------------- */}
        {interactive ? (
          <span className="titech-chart-legend__sr-only">
            Use Enter or Space on a series to
            show or hide that chart series.
          </span>
        ) : null}

        <style>
          {getLegendStyles()}
        </style>
      </section>
    );
  }),
);

ChartLegend.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Styles
 * ========================================================================== */

function getLegendStyles() {
  return `
    .titech-chart-legend {
      --titech-legend-surface:
        var(
          --titech-surface,
          var(--color-white)
        );

      --titech-legend-surface-muted:
        var(
          --titech-surface-muted,
          #f8fafc
        );

      --titech-legend-border:
        var(
          --titech-border,
          #e2e8f0
        );

      --titech-legend-border-strong:
        var(
          --titech-border-strong,
          #cbd5e1
        );

      --titech-legend-text:
        var(
          --titech-text-primary,
          #0f172a
        );

      --titech-legend-text-muted:
        var(
          --titech-text-secondary,
          #64748b
        );

      --titech-legend-primary:
        var(
          --titech-primary,
          #0f172a
        );

      --titech-legend-focus:
        var(
          --titech-focus-ring,
          #2563eb
        );

      --titech-legend-success:
        var(
          --titech-success,
          #047857
        );

      --titech-legend-warning:
        var(
          --titech-warning,
          #92400e
        );

      --titech-legend-danger:
        var(
          --titech-danger,
          #b91c1c
        );

      width: 100%;
      min-width: 0;
      color:
        var(--titech-legend-text);
      font: inherit;
    }

    .titech-chart-legend *,
    .titech-chart-legend
      *::before,
    .titech-chart-legend
      *::after {
      box-sizing: border-box;
    }

    .titech-chart-legend--wrap
      .titech-chart-legend__list {
      flex-wrap: wrap;
    }

    .titech-chart-legend__header {
      margin-bottom: 9px;
    }

    .titech-chart-legend__header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      flex-wrap: wrap;
    }

    .titech-chart-legend__header-main {
      min-width: 0;
    }

    .titech-chart-legend__title {
      margin: 0;
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
    }

    .titech-chart-legend__description {
      margin-top: 3px;
      max-width: 660px;
      color:
        var(--titech-legend-text-muted);
      font-size: 10px;
      line-height: 1.45;
    }

    .titech-chart-legend__aggregate {
      flex: 0 0 auto;
      color:
        var(--titech-legend-text-muted);
      font-size: 10px;
      font-weight: 700;
      text-align: right;
    }

    .titech-chart-legend__controls {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .titech-chart-legend__selection {
      margin-right: auto;
      color:
        var(--titech-legend-text-muted);
      font-size: 10px;
      line-height: 1.3;
    }

    .titech-chart-legend__control-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 28px;
      padding: 5px 8px;
      border: 1px solid
        var(--titech-legend-border);
      border-radius: 7px;
      background:
        var(--titech-legend-surface);
      color:
        var(--titech-legend-text-muted);
      font: inherit;
      font-size: 9px;
      line-height: 1.2;
      font-weight: 750;
      cursor: pointer;
    }

    .titech-chart-legend__control-button:hover:not(
      :disabled
    ) {
      border-color:
        var(
          --titech-legend-border-strong
        );
      background:
        var(
          --titech-legend-surface-muted
        );
      color:
        var(--titech-legend-text);
    }

    .titech-chart-legend__control-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .titech-chart-legend__control-button:focus-visible,
    .titech-chart-legend__item:focus-visible {
      outline: 3px solid
        var(--titech-legend-focus);
      outline-offset: 2px;
    }

    .titech-chart-legend__list {
      display: flex;
      align-items: center;
      gap:
        var(--titech-legend-gap);
      min-width: 0;
      width: 100%;
    }

    .titech-chart-legend--vertical
      .titech-chart-legend__list {
      flex-direction: column;
      align-items: stretch;
    }

    .titech-chart-legend--left
      .titech-chart-legend__list {
      justify-content: flex-start;
    }

    .titech-chart-legend--center
      .titech-chart-legend__list {
      justify-content: center;
    }

    .titech-chart-legend--right
      .titech-chart-legend__list {
      justify-content: flex-end;
    }

    .titech-chart-legend__item {
      display: inline-flex;
      align-items: center;
      gap:
        var(--titech-legend-item-gap);
      min-width: 0;
      max-width: 100%;
      padding: 2px 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color:
        var(--titech-legend-text);
      font: inherit;
      font-size: 11px;
      line-height: 1.35;
      text-align: left;
    }

    button.titech-chart-legend__item {
      cursor: pointer;
    }

    button.titech-chart-legend__item:hover:not(
      :disabled
    ) {
      background:
        var(
          --titech-legend-surface-muted
        );
    }

    .titech-chart-legend__item--inactive {
      color:
        var(--titech-legend-text-muted);
      opacity: 0.66;
    }

    .titech-chart-legend__item--disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }

    .titech-chart-legend__indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
    }

    .titech-chart-legend__line {
      display: block;
      width: 17px;
      border-top:
        3px solid currentColor;
      border-top-color:
        var(
          --titech-legend-marker-color,
          currentColor
        );
      border-radius: 999px;
    }

    .titech-chart-legend__line--dashed {
      border-top-style: dashed;
    }

    .titech-chart-legend__marker {
      display: block;
      width: 9px;
      height: 9px;
      flex: 0 0 auto;
    }

    .titech-chart-legend__marker--square {
      border-radius: 2px;
    }

    .titech-chart-legend__marker--circle {
      border-radius: 50%;
    }

    .titech-chart-legend__label {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .titech-chart-legend__value {
      flex: 0 0 auto;
      color:
        var(
          --titech-legend-text-muted
        );
      font-variant-numeric:
        tabular-nums;
      font-weight: 700;
    }

    .titech-chart-legend__check {
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      margin-left: 1px;
      border: 1px solid
        var(--titech-legend-border-strong);
      border-radius: 4px;
      color:
        var(--titech-legend-primary);
    }

    .titech-chart-legend__check--visible {
      background:
        var(--titech-legend-surface);
    }

    .titech-chart-legend__status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      color:
        var(--titech-legend-text-muted);
      font-size: 8px;
      line-height: 1.2;
      font-weight: 800;
      white-space: nowrap;
    }

    .titech-chart-legend__status-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background:
        currentColor;
    }

    .titech-chart-legend__status--active,
    .titech-chart-legend__status--healthy,
    .titech-chart-legend__status--live {
      color:
        var(--titech-legend-success);
    }

    .titech-chart-legend__status--pending,
    .titech-chart-legend__status--delayed,
    .titech-chart-legend__status--warning {
      color:
        var(--titech-legend-warning);
    }

    .titech-chart-legend__status--error,
    .titech-chart-legend__status--failed {
      color:
        var(--titech-legend-danger);
    }

    .titech-chart-legend__footer {
      margin-top: 9px;
      color:
        var(--titech-legend-text-muted);
      font-size: 9px;
      line-height: 1.45;
    }

    .titech-chart-legend__state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 38px;
      padding: 10px 12px;
      border:
        1px dashed
        var(--titech-legend-border-strong);
      border-radius: 9px;
      background:
        var(--titech-legend-surface-muted);
      color:
        var(--titech-legend-text-muted);
      font-size: 10px;
      line-height: 1.4;
      text-align: center;
    }

    .titech-chart-legend__loading-dot {
      width: 7px;
      height: 7px;
      border:
        2px solid
        currentColor;
      border-right-color:
        transparent;
      border-radius: 50%;
      animation:
        titech-chart-legend-spin
        700ms linear infinite;
    }

    .titech-chart-legend__sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    /* ------------------------------------------------------------------------
       Size variants
       ---------------------------------------------------------------------- */

    .titech-chart-legend--small
      .titech-chart-legend__item {
      font-size: 9px;
    }

    .titech-chart-legend--small
      .titech-chart-legend__indicator {
      width: 15px;
    }

    .titech-chart-legend--small
      .titech-chart-legend__line {
      width: 14px;
    }

    .titech-chart-legend--large
      .titech-chart-legend__item {
      font-size: 12px;
    }

    .titech-chart-legend--large
      .titech-chart-legend__indicator {
      width: 20px;
    }

    .titech-chart-legend--large
      .titech-chart-legend__line {
      width: 19px;
    }

    /* ------------------------------------------------------------------------
       Variant modes
       ---------------------------------------------------------------------- */

    .titech-chart-legend--compact {
      font-size: 10px;
    }

    .titech-chart-legend--compact
      .titech-chart-legend__item {
      padding: 1px 3px;
    }

    .titech-chart-legend--pill
      .titech-chart-legend__item {
      min-height: 28px;
      padding: 5px 8px;
      border: 1px solid
        var(--titech-legend-border);
      border-radius: 999px;
      background:
        var(--titech-legend-surface);
    }

    .titech-chart-legend--pill
      .titech-chart-legend__item:hover:not(
        :disabled
      ) {
      border-color:
        var(
          --titech-legend-border-strong
        );
      background:
        var(
          --titech-legend-surface-muted
        );
    }

    .titech-chart-legend--bordered {
      padding: 12px;
      border: 1px solid
        var(--titech-legend-border);
      border-radius: 10px;
      background:
        var(--titech-legend-surface);
    }

    .titech-chart-legend--collapsed
      .titech-chart-legend__controls {
      margin-bottom: 0;
    }

    @keyframes titech-chart-legend-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 600px) {
      .titech-chart-legend__header-content {
        flex-direction: column;
        align-items: flex-start;
      }

      .titech-chart-legend__aggregate {
        text-align: left;
      }

      .titech-chart-legend__controls {
        justify-content: flex-start;
      }

      .titech-chart-legend__selection {
        width: 100%;
        margin-right: 0;
      }

      .titech-chart-legend__list {
        gap: 7px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .titech-chart-legend *,
      .titech-chart-legend
        *::before,
      .titech-chart-legend
        *::after {
        animation: none !important;
        transition: none !important;
      }
    }

    @media print {
      .titech-chart-legend__controls {
        display: none !important;
      }

      .titech-chart-legend__item {
        color: #000000 !important;
      }
    }
  `;
}

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ChartLegend,
  LegendItem,
  LegendSeriesIcon,
  LegendStatus,
  normalizeLegendItem,
  normalizeLegendItems,
  normalizeVisibilityMap,
  createInitialVisibility,
  countVisibleItems,
  isItemVisible,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartLegend;