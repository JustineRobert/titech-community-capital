'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartContainer.jsx
 *
 * Purpose:
 *   Canonical enterprise-grade presentation container for TITech charts,
 *   analytics visualizations and dashboard data modules.
 *
 * Responsibilities:
 *   - Provide a consistent TITech chart card / panel experience.
 *   - Render title, description, badges, metadata and actions.
 *   - Support loading, error and empty states.
 *   - Support chart content supplied through children.
 *   - Support optional header, toolbar, footer and contextual content.
 *   - Provide accessible semantics and keyboard-focus behavior.
 *   - Support responsive and print-friendly presentation.
 *   - Avoid coupling the container to a specific charting library.
 *   - Avoid performing financial calculations or modifying financial state.
 *
 * Architectural principle:
 *   This component is a UI composition primitive.
 *
 *   Financial authority remains with:
 *     backend services
 *     ledger / journal
 *     transaction state machine
 *     reconciliation services
 *     settlement services
 *     authoritative reporting APIs
 *
 *   This component MUST NOT:
 *     - mutate financial records;
 *     - infer settlement;
 *     - convert pending/queued/offline provider states into settlement;
 *     - perform wallet/balance calculations;
 *     - replace backend-authoritative values.
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

const COMPONENT_NAME = 'TITechChartContainer';

const DEFAULT_TITLE = 'Chart';

const DEFAULT_MIN_HEIGHT = 320;

const DEFAULT_PADDING = 20;

/* ============================================================================
 * Small utilities
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

function normalizeMessage(value, fallback) {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof value.message === 'string'
  ) {
    return value.message;
  }

  return fallback;
}

function normalizeHeight(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    value.trim() !== ''
  ) {
    return value;
  }

  return DEFAULT_MIN_HEIGHT;
}

/* ============================================================================
 * Inline icon primitives
 *
 * These use plain SVG so ChartContainer does not require an additional icon
 * dependency. Applications may replace them through the corresponding props.
 * ========================================================================== */

const ChartPlaceholderIcon = memo(
  function ChartPlaceholderIcon() {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x="5"
          y="6"
          width="30"
          height="28"
          rx="6"
          stroke="currentColor"
          strokeWidth="1.8"
        />

        <path
          d="M10 27L16 21L21 25L29 15"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle
          cx="10"
          cy="27"
          r="1.5"
          fill="currentColor"
        />

        <circle
          cx="16"
          cy="21"
          r="1.5"
          fill="currentColor"
        />

        <circle
          cx="21"
          cy="25"
          r="1.5"
          fill="currentColor"
        />

        <circle
          cx="29"
          cy="15"
          r="1.5"
          fill="currentColor"
        />
      </svg>
    );
  },
);

ChartPlaceholderIcon.displayName =
  'ChartPlaceholderIcon';

const ChartErrorIcon = memo(
  function ChartErrorIcon() {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="20"
          cy="20"
          r="15"
          stroke="currentColor"
          strokeWidth="1.8"
        />

        <path
          d="M20 11.5V21.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <circle
          cx="20"
          cy="27"
          r="1.25"
          fill="currentColor"
        />
      </svg>
    );
  },
);

ChartErrorIcon.displayName =
  'ChartErrorIcon';

/* ============================================================================
 * Loading state
 * ========================================================================== */

const ChartLoadingState = memo(
  function ChartLoadingState({
    title,
    description,
    height,
    showHeader = true,
    rows = 3,
  }) {
    const safeRows = Math.max(
      1,
      Math.min(Number(rows) || 3, 6),
    );

    return (
      <div
        className="titech-chart-container__loading"
        aria-busy="true"
        aria-label={`${title} loading`}
      >
        {showHeader ? (
          <div
            className="titech-chart-container__loading-header"
          >
            <div
              className="titech-chart-container__skeleton titech-chart-container__skeleton--title"
            />

            {description ? (
              <div
                className="titech-chart-container__skeleton titech-chart-container__skeleton--description"
              />
            ) : null}
          </div>
        ) : null}

        <div
          className="titech-chart-container__skeleton-chart"
          style={{
            minHeight: height,
          }}
        >
          <div className="titech-chart-container__axis-placeholder">
            <span />
            <span />
            <span />
            <span />
          </div>

          <div className="titech-chart-container__loading-bars">
            {Array.from(
              { length: safeRows },
              (_, index) => (
                <span
                  key={`loading-bar-${index}`}
                  style={{
                    height: `${45 + index * 8}%`,
                  }}
                />
              ),
            )}
          </div>
        </div>
      </div>
    );
  },
);

ChartLoadingState.displayName =
  'ChartLoadingState';

/* ============================================================================
 * Empty state
 * ========================================================================== */

const ChartEmptyState = memo(
  function ChartEmptyState({
    title,
    message,
    action,
    icon,
    height,
  }) {
    return (
      <div
        className="titech-chart-container__state"
        role="status"
        aria-label={`${title} empty state`}
        style={{
          minHeight: height,
        }}
      >
        <div className="titech-chart-container__state-icon">
          {icon || <ChartPlaceholderIcon />}
        </div>

        <div className="titech-chart-container__state-title">
          No data available
        </div>

        <div className="titech-chart-container__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-chart-container__state-action">
            {action}
          </div>
        ) : null}
      </div>
    );
  },
);

ChartEmptyState.displayName =
  'ChartEmptyState';

/* ============================================================================
 * Error state
 * ========================================================================== */

const ChartErrorState = memo(
  function ChartErrorState({
    title,
    message,
    action,
    icon,
  }) {
    return (
      <div
        className="titech-chart-container__state titech-chart-container__state--error"
        role="alert"
        aria-label={`${title} error`}
      >
        <div className="titech-chart-container__state-icon">
          {icon || <ChartErrorIcon />}
        </div>

        <div className="titech-chart-container__state-title">
          Unable to display chart
        </div>

        <div className="titech-chart-container__state-message">
          {message}
        </div>

        {action ? (
          <div className="titech-chart-container__state-action">
            {action}
          </div>
        ) : null}
      </div>
    );
  },
);

ChartErrorState.displayName =
  'ChartErrorState';

/* ============================================================================
 * Status badge
 * ========================================================================== */

const ChartStatusBadge = memo(
  function ChartStatusBadge({
    status,
    label,
  }) {
    if (!status && !label) {
      return null;
    }

    const normalizedStatus =
      typeof status === 'string'
        ? status.toLowerCase()
        : 'neutral';

    const statusLabel =
      label ||
      (() => {
        switch (normalizedStatus) {
          case 'success':
          case 'healthy':
          case 'live':
            return 'Live';

          case 'warning':
          case 'delayed':
            return 'Delayed';

          case 'error':
          case 'failed':
            return 'Error';

          case 'pending':
            return 'Pending';

          case 'offline':
            return 'Offline';

          default:
            return status || 'Status';
        }
      })();

    return (
      <span
        className={classNames(
          'titech-chart-container__status',
          `titech-chart-container__status--${normalizedStatus}`,
        )}
        role="status"
      >
        <span
          className="titech-chart-container__status-dot"
          aria-hidden="true"
        />

        {statusLabel}
      </span>
    );
  },
);

ChartStatusBadge.displayName =
  'ChartStatusBadge';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartContainer = memo(
  forwardRef(function ChartContainer(
    {
      children,

      title = DEFAULT_TITLE,

      description = null,

      eyebrow = null,

      icon = null,

      status = null,

      statusLabel = null,

      metadata = null,

      actions = null,

      toolbar = null,

      header = null,

      footer = null,

      footerLeft = null,

      footerRight = null,

      loading = false,

      error = null,

      empty = false,

      emptyMessage =
        'There is no chart data to display for the current selection.',

      emptyAction = null,

      errorMessage =
        'An unexpected error occurred while preparing this chart.',

      errorAction = null,

      retryLabel = 'Retry',

      onRetry = null,

      loadingTitle = null,

      loadingDescription = null,

      loadingRows = 3,

      loadingShowHeader = true,

      height = DEFAULT_MIN_HEIGHT,

      minHeight = DEFAULT_MIN_HEIGHT,

      padding = DEFAULT_PADDING,

      bordered = true,

      elevated = false,

      compact = false,

      flush = false,

      scrollable = false,

      collapsible = false,

      defaultCollapsed = false,

      onCollapseChange = null,

      ariaLabel = null,

      ariaDescribedBy = null,

      role = 'region',

      className = '',

      contentClassName = '',

      headerClassName = '',

      footerClassName = '',

      style = undefined,

      contentStyle = undefined,

      headerStyle = undefined,

      footerStyle = undefined,

      stateClassName = '',

      stateStyle = undefined,

      testId = null,

      childrenWhenEmpty = false,

      childrenWhenError = false,

      showHeader = true,

      showFooter = false,

      showStatus = true,

      showMetadata = true,

      showActions = true,

      allowOverflow = false,

      collapsibleLabel = 'Toggle chart visibility',

      dataState = null,

      onFocus = undefined,

      onBlur = undefined,
    },
    ref,
  ) {
    const [collapsed, setCollapsed] =
      React.useState(defaultCollapsed);

    const computedHeight = useMemo(
      () => normalizeHeight(height),
      [height],
    );

    const computedMinHeight = useMemo(
      () => normalizeHeight(minHeight),
      [minHeight],
    );

    const effectiveErrorMessage = useMemo(
      () =>
        normalizeMessage(
          error,
          errorMessage,
        ),
      [error, errorMessage],
    );

    const containerClassName = useMemo(
      () =>
        classNames(
          'titech-chart-container',
          bordered &&
            'titech-chart-container--bordered',
          elevated &&
            'titech-chart-container--elevated',
          compact &&
            'titech-chart-container--compact',
          flush &&
            'titech-chart-container--flush',
          scrollable &&
            'titech-chart-container--scrollable',
          collapsed &&
            'titech-chart-container--collapsed',
          allowOverflow &&
            'titech-chart-container--overflow',
          className,
        ),
      [
        bordered,
        elevated,
        compact,
        flush,
        scrollable,
        collapsed,
        allowOverflow,
        className,
      ],
    );

    const contentClasses = useMemo(
      () =>
        classNames(
          'titech-chart-container__content',
          contentClassName,
        ),
      [contentClassName],
    );

    const handleCollapseChange = () => {
      const nextValue = !collapsed;

      setCollapsed(nextValue);

      if (
        typeof onCollapseChange === 'function'
      ) {
        onCollapseChange(nextValue);
      }
    };

    const shouldShowError =
      Boolean(error) &&
      !loading &&
      !childrenWhenError;

    const shouldShowEmpty =
      Boolean(empty) &&
      !loading &&
      !shouldShowError &&
      !childrenWhenEmpty;

    const hasFooterContent = Boolean(
      footer ||
        footerLeft ||
        footerRight ||
        showFooter,
    );

    const resolvedHeader =
      header || (
        <>
          {eyebrow ? (
            <div className="titech-chart-container__eyebrow">
              {eyebrow}
            </div>
          ) : null}

          <div className="titech-chart-container__title-row">
            {icon ? (
              <div
                className="titech-chart-container__icon"
                aria-hidden="true"
              >
                {icon}
              </div>
            ) : null}

            <div className="titech-chart-container__heading">
              <h2 className="titech-chart-container__title">
                {title}
              </h2>

              {description ? (
                <p
                  id={
                    ariaDescribedBy ||
                    undefined
                  }
                  className="titech-chart-container__description"
                >
                  {description}
                </p>
              ) : null}
            </div>

            {showStatus ? (
              <ChartStatusBadge
                status={status}
                label={statusLabel}
              />
            ) : null}
          </div>

          {showMetadata && metadata ? (
            <div className="titech-chart-container__metadata">
              {metadata}
            </div>
          ) : null}
        </>
      );

    return (
      <section
        ref={ref}
        className={containerClassName}
        role={role}
        aria-label={
          ariaLabel ||
          (typeof title === 'string'
            ? title
            : undefined)
        }
        aria-describedby={
          ariaDescribedBy ||
          undefined
        }
        aria-busy={loading || undefined}
        data-state={dataState || undefined}
        data-testid={testId || undefined}
        onFocus={onFocus}
        onBlur={onBlur}
        style={style}
      >
        {/* ------------------------------------------------------------------
            Header
            ---------------------------------------------------------------- */}
        {showHeader && !flush ? (
          <header
            className={classNames(
              'titech-chart-container__header',
              headerClassName,
            )}
            style={headerStyle}
          >
            <div className="titech-chart-container__header-main">
              {resolvedHeader}
            </div>

            {(toolbar ||
              (showActions && actions) ||
              collapsible) ? (
              <div className="titech-chart-container__header-actions">
                {toolbar ? (
                  <div className="titech-chart-container__toolbar">
                    {toolbar}
                  </div>
                ) : null}

                {showActions && actions ? (
                  <div className="titech-chart-container__actions">
                    {actions}
                  </div>
                ) : null}

                {collapsible ? (
                  <button
                    type="button"
                    className="titech-chart-container__collapse-button"
                    aria-expanded={!collapsed}
                    aria-label={
                      collapsibleLabel
                    }
                    title={
                      collapsibleLabel
                    }
                    onClick={
                      handleCollapseChange
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
                          transform: collapsed
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
              </div>
            ) : null}
          </header>
        ) : null}

        {/* ------------------------------------------------------------------
            Collapsible content
            ---------------------------------------------------------------- */}
        {!collapsed ? (
          <div
            className={contentClasses}
            style={{
              padding,
              minHeight:
                !loading &&
                !shouldShowError &&
                !shouldShowEmpty
                  ? computedMinHeight
                  : undefined,
              overflow:
                scrollable && !allowOverflow
                  ? 'auto'
                  : undefined,
              ...contentStyle,
            }}
          >
            {loading ? (
              <ChartLoadingState
                title={
                  loadingTitle ||
                  title
                }
                description={
                  loadingDescription ||
                  description
                }
                height={
                  computedHeight
                }
                showHeader={
                  loadingShowHeader &&
                  flush
                }
                rows={loadingRows}
              />
            ) : shouldShowError ? (
              <ChartErrorState
                title={title}
                message={
                  effectiveErrorMessage
                }
                icon={null}
                action={
                  errorAction ||
                  (typeof onRetry ===
                    'function' ? (
                    <button
                      type="button"
                      className="titech-chart-container__retry-button"
                      onClick={onRetry}
                    >
                      {retryLabel}
                    </button>
                  ) : null)
                }
              />
            ) : shouldShowEmpty ? (
              <ChartEmptyState
                title={title}
                message={
                  emptyMessage
                }
                action={
                  emptyAction
                }
                height={
                  computedHeight
                }
              />
            ) : (
              children
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------------------------
            Footer
            ---------------------------------------------------------------- */}
        {!collapsed &&
        hasFooterContent ? (
          <footer
            className={classNames(
              'titech-chart-container__footer',
              footerClassName,
            )}
            style={{
              padding,
              ...footerStyle,
            }}
          >
            {footer || (
              <>
                <div className="titech-chart-container__footer-left">
                  {footerLeft}
                </div>

                <div className="titech-chart-container__footer-right">
                  {footerRight}
                </div>
              </>
            )}
          </footer>
        ) : null}

        {/* ------------------------------------------------------------------
            Scoped component CSS
            ---------------------------------------------------------------- */}
        <style>
          {`
            .titech-chart-container {
              --titech-chart-surface:
                var(--titech-surface);

              --titech-chart-surface-muted:
                var(--titech-surface-muted);

              --titech-chart-border:
                var(--titech-border);

              --titech-chart-border-strong:
                var(--titech-border-strong);

              --titech-chart-text:
                var(--titech-text-primary);

              --titech-chart-text-muted:
                var(--titech-text-secondary);

              --titech-chart-primary:
                var(--titech-primary);

              --titech-chart-on-primary:
                var(--titech-on-primary);

              --titech-chart-danger:
                var(--titech-danger);

              --titech-chart-danger-surface:
                var(--titech-danger-surface);

              --titech-chart-warning:
                var(--titech-warning);

              --titech-chart-success:
                var(--titech-success);

              width: 100%;
              min-width: 0;
              color: var(--titech-chart-text);
              font: inherit;
            }

            .titech-chart-container *,
            .titech-chart-container *::before,
            .titech-chart-container *::after {
              box-sizing: border-box;
            }

            .titech-chart-container--bordered {
              border: 1px solid
                var(--titech-chart-border);
              border-radius: 16px;
              background:
                var(--titech-chart-surface);
            }

            .titech-chart-container--elevated {
              box-shadow:
                0 10px 30px
                rgba(15, 23, 42, 0.08);
            }

            .titech-chart-container--compact
              .titech-chart-container__header {
              padding-top: 14px;
              padding-bottom: 14px;
            }

            .titech-chart-container--compact
              .titech-chart-container__content {
              padding-top: 14px;
              padding-bottom: 14px;
            }

            .titech-chart-container--flush
              .titech-chart-container__content {
              padding: 0;
            }

            .titech-chart-container--scrollable
              .titech-chart-container__content {
              overscroll-behavior: contain;
              scrollbar-width: thin;
            }

            .titech-chart-container--overflow {
              overflow: visible;
            }

            .titech-chart-container:not(
              .titech-chart-container--overflow
            ) {
              overflow: hidden;
            }

            .titech-chart-container__header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 20px;
              padding: 20px 20px 0;
            }

            .titech-chart-container--compact
              .titech-chart-container__header {
              padding-left: 14px;
              padding-right: 14px;
            }

            .titech-chart-container__header-main {
              min-width: 0;
              flex: 1 1 auto;
            }

            .titech-chart-container__title-row {
              display: flex;
              align-items: flex-start;
              gap: 10px;
              min-width: 0;
            }

            .titech-chart-container__icon {
              display: grid;
              place-items: center;
              flex: 0 0 auto;
              width: 36px;
              height: 36px;
              margin-top: 1px;
              border-radius: 9px;
              background:
                var(
                  --titech-chart-surface-muted
                );
              color:
                var(--titech-chart-primary);
            }

            .titech-chart-container__heading {
              min-width: 0;
              flex: 1 1 auto;
            }

            .titech-chart-container__eyebrow {
              margin: 0 0 5px;
              color:
                var(--titech-chart-text-muted);
              font-size: 10px;
              line-height: 1.3;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }

            .titech-chart-container__title {
              margin: 0;
              color: var(--titech-chart-text);
              font-size: 18px;
              line-height: 1.3;
              font-weight: 800;
              letter-spacing: -0.015em;
              overflow-wrap: anywhere;
            }

            .titech-chart-container__description {
              margin: 6px 0 0;
              max-width: 760px;
              color:
                var(--titech-chart-text-muted);
              font-size: 12px;
              line-height: 1.55;
            }

            .titech-chart-container__metadata {
              display: flex;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
              margin-top: 11px;
              color:
                var(--titech-chart-text-muted);
              font-size: 11px;
            }

            .titech-chart-container__header-actions {
              display: flex;
              align-items: center;
              justify-content: flex-end;
              gap: 8px;
              flex: 0 0 auto;
              flex-wrap: wrap;
            }

            .titech-chart-container__toolbar,
            .titech-chart-container__actions {
              display: flex;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
            }

            .titech-chart-container__collapse-button {
              display: grid;
              place-items: center;
              width: 36px;
              height: 36px;
              padding: 0;
              border: 1px solid
                var(--titech-chart-border);
              border-radius: 8px;
              background:
                var(--titech-chart-surface);
              color:
                var(--titech-chart-text-muted);
              cursor: pointer;
              transition:
                border-color 140ms ease,
                background-color 140ms ease,
                color 140ms ease;
            }

            .titech-chart-container__collapse-button:hover {
              border-color:
                var(--titech-chart-border-strong);
              background:
                var(--titech-chart-surface-muted);
              color:
                var(--titech-chart-text);
            }

            .titech-chart-container__collapse-button:focus-visible,
            .titech-chart-container__retry-button:focus-visible {
              outline: 3px solid
                var(
                  --titech-focus-ring,
                  #2563eb
                );
              outline-offset: 2px;
            }

            .titech-chart-container__status {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              flex: 0 0 auto;
              min-height: 24px;
              padding: 4px 8px;
              border: 1px solid
                var(--titech-chart-border);
              border-radius: 999px;
              background:
                var(--titech-chart-surface-muted);
              color:
                var(--titech-chart-text-muted);
              font-size: 10px;
              line-height: 1.2;
              font-weight: 800;
              white-space: nowrap;
            }

            .titech-chart-container__status-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background:
                currentColor;
            }

            .titech-chart-container__status--success,
            .titech-chart-container__status--healthy,
            .titech-chart-container__status--live {
              color:
                var(--titech-chart-success);
            }

            .titech-chart-container__status--warning,
            .titech-chart-container__status--delayed,
            .titech-chart-container__status--pending {
              color:
                var(--titech-chart-warning);
            }

            .titech-chart-container__status--error,
            .titech-chart-container__status--failed {
              color:
                var(--titech-chart-danger);
            }

            .titech-chart-container__status--offline {
              color:
                var(--titech-chart-text-muted);
            }

            .titech-chart-container__content {
              width: 100%;
              min-width: 0;
            }

            .titech-chart-container__footer {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 14px;
              flex-wrap: wrap;
              color:
                var(--titech-chart-text-muted);
              font-size: 10px;
              line-height: 1.45;
            }

            .titech-chart-container__footer-left,
            .titech-chart-container__footer-right {
              min-width: 0;
            }

            .titech-chart-container__footer-right {
              margin-left: auto;
              text-align: right;
            }

            /* --------------------------------------------------------------
               State surfaces
               ------------------------------------------------------------ */

            .titech-chart-container__state {
              display: grid;
              place-items: center;
              align-content: center;
              width: 100%;
              min-height: 260px;
              padding: 32px 24px;
              border:
                1px dashed
                var(--titech-chart-border-strong);
              border-radius: 12px;
              background:
                var(--titech-chart-surface-muted);
              color:
                var(--titech-chart-text);
              text-align: center;
            }

            .titech-chart-container__state--error {
              border-style: solid;
              border-color:
                var(
                  --titech-danger-border,
                  #fecaca
                );
              background:
                var(
                  --titech-chart-danger-surface
                );
            }

            .titech-chart-container__state-icon {
              display: grid;
              place-items: center;
              width: 52px;
              height: 52px;
              margin-bottom: 11px;
              border-radius: 14px;
              color:
                var(--titech-chart-text-muted);
              background:
                var(--titech-chart-surface);
            }

            .titech-chart-container__state--error
              .titech-chart-container__state-icon {
              color:
                var(--titech-chart-danger);
            }

            .titech-chart-container__state-title {
              margin-bottom: 5px;
              font-size: 14px;
              line-height: 1.35;
              font-weight: 800;
            }

            .titech-chart-container__state-message {
              max-width: 470px;
              color:
                var(--titech-chart-text-muted);
              font-size: 12px;
              line-height: 1.55;
              overflow-wrap: anywhere;
            }

            .titech-chart-container__state-action {
              margin-top: 14px;
            }

            .titech-chart-container__retry-button {
              min-height: 38px;
              padding: 8px 14px;
              border: 0;
              border-radius: 8px;
              background:
                var(--titech-chart-primary);
              color:
                var(--titech-chart-on-primary);
              font-size: 12px;
              font-weight: 800;
              cursor: pointer;
              transition:
                opacity 140ms ease,
                transform 140ms ease;
            }

            .titech-chart-container__retry-button:hover {
              opacity: 0.9;
            }

            .titech-chart-container__retry-button:active {
              transform: translateY(1px);
            }

            /* --------------------------------------------------------------
               Loading
               ------------------------------------------------------------ */

            .titech-chart-container__loading {
              width: 100%;
            }

            .titech-chart-container__loading-header {
              margin-bottom: 18px;
            }

            .titech-chart-container__skeleton {
              border-radius: 6px;
              background:
                linear-gradient(
                  90deg,
                  var(
                    --titech-skeleton,
                    #e2e8f0
                  ) 25%,
                  var(
                    --titech-skeleton-muted,
                    #f8fafc
                  ) 50%,
                  var(
                    --titech-skeleton,
                    #e2e8f0
                  ) 75%
                );
              background-size: 200% 100%;
              animation:
                titech-chart-container-skeleton
                1.5s
                ease-in-out
                infinite;
            }

            .titech-chart-container__skeleton--title {
              width: 30%;
              min-width: 120px;
              height: 18px;
            }

            .titech-chart-container__skeleton--description {
              width: 50%;
              min-width: 180px;
              height: 11px;
              margin-top: 8px;
            }

            .titech-chart-container__skeleton-chart {
              position: relative;
              width: 100%;
              border-radius: 12px;
              overflow: hidden;
              background:
                var(
                  --titech-chart-surface-muted
                );
            }

            .titech-chart-container__axis-placeholder {
              position: absolute;
              inset: 14px 16px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              pointer-events: none;
            }

            .titech-chart-container__axis-placeholder span {
              display: block;
              height: 1px;
              width: 100%;
              background:
                var(
                  --titech-chart-border
                );
              opacity: 0.55;
            }

            .titech-chart-container__loading-bars {
              position: absolute;
              left: 8%;
              right: 8%;
              bottom: 10%;
              top: 12%;
              display: flex;
              align-items: flex-end;
              justify-content: space-around;
              gap: 8px;
            }

            .titech-chart-container__loading-bars span {
              display: block;
              width: 8%;
              max-width: 42px;
              min-width: 8px;
              border-radius: 6px 6px 2px 2px;
              background:
                var(
                  --titech-skeleton,
                  #e2e8f0
                );
              opacity: 0.88;
            }

            @keyframes titech-chart-container-skeleton {
              0% {
                background-position: 200% 0;
              }

              100% {
                background-position: -200% 0;
              }
            }

            /* --------------------------------------------------------------
               Responsive
               ------------------------------------------------------------ */

            @media (max-width: 760px) {
              .titech-chart-container__header {
                flex-direction: column;
                align-items: stretch;
              }

              .titech-chart-container__header-actions {
                justify-content: flex-start;
                width: 100%;
              }

              .titech-chart-container__status {
                margin-top: 4px;
              }

              .titech-chart-container__footer-right {
                margin-left: 0;
                text-align: left;
              }
            }

            @media (max-width: 520px) {
              .titech-chart-container__title {
                font-size: 16px;
              }

              .titech-chart-container__description {
                font-size: 11px;
              }

              .titech-chart-container__header-actions {
                width: 100%;
              }

              .titech-chart-container__toolbar,
              .titech-chart-container__actions {
                max-width: 100%;
                overflow-x: auto;
                padding-bottom: 2px;
              }
            }

            /* --------------------------------------------------------------
               Reduced motion
               ------------------------------------------------------------ */

            @media (prefers-reduced-motion: reduce) {
              .titech-chart-container *,
              .titech-chart-container
                *::before,
              .titech-chart-container
                *::after {
                animation: none !important;
                transition: none !important;
                scroll-behavior: auto !important;
              }
            }

            /* --------------------------------------------------------------
               Print
               ------------------------------------------------------------ */

            @media print {
              .titech-chart-container {
                break-inside: avoid;
                page-break-inside: avoid;
                box-shadow: none !important;
              }

              .titech-chart-container__collapse-button,
              .titech-chart-container__actions,
              .titech-chart-container__toolbar {
                display: none !important;
              }
            }
          `}
        </style>
      </section>
    );
  }),
);

ChartContainer.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ChartContainer,
  ChartEmptyState,
  ChartErrorState,
  ChartLoadingState,
  ChartStatusBadge,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartContainer;