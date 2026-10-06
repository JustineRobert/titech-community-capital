'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartFilters.jsx
 *
 * Purpose:
 *   Enterprise-grade, reusable filtering toolbar for TITech analytics,
 *   reporting and charting surfaces.
 *
 * Responsibilities:
 *   - Provide consistent TITech chart/report filtering UX.
 *   - Support date-range filtering.
 *   - Support predefined reporting periods.
 *   - Support tenant/institution/group filters.
 *   - Support currency and transaction/status filters.
 *   - Support search/filter text.
 *   - Support controlled and uncontrolled usage.
 *   - Separate draft filter changes from committed/applied filters.
 *   - Provide reset/clear behavior.
 *   - Support custom filter controls through slots.
 *   - Provide accessible labels, keyboard behavior and live announcements.
 *   - Keep the component independent of charting libraries.
 *
 * Financial integrity:
 *   - UI filtering only.
 *   - Does NOT mutate financial records.
 *   - Does NOT recalculate balances, journals, settlement or reconciliation.
 *   - Does NOT convert provider acceptance, pending, queued, offline,
 *     unknown or processing states into settled financial states.
 *   - Server-authoritative financial data remains authoritative.
 *
 * Supported usage:
 *
 *   <ChartFilters
 *     value={filters}
 *     onChange={setFilters}
 *     onApply={loadChart}
 *   />
 *
 * Or uncontrolled:
 *
 *   <ChartFilters
 *     defaultValue={{
 *       period: '30d',
 *       currency: 'UGX',
 *     }}
 *     onApply={loadChart}
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

const COMPONENT_NAME = 'TITechChartFilters';

const DEFAULT_FILTERS = {
  period: '30d',
  dateFrom: '',
  dateTo: '',
  institutionId: '',
  groupId: '',
  currency: 'UGX',
  status: '',
  type: '',
  search: '',
};

const DEFAULT_PERIOD_OPTIONS = [
  {
    value: '7d',
    label: 'Last 7 days',
  },
  {
    value: '30d',
    label: 'Last 30 days',
  },
  {
    value: '90d',
    label: 'Last 90 days',
  },
  {
    value: '6m',
    label: 'Last 6 months',
  },
  {
    value: '12m',
    label: 'Last 12 months',
  },
  {
    value: 'ytd',
    label: 'Year to date',
  },
  {
    value: 'custom',
    label: 'Custom range',
  },
];

const DEFAULT_CURRENCY_OPTIONS = [
  {
    value: 'UGX',
    label: 'UGX — Uganda Shilling',
  },
  {
    value: 'KES',
    label: 'KES — Kenyan Shilling',
  },
  {
    value: 'TZS',
    label: 'TZS — Tanzanian Shilling',
  },
  {
    value: 'RWF',
    label: 'RWF — Rwandan Franc',
  },
  {
    value: 'USD',
    label: 'USD — US Dollar',
  },
  {
    value: 'EUR',
    label: 'EUR — Euro',
  },
];

const DEFAULT_STATUS_OPTIONS = [
  {
    value: '',
    label: 'All statuses',
  },
  {
    value: 'SUCCESS',
    label: 'Successful',
  },
  {
    value: 'PENDING',
    label: 'Pending',
  },
  {
    value: 'PROCESSING',
    label: 'Processing',
  },
  {
    value: 'UNKNOWN',
    label: 'Unknown',
  },
  {
    value: 'FAILED',
    label: 'Failed',
  },
  {
    value: 'REVERSED',
    label: 'Reversed',
  },
  {
    value: 'REFUNDED',
    label: 'Refunded',
  },
];

const DEFAULT_TYPE_OPTIONS = [
  {
    value: '',
    label: 'All types',
  },
  {
    value: 'INFLOW',
    label: 'Cash inflow',
  },
  {
    value: 'OUTFLOW',
    label: 'Cash outflow',
  },
  {
    value: 'TRANSFER',
    label: 'Transfer',
  },
  {
    value: 'PAYMENT',
    label: 'Payment',
  },
  {
    value: 'CONTRIBUTION',
    label: 'Contribution',
  },
  {
    value: 'LOAN',
    label: 'Loan',
  },
  {
    value: 'PAYROLL',
    label: 'Payroll',
  },
];

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search transactions, members or references…';

const DEFAULT_APPLY_LABEL =
  'Apply filters';

const DEFAULT_RESET_LABEL =
  'Reset';

const DEFAULT_CLEAR_LABEL =
  'Clear';

const DEFAULT_COLLAPSE_LABEL =
  'Toggle filters';

const DEFAULT_FILTERS_LABEL =
  'Chart and report filters';

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

function normalizeFilters(value) {
  const source =
    isObject(value)
      ? value
      : {};

  return {
    ...DEFAULT_FILTERS,
    ...source,
  };
}

function areFiltersEqual(left, right) {
  const a =
    normalizeFilters(left);

  const b =
    normalizeFilters(right);

  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
  ]);

  for (const key of keys) {
    if (
      String(a[key] ?? '') !==
      String(b[key] ?? '')
    ) {
      return false;
    }
  }

  return true;
}

function countActiveFilters(
  filters,
  {
    exclude = [],
  } = {},
) {
  const normalized =
    normalizeFilters(filters);

  const excluded =
    new Set(exclude);

  return Object.entries(
    normalized,
  ).reduce(
    (count, [key, value]) => {
      if (excluded.has(key)) {
        return count;
      }

      if (
        key === 'period' &&
        (value ===
          DEFAULT_FILTERS.period ||
          value === '')
      ) {
        return count;
      }

      if (
        value === '' ||
        value === null ||
        value === undefined
      ) {
        return count;
      }

      return count + 1;
    },
    0,
  );
}

