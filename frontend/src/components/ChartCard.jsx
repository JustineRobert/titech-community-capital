'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chart Card
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ChartCard.jsx
 *
 * Purpose:
 *   Production-grade reusable card/container for TITech analytics,
 *   dashboards, operational reporting, financial insights and monitoring
 *   visualizations.
 *
 * IMPORTANT ARCHITECTURAL NOTE
 * ----------------------------------------------------------------------------
 * This component is a PRESENTATION CONTAINER.
 *
 * It does NOT:
 *   - calculate authoritative financial balances
 *   - approve or reject transactions
 *   - perform financial decisions
 *   - enforce tenant authorization
 *   - mutate authoritative reporting records
 *
 * Data integrity, tenant isolation, authorization and financial truth remain
 * responsibilities of TITech's trusted API/service/data layers.
 *
 * Supported chart integrations
 * ----------------------------------------------------------------------------
 * ✓ Recharts
 * ✓ Chart.js / react-chartjs-2
 * ✓ Nivo
 * ✓ ECharts / wrapper components
 * ✓ Custom SVG / Canvas charts
 * ✓ Any React chart component
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Header / title / subtitle
 * ✓ KPI / summary value
 * ✓ Trend indicator
 * ✓ Period / filter controls
 * ✓ Loading state
 * ✓ Error state
 * ✓ Empty state
 * ✓ Refresh action
 * ✓ Export action
 * ✓ Fullscreen action hook
 * ✓ More-actions hook
 * ✓ Tenant context metadata
 * ✓ Responsive container
 * ✓ Configurable height
 * ✓ Min/max dimensions
 * ✓ Accessible chart labeling
 * ✓ Screen-reader summary
 * ✓ Keyboard accessibility
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ Custom header / footer
 * ✓ Custom content
 * ✓ Status indicators
 * ✓ Footer metadata
 * ✓ TITech branding consistency
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import './chart-card.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_HEIGHT = 320;

const DEFAULT_MIN_HEIGHT = 220;

const DEFAULT_MAX_HEIGHT = 720;

const DEFAULT_VARIANT = 'default';

const DEFAULT_EMPTY_TITLE =
  'No data available';

const DEFAULT_EMPTY_MESSAGE =
  'There is no data available for this view.';

const DEFAULT_ERROR_MESSAGE =
  'Unable to load chart data.';


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const safeText = (
  value,
  fallback = '',
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    return (
      String(value).trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
};


const safeNumber = (
  value,
  fallback = 0,
) => {
  const numeric =
    Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : fallback;
};


const clampHeight = (
  value,
  min,
  max,
) =>
  Math.min(
    Math.max(
      safeNumber(
        value,
        DEFAULT_HEIGHT,
      ),
      safeNumber(
        min,
        DEFAULT_MIN_HEIGHT,
      ),
    ),
    safeNumber(
      max,
      DEFAULT_MAX_HEIGHT,
    ),
  );


const normalizeTrendDirection = (
  direction,
) => {
  const normalized =
    safeText(
      direction,
    ).toLowerCase();

  if (
    ['up', 'increase', 'increasing', 'positive'].includes(
      normalized,
    )
  ) {
    return 'up';
  }

  if (
    ['down', 'decrease', 'decreasing', 'negative'].includes(
      normalized,
    )
  ) {
    return 'down';
  }

  return 'neutral';
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const IconBase = ({
  children,
  size = 18,
  className = '',
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);


const RefreshIcon = ({
  size = 17,
}) => (
  <IconBase size={size}>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </IconBase>
);


const DownloadIcon = ({
  size = 17,
}) => (
  <IconBase size={size}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </IconBase>
);


const ExpandIcon = ({
  size = 17,
}) => (
  <IconBase size={size}>
    <path d="M8 3H3v5" />
    <path d="M3 3l6 6" />
    <path d="M16 3h5v5" />
    <path d="m21 3-6 6" />
    <path d="M8 21H3v-5" />
    <path d="m3 21 6-6" />
    <path d="M16 21h5v-5" />
    <path d="m21 21-6-6" />
  </IconBase>
);


const MoreIcon = ({
  size = 17,
}) => (
  <IconBase
    size={size}
    strokeWidth={1.5}
  >
    <circle
      cx="5"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />

    <circle
      cx="12"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />

    <circle
      cx="19"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />
  </IconBase>
);


const TrendUpIcon = ({
  size = 15,
}) => (
  <IconBase size={size}>
    <path d="m4 15 5-5 4 4 7-7" />
    <path d="M15 7h5v5" />
  </IconBase>
);


const TrendDownIcon = ({
  size = 15,
}) => (
  <IconBase size={size}>
    <path d="m4 9 5 5 4-4 7 7" />
    <path d="M15 17h5v-5" />
  </IconBase>
);


const TrendNeutralIcon = ({
  size = 15,
}) => (
  <IconBase size={size}>
    <path d="M4 12h16" />
  </IconBase>
);


const AlertIcon = ({
  size = 28,
}) => (
  <IconBase size={size}>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </IconBase>
);


const EmptyChartIcon = ({
  size = 28,
}) => (
  <IconBase size={size}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="m7 15 3-3 3 2 5-6" />
  </IconBase>
);


/* ============================================================================
 * Subcomponents
 * ========================================================================== */

const TrendIndicator = ({
  value,
  direction = 'neutral',
  label,
  showValue = true,
}) => {
  const normalizedDirection =
    normalizeTrendDirection(
      direction,
    );

  const numericValue =
    safeNumber(
      value,
      NaN,
    );

  const resolvedLabel =
    safeText(
      label,
      normalizedDirection ===
        'up'
        ? 'Increasing'
        : normalizedDirection ===
            'down'
          ? 'Decreasing'
          : 'Stable',
    );

  const icon =
    normalizedDirection ===
    'up'
      ? (
          <TrendUpIcon />
        )
      : normalizedDirection ===
          'down'
        ? (
            <TrendDownIcon />
          )
        : (
            <TrendNeutralIcon />
          );

  return (
    <span
      className={cn(
        'titech-chart-card__trend',
        `titech-chart-card__trend--${normalizedDirection}`,
      )}
      aria-label={
        numericValue ===
        numericValue
          ? `${resolvedLabel}: ${numericValue}%`
          : resolvedLabel
      }
      title={
        resolvedLabel
      }
    >
      <span
        className="titech-chart-card__trend-icon"
        aria-hidden="true"
      >
        {icon}
      </span>

      {showValue &&
      numericValue ===
        numericValue ? (
        <span className="titech-chart-card__trend-value">
          {numericValue > 0
            ? `+${numericValue}%`
            : `${numericValue}%`}
        </span>
      ) : null}

      <span className="titech-chart-card__trend-label">
        {
          resolvedLabel
        }
      </span>
    </span>
  );
};


const EmptyState = ({
  title,
  message,
}) => (
  <div
    className="titech-chart-card__empty"
    role="status"
    aria-live="polite"
  >
    <div
      className="titech-chart-card__empty-icon"
      aria-hidden="true"
    >
      <EmptyChartIcon />
    </div>

    <div className="titech-chart-card__empty-title">
      {
        title
      }
    </div>

    <div className="titech-chart-card__empty-message">
      {
        message
      }
    </div>
  </div>
);


const ErrorState = ({
  title =
    'Unable to load chart',
  message =
    DEFAULT_ERROR_MESSAGE,
  onRetry,
}) => (
  <div
    className="titech-chart-card__error"
    role="alert"
  >
    <div
      className="titech-chart-card__error-icon"
      aria-hidden="true"
    >
      <AlertIcon />
    </div>

    <div className="titech-chart-card__error-content">
      <div className="titech-chart-card__error-title">
        {
          title
        }
      </div>

      <div className="titech-chart-card__error-message">
        {
          message
        }
      </div>

      {typeof onRetry ===
      'function' ? (
        <button
          type="button"
          className="titech-chart-card__error-retry"
          onClick={
            onRetry
          }
        >
          Retry
        </button>
      ) : null}
    </div>
  </div>
);


/* ============================================================================
 * ChartCard
 * ========================================================================== */

const ChartCard =
  forwardRef(
    function ChartCard(
      {
        title,
        subtitle,

        description,

        children,

        value,
        valueLabel,

        trendValue,
        trendDirection =
          'neutral',
        trendLabel,
        showTrend =
          false,

        loading =
          false,

        error =
          null,

        empty =
          false,

        emptyTitle =
          DEFAULT_EMPTY_TITLE,

        emptyMessage =
          DEFAULT_EMPTY_MESSAGE,

        onRetry,

        onRefresh,

        onExport,

        onFullscreen,

        onMore,

        headerContent,

        footerContent,

        filters,

        actions = [],

        period,

        onPeriodChange,

        periodOptions = [],

        showHeader =
          true,

        showFooter =
          false,

        showRefresh =
          false,

        showExport =
          false,

        showFullscreen =
          false,

        showMore =
          false,

        showPeriodSelector =
          false,

        showTrendValue =
          true,

        showValue =
          false,

        showLegendSlot =
          false,

        legendContent,

        variant =
          DEFAULT_VARIANT,

        height =
          DEFAULT_HEIGHT,

        minHeight =
          DEFAULT_MIN_HEIGHT,

        maxHeight =
          DEFAULT_MAX_HEIGHT,

        responsive =
          true,

        bordered =
          true,

        elevated =
          false,

        compact =
          false,

        dense =
          false,

        collapsible =
          false,

        defaultCollapsed =
          false,

        collapsed: controlledCollapsed,

        onCollapsedChange,

        fullscreen =
          false,

        onFullscreenChange,

        tenant =
          null,

        dataSource,

        dataUpdatedAt,

        dataTestId,

        chartLabel,

        chartDescription,

        ariaLabel,

        className =
          '',

        headerClassName =
          '',

        bodyClassName =
          '',

        footerClassName =
          '',

        chartClassName =
          '',

        contentClassName =
          '',

        loadingLabel =
          'Loading chart…',

        skeletonHeight,

        testId =
          'titech-chart-card',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const rootRef =
        useRef(null);

      const chartBodyRef =
        useRef(null);

      const [
        internalCollapsed,
        setInternalCollapsed,
      ] = useState(
        defaultCollapsed,
      );

      const [
        menuOpen,
        setMenuOpen,
      ] = useState(
        false,
      );

      const isCollapsedControlled =
        controlledCollapsed !==
        undefined;

      const isCollapsed =
        isCollapsedControlled
          ? Boolean(
              controlledCollapsed,
            )
          : internalCollapsed;

      const chartHeight =
        clampHeight(
          height,
          minHeight,
          maxHeight,
        );

      const resolvedTenantId =
        tenant?.id ??
        tenant?.tenantId ??
        tenant?.uuid ??
        null;

      const trendDirection =
        normalizeTrendDirection(
          trendDirection,
        );

      const resolvedTitle =
        safeText(
          title,
          'TITech Analytics',
        );

      const resolvedSubtitle =
        safeText(
          subtitle,
        );

      const resolvedDescription =
        safeText(
          description,
        );

      const resolvedChartLabel =
        safeText(
          chartLabel ||
            resolvedTitle,
          resolvedTitle,
        );

      const resolvedChartDescription =
        safeText(
          chartDescription ||
            resolvedDescription,
        );

      const headerId =
        `titech-chart-card-header-${generatedId}`;

      const descriptionId =
        `titech-chart-card-description-${generatedId}`;

      const chartRegionId =
        `titech-chart-card-region-${generatedId}`;

      const resolvedDataUpdatedAt =
        dataUpdatedAt
          ? new Date(
              dataUpdatedAt,
            )
          : null;

      const formattedUpdatedAt =
        resolvedDataUpdatedAt &&
        !Number.isNaN(
          resolvedDataUpdatedAt.getTime(),
        )
          ? resolvedDataUpdatedAt.toLocaleString()
          : '';


      /* ======================================================================
       * Callbacks
       * ==================================================================== */

      const handleCollapsedChange =
        useCallback(
          (
            nextCollapsed,
          ) => {
            if (
              !isCollapsedControlled
            ) {
              setInternalCollapsed(
                nextCollapsed,
              );
            }

            onCollapsedChange?.(
              nextCollapsed,
            );
          },
          [
            isCollapsedControlled,
            onCollapsedChange,
          ],
        );


      const toggleCollapsed =
        useCallback(
          () => {
            handleCollapsedChange(
              !isCollapsed,
            );
          },
          [
            handleCollapsedChange,
            isCollapsed,
          ],
        );


      const handleFullscreen =
        useCallback(
          () => {
            if (
              typeof onFullscreen ===
              'function'
            ) {
              onFullscreen();
              return;
            }

            onFullscreenChange?.(
              !fullscreen,
            );
          },
          [
            fullscreen,
            onFullscreen,
            onFullscreenChange,
          ],
        );


      const handleMore =
        useCallback(
          () => {
            if (
              typeof onMore ===
              'function'
            ) {
              onMore();
              return;
            }

            setMenuOpen(
              (
                current,
              ) =>
                !current,
            );
          },
          [
            onMore,
          ],
        );


      /* ======================================================================
       * Ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          getElement() {
            return rootRef.current;
          },

          getChartElement() {
            return chartBodyRef.current;
          },

          focus() {
            rootRef.current?.focus();
          },

          collapse() {
            handleCollapsedChange(
              true,
            );
          },

          expand() {
            handleCollapsedChange(
              false,
            );
          },

          toggle() {
            toggleCollapsed();
          },

          isCollapsed() {
            return isCollapsed;
          },

          isFullscreen() {
            return fullscreen;
          },

          getTenantId() {
            return resolvedTenantId;
          },
        }),
        [
          fullscreen,
          handleCollapsedChange,
          isCollapsed,
          resolvedTenantId,
          toggleCollapsed,
        ],
      );


      /* ======================================================================
       * Resolve action collection
       * ==================================================================== */

      const normalizedActions =
        useMemo(
          () =>
            Array.isArray(
              actions,
            )
              ? actions.filter(
                  (
                    action,
                  ) =>
                    action &&
                    typeof action ===
                      'object' &&
                    safeText(
                      action.label,
                    ),
                )
              : [],
          [
            actions,
          ],
        );


      /* ======================================================================
       * Root classes
       * ==================================================================== */

      const rootClassName =
        cn(
          'titech-chart-card',

          `titech-chart-card--${variant}`,

          responsive &&
            'titech-chart-card--responsive',

          bordered &&
            'titech-chart-card--bordered',

          elevated &&
            'titech-chart-card--elevated',

          compact &&
            'titech-chart-card--compact',

          dense &&
            'titech-chart-card--dense',

          loading &&
            'titech-chart-card--loading',

          error &&
            'titech-chart-card--error',

          empty &&
            'titech-chart-card--empty',

          isCollapsed &&
            'titech-chart-card--collapsed',

          fullscreen &&
            'titech-chart-card--fullscreen',

          className,
        );


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <article
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          data-testid={
            testId
          }
          data-tenant-id={
            resolvedTenantId ??
            undefined
          }
          data-data-source={
            dataSource
              ? safeText(
                  dataSource,
                )
              : undefined
          }
          data-testid-data={
            dataTestId ??
            undefined
          }
          aria-labelledby={
            showHeader
              ? headerId
              : undefined
          }
          tabIndex={
            -1
          }
        >

          {/* ================================================================
              Header
              ================================================================ */}

          {showHeader ? (
            <header
              id={
                headerId
              }
              className={cn(
                'titech-chart-card__header',
                headerClassName,
              )}
            >

              <div className="titech-chart-card__header-main">

                <div className="titech-chart-card__title-group">

                  {resolvedTitle ? (
                    <h2 className="titech-chart-card__title">
                      {
                        resolvedTitle
                      }
                    </h2>
                  ) : null}

                  {resolvedSubtitle ? (
                    <p
                      id={
                        descriptionId
                      }
                      className="titech-chart-card__subtitle"
                    >
                      {
                        resolvedSubtitle
                      }
                    </p>
                  ) : null}

                  {resolvedDescription ? (
                    <p className="titech-chart-card__description">
                      {
                        resolvedDescription
                      }
                    </p>
                  ) : null}

                </div>


                {showValue &&
                value !==
                  undefined &&
                value !==
                  null ? (
                  <div className="titech-chart-card__summary">

                    {valueLabel ? (
                      <span className="titech-chart-card__value-label">
                        {
                          valueLabel
                        }
                      </span>
                    ) : null}

                    <span className="titech-chart-card__value">
                      {
                        value
                      }
                    </span>

                    {showTrend ? (
                      <TrendIndicator
                        value={
                          trendValue
                        }
                        direction={
                          trendDirection
                        }
                        label={
                          trendLabel
                        }
                        showValue={
                          showTrendValue
                        }
                      />
                    ) : null}

                  </div>
                ) : null}

              </div>


              {/* Header content supplied by parent */}
              {headerContent ? (
                <div className="titech-chart-card__header-custom">
                  {
                    headerContent
                  }
                </div>
              ) : null}


              {/* Header filters */}
              {filters ? (
                <div className="titech-chart-card__filters">
                  {
                    filters
                  }
                </div>
              ) : null}


              {/* Period selector */}
              {showPeriodSelector &&
              periodOptions.length >
                0 ? (
                <div className="titech-chart-card__period">
                  <label
                    htmlFor={`titech-chart-card-period-${generatedId}`}
                    className="titech-chart-card__period-label"
                  >
                    Period
                  </label>

                  <select
                    id={`titech-chart-card-period-${generatedId}`}
                    className="titech-chart-card__period-select"
                    value={
                      period ??
                      ''
                    }
                    onChange={(
                      event,
                    ) =>
                      onPeriodChange?.(
                        event.target.value,
                      )
                    }
                  >
                    {periodOptions.map(
                      (
                        option,
                        index,
                      ) => {
                        const item =
                          typeof option ===
                          'string'
                            ? {
                                label:
                                  option,
                                value:
                                  option,
                              }
                            : option;

                        return (
                          <option
                            key={
                              item?.value ??
                              index
                            }
                            value={
                              item?.value ??
                              ''
                            }
                          >
                            {
                              item?.label ??
                              item?.value
                            }
                          </option>
                        );
                      },
                    )}
                  </select>
                </div>
              ) : null}


              {/* Standard actions */}
              <div className="titech-chart-card__actions">

                {showRefresh &&
                typeof onRefresh ===
                  'function' ? (
                  <button
                    type="button"
                    className="titech-chart-card__action"
                    onClick={
                      onRefresh
                    }
                    disabled={
                      loading
                    }
                    aria-label="Refresh chart"
                    title="Refresh chart"
                    data-testid="titech-chart-card-refresh"
                  >
                    <RefreshIcon />
                  </button>
                ) : null}


                {showExport &&
                typeof onExport ===
                  'function' ? (
                  <button
                    type="button"
                    className="titech-chart-card__action"
                    onClick={
                      onExport
                    }
                    disabled={
                      loading ||
                      empty
                    }
                    aria-label="Export chart"
                    title="Export chart"
                    data-testid="titech-chart-card-export"
                  >
                    <DownloadIcon />
                  </button>
                ) : null}


                {showFullscreen ? (
                  <button
                    type="button"
                    className="titech-chart-card__action"
                    onClick={
                      handleFullscreen
                    }
                    aria-label={
                      fullscreen
                        ? 'Exit chart fullscreen'
                        : 'Open chart fullscreen'
                    }
                    title={
                      fullscreen
                        ? 'Exit fullscreen'
                        : 'Fullscreen'
                    }
                    data-testid="titech-chart-card-fullscreen"
                  >
                    <ExpandIcon />
                  </button>
                ) : null}


                {collapsible ? (
                  <button
                    type="button"
                    className="titech-chart-card__action"
                    onClick={
                      toggleCollapsed
                    }
                    aria-expanded={
                      !isCollapsed
                    }
                    aria-controls={
                      chartRegionId
                    }
                    aria-label={
                      isCollapsed
                        ? 'Expand chart'
                        : 'Collapse chart'
                    }
                    title={
                      isCollapsed
                        ? 'Expand chart'
                        : 'Collapse chart'
                    }
                    data-testid="titech-chart-card-collapse"
                  >
                    <span
                      aria-hidden="true"
                    >
                      {isCollapsed
                        ? '＋'
                        : '−'}
                    </span>
                  </button>
                ) : null}


                {(showMore ||
                  normalizedActions.length >
                    0) ? (
                  <div className="titech-chart-card__more-wrapper">

                    <button
                      type="button"
                      className="titech-chart-card__action"
                      onClick={
                        handleMore
                      }
                      aria-haspopup="menu"
                      aria-expanded={
                        menuOpen
                      }
                      aria-label="More chart actions"
                      title="More actions"
                      data-testid="titech-chart-card-more"
                    >
                      <MoreIcon />
                    </button>

                    {menuOpen ? (
                      <div
                        className="titech-chart-card__menu"
                        role="menu"
                      >
                        {normalizedActions.map(
                          (
                            action,
                            index,
                          ) => (
                            <button
                              key={
                                action.id ||
                                action.key ||
                                index
                              }
                              type="button"
                              role="menuitem"
                              className={cn(
                                'titech-chart-card__menu-item',
                                action.danger &&
                                  'titech-chart-card__menu-item--danger',
                              )}
                              disabled={
                                action.disabled
                              }
                              onClick={() => {
                                setMenuOpen(
                                  false,
                                );

                                action.onClick?.();
                              }}
                            >
                              {action.icon ? (
                                <span
                                  className="titech-chart-card__menu-icon"
                                  aria-hidden="true"
                                >
                                  {
                                    action.icon
                                  }
                                </span>
                              ) : null}

                              <span>
                                {
                                  action.label
                                }
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    ) : null}

                  </div>
                ) : null}

              </div>

            </header>
          ) : null}


          {/* ================================================================
              Collapsible content
              ================================================================ */}

          {!isCollapsed ? (
            <div
              id={
                chartRegionId
              }
              ref={
                chartBodyRef
              }
              className={cn(
                'titech-chart-card__body',
                bodyClassName,
              )}
            >

              {/* Screen-reader description */}
              {resolvedChartDescription ? (
                <span className="titech-chart-card__sr-description">
                  {
                    resolvedChartDescription
                  }
                </span>
              ) : null}


              {/* Loading */}
              {loading ? (
                <div
                  className="titech-chart-card__loading"
                  role="status"
                  aria-live="polite"
                  aria-label={
                    loadingLabel
                  }
                >
                  <div
                    className="titech-chart-card__loading-bars"
                    style={{
                      minHeight:
                        `${safeNumber(
                          skeletonHeight ||
                            chartHeight,
                          chartHeight,
                        )}px`,
                    }}
                  >
                    <div className="titech-chart-card__loading-bar" />
                    <div className="titech-chart-card__loading-bar" />
                    <div className="titech-chart-card__loading-bar" />
                  </div>

                  <span className="titech-chart-card__loading-label">
                    {
                      loadingLabel
                    }
                  </span>
                </div>
              ) : null}


              {/* Error */}
              {!loading &&
              error ? (
                <div
                  className="titech-chart-card__state"
                  style={{
                    minHeight:
                      `${chartHeight}px`,
                  }}
                >
                  <ErrorState
                    title="Chart unavailable"
                    message={
                      typeof error ===
                      'string'
                        ? error
                        : DEFAULT_ERROR_MESSAGE
                    }
                    onRetry={
                      onRetry
                    }
                  />
                </div>
              ) : null}


              {/* Empty */}
              {!loading &&
              !error &&
              empty ? (
                <div
                  className="titech-chart-card__state"
                  style={{
                    minHeight:
                      `${chartHeight}px`,
                  }}
                >
                  <EmptyState
                    title={
                      emptyTitle
                    }
                    message={
                      emptyMessage
                    }
                  />
                </div>
              ) : null}


              {/* Chart/content */}
              {!loading &&
              !error &&
              !empty ? (
                <div
                  className={cn(
                    'titech-chart-card__chart',
                    chartClassName,
                    contentClassName,
                  )}
                  role="img"
                  aria-label={
                    ariaLabel ||
                    resolvedChartLabel
                  }
                  aria-describedby={
                    resolvedChartDescription
                      ? descriptionId
                      : undefined
                  }
                  style={{
                    height:
                      responsive
                        ? 'auto'
                        : `${chartHeight}px`,

                    minHeight:
                      `${minHeight}px`,

                    maxHeight:
                      `${maxHeight}px`,
                  }}
                  data-testid="titech-chart-card-content"
                >
                  {children}
                </div>
              ) : null}


              {/* Legend */}
              {showLegendSlot &&
              legendContent &&
              !loading &&
              !error ? (
                <div
                  className="titech-chart-card__legend"
                  aria-label="Chart legend"
                >
                  {
                    legendContent
                  }
                </div>
              ) : null}


              {/* Data freshness */}
              {formattedUpdatedAt ? (
                <div
                  className="titech-chart-card__freshness"
                  role="note"
                >
                  Updated{' '}
                  <time
                    dateTime={
                      resolvedDataUpdatedAt?.toISOString()
                    }
                  >
                    {
                      formattedUpdatedAt
                    }
                  </time>
                </div>
              ) : null}

            </div>
          ) : null}


          {/* ================================================================
              Footer
              ================================================================ */}

          {showFooter &&
          footerContent ? (
            <footer
              className={cn(
                'titech-chart-card__footer',
                footerClassName,
              )}
            >
              {
                footerContent
              }
            </footer>
          ) : null}

        </article>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

ChartCard.displayName =
  'TITechChartCard';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ChartCard.propTypes = {
  title:
    PropTypes.string,

  subtitle:
    PropTypes.string,

  description:
    PropTypes.string,

  children:
    PropTypes.node,

  value:
    PropTypes.node,

  valueLabel:
    PropTypes.string,

  trendValue:
    PropTypes.number,

  trendDirection:
    PropTypes.oneOf([
      'up',
      'down',
      'neutral',
      'increase',
      'decrease',
      'increasing',
      'decreasing',
      'positive',
      'negative',
    ]),

  trendLabel:
    PropTypes.string,

  showTrend:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.bool,
      PropTypes.string,
      PropTypes.object,
    ]),

  empty:
    PropTypes.bool,

  emptyTitle:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,

  onRetry:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onExport:
    PropTypes.func,

  onFullscreen:
    PropTypes.func,

  onMore:
    PropTypes.func,

  headerContent:
    PropTypes.node,

  footerContent:
    PropTypes.node,

  filters:
    PropTypes.node,

  actions:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.string,

        key:
          PropTypes.string,

        label:
          PropTypes.string
            .isRequired,

        icon:
          PropTypes.node,

        onClick:
          PropTypes.func,

        disabled:
          PropTypes.bool,

        danger:
          PropTypes.bool,
      }),
    ),

  period:
    PropTypes.string,

  onPeriodChange:
    PropTypes.func,

  periodOptions:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,

        PropTypes.shape({
          label:
            PropTypes.string,

          value:
            PropTypes.string,
        }),
      ]),
    ),

  showHeader:
    PropTypes.bool,

  showFooter:
    PropTypes.bool,

  showRefresh:
    PropTypes.bool,

  showExport:
    PropTypes.bool,

  showFullscreen:
    PropTypes.bool,

  showMore:
    PropTypes.bool,

  showPeriodSelector:
    PropTypes.bool,

  showTrendValue:
    PropTypes.bool,

  showValue:
    PropTypes.bool,

  showLegendSlot:
    PropTypes.bool,

  legendContent:
    PropTypes.node,

  variant:
    PropTypes.oneOf([
      'default',
      'primary',
      'success',
      'warning',
      'danger',
      'info',
      'neutral',
    ]),

  height:
    PropTypes.number,

  minHeight:
    PropTypes.number,

  maxHeight:
    PropTypes.number,

  responsive:
    PropTypes.bool,

  bordered:
    PropTypes.bool,

  elevated:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  dense:
    PropTypes.bool,

  collapsible:
    PropTypes.bool,

  defaultCollapsed:
    PropTypes.bool,

  collapsed:
    PropTypes.bool,

  onCollapsedChange:
    PropTypes.func,

  fullscreen:
    PropTypes.bool,

  onFullscreenChange:
    PropTypes.func,

  tenant:
    PropTypes.object,

  dataSource:
    PropTypes.string,

  dataUpdatedAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(
        Date,
      ),
    ]),

  dataTestId:
    PropTypes.string,

  chartLabel:
    PropTypes.string,

  chartDescription:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  className:
    PropTypes.string,

  headerClassName:
    PropTypes.string,

  bodyClassName:
    PropTypes.string,

  footerClassName:
    PropTypes.string,

  chartClassName:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  loadingLabel:
    PropTypes.string,

  skeletonHeight:
    PropTypes.number,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ChartCard.defaultProps = {
  title:
    undefined,

  subtitle:
    undefined,

  description:
    undefined,

  children:
    undefined,

  value:
    undefined,

  valueLabel:
    undefined,

  trendValue:
    undefined,

  trendDirection:
    'neutral',

  trendLabel:
    undefined,

  showTrend:
    false,

  loading:
    false,

  error:
    null,

  empty:
    false,

  emptyTitle:
    DEFAULT_EMPTY_TITLE,

  emptyMessage:
    DEFAULT_EMPTY_MESSAGE,

  onRetry:
    undefined,

  onRefresh:
    undefined,

  onExport:
    undefined,

  onFullscreen:
    undefined,

  onMore:
    undefined,

  headerContent:
    undefined,

  footerContent:
    undefined,

  filters:
    undefined,

  actions:
    [],

  period:
    undefined,

  onPeriodChange:
    undefined,

  periodOptions:
    [],

  showHeader:
    true,

  showFooter:
    false,

  showRefresh:
    false,

  showExport:
    false,

  showFullscreen:
    false,

  showMore:
    false,

  showPeriodSelector:
    false,

  showTrendValue:
    true,

  showValue:
    false,

  showLegendSlot:
    false,

  legendContent:
    undefined,

  variant:
    DEFAULT_VARIANT,

  height:
    DEFAULT_HEIGHT,

  minHeight:
    DEFAULT_MIN_HEIGHT,

  maxHeight:
    DEFAULT_MAX_HEIGHT,

  responsive:
    true,

  bordered:
    true,

  elevated:
    false,

  compact:
    false,

  dense:
    false,

  collapsible:
    false,

  defaultCollapsed:
    false,

  collapsed:
    undefined,

  onCollapsedChange:
    undefined,

  fullscreen:
    false,

  onFullscreenChange:
    undefined,

  tenant:
    null,

  dataSource:
    undefined,

  dataUpdatedAt:
    undefined,

  dataTestId:
    undefined,

  chartLabel:
    undefined,

  chartDescription:
    undefined,

  ariaLabel:
    undefined,

  className:
    '',

  headerClassName:
    '',

  bodyClassName:
    '',

  footerClassName:
    '',

  chartClassName:
    '',

  contentClassName:
    '',

  loadingLabel:
    'Loading chart…',

  skeletonHeight:
    undefined,

  testId:
    'titech-chart-card',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  EmptyChartIcon,
  ExpandIcon,
  DownloadIcon,
  MoreIcon,
  RefreshIcon,
  TrendDownIcon,
  TrendIndicator,
  TrendNeutralIcon,
  TrendUpIcon,
  clampHeight,
  cn,
  normalizeTrendDirection,
  safeNumber,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartCard;