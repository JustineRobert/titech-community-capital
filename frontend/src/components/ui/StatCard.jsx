'use client';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise StatCard Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/StatCard.jsx
 *
 * Purpose:
 *   Reusable enterprise KPI / statistic card for the TITech Community Capital
 *   platform.
 *
 * Designed for:
 *   - Total Members
 *   - Active Members
 *   - Total Savings
 *   - Loan Portfolio
 *   - Outstanding Loans
 *   - Total Shares
 *   - Transaction Volume
 *   - Collections
 *   - Repayments
 *   - Deposits
 *   - Withdrawals
 *   - Revenue
 *   - Expenses
 *   - Delinquency
 *   - Portfolio at Risk
 *   - Branch performance
 *   - Group performance
 *   - SACCO / VSLA KPIs
 *   - Administrative dashboards
 *
 * Features:
 *   ✓ Controlled loading state
 *   ✓ Built-in skeleton state
 *   ✓ Currency formatting
 *   ✓ Number formatting
 *   ✓ Percentage formatting
 *   ✓ Custom value formatter
 *   ✓ Trend indicators
 *   ✓ Positive / negative / neutral trends
 *   ✓ Automatic trend direction
 *   ✓ Comparison text
 *   ✓ Icon support
 *   ✓ Semantic accent variants
 *   ✓ Optional action
 *   ✓ Optional href
 *   ✓ Optional onClick
 *   ✓ Accessible labels
 *   ✓ Tooltip-friendly content
 *   ✓ Responsive layout
 *   ✓ Dark mode
 *   ✓ Compact / default / large sizes
 *   ✓ Footer content
 *   ✓ Custom value rendering
 *   ✓ Enterprise financial dashboard friendly
 *
 * Important:
 *   This component contains no ACFOS references.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useMemo,
} from 'react';

import {
  Skeleton,
} from './Skeleton';

/**
 * ============================================================================
 * Utility
 * ============================================================================
 */

const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');

/**
 * ============================================================================
 * Number Formatting
 * ============================================================================
 */

const defaultFormatNumber = (
  value,
  options = {},
) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  if (
    typeof value !== 'number' &&
    Number.isNaN(Number(value))
  ) {
    return String(value);
  }

  const numericValue =
    Number(value);

  try {
    return new Intl.NumberFormat(
      options.locale || 'en-UG',
      {
        minimumFractionDigits:
          options.minimumFractionDigits ??
          0,

        maximumFractionDigits:
          options.maximumFractionDigits ??
          2,

        notation:
          options.notation ||
          'standard',

        compactDisplay:
          options.compactDisplay ||
          'short',
      },
    ).format(numericValue);
  } catch {
    return String(value);
  }
};

/**
 * ============================================================================
 * Currency Formatting
 * ============================================================================
 */

const defaultFormatCurrency = (
  value,
  currency = 'UGX',
  locale = 'en-UG',
) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  const numericValue =
    Number(value);

  if (Number.isNaN(numericValue)) {
    return String(value);
  }

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        maximumFractionDigits:
          currency === 'UGX'
            ? 0
            : 2,
      },
    ).format(numericValue);
  } catch {
    return `${currency} ${defaultFormatNumber(
      numericValue,
      {
        locale,
      },
    )}`;
  }
};

/**
 * ============================================================================
 * Percentage Formatting
 * ============================================================================
 */

const defaultFormatPercentage = (
  value,
  decimals = 1,
) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  const numericValue =
    Number(value);

  if (Number.isNaN(numericValue)) {
    return String(value);
  }

  return `${defaultFormatNumber(
    numericValue,
    {
      minimumFractionDigits:
        decimals,

      maximumFractionDigits:
        decimals,
    },
  )}%`;
};

/**
 * ============================================================================
 * Trend Helpers
 * ============================================================================
 */

const normalizeTrendDirection = (
  trend,
  trendDirection,
) => {
  if (
    trendDirection ===
      'up' ||
    trendDirection ===
      'down' ||
    trendDirection ===
      'neutral'
  ) {
    return trendDirection;
  }

  if (
    typeof trend === 'number'
  ) {
    if (trend > 0) {
      return 'up';
    }

    if (trend < 0) {
      return 'down';
    }
  }

  if (
    typeof trend === 'string'
  ) {
    const numericTrend =
      Number(
        trend.replace('%', ''),
      );

    if (!Number.isNaN(numericTrend)) {
      if (numericTrend > 0) {
        return 'up';
      }

      if (numericTrend < 0) {
        return 'down';
      }
    }
  }

  return 'neutral';
};

/**
 * ============================================================================
 * Default Icons
 * ============================================================================
 */

const TrendUpIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M3 17 9 11l4 4 8-8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M15 7h6v6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TrendDownIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="m3 7 6 6 4-4 8 8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M15 17h6v-6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const NeutralTrendIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path
      d="M5 12h14"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * ============================================================================
 * Default Arrow
 * ============================================================================
 */

const ArrowIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path
      d="m9 18 6-6-6-6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * ============================================================================
 * StatCard
 * ============================================================================
 */

const StatCard = forwardRef(
  function StatCard(
    {
      /**
       * ----------------------------------------------------------------------
       * Content
       * ----------------------------------------------------------------------
       */

      title,
      label,

      value = 0,

      subtitle,
      description,

      /**
       * ----------------------------------------------------------------------
       * Formatting
       * ----------------------------------------------------------------------
       */

      format = 'number',

      currency = 'UGX',

      locale = 'en-UG',

      decimals = 1,

      formatOptions,

      formatter,

      prefix = '',
      suffix = '',

      compact = false,

      /**
       * ----------------------------------------------------------------------
       * Trend
       * ----------------------------------------------------------------------
       */

      trend,

      trendDirection,

      trendLabel,

      comparison,

      comparisonLabel,

      inverseTrend = false,

      showTrend = true,

      /**
       * ----------------------------------------------------------------------
       * Loading
       * ----------------------------------------------------------------------
       */

      loading = false,

      /**
       * ----------------------------------------------------------------------
       * Icon
       * ----------------------------------------------------------------------
       */

      icon,

      iconLabel,

      /**
       * ----------------------------------------------------------------------
       * Variant
       * ----------------------------------------------------------------------
       */

      variant = 'default',

      size = 'md',

      /**
       * ----------------------------------------------------------------------
       * Interaction
       * ----------------------------------------------------------------------
       */

      href,

      onClick,

      action,

      actionLabel = 'View details',

      disabled = false,

      /**
       * ----------------------------------------------------------------------
       * Footer
       * ----------------------------------------------------------------------
       */

      footer,

      /**
       * ----------------------------------------------------------------------
       * Rendering
       * ----------------------------------------------------------------------
       */

      renderValue,

      renderTrend,

      /**
       * ----------------------------------------------------------------------
       * Accessibility
       * ----------------------------------------------------------------------
       */

      ariaLabel,

      /**
       * ----------------------------------------------------------------------
       * Styling
       * ----------------------------------------------------------------------
       */

      className = '',

      contentClassName = '',

      valueClassName = '',

      titleClassName = '',

      iconClassName = '',

      trendClassName = '',

      footerClassName = '',

      ...rest
    },
    ref,
  ) {
    /**
     * ========================================================================
     * Normalized Title
     * ========================================================================
     */

    const resolvedTitle =
      title ?? label ?? '';

    /**
     * ========================================================================
     * Formatted Value
     * ========================================================================
     */

    const formattedValue =
      useMemo(() => {
        if (formatter) {
          return formatter(
            value,
          );
        }

        switch (format) {
          case 'currency':
            return defaultFormatCurrency(
              value,
              currency,
              locale,
            );

          case 'percentage':
          case 'percent':
            return defaultFormatPercentage(
              value,
              decimals,
            );

          case 'number':
          default:
            return defaultFormatNumber(
              value,
              {
                locale,
                ...(formatOptions ||
                  {}),
                ...(compact
                  ? {
                      notation:
                        'compact',
                    }
                  : {}),
              },
            );
        }
      }, [
        formatter,
        value,
        format,
        currency,
        locale,
        decimals,
        formatOptions,
        compact,
      ]);

    /**
     * ========================================================================
     * Display Value
     * ========================================================================
     */

    const displayValue =
      renderValue
        ? renderValue(
            value,
            formattedValue,
          )
        : (
          <>
            {prefix}
            {formattedValue}
            {suffix}
          </>
        );

    /**
     * ========================================================================
     * Trend Direction
     * ========================================================================
     */

    const resolvedTrendDirection =
      normalizeTrendDirection(
        trend,
        trendDirection,
      );

    const effectiveTrendDirection =
      inverseTrend &&
      resolvedTrendDirection !==
        'neutral'
        ? resolvedTrendDirection ===
          'up'
          ? 'down'
          : 'up'
        : resolvedTrendDirection;

    /**
     * ========================================================================
     * Trend Text
     * ========================================================================
     */

    const trendText =
      trendLabel ??
      (trend === null ||
      trend === undefined
        ? null
        : typeof trend ===
            'number'
          ? defaultFormatPercentage(
              Math.abs(trend),
              decimals,
            )
          : String(trend));

    /**
     * ========================================================================
     * Variant Styles
     * ========================================================================
     */

    const variantStyles = {
      default: {
        card:
          'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900',

        icon:
          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
      },

      primary: {
        card:
          'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900',

        icon:
          'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
      },

      success: {
        card:
          'border-green-200 bg-white dark:border-green-900/60 dark:bg-gray-900',

        icon:
          'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
      },

      warning: {
        card:
          'border-amber-200 bg-white dark:border-amber-900/60 dark:bg-gray-900',

        icon:
          'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
      },

      danger: {
        card:
          'border-red-200 bg-white dark:border-red-900/60 dark:bg-gray-900',

        icon:
          'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
      },

      info: {
        card:
          'border-blue-200 bg-white dark:border-blue-900/60 dark:bg-gray-900',

        icon:
          'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
      },

      purple: {
        card:
          'border-purple-200 bg-white dark:border-purple-900/60 dark:bg-gray-900',

        icon:
          'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
      },

      neutral: {
        card:
          'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950',

        icon:
          'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
      },
    };

    const selectedVariant =
      variantStyles[
        variant
      ] ||
      variantStyles.default;

    /**
     * ========================================================================
     * Size Styles
     * ========================================================================
     */

    const sizeStyles = {
      sm: {
        card: 'p-4',
        title: 'text-xs',
        value: 'mt-2 text-xl',
        subtitle: 'mt-1 text-xs',
        icon: 'h-9 w-9',
      },

      md: {
        card: 'p-5',
        title: 'text-sm',
        value: 'mt-2 text-2xl',
        subtitle: 'mt-1.5 text-xs',
        icon: 'h-11 w-11',
      },

      lg: {
        card: 'p-6',
        title: 'text-sm',
        value: 'mt-3 text-3xl',
        subtitle: 'mt-2 text-sm',
        icon: 'h-12 w-12',
      },
    };

    const selectedSize =
      sizeStyles[size] ||
      sizeStyles.md;

    /**
     * ========================================================================
     * Trend Styles
     * ========================================================================
     */

    const trendStyles = {
      up: {
        text:
          'text-green-600 dark:text-green-400',

        background:
          'bg-green-50 dark:bg-green-950/40',
      },

      down: {
        text:
          'text-red-600 dark:text-red-400',

        background:
          'bg-red-50 dark:bg-red-950/40',
      },

      neutral: {
        text:
          'text-gray-600 dark:text-gray-400',

        background:
          'bg-gray-100 dark:bg-gray-800',
      },
    };

    const selectedTrendStyle =
      trendStyles[
        effectiveTrendDirection
      ] ||
      trendStyles.neutral;

    /**
     * ========================================================================
     * Trend Icon
     * ========================================================================
     */

    const trendIcon =
      effectiveTrendDirection ===
      'up'
        ? <TrendUpIcon />
        : effectiveTrendDirection ===
            'down'
          ? <TrendDownIcon />
          : <NeutralTrendIcon />;

    /**
     * ========================================================================
     * Interaction
     * ========================================================================
     */

    const isInteractive =
      Boolean(
        href ||
          onClick,
      ) &&
      !disabled;

    const handleClick =
      (event) => {
        if (
          disabled ||
          !onClick
        ) {
          return;
        }

        onClick(event);
      };

    /**
     * ========================================================================
     * Loading State
     * ========================================================================
     */

    if (loading) {
      return (
        <div
          ref={ref}
          className={cn(
            'relative w-full rounded-xl border',
            'border-gray-200 bg-white',
            'dark:border-gray-800 dark:bg-gray-900',
            selectedSize.card,
            className,
          )}
          aria-busy="true"
          aria-label={
            ariaLabel ||
            `${resolvedTitle} loading`
          }
          {...rest}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton
                width="45%"
                height="0.75rem"
                variant="text"
              />

              <div className="mt-3">
                <Skeleton
                  width="65%"
                  height={
                    size === 'lg'
                      ? '2rem'
                      : '1.75rem'
                  }
                  variant="text"
                />
              </div>

              <div className="mt-2">
                <Skeleton
                  width="40%"
                  height="0.65rem"
                  variant="text"
                />
              </div>
            </div>

            <Skeleton
              width={
                size === 'sm'
                  ? 36
                  : size === 'lg'
                    ? 48
                    : 44
              }
              height={
                size === 'sm'
                  ? 36
                  : size === 'lg'
                    ? 48
                    : 44
              }
              variant="circle"
            />
          </div>
        </div>
      );
    }

    /**
     * ========================================================================
     * Main Card
     * ========================================================================
     */

    const cardClassName =
      cn(
        'relative w-full rounded-xl border',
        'transition-all duration-150',
        selectedVariant.card,
        selectedSize.card,

        isInteractive
          ? [
              'cursor-pointer',
              'hover:-translate-y-0.5',
              'hover:shadow-md',
              'focus-within:ring-2',
              'focus-within:ring-gray-300',
              'dark:focus-within:ring-gray-700',
            ].join(' ')
          : '',

        disabled
          ? 'cursor-not-allowed opacity-60'
          : '',

        className,
      );

    /**
     * ========================================================================
     * Card Content
     * ========================================================================
     */

    const cardContent = (
      <>
        <div
          className={cn(
            'flex items-start justify-between gap-4',
            contentClassName,
          )}
        >
          <div className="min-w-0 flex-1">
            {/* Title */}
            <div
              className={cn(
                'truncate font-medium text-gray-500',
                'dark:text-gray-400',
                selectedSize.title,
                titleClassName,
              )}
              title={resolvedTitle}
            >
              {resolvedTitle}
            </div>

            {/* Value */}
            <div
              className={cn(
                'truncate font-semibold tracking-tight',
                'text-gray-900',
                'dark:text-white',
                selectedSize.value,
                valueClassName,
              )}
              title={
                typeof formattedValue ===
                'string'
                  ? formattedValue
                  : undefined
              }
            >
              {displayValue}
            </div>

            {/* Subtitle */}
            {(subtitle ||
              description) && (
              <div
                className={cn(
                  'truncate text-gray-500 dark:text-gray-400',
                  selectedSize.subtitle,
                )}
                title={
                  subtitle ||
                  description
                }
              >
                {subtitle ||
                  description}
              </div>
            )}

            {/* Trend */}
            {showTrend &&
              trendText !==
                null &&
              trendText !==
                undefined && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {renderTrend ? (
                    renderTrend({
                      trend,
                      direction:
                        effectiveTrendDirection,
                      label:
                        trendText,
                    })
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
                        selectedTrendStyle.background,
                        selectedTrendStyle.text,
                        trendClassName,
                      )}
                    >
                      {trendIcon}

                      <span>
                        {trendText}
                      </span>
                    </span>
                  )}

                  {(comparison ||
                    comparisonLabel) && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {comparison ||
                        comparisonLabel}
                    </span>
                  )}
                </div>
              )}
          </div>

          {/* Icon */}
          {icon && (
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-xl',
                selectedVariant.icon,
                selectedSize.icon,
                iconClassName,
              )}
              aria-label={
                iconLabel
              }
              title={iconLabel}
            >
              {icon}
            </div>
          )}
        </div>

        {/* Footer */}
        {(footer ||
          action) && (
          <div
            className={cn(
              'mt-5 flex items-center justify-between gap-3 border-t',
              'border-gray-100 pt-3',
              'dark:border-gray-800',
              footerClassName,
            )}
          >
            <div className="min-w-0 flex-1">
              {footer}
            </div>

            {action && (
              <div className="shrink-0">
                {action}
              </div>
            )}
          </div>
        )}

        {/* Default action */}
        {!footer &&
          !action &&
          (href ||
            onClick) && (
            <div className="mt-4 flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>
                {actionLabel}
              </span>

              <ArrowIcon />
            </div>
          )}
      </>
    );

    /**
     * ========================================================================
     * Link Card
     * ========================================================================
     */

    if (href && !disabled) {
      return (
        <a
          ref={ref}
          href={href}
          className={cardClassName}
          aria-label={
            ariaLabel ||
            resolvedTitle
          }
          {...rest}
        >
          {cardContent}
        </a>
      );
    }

    /**
     * ========================================================================
     * Button / Clickable Card
     * ========================================================================
     */

    if (onClick && !disabled) {
      return (
        <button
          ref={ref}
          type="button"
          className={cn(
            cardClassName,
            'block text-left',
          )}
          onClick={handleClick}
          aria-label={
            ariaLabel ||
            resolvedTitle
          }
          {...rest}
        >
          {cardContent}
        </button>
      );
    }

    /**
     * ========================================================================
     * Static Card
     * ========================================================================
     */

    return (
      <div
        ref={ref}
        className={cardClassName}
        aria-label={ariaLabel}
        {...rest}
      >
        {cardContent}
      </div>
    );
  },
);

StatCard.displayName =
  'StatCard';

/**
 * ============================================================================
 * Specialized Financial Stat Cards
 * ============================================================================
 */

/**
 * CurrencyStatCard
 *
 * Convenience wrapper for financial values.
 */
export const CurrencyStatCard =
  forwardRef(
    function CurrencyStatCard(
      {
        currency = 'UGX',
        locale = 'en-UG',
        ...props
      },
      ref,
    ) {
      return (
        <StatCard
          ref={ref}
          {...props}
          format="currency"
          currency={currency}
          locale={locale}
        />
      );
    },
  );

CurrencyStatCard.displayName =
  'CurrencyStatCard';

/**
 * PercentageStatCard
 */
export const PercentageStatCard =
  forwardRef(
    function PercentageStatCard(
      {
        decimals = 1,
        ...props
      },
      ref,
    ) {
      return (
        <StatCard
          ref={ref}
          {...props}
          format="percentage"
          decimals={decimals}
        />
      );
    },
  );

PercentageStatCard.displayName =
  'PercentageStatCard';

/**
 * NumberStatCard
 */
export const NumberStatCard =
  forwardRef(
    function NumberStatCard(
      props,
      ref,
    ) {
      return (
        <StatCard
          ref={ref}
          {...props}
          format="number"
        />
      );
    },
  );

NumberStatCard.displayName =
  'NumberStatCard';

/**
 * ============================================================================
 * Default Export
 * ============================================================================
 */

export default StatCard;