function normalizeOptions(
  options,
  fallback,
) {
  if (
    !Array.isArray(options) ||
    options.length === 0
  ) {
    return fallback;
  }

  return options
    .map((option) => {
      if (
        typeof option === 'string'
      ) {
        return {
          value: option,
          label: option,
        };
      }

      if (isObject(option)) {
        return {
          value:
            option.value ??
            option.id ??
            '',
          label:
            option.label ??
            option.name ??
            String(
              option.value ??
                option.id ??
                '',
            ),
          disabled:
            Boolean(option.disabled),
        };
      }

      return null;
    })
    .filter(
      (option) =>
        option &&
        String(option.value)
          .length > 0,
    );
}

function todayAsInputValue() {
  const date =
    new Date();

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1,
    ).padStart(2, '0');

  const day =
    String(
      date.getDate(),
    ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Validates only the UI date relationship.
 *
 * This does not assert that transactions actually occurred on a date;
 * server-side validation remains authoritative.
 */
function validateDateRange(
  dateFrom,
  dateTo,
) {
  if (
    !dateFrom ||
    !dateTo
  ) {
    return '';
  }

  const from =
    new Date(
      `${dateFrom}T00:00:00`,
    );

  const to =
    new Date(
      `${dateTo}T00:00:00`,
    );

  if (
    Number.isNaN(
      from.getTime(),
    ) ||
    Number.isNaN(
      to.getTime(),
    )
  ) {
    return 'Enter valid dates.';
  }

  if (from > to) {
    return 'The start date cannot be after the end date.';
  }

  return '';
}

function filterSignature(
  filters,
) {
  return JSON.stringify(
    normalizeFilters(filters),
    Object.keys(
      normalizeFilters(filters),
    ).sort(),
  );
}

/* ============================================================================
 * Default icons
 * ========================================================================== */

const FilterIcon = memo(
  function FilterIcon() {
    return (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 5H20"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        <path
          d="M7 12H17"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        <path
          d="M10 19H14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  },
);

FilterIcon.displayName =
  'FilterIcon';

const SearchIcon = memo(
  function SearchIcon() {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="10.8"
          cy="10.8"
          r="6.3"
          stroke="currentColor"
          strokeWidth="1.8"
        />

        <path
          d="M16 16L20 20"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  },
);

SearchIcon.displayName =
  'SearchIcon';

/* ============================================================================
 * Field
 * ========================================================================== */

const FilterField = memo(
  function FilterField({
    label,
    htmlFor,
    children,
    hint,
    error,
    required = false,
  }) {
    return (
      <div className="titech-chart-filters__field">
        <label
          className="titech-chart-filters__label"
          htmlFor={htmlFor}
        >
          {label}

          {required ? (
            <span
              className="titech-chart-filters__required"
              aria-hidden="true"
            >
              *
            </span>
          ) : null}
        </label>

        {children}

        {hint && !error ? (
          <div className="titech-chart-filters__hint">
            {hint}
          </div>
        ) : null}

        {error ? (
          <div
            className="titech-chart-filters__field-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>
    );
  },
);

FilterField.displayName =
  'FilterField';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartFilters = memo(
  forwardRef(function ChartFilters(
    {
      value,

      defaultValue = DEFAULT_FILTERS,

      onChange,

      onApply,

      onReset,

      onClear,

      disabled = false,

      loading = false,

      title =
        DEFAULT_FILTERS_LABEL,

      description = null,

      eyebrow = null,

      periods =
        DEFAULT_PERIOD_OPTIONS,

      currencies =
        DEFAULT_CURRENCY_OPTIONS,

      statuses =
        DEFAULT_STATUS_OPTIONS,

      types =
        DEFAULT_TYPE_OPTIONS,

      institutions = [],

      groups = [],

      showPeriod = true,

      showDateRange = true,

      showInstitution = true,

      showGroup = true,

      showCurrency = true,

      showStatus = true,

      showType = true,

      showSearch = true,

      showApply = true,

      showReset = true,

      showClear = false,

      showActiveCount = true,

      collapsible = false,

      defaultCollapsed = false,

      collapseLabel =
        DEFAULT_COLLAPSE_LABEL,

      applyLabel =
        DEFAULT_APPLY_LABEL,

      resetLabel =
        DEFAULT_RESET_LABEL,

      clearLabel =
        DEFAULT_CLEAR_LABEL,

      searchPlaceholder =
        DEFAULT_SEARCH_PLACEHOLDER,

      searchDebounce = 0,

      dateFromLabel =
        'From',

      dateToLabel =
        'To',

      periodLabel =
        'Reporting period',

      institutionLabel =
        'Institution',

      groupLabel =
        'Group',

      currencyLabel =
        'Currency',

      statusLabel =
        'Status',

      typeLabel =
        'Transaction type',

      searchLabel =
        'Search',

      dateRangeHint = null,

      renderCustomFilters = null,

      beforeApply = null,

      afterApply = null,

      onValidationError = null,

      validate = null,

      autoApply = false,

      resetOnUnmount = false,

      showHeader = true,

      variant = 'default',

      size = 'medium',

      bordered = true,

      compact = false,

      fullWidth = false,

      className = '',

      style = undefined,

      formClassName = '',

      testId = null,

      id = null,

      ariaLabel = null,

      liveAnnouncements = true,
    },
    forwardedRef,
  ) {
    const generatedId =
      useId();

    const rootRef =
      useRef(null);

    const isControlled =
      value !== undefined;

    const [internalValue, setInternalValue] =
      useState(() =>
        normalizeFilters(
          defaultValue,
        ),
      );

    const [appliedValue, setAppliedValue] =
      useState(() =>
        normalizeFilters(
          value ??
            defaultValue,
        ),
      );

    const [collapsed, setCollapsed] =
      useState(
        Boolean(defaultCollapsed),
      );

    const [validationError, setValidationError] =
      useState('');

    const [announcement, setAnnouncement] =
      useState('');

    const [isApplying, setIsApplying] =
      useState(false);

    const controlledFilters =
      useMemo(
        () =>
          normalizeFilters(value),
        [value],
      );

    const draftFilters =
      isControlled
        ? controlledFilters
        : internalValue;

    const normalizedPeriods =
      useMemo(
        () =>
          normalizeOptions(
            periods,
            DEFAULT_PERIOD_OPTIONS,
          ),
        [periods],
      );

    const normalizedCurrencies =
      useMemo(
        () =>
          normalizeOptions(
            currencies,
            DEFAULT_CURRENCY_OPTIONS,
          ),
        [currencies],
      );

    const normalizedStatuses =
      useMemo(
        () =>
          normalizeOptions(
            statuses,
            DEFAULT_STATUS_OPTIONS,
          ),
        [statuses],
      );

    const normalizedTypes =
      useMemo(
        () =>
          normalizeOptions(
            types,
            DEFAULT_TYPE_OPTIONS,
          ),
        [types],
      );

    const normalizedInstitutions =
      useMemo(
        () =>
          normalizeOptions(
            institutions,
            [],
          ),
        [institutions],
      );

    const normalizedGroups =
      useMemo(
        () =>
          normalizeOptions(
            groups,
            [],
          ),
        [groups],
      );

    const activeCount =
      useMemo(
        () =>
          countActiveFilters(
            draftFilters,
          ),
        [draftFilters],
      );

    const hasDraftChanges =
      useMemo(
        () =>
          !areFiltersEqual(
            draftFilters,
            appliedValue,
          ),
        [
          draftFilters,
          appliedValue,
        ],
      );

    const rangeError =
      useMemo(
        () =>
          validateDateRange(
            draftFilters.dateFrom,
            draftFilters.dateTo,
          ),
        [
          draftFilters.dateFrom,
          draftFilters.dateTo,
        ],
      );

    const baseId =
      id || generatedId;

    const fieldIds =
      useMemo(
        () => ({
          period: `${baseId}-period`,
          dateFrom: `${baseId}-date-from`,
          dateTo: `${baseId}-date-to`,
          institution: `${baseId}-institution`,
          group: `${baseId}-group`,
          currency: `${baseId}-currency`,
          status: `${baseId}-status`,
          type: `${baseId}-type`,
          search: `${baseId}-search`,
          form: `${baseId}-form`,
          live: `${baseId}-live`,
        }),
        [baseId],
      );

    const assignForwardedRef =
      useCallback(
        (node) => {
          rootRef.current = node;

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

    /**
     * Keep the local "applied" baseline aligned when a controlled parent
     * changes the applied filters externally.
     */
    useEffect(() => {
      if (!isControlled) {
        return;
      }

      setAppliedValue(
        normalizeFilters(value),
      );
    }, [
      isControlled,
      value,
    ]);

    /**
     * Optional cleanup behavior for screens which explicitly request it.
     */
    useEffect(
      () => () => {
        if (
          resetOnUnmount &&
          typeof onReset ===
            'function'
        ) {
          onReset({
            ...DEFAULT_FILTERS,
          });
        }
      },
      [resetOnUnmount, onReset],
    );

    const emitChange =
      useCallback(
        (nextFilters) => {
          const normalized =
            normalizeFilters(
              nextFilters,
            );

          if (!isControlled) {
            setInternalValue(
              normalized,
            );
          }

          if (
            typeof onChange ===
            'function'
          ) {
            onChange(
              normalized,
            );
          }

          return normalized;
        },
        [
          isControlled,
          onChange,
        ],
      );

    const updateFilter =
      useCallback(
        (key, nextValue) => {
          const nextFilters = {
            ...draftFilters,
            [key]:
              nextValue ?? '',
          };

          setValidationError('');

          return emitChange(
            nextFilters,
          );
        },
        [
          draftFilters,
          emitChange,
        ],
      );

    /**
     * Optional debounced search notification.
     *
     * The filter state itself is updated immediately. Debouncing only controls
     * an optional auto-apply operation and does not delay UI state.
     */
    useEffect(() => {
      if (
        !autoApply ||
        !searchDebounce ||
        searchDebounce <= 0
      ) {
        return undefined;
      }

      if (!draftFilters.search) {
        return undefined;
      }

      const timeout =
        window.setTimeout(() => {
          void applyFilters();
        }, searchDebounce);

      return () =>
        window.clearTimeout(
          timeout,
        );
      // `applyFilters` intentionally omitted to prevent unnecessary timers.
      // The latest filter state is captured by the effect's draft dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      draftFilters.search,
      searchDebounce,
      autoApply,
    ]);

    const runValidation =
      useCallback(
        async (filters) => {
          const errors = [];

          if (rangeError) {
            errors.push(
              rangeError,
            );
          }

          if (
            typeof validate ===
            'function'
          ) {
            const result =
              await validate(
                filters,
              );

            if (
              typeof result ===
              'string'
            ) {
              errors.push(result);
            }

            if (
              Array.isArray(result)
            ) {
              errors.push(
                ...result.filter(
                  Boolean,
                ),
              );
            }

            if (
              result === false
            ) {
              errors.push(
                'The selected filters are invalid.',
              );
            }
          }

          return errors.filter(
            (message, index, array) =>
              array.indexOf(
                message,
              ) === index,
          );
        },
        [
          rangeError,
          validate,
        ],
      );

    const applyFilters =
      useCallback(
        async (
          event,
        ) => {
          event?.preventDefault();

          if (
            disabled ||
            loading ||
            isApplying
          ) {
            return;
          }

          setValidationError('');
          setIsApplying(true);

          try {
            const nextFilters =
              normalizeFilters(
                draftFilters,
              );

            const errors =
              await runValidation(
                nextFilters,
              );

            if (errors.length > 0) {
              const combined =
                errors.join(' ');

              setValidationError(
                combined,
              );

              setAnnouncement(
                combined,
              );

              if (
                typeof onValidationError ===
                'function'
              ) {
                await onValidationError(
                  errors,
                  nextFilters,
                );
              }

              return;
            }

            if (
              typeof beforeApply ===
              'function'
            ) {
              await beforeApply(
                nextFilters,
              );
            }

            setAppliedValue(
              nextFilters,
            );

            if (
              !isControlled
            ) {
              setInternalValue(
                nextFilters,
              );
            }

            if (
              typeof onChange ===
              'function'
            ) {
              onChange(
                nextFilters,
              );
            }

            if (
              typeof onApply ===
              'function'
            ) {
              await onApply(
                nextFilters,
              );
            }

            if (
              typeof afterApply ===
              'function'
            ) {
              await afterApply(
                nextFilters,
              );
            }

            setAnnouncement(
              'Filters applied.',
            );
          } catch (error) {
            const message =
              error?.message ||
              'Unable to apply filters.';

            setValidationError(
              message,
            );

            setAnnouncement(
              message,
            );

            if (
              typeof onValidationError ===
              'function'
            ) {
              await onValidationError(
                [message],
                draftFilters,
              );
            }
          } finally {
            setIsApplying(false);
          }
        },
        [
          disabled,
          loading,
          isApplying,
          draftFilters,
          runValidation,
          beforeApply,
          afterApply,
          isControlled,
          onChange,
          onApply,
          onValidationError,
        ],
      );

    const resetFilters =
      useCallback(() => {
        if (
          disabled ||
          loading ||
          isApplying
        ) {
          return;
        }

        const resetValue =
          normalizeFilters(
            DEFAULT_FILTERS,
          );

        setValidationError('');

        emitChange(
          resetValue,
        );

        setAppliedValue(
          resetValue,
        );

        setAnnouncement(
          'Filters reset.',
        );

        if (
          typeof onReset ===
          'function'
        ) {
          onReset(
            resetValue,
          );
        }

        if (autoApply) {
          void onApply?.(
            resetValue,
          );
        }
      }, [
        disabled,
        loading,
        isApplying,
        emitChange,
        onReset,
        autoApply,
        onApply,
      ]);

    const clearFilters =
      useCallback(() => {
        if (
          disabled ||
          loading ||
          isApplying
        ) {
          return;
        }

        const cleared = {
          ...draftFilters,
          institutionId: '',
          groupId: '',
          currency: '',
          status: '',
          type: '',
          search: '',
          dateFrom: '',
          dateTo: '',
          period: '',
        };

        setValidationError('');

        emitChange(
          cleared,
        );

        setAnnouncement(
          'Filters cleared.',
        );

        if (
          typeof onClear ===
          'function'
        ) {
          onClear(
            cleared,
          );
        }

        if (autoApply) {
          setAppliedValue(
            cleared,
          );

          void onApply?.(
            cleared,
          );
        }
      }, [
        disabled,
        loading,
        isApplying,
        draftFilters,
        emitChange,
        onClear,
        autoApply,
        onApply,
      ]);

    const handlePeriodChange =
      useCallback(
        (event) => {
          const nextPeriod =
            event.target.value;

          /**
           * Custom dates are retained when switching away from `custom` so
           * the user does not accidentally lose entered values.
           */
          updateFilter(
            'period',
            nextPeriod,
          );
        },
        [updateFilter],
      );

    const handleSubmit =
      useCallback(
        (event) => {
          void applyFilters(
            event,
          );
        },
        [applyFilters],
      );

    const rootClasses =
      classNames(
        'titech-chart-filters',
        `titech-chart-filters--${variant}`,
        `titech-chart-filters--${size}`,
        bordered &&
          'titech-chart-filters--bordered',
        compact &&
          'titech-chart-filters--compact',
        fullWidth &&
          'titech-chart-filters--full-width',
        collapsed &&
          'titech-chart-filters--collapsed',
        className,
      );

    const formClasses =
      classNames(
        'titech-chart-filters__form',
        formClassName,
      );

    return (
      <section
        ref={assignForwardedRef}
        className={rootClasses}
        aria-label={
          ariaLabel ||
          title
        }
        data-testid={
          testId || undefined
        }
        data-component={
          COMPONENT_NAME
        }
        style={style}
      >
        {showHeader ? (
          <header className="titech-chart-filters__header">
            <div className="titech-chart-filters__header-main">
              {eyebrow ? (
                <div className="titech-chart-filters__eyebrow">
                  {eyebrow}
                </div>
              ) : null}

              <div className="titech-chart-filters__title-row">
                <span
                  className="titech-chart-filters__title-icon"
                  aria-hidden="true"
                >
                  <FilterIcon />
                </span>

                <div>
                  <h2 className="titech-chart-filters__title">
                    {title}
                  </h2>

                  {description ? (
                    <p className="titech-chart-filters__description">
                      {description}
                    </p>
                  ) : null}
                </div>

                {showActiveCount &&
                activeCount > 0 ? (
                  <span className="titech-chart-filters__count">
                    {activeCount}{' '}
                    active
                  </span>
                ) : null}
              </div>
            </div>

            {collapsible ? (
              <button
                type="button"
                className="titech-chart-filters__collapse-button"
                aria-expanded={
                  !collapsed
                }
                aria-label={
                  collapseLabel
                }
                title={
                  collapseLabel
                }
                disabled={
                  disabled
                }
                onClick={() =>
                  setCollapsed(
                    (previous) =>
                      !previous,
                  )
                }
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6 9L12 15L18 9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform:
                        collapsed
                          ? 'rotate(-90deg)'
                          : 'rotate(0deg)',
                      transformOrigin:
                        'center',
                      transition:
                        'transform 160ms ease',
                    }}
                  />
                </svg>
              </button>
            ) : null}
          </header>
        ) : null}

        {!collapsed ? (
          <form
            id={fieldIds.form}
            className={formClasses}
            onSubmit={
              handleSubmit
            }
            noValidate
          >
            {/* --------------------------------------------------------------
                Reporting period
                ------------------------------------------------------------ */}
            {showPeriod ? (
              <FilterField
                label={
                  periodLabel
                }
                htmlFor={
                  fieldIds.period
                }
                hint={
                  draftFilters.period ===
                    'custom'
                    ? dateRangeHint
                    : null
                }
              >
                <select
                  id={
                    fieldIds.period
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.period
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={
                    handlePeriodChange
                  }
                >
                  {normalizedPeriods.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Custom date range
                ------------------------------------------------------------ */}
            {showDateRange &&
            (draftFilters.period ===
              'custom' ||
              draftFilters.dateFrom ||
              draftFilters.dateTo) ? (
              <>
                <FilterField
                  label={
                    dateFromLabel
                  }
                  htmlFor={
                    fieldIds.dateFrom
                  }
                  error={
                    validationError ||
                    rangeError
                      ? rangeError
                      : null
                  }
                >
                  <input
                    id={
                      fieldIds.dateFrom
                    }
                    className={classNames(
                      'titech-chart-filters__control',
                      rangeError &&
                        'titech-chart-filters__control--error',
                    )}
                    type="date"
                    max={
                      draftFilters.dateTo ||
                      undefined
                    }
                    value={
                      draftFilters.dateFrom
                    }
                    disabled={
                      disabled ||
                      loading ||
                      isApplying
                    }
                    aria-invalid={
                      Boolean(
                        rangeError,
                      )
                    }
                    onChange={(
                      event,
                    ) =>
                      updateFilter(
                        'dateFrom',
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </FilterField>

                <FilterField
                  label={
                    dateToLabel
                  }
                  htmlFor={
                    fieldIds.dateTo
                  }
                >
                  <input
                    id={
                      fieldIds.dateTo
                    }
                    className={classNames(
                      'titech-chart-filters__control',
                      rangeError &&
                        'titech-chart-filters__control--error',
                    )}
                    type="date"
                    min={
                      draftFilters.dateFrom ||
                      undefined
                    }
                    max={
                      todayAsInputValue()
                    }
                    value={
                      draftFilters.dateTo
                    }
                    disabled={
                      disabled ||
                      loading ||
                      isApplying
                    }
                    aria-invalid={
                      Boolean(
                        rangeError,
                      )
                    }
                    onChange={(
                      event,
                    ) =>
                      updateFilter(
                        'dateTo',
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </FilterField>
              </>
            ) : null}

            {/* --------------------------------------------------------------
                Institution
                ------------------------------------------------------------ */}
            {showInstitution &&
            normalizedInstitutions.length >
              0 ? (
              <FilterField
                label={
                  institutionLabel
                }
                htmlFor={
                  fieldIds.institution
                }
              >
                <select
                  id={
                    fieldIds.institution
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.institutionId
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={(
                    event,
                  ) =>
                    updateFilter(
                      'institutionId',
                      event
                        .target
                        .value,
                    )
                  }
                >
                  <option value="">
                    All institutions
                  </option>

                  {normalizedInstitutions.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Group
                ------------------------------------------------------------ */}
            {showGroup &&
            normalizedGroups.length >
              0 ? (
              <FilterField
                label={
                  groupLabel
                }
                htmlFor={
                  fieldIds.group
                }
              >
                <select
                  id={
                    fieldIds.group
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.groupId
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={(
                    event,
                  ) =>
                    updateFilter(
                      'groupId',
                      event
                        .target
                        .value,
                    )
                  }
                >
                  <option value="">
                    All groups
                  </option>

                  {normalizedGroups.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Currency
                ------------------------------------------------------------ */}
            {showCurrency ? (
              <FilterField
                label={
                  currencyLabel
                }
                htmlFor={
                  fieldIds.currency
                }
              >
                <select
                  id={
                    fieldIds.currency
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.currency
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={(
                    event,
                  ) =>
                    updateFilter(
                      'currency',
                      event
                        .target
                        .value,
                    )
                  }
                >
                  <option value="">
                    All currencies
                  </option>

                  {normalizedCurrencies.map(
                    (option) => (
                      <option
                        key={
                          option.value
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Status
                ------------------------------------------------------------ */}
            {showStatus ? (
              <FilterField
                label={
                  statusLabel
                }
                htmlFor={
                  fieldIds.status
                }
              >
                <select
                  id={
                    fieldIds.status
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.status
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={(
                    event,
                  ) =>
                    updateFilter(
                      'status',
                      event
                        .target
                        .value,
                    )
                  }
                >
                  {normalizedStatuses.map(
                    (option) => (
                      <option
                        key={
                          option.value ||
                          '__all__'
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Transaction type
                ------------------------------------------------------------ */}
            {showType ? (
              <FilterField
                label={
                  typeLabel
                }
                htmlFor={
                  fieldIds.type
                }
              >
                <select
                  id={
                    fieldIds.type
                  }
                  className="titech-chart-filters__control"
                  value={
                    draftFilters.type
                  }
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onChange={(
                    event,
                  ) =>
                    updateFilter(
                      'type',
                      event
                        .target
                        .value,
                    )
                  }
                >
                  {normalizedTypes.map(
                    (option) => (
                      <option
                        key={
                          option.value ||
                          '__all__'
                        }
                        value={
                          option.value
                        }
                        disabled={
                          option.disabled
                        }
                      >
                        {
                          option.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Search
                ------------------------------------------------------------ */}
            {showSearch ? (
              <FilterField
                label={
                  searchLabel
                }
                htmlFor={
                  fieldIds.search
                }
              >
                <div className="titech-chart-filters__search">
                  <span
                    className="titech-chart-filters__search-icon"
                    aria-hidden="true"
                  >
                    <SearchIcon />
                  </span>

                  <input
                    id={
                      fieldIds.search
                    }
                    className="titech-chart-filters__control titech-chart-filters__control--search"
                    type="search"
                    autoComplete="off"
                    spellCheck="false"
                    placeholder={
                      searchPlaceholder
                    }
                    value={
                      draftFilters.search
                    }
                    disabled={
                      disabled ||
                      loading ||
                      isApplying
                    }
                    onChange={(
                      event,
                    ) =>
                      updateFilter(
                        'search',
                        event
                          .target
                          .value,
                      )
                    }
                  />
                </div>
              </FilterField>
            ) : null}

            {/* --------------------------------------------------------------
                Custom filter slot
                ------------------------------------------------------------ */}
            {typeof renderCustomFilters ===
            'function' ? (
              <div className="titech-chart-filters__custom">
                {renderCustomFilters({
                  filters:
                    draftFilters,

                  updateFilter,

                  setFilters:
                    emitChange,

                  disabled:
                    disabled ||
                    loading ||
                    isApplying,
                })}
              </div>
            ) : null}

            {/* --------------------------------------------------------------
                Validation / announcement region
                ------------------------------------------------------------ */}
            {validationError ? (
              <div
                className="titech-chart-filters__validation"
                role="alert"
              >
                {validationError}
              </div>
            ) : null}

            {liveAnnouncements &&
            announcement ? (
              <div
                id={
                  fieldIds.live
                }
                className="titech-chart-filters__sr-only"
                aria-live="polite"
                aria-atomic="true"
              >
                {announcement}
              </div>
            ) : null}

            {/* --------------------------------------------------------------
                Actions
                ------------------------------------------------------------ */}
            <div className="titech-chart-filters__actions">
              {showClear ? (
                <button
                  type="button"
                  className="titech-chart-filters__button titech-chart-filters__button--ghost"
                  disabled={
                    disabled ||
                    loading ||
                    isApplying
                  }
                  onClick={
                    clearFilters
                  }
                >
                  {clearLabel}
                </button>
              ) : null}

              {showReset ? (
                <button
                  type="button"
                  className="titech-chart-filters__button titech-chart-filters__button--secondary"
                  disabled={
                    disabled ||
                    loading ||
                    isApplying ||
                    countActiveFilters(
                      draftFilters,
                    ) === 0
                  }
                  onClick={
                    resetFilters
                  }
                >
                  {resetLabel}
                </button>
              ) : null}

              {showApply ? (
                <button
                  type="submit"
                  className="titech-chart-filters__button titech-chart-filters__button--primary"
                  disabled={
                    disabled ||
                    loading ||
                    isApplying ||
                    Boolean(
                      rangeError,
                    ) ||
                    (!hasDraftChanges &&
                      !autoApply)
                  }
                  aria-busy={
                    isApplying
                  }
                >
                  {isApplying
                    ? 'Applying…'
                    : applyLabel}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        <style>
          {`
            .titech-chart-filters {
              --titech-filter-surface:
                var(
                  --titech-surface,
                  var(--color-white)
                );

              --titech-filter-surface-muted:
                var(
                  --titech-surface-muted,
                  #f8fafc
                );

              --titech-filter-border:
                var(
                  --titech-border,
                  #e2e8f0
                );

              --titech-filter-border-strong:
                var(
                  --titech-border-strong,
                  #cbd5e1
                );

              --titech-filter-text:
                var(
                  --titech-text-primary,
                  #0f172a
                );

              --titech-filter-text-muted:
                var(
                  --titech-text-secondary,
                  #64748b
                );

              --titech-filter-primary:
                var(
                  --titech-primary,
                  #0f172a
                );

              --titech-filter-primary-hover:
                var(
                  --titech-primary-hover,
                  #1e293b
                );

              --titech-filter-on-primary:
                var(
                  --titech-on-primary,
                  var(--color-white)
                );

              --titech-filter-danger:
                var(
                  --titech-danger,
                  #b91c1c
                );

              --titech-filter-success:
                var(
                  --titech-success,
                  #047857
                );

              --titech-filter-focus:
                var(
                  --titech-focus-ring,
                  #2563eb
                );

              width: 100%;
              min-width: 0;
              color:
                var(--titech-filter-text);
              font: inherit;
            }

            .titech-chart-filters *,
            .titech-chart-filters
              *::before,
            .titech-chart-filters
              *::after {
              box-sizing: border-box;
            }

            .titech-chart-filters--bordered {
              border: 1px solid
                var(--titech-filter-border);
              border-radius: 14px;
              background:
                var(--titech-filter-surface);
            }

            .titech-chart-filters--default {
              background:
                var(--titech-filter-surface);
            }

            .titech-chart-filters--compact
              .titech-chart-filters__header {
              padding: 13px 14px 0;
            }

            .titech-chart-filters--compact
              .titech-chart-filters__form {
              padding: 14px;
              gap: 10px;
            }

            .titech-chart-filters--full-width {
              width: 100%;
            }

            .titech-chart-filters__header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 18px;
              padding: 18px 18px 0;
            }

            .titech-chart-filters__header-main {
              min-width: 0;
              flex: 1 1 auto;
            }

            .titech-chart-filters__eyebrow {
              margin-bottom: 5px;
              color:
                var(--titech-filter-text-muted);
              font-size: 10px;
              font-weight: 800;
              line-height: 1.3;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }

            .titech-chart-filters__title-row {
              display: flex;
              align-items: center;
              flex-wrap: wrap;
              gap: 9px;
              min-width: 0;
            }

            .titech-chart-filters__title-icon {
              display: grid;
              place-items: center;
              width: 34px;
              height: 34px;
              flex: 0 0 auto;
              border-radius: 9px;
              background:
                var(
                  --titech-filter-surface-muted
                );
              color:
                var(--titech-filter-primary);
            }

            .titech-chart-filters__title {
              margin: 0;
              font-size: 16px;
              line-height: 1.3;
              font-weight: 800;
              letter-spacing: -0.01em;
            }

            .titech-chart-filters__description {
              max-width: 720px;
              margin: 4px 0 0;
              color:
                var(--titech-filter-text-muted);
              font-size: 11px;
              line-height: 1.5;
            }

            .titech-chart-filters__count {
              display: inline-flex;
              align-items: center;
              min-height: 23px;
              padding: 3px 8px;
              border: 1px solid
                var(--titech-filter-border);
              border-radius: 999px;
              background:
                var(
                  --titech-filter-surface-muted
                );
              color:
                var(--titech-filter-text-muted);
              font-size: 9px;
              line-height: 1.2;
              font-weight: 800;
              white-space: nowrap;
            }

            .titech-chart-filters__collapse-button {
              display: grid;
              place-items: center;
              width: 35px;
              height: 35px;
              flex: 0 0 auto;
              padding: 0;
              border: 1px solid
                var(--titech-filter-border);
              border-radius: 8px;
              background:
                var(--titech-filter-surface);
              color:
                var(--titech-filter-text-muted);
              cursor: pointer;
            }

            .titech-chart-filters__collapse-button:hover:not(
              :disabled
            ) {
              border-color:
                var(
                  --titech-filter-border-strong
                );
              background:
                var(
                  --titech-filter-surface-muted
                );
              color:
                var(--titech-filter-text);
            }

            .titech-chart-filters__collapse-button:disabled {
              cursor: not-allowed;
              opacity: 0.55;
            }

            .titech-chart-filters__form {
              display: grid;
              grid-template-columns:
                repeat(
                  auto-fit,
                  minmax(
                    155px,
                    1fr
                  )
                );
              align-items: end;
              gap: 12px;
              padding: 18px;
            }

            .titech-chart-filters__field {
              min-width: 0;
            }

            .titech-chart-filters__label {
              display: flex;
              align-items: center;
              gap: 3px;
              min-height: 17px;
              margin-bottom: 5px;
              color:
                var(--titech-filter-text);
              font-size: 10px;
              line-height: 1.3;
              font-weight: 800;
            }

            .titech-chart-filters__required {
              color:
                var(--titech-filter-danger);
            }

            .titech-chart-filters__control {
              display: block;
              width: 100%;
              min-width: 0;
              min-height: 38px;
              padding: 8px 10px;
              border: 1px solid
                var(--titech-filter-border-strong);
              border-radius: 8px;
              outline: none;
              background:
                var(--titech-filter-surface);
              color:
                var(--titech-filter-text);
              font: inherit;
              font-size: 11px;
              line-height: 1.35;
              box-shadow:
                0 1px 2px
                rgba(15, 23, 42, 0.025);
            }

            select.titech-chart-filters__control {
              cursor: pointer;
            }

            .titech-chart-filters__control:hover:not(
              :disabled
            ) {
              border-color:
                var(
                  --titech-filter-border-strong
                );
            }

            .titech-chart-filters__control:focus-visible {
              border-color:
                var(--titech-filter-focus);
              outline: 3px solid
                color-mix(
                  in srgb,
                  var(
                    --titech-filter-focus
                  )
                  24%,
                  transparent
                );
              outline-offset: 1px;
            }

            .titech-chart-filters__control:disabled {
              cursor: not-allowed;
              background:
                var(
                  --titech-filter-surface-muted
                );
              opacity: 0.58;
            }

            .titech-chart-filters__control--error {
              border-color:
                var(--titech-filter-danger);
            }

            .titech-chart-filters__control--search {
              padding-left: 34px;
            }

            .titech-chart-filters__search {
              position: relative;
              min-width: 0;
            }

            .titech-chart-filters__search-icon {
              position: absolute;
              left: 10px;
              top: 50%;
              display: grid;
              place-items: center;
              color:
                var(
                  --titech-filter-text-muted
                );
              transform:
                translateY(-50%);
              pointer-events: none;
            }

            .titech-chart-filters__hint {
              margin-top: 4px;
              color:
                var(--titech-filter-text-muted);
              font-size: 9px;
              line-height: 1.4;
            }

            .titech-chart-filters__field-error {
              margin-top: 4px;
              color:
                var(--titech-filter-danger);
              font-size: 9px;
              line-height: 1.4;
            }

            .titech-chart-filters__custom {
              grid-column:
                1 / -1;
              min-width: 0;
            }

            .titech-chart-filters__validation {
              grid-column:
                1 / -1;
              border: 1px solid
                color-mix(
                  in srgb,
                  var(
                    --titech-filter-danger
                  )
                  28%,
                  transparent
                );
              border-radius: 8px;
              padding: 9px 11px;
              background:
                color-mix(
                  in srgb,
                  var(
                    --titech-filter-danger
                  )
                  7%,
                  transparent
                );
              color:
                var(--titech-filter-danger);
              font-size: 10px;
              line-height: 1.45;
            }

            .titech-chart-filters__actions {
              grid-column:
                1 / -1;
              display: flex;
              justify-content: flex-end;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
              padding-top: 3px;
            }

            .titech-chart-filters__button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-height: 37px;
              padding: 8px 13px;
              border-radius: 8px;
              font: inherit;
              font-size: 11px;
              line-height: 1.2;
              font-weight: 800;
              cursor: pointer;
              white-space: nowrap;
              transition:
                background-color 140ms ease,
                border-color 140ms ease,
                color 140ms ease,
                opacity 140ms ease,
                transform 140ms ease;
            }

            .titech-chart-filters__button:active:not(
              :disabled
            ) {
              transform:
                translateY(1px);
            }

            .titech-chart-filters__button:disabled {
              cursor: not-allowed;
              opacity: 0.52;
            }

            .titech-chart-filters__button:focus-visible {
              outline: 3px solid
                var(--titech-filter-focus);
              outline-offset: 2px;
            }

            .titech-chart-filters__button--primary {
              border: 1px solid
                var(--titech-filter-primary);
              background:
                var(--titech-filter-primary);
              color:
                var(--titech-filter-on-primary);
            }

            .titech-chart-filters__button--primary:hover:not(
              :disabled
            ) {
              background:
                var(
                  --titech-filter-primary-hover
                );
              border-color:
                var(
                  --titech-filter-primary-hover
                );
            }

            .titech-chart-filters__button--secondary {
              border: 1px solid
                var(--titech-filter-border-strong);
              background:
                var(--titech-filter-surface);
              color:
                var(--titech-filter-text);
            }

            .titech-chart-filters__button--secondary:hover:not(
              :disabled
            ) {
              background:
                var(
                  --titech-filter-surface-muted
                );
            }

            .titech-chart-filters__button--ghost {
              border: 1px solid transparent;
              background: transparent;
              color:
                var(
                  --titech-filter-text-muted
                );
            }

            .titech-chart-filters__button--ghost:hover:not(
              :disabled
            ) {
              background:
                var(
                  --titech-filter-surface-muted
                );
              border-color:
                var(--titech-filter-border);
              color:
                var(--titech-filter-text);
            }

            .titech-chart-filters--small
              .titech-chart-filters__control {
              min-height: 34px;
              padding: 7px 9px;
              font-size: 10px;
            }

            .titech-chart-filters--small
              .titech-chart-filters__button {
              min-height: 33px;
              padding: 7px 10px;
              font-size: 10px;
            }

            .titech-chart-filters--large
              .titech-chart-filters__control {
              min-height: 43px;
              padding: 10px 12px;
              font-size: 12px;
            }

            .titech-chart-filters--large
              .titech-chart-filters__button {
              min-height: 43px;
              padding: 10px 15px;
              font-size: 12px;
            }

            .titech-chart-filters__sr-only {
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

            @media (max-width: 900px) {
              .titech-chart-filters__form {
                grid-template-columns:
                  repeat(
                    2,
                    minmax(
                      0,
                      1fr
                    )
                  );
              }

              .titech-chart-filters__custom,
              .titech-chart-filters__validation,
              .titech-chart-filters__actions {
                grid-column:
                  1 / -1;
              }
            }

            @media (max-width: 560px) {
              .titech-chart-filters__header {
                align-items: stretch;
              }

              .titech-chart-filters__form {
                grid-template-columns:
                  1fr;
              }

              .titech-chart-filters__custom,
              .titech-chart-filters__validation,
              .titech-chart-filters__actions {
                grid-column:
                  1;
              }

              .titech-chart-filters__actions {
                justify-content: stretch;
              }

              .titech-chart-filters__button {
                flex: 1 1 auto;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .titech-chart-filters *,
              .titech-chart-filters
                *::before,
              .titech-chart-filters
                *::after {
                animation: none !important;
                transition: none !important;
                scroll-behavior: auto !important;
              }
            }

            @media print {
              .titech-chart-filters {
                display: none !important;
              }
            }
          `}
        </style>
      </section>
    );
  }),
);

ChartFilters.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ChartFilters,
  DEFAULT_FILTERS,
  DEFAULT_PERIOD_OPTIONS,
  DEFAULT_CURRENCY_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_TYPE_OPTIONS,
  countActiveFilters,
  normalizeFilters,
  normalizeOptions,
  validateDateRange,
  areFiltersEqual,
  filterSignature,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartFilters;