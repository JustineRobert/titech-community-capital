'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Dashboard Skeleton
 * ============================================================================
 *
 * File:
 *   frontend/src/components/DashboardSkeleton.jsx
 *
 * Purpose:
 *   Production-grade loading skeleton for TITech administrative, financial,
 *   operational and analytics dashboards.
 *
 * Design principles
 * ----------------------------------------------------------------------------
 * ✓ Stable layout during loading
 * ✓ Low cumulative layout shift
 * ✓ Responsive desktop/tablet/mobile support
 * ✓ Configurable KPI/stat cards
 * ✓ Configurable chart cards
 * ✓ Configurable table rows
 * ✓ Configurable activity/feed rows
 * ✓ Sidebar/header/dashboard modes
 * ✓ Compact and dense layouts
 * ✓ Reduced-motion support
 * ✓ Accessibility / screen-reader semantics
 * ✓ Custom skeleton sections
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ No dependency on a specific chart library
 * ✓ TITech branding consistency
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This component is presentational only.
 *
 * It does not:
 *   - fetch data
 *   - authorize users
 *   - enforce tenant isolation
 *   - calculate financial balances
 *   - approve transactions
 *
 * Those responsibilities belong to TITech's trusted application and API
 * layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import './DashboardSkeleton.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_STAT_COUNT = 4;

const DEFAULT_CHART_COUNT = 2;

const DEFAULT_TABLE_ROWS = 6;

const DEFAULT_ACTIVITY_ROWS = 5;

const DEFAULT_STAT_HEIGHT = 112;

const DEFAULT_CHART_HEIGHT = 320;


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const safeNumber = (
  value,
  fallback,
) => {
  const numeric =
    Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : fallback;
};


const clampPositive = (
  value,
  fallback,
  maximum = 100,
) =>
  Math.min(
    maximum,
    Math.max(
      1,
      safeNumber(
        value,
        fallback,
      ),
    ),
  );


/* ============================================================================
 * Primitive skeleton
 * ========================================================================== */

const SkeletonBlock = ({
  width = '100%',
  height = 16,
  radius = 8,
  className = '',
  variant = 'default',
  animated = true,
}) => (
  <span
    aria-hidden="true"
    className={cn(
      'titech-dashboard-skeleton__block',
      `titech-dashboard-skeleton__block--${variant}`,
      animated &&
        'titech-dashboard-skeleton__block--animated',
      className,
    )}
    style={{
      width:
        typeof width ===
        'number'
          ? `${width}px`
          : width,

      height:
        typeof height ===
        'number'
          ? `${height}px`
          : height,

      borderRadius:
        typeof radius ===
        'number'
          ? `${radius}px`
          : radius,
    }}
  />
);


/* ============================================================================
 * Stat card skeleton
 * ========================================================================== */

const StatCardSkeleton = ({
  height =
    DEFAULT_STAT_HEIGHT,
  compact = false,
  animated = true,
}) => (
  <article
    className={cn(
      'titech-dashboard-skeleton__stat-card',
      compact &&
        'titech-dashboard-skeleton__stat-card--compact',
    )}
    aria-hidden="true"
  >
    <div className="titech-dashboard-skeleton__stat-header">
      <SkeletonBlock
        width="34%"
        height={10}
        radius={5}
        animated={animated}
      />

      <SkeletonBlock
        width={30}
        height={30}
        radius={10}
        variant="circle"
        animated={animated}
      />
    </div>

    <SkeletonBlock
      width="46%"
      height={26}
      radius={6}
      animated={animated}
    />

    <SkeletonBlock
      width="68%"
      height={10}
      radius={5}
      animated={animated}
    />

    <div
      className="titech-dashboard-skeleton__stat-footer"
      style={{
        minHeight:
          Math.max(
            28,
            height -
              90,
          ),
      }}
    >
      <SkeletonBlock
        width="24%"
        height={9}
        radius={4}
        animated={animated}
      />

      <SkeletonBlock
        width="36%"
        height={9}
        radius={4}
        animated={animated}
      />
    </div>
  </article>
);


/* ============================================================================
 * Chart skeleton
 * ========================================================================== */

const ChartSkeleton = ({
  height =
    DEFAULT_CHART_HEIGHT,
  showHeader = true,
  showLegend = false,
  animated = true,
  className = '',
}) => (
  <section
    className={cn(
      'titech-dashboard-skeleton__chart',
      className,
    )}
    aria-hidden="true"
    style={{
      minHeight:
        `${Math.max(
          180,
          height,
        )}px`,
    }}
  >
    {showHeader ? (
      <div className="titech-dashboard-skeleton__chart-header">

        <div className="titech-dashboard-skeleton__chart-title">
          <SkeletonBlock
            width="30%"
            height={14}
            radius={5}
            animated={animated}
          />

          <SkeletonBlock
            width="48%"
            height={9}
            radius={4}
            animated={animated}
          />
        </div>

        <div className="titech-dashboard-skeleton__chart-controls">
          <SkeletonBlock
            width={68}
            height={30}
            radius={7}
            animated={animated}
          />

          <SkeletonBlock
            width={32}
            height={30}
            radius={7}
            animated={animated}
          />
        </div>
      </div>
    ) : null}

    <div className="titech-dashboard-skeleton__chart-body">

      <div className="titech-dashboard-skeleton__chart-y-axis">
        <SkeletonBlock
          width={30}
          height={8}
          radius={4}
          animated={animated}
        />

        <SkeletonBlock
          width={24}
          height={8}
          radius={4}
          animated={animated}
        />

        <SkeletonBlock
          width={28}
          height={8}
          radius={4}
          animated={animated}
        />

        <SkeletonBlock
          width={22}
          height={8}
          radius={4}
          animated={animated}
        />
      </div>

      <div className="titech-dashboard-skeleton__chart-grid">

        <div className="titech-dashboard-skeleton__chart-grid-lines">
          {Array.from({
            length: 5,
          }).map(
            (
              _,
              index,
            ) => (
              <span
                key={
                  index
                }
                className="titech-dashboard-skeleton__chart-grid-line"
              />
            ),
          )}
        </div>

        <div className="titech-dashboard-skeleton__chart-plot">
          <span className="titech-dashboard-skeleton__chart-area titech-dashboard-skeleton__chart-area--one" />
          <span className="titech-dashboard-skeleton__chart-area titech-dashboard-skeleton__chart-area--two" />
          <span className="titech-dashboard-skeleton__chart-area titech-dashboard-skeleton__chart-area--three" />

          <span className="titech-dashboard-skeleton__chart-line titech-dashboard-skeleton__chart-line--one" />
          <span className="titech-dashboard-skeleton__chart-line titech-dashboard-skeleton__chart-line--two" />
        </div>

        <div className="titech-dashboard-skeleton__chart-x-axis">
          {Array.from({
            length: 6,
          }).map(
            (
              _,
              index,
            ) => (
              <SkeletonBlock
                key={
                  index
                }
                width={
                  index %
                    2 ===
                  0
                    ? 34
                    : 24
                }
                height={7}
                radius={3}
                animated={animated}
              />
            ),
          )}
        </div>

      </div>
    </div>

    {showLegend ? (
      <div className="titech-dashboard-skeleton__chart-legend">
        <SkeletonBlock
          width={52}
          height={9}
          radius={4}
          animated={animated}
        />

        <SkeletonBlock
          width={68}
          height={9}
          radius={4}
          animated={animated}
        />

        <SkeletonBlock
          width={44}
          height={9}
          radius={4}
          animated={animated}
        />
      </div>
    ) : null}
  </section>
);


/* ============================================================================
 * Table skeleton
 * ========================================================================== */

const TableSkeleton = ({
  rows =
    DEFAULT_TABLE_ROWS,
  columns = 5,
  showHeader = true,
  animated = true,
}) => {
  const safeRows =
    Math.max(
      1,
      Math.min(
        30,
        safeNumber(
          rows,
          DEFAULT_TABLE_ROWS,
        ),
      ),
    );

  const safeColumns =
    Math.max(
      2,
      Math.min(
        12,
        safeNumber(
          columns,
          5,
        ),
      ),
    );

  return (
    <section
      className="titech-dashboard-skeleton__table"
      aria-hidden="true"
    >
      {showHeader ? (
        <div className="titech-dashboard-skeleton__table-header">
          <SkeletonBlock
            width="18%"
            height={12}
            radius={5}
            animated={animated}
          />

          <SkeletonBlock
            width="11%"
            height={12}
            radius={5}
            animated={animated}
          />

          <SkeletonBlock
            width="13%"
            height={12}
            radius={5}
            animated={animated}
          />

          <SkeletonBlock
            width="10%"
            height={12}
            radius={5}
            animated={animated}
          />

          <SkeletonBlock
            width={32}
            height={12}
            radius={5}
            animated={animated}
          />
        </div>
      ) : null}

      <div className="titech-dashboard-skeleton__table-body">
        {Array.from({
          length:
            safeRows,
        }).map(
          (
            _,
            rowIndex,
          ) => (
            <div
              key={
                rowIndex
              }
              className="titech-dashboard-skeleton__table-row"
            >
              {Array.from({
                length:
                  safeColumns,
              }).map(
                (
                  _cell,
                  cellIndex,
                ) => (
                  <SkeletonBlock
                    key={
                      cellIndex
                    }
                    width={
                      cellIndex ===
                      0
                        ? '58%'
                        : cellIndex ===
                            safeColumns -
                              1
                          ? 36
                          : `${42 + (
                              cellIndex *
                              7
                            )}%`
                    }
                    height={
                      cellIndex ===
                      0
                        ? 12
                        : 10
                    }
                    radius={4}
                    animated={
                      animated
                    }
                  />
                ),
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
};


/* ============================================================================
 * Activity feed skeleton
 * ========================================================================== */

const ActivitySkeleton = ({
  rows =
    DEFAULT_ACTIVITY_ROWS,
  animated = true,
}) => (
  <section
    className="titech-dashboard-skeleton__activity"
    aria-hidden="true"
  >
    <div className="titech-dashboard-skeleton__activity-header">
      <SkeletonBlock
        width="32%"
        height={14}
        radius={5}
        animated={animated}
      />

      <SkeletonBlock
        width={52}
        height={10}
        radius={4}
        animated={animated}
      />
    </div>

    <div className="titech-dashboard-skeleton__activity-list">
      {Array.from({
        length: Math.max(
          1,
          safeNumber(
            rows,
            DEFAULT_ACTIVITY_ROWS,
          ),
        ),
      ).map(
        (
          _,
          index,
        ) => (
          <div
            key={
              index
            }
            className="titech-dashboard-skeleton__activity-row"
          >
            <SkeletonBlock
              width={34}
              height={34}
              radius={999}
              variant="circle"
              animated={animated}
            />

            <div className="titech-dashboard-skeleton__activity-content">
              <SkeletonBlock
                width={
                  index %
                    2 ===
                  0
                    ? '46%'
                    : '34%'
                }
                height={10}
                radius={4}
                animated={animated}
              />

              <SkeletonBlock
                width="78%"
                height={9}
                radius={4}
                animated={animated}
              />
            </div>

            <SkeletonBlock
              width={46}
              height={8}
              radius={4}
              animated={animated}
            />
          </div>
        ),
      )}
    </div>
  </section>
);


/* ============================================================================
 * DashboardSkeleton
 * ========================================================================== */

const DashboardSkeleton =
  forwardRef(
    function DashboardSkeleton(
      {
        statCount =
          DEFAULT_STAT_COUNT,

        chartCount =
          DEFAULT_CHART_COUNT,

        tableRows =
          DEFAULT_TABLE_ROWS,

        activityRows =
          DEFAULT_ACTIVITY_ROWS,

        tableColumns =
          5,

        statHeight =
          DEFAULT_STAT_HEIGHT,

        chartHeight =
          DEFAULT_CHART_HEIGHT,

        showHeader =
          true,

        showWelcome =
          true,

        showStats =
          true,

        showCharts =
          true,

        showTable =
          true,

        showActivity =
          false,

        showSidebar =
          false,

        sidebarWidth =
          248,

        showBreadcrumbs =
          false,

        showFilters =
          false,

        showQuickActions =
          false,

        showLegend =
          false,

        compact =
          false,

        dense =
          false,

        animated =
          true,

        fullHeight =
          false,

        responsive =
          true,

        variant =
          'default',

        customSections,

        headerContent,

        welcomeContent,

        className =
          '',

        contentClassName =
          '',

        ariaLabel =
          'Loading TITech dashboard',

        testId =
          'titech-dashboard-skeleton',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const safeStatCount =
        Math.max(
          1,
          Math.min(
            12,
            safeNumber(
              statCount,
              DEFAULT_STAT_COUNT,
            ),
          ),
        );

      const safeChartCount =
        Math.max(
          0,
          Math.min(
            8,
            safeNumber(
              chartCount,
              DEFAULT_CHART_COUNT,
            ),
          ),
        );

      const safeTableRows =
        Math.max(
          1,
          Math.min(
            30,
            safeNumber(
              tableRows,
              DEFAULT_TABLE_ROWS,
            ),
          ),
        );

      const safeActivityRows =
        Math.max(
          1,
          Math.min(
            30,
            safeNumber(
              activityRows,
              DEFAULT_ACTIVITY_ROWS,
            ),
          ),
        );

      const resolvedSidebarWidth =
        clampPositive(
          sidebarWidth,
          248,
          420,
        );

      const layoutClassName =
        cn(
          'titech-dashboard-skeleton',

          `titech-dashboard-skeleton--${variant}`,

          compact &&
            'titech-dashboard-skeleton--compact',

          dense &&
            'titech-dashboard-skeleton--dense',

          fullHeight &&
            'titech-dashboard-skeleton--full-height',

          responsive &&
            'titech-dashboard-skeleton--responsive',

          showSidebar &&
            'titech-dashboard-skeleton--with-sidebar',

          animated &&
            'titech-dashboard-skeleton--animated',

          className,
        );

      const style = {
        '--titech-dashboard-skeleton-sidebar-width':
          `${resolvedSidebarWidth}px`,
      };


      /* ======================================================================
       * Ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          getElement() {
            return rootRef.current;
          },

          scrollToTop() {
            rootRef.current?.scrollIntoView({
              behavior:
                'smooth',
              block:
                'start',
            });
          },
        }),
        [],
      );


      /* ======================================================================
       * Custom sections
       * ==================================================================== */

      const resolvedCustomSections =
        useMemo(
          () =>
            Array.isArray(
              customSections,
            )
              ? customSections.filter(
                  (
                    section,
                  ) =>
                    section !==
                      null &&
                    section !==
                      undefined,
                )
              : [],
          [
            customSections,
          ],
        );


      return (
        <section
          {...rest}
          ref={
            rootRef
          }
          className={
            layoutClassName
          }
          style={
            style
          }
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={
            ariaLabel
          }
          tabIndex={
            -1
          }
          data-testid={
            testId
          }
        >

          {/* =================================================================
              Screen-reader announcement
              ================================================================= */}

          <span className="titech-dashboard-skeleton__sr-only">
            Loading TITech dashboard content…
          </span>


          <div className="titech-dashboard-skeleton__layout">

            {/* ===============================================================
                Sidebar
                =============================================================== */}

            {showSidebar ? (
              <aside
                className="titech-dashboard-skeleton__sidebar"
                aria-hidden="true"
              >
                <div className="titech-dashboard-skeleton__sidebar-brand">
                  <SkeletonBlock
                    width={34}
                    height={34}
                    radius={9}
                    variant="circle"
                    animated={
                      animated
                    }
                  />

                  <SkeletonBlock
                    width="48%"
                    height={12}
                    radius={5}
                    animated={
                      animated
                    }
                  />
                </div>

                <div className="titech-dashboard-skeleton__sidebar-nav">
                  {Array.from({
                    length: 9,
                  }).map(
                    (
                      _,
                      index,
                    ) => (
                      <div
                        key={
                          index
                        }
                        className={cn(
                          'titech-dashboard-skeleton__sidebar-item',
                          index ===
                            0 &&
                            'titech-dashboard-skeleton__sidebar-item--active',
                        )}
                      >
                        <SkeletonBlock
                          width={18}
                          height={18}
                          radius={5}
                          variant="circle"
                          animated={
                            animated
                          }
                        />

                        <SkeletonBlock
                          width={
                            index %
                              3 ===
                            0
                              ? '66%'
                              : '52%'
                          }
                          height={10}
                          radius={4}
                          animated={
                            animated
                          }
                        />
                      </div>
                    ),
                  )}
                </div>

                <div className="titech-dashboard-skeleton__sidebar-footer">
                  <SkeletonBlock
                    width={36}
                    height={36}
                    radius={999}
                    variant="circle"
                    animated={
                      animated
                    }

                  />

                  <div>
                    <SkeletonBlock
                      width={92}
                      height={10}
                      radius={4}
                      animated={
                        animated
                      }
                    />

                    <SkeletonBlock
                      width={66}
                      height={8}
                      radius={4}
                      animated={
                        animated
                      }
                    />
                  </div>
                </div>
              </aside>
            ) : null}


            {/* ===============================================================
                Main content
                =============================================================== */}

            <main className="titech-dashboard-skeleton__main">

              {/* =============================================================
                  Header
                  ============================================================= */}

              {showHeader ? (
                <header
                  className="titech-dashboard-skeleton__header"
                  aria-hidden="true"
                >
                  <div className="titech-dashboard-skeleton__header-left">

                    <SkeletonBlock
                      width={124}
                      height={28}
                      radius={7}
                      animated={
                        animated
                      }
                    />

                    {showBreadcrumbs ? (
                      <SkeletonBlock
                        width={180}
                        height={9}
                        radius={4}
                        animated={
                          animated
                        }
                      />
                    ) : null}

                  </div>

                  <div className="titech-dashboard-skeleton__header-actions">
                    <SkeletonBlock
                      width={34}
                      height={34}
                      radius={8}
                      animated={
                        animated
                      }
                    />

                    <SkeletonBlock
                      width={34}
                      height={34}
                      radius={8}
                      animated={
                        animated
                      }
                    />

                    <SkeletonBlock
                      width={38}
                      height={38}
                      radius={999}
                      variant="circle"
                      animated={
                        animated
                      }
                    />
                  </div>
                </header>
              ) : null}


              {/* =============================================================
                  Welcome
                  ============================================================= */}

              {showWelcome ? (
                <section
                  className="titech-dashboard-skeleton__welcome"
                  aria-hidden="true"
                >
                  <div className="titech-dashboard-skeleton__welcome-copy">

                    <SkeletonBlock
                      width="36%"
                      height={22}
                      radius={6}
                      animated={
                        animated
                      }
                    />

                    <SkeletonBlock
                      width="54%"
                      height={10}
                      radius={4}
                      animated={
                        animated
                      }
                    />

                  </div>

                  {welcomeContent ? (
                    <div className="titech-dashboard-skeleton__welcome-custom">
                      {
                        welcomeContent
                      }
                    </div>
                  ) : null}

                  {showQuickActions ? (
                    <div className="titech-dashboard-skeleton__quick-actions">
                      <SkeletonBlock
                        width={104}
                        height={34}
                        radius={8}
                        animated={
                          animated
                        }
                      />

                      <SkeletonBlock
                        width={104}
                        height={34}
                        radius={8}
                        animated={
                          animated
                        />

                      <SkeletonBlock
                        width={104}
                        height={34}
                        radius={8}
                        animated={
                          animated
                        }
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}


              {/* =============================================================
                  Dashboard filters
                  ============================================================= */}

              {showFilters ? (
                <section
                  className="titech-dashboard-skeleton__filters"
                  aria-hidden="true"
                >
                  <SkeletonBlock
                    width={170}
                    height={36}
                    radius={8}
                    animated={
                      animated
                    }
                  />

                  <SkeletonBlock
                    width={140}
                    height={36}
                    radius={8}
                    animated={
                      animated
                    }
                  />

                  <SkeletonBlock
                    width={116}
                    height={36}
                    radius={8}
                    animated={
                      animated
                    }

                  />

                  <SkeletonBlock
                    width={86}
                    height={36}
                    radius={8}
                    animated={
                      animated
                    }
                  />
                </section>
              ) : null}


              {/* =============================================================
                  Stats
                  ============================================================= */}

              {showStats ? (
                <section
                  className="titech-dashboard-skeleton__stats-grid"
                  aria-hidden="true"
                >
                  {Array.from({
                    length:
                      safeStatCount,
                  }).map(
                    (
                      _,
                      index,
                    ) => (
                      <StatCardSkeleton
                        key={
                          index
                        }
                        height={
                          statHeight
                        }
                        compact={
                          compact ||
                          dense
                        }
                        animated={
                          animated
                        }
                      />
                    ),
                  )}
                </section>
              ) : null}


              {/* =============================================================
                  Charts
                  ============================================================= */}

              {showCharts &&
              safeChartCount >
                0 ? (
                <section
                  className={cn(
                    'titech-dashboard-skeleton__charts-grid',
                    safeChartCount ===
                      1 &&
                      'titech-dashboard-skeleton__charts-grid--single',
                  )}
                  aria-hidden="true"
                >
                  {Array.from({
                    length:
                      safeChartCount,
                  }).map(
                    (
                      _,
                      index,
                    ) => (
                      <ChartSkeleton
                        key={
                          index
                        }
                        height={
                          chartHeight
                        }
                        showHeader
                        showLegend={
                          showLegend
                        }
                        animated={
                          animated
                        }
                      />
                    ),
                  )}
                </section>
              ) : null}


              {/* =============================================================
                  Table + activity
                  ============================================================= */}

              {(showTable ||
                showActivity) ? (
                <section className="titech-dashboard-skeleton__lower-grid">

                  {showTable ? (
                    <div className="titech-dashboard-skeleton__table-panel">
                      <div className="titech-dashboard-skeleton__panel-header">
                        <SkeletonBlock
                          width="34%"
                          height={14}
                          radius={5}
                          animated={
                            animated
                          }
                        />

                        <SkeletonBlock
                          width={70}
                          height={28}
                          radius={7}
                          animated={
                            animated
                          }
                        />
                      </div>

                      <TableSkeleton
                        rows={
                          safeTableRows
                        }
                        columns={
                          tableColumns
                        }
                        showHeader
                        animated={
                          animated
                        }
                      />
                    </div>
                  ) : null}

                  {showActivity ? (
                    <ActivitySkeleton
                      rows={
                        safeActivityRows
                      }
                      animated={
                        animated
                      }
                    />
                  ) : null}

                </section>
              ) : null}


              {/* =============================================================
                  Custom sections
                  ============================================================= */}

              {resolvedCustomSections.length >
              0 ? (
                <section className="titech-dashboard-skeleton__custom-sections">
                  {resolvedCustomSections.map(
                    (
                      section,
                      index,
                    ) => (
                      <React.Fragment
                        key={
                          section?.id ||
                          section?.key ||
                          index
                        }
                      >
                        {section}
                      </React.Fragment>
                    ),
                  )}
                </section>
              ) : null}

            </main>
          </div>
        </section>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

DashboardSkeleton.displayName =
  'TITechDashboardSkeleton';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

DashboardSkeleton.propTypes = {
  statCount:
    PropTypes.number,

  chartCount:
    PropTypes.number,

  tableRows:
    PropTypes.number,

  activityRows:
    PropTypes.number,

  tableColumns:
    PropTypes.number,

  statHeight:
    PropTypes.number,

  chartHeight:
    PropTypes.number,

  showHeader:
    PropTypes.bool,

  showWelcome:
    PropTypes.bool,

  showStats:
    PropTypes.bool,

  showCharts:
    PropTypes.bool,

  showTable:
    PropTypes.bool,

  showActivity:
    PropTypes.bool,

  showSidebar:
    PropTypes.bool,

  sidebarWidth:
    PropTypes.number,

  showBreadcrumbs:
    PropTypes.bool,

  showFilters:
    PropTypes.bool,

  showQuickActions:
    PropTypes.bool,

  showLegend:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  dense:
    PropTypes.bool,

  animated:
    PropTypes.bool,

  fullHeight:
    PropTypes.bool,

  responsive:
    PropTypes.bool,

  variant:
    PropTypes.oneOf([
      'default',
      'admin',
      'analytics',
      'financial',
      'operations',
    ]),

  customSections:
    PropTypes.arrayOf(
      PropTypes.node,
    ),

  headerContent:
    PropTypes.node,

  welcomeContent:
    PropTypes.node,

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

DashboardSkeleton.defaultProps = {
  statCount:
    DEFAULT_STAT_COUNT,

  chartCount:
    DEFAULT_CHART_COUNT,

  tableRows:
    DEFAULT_TABLE_ROWS,

  activityRows:
    DEFAULT_ACTIVITY_ROWS,

  tableColumns:
    5,

  statHeight:
    DEFAULT_STAT_HEIGHT,

  chartHeight:
    DEFAULT_CHART_HEIGHT,

  showHeader:
    true,

  showWelcome:
    true,

  showStats:
    true,

  showCharts:
    true,

  showTable:
    true,

  showActivity:
    false,

  showSidebar:
    false,

  sidebarWidth:
    248,

  showBreadcrumbs:
    false,

  showFilters:
    false,

  showQuickActions:
    false,

  showLegend:
    false,

  compact:
    false,

  dense:
    false,

  animated:
    true,

  fullHeight:
    false,

  responsive:
    true,

  variant:
    'default',

  customSections:
    [],

  headerContent:
    undefined,

  welcomeContent:
    undefined,

  className:
    '',

  contentClassName:
    '',

  ariaLabel:
    'Loading TITech dashboard',

  testId:
    'titech-dashboard-skeleton',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ActivitySkeleton,
  ChartSkeleton,
  DEFAULT_ACTIVITY_ROWS,
  DEFAULT_CHART_COUNT,
  DEFAULT_STAT_COUNT,
  DEFAULT_TABLE_ROWS,
  SkeletonBlock,
  StatCardSkeleton,
  TableSkeleton,
  clampPositive,
  cn,
  safeNumber,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default DashboardSkeleton;