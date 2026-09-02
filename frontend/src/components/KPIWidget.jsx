// ============================================================================
// TITech Community Capital
// Enterprise KPI Widget
// File: frontend/src/components/KPIWidget.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Reusable, resilient KPI / metric presentation component for TITech
// Community Capital dashboards and operational interfaces.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ KPI identity and value presentation
// ✓ Financial and non-financial metrics
// ✓ Currency / number / percentage formatting
// ✓ Positive / negative / neutral trends
// ✓ Optional comparison values
// ✓ Optional navigation
// ✓ Optional click actions
// ✓ Loading state
// ✓ Error state
// ✓ Empty / unavailable state
// ✓ Compact and standard presentation modes
// ✓ Accessibility
// ✓ Defensive API data normalization
// ✓ Stable test selectors
// ✓ Responsive-friendly markup
// ✓ React Router integration
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is presentation-only.
//
// It MUST NOT be treated as an authorization, tenant-isolation, financial
// authorization, KYC/AML, compliance, or accounting boundary.
//
// Financial values and permissions MUST be validated and authorized by the
// backend/API layer before reaching this component.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useMemo,
} from "react";

import PropTypes from "prop-types";
import { Link } from "react-router-dom";

import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Minus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";

import "./KPIWidget.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID = "titech-kpi-widget";

const DEFAULT_LOCALE = "en-UG";

const DEFAULT_CURRENCY = "UGX";

const DEFAULT_DECIMAL_PLACES = 0;

const DEFAULT_PERCENTAGE_DECIMAL_PLACES = 1;

const DEFAULT_TITLE = "Key Metric";

const DEFAULT_VALUE = 0;

const MAX_FRACTION_DIGITS = 20;

const TREND = Object.freeze({
  UP: "up",
  DOWN: "down",
  FLAT: "flat",
  POSITIVE: "positive",
  NEGATIVE: "negative",
  NEUTRAL: "neutral",
});

const STATUS = Object.freeze({
  DEFAULT: "default",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
  INFO: "info",
  PENDING: "pending",
});

const FORMAT = Object.freeze({
  NUMBER: "number",
  CURRENCY: "currency",
  PERCENTAGE: "percentage",
  COMPACT: "compact",
  INTEGER: "integer",
  DECIMAL: "decimal",
  TEXT: "text",
});

const SIZE = Object.freeze({
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
});

const DEFAULT_ICON = BarChart3;

// ============================================================================
// General Normalization
// ============================================================================

function normalizeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBoolean(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    ["true", "1", "yes", "on"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    ["false", "0", "no", "off"].includes(
      normalized,
    )
  ) {
    return false;
  }

  return fallback;
}

function clampFractionDigits(value, fallback = DEFAULT_DECIMAL_PLACES) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(0, Math.trunc(numericValue)),
  );
}

// ============================================================================
// Numeric Normalization
// ============================================================================

function normalizeNumber(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  if (typeof value === "bigint") {
    try {
      return Number(value);
    } catch {
      return fallback;
    }
  }

  const normalized = String(value)
    .trim()
    .replace(/,/g, "")
    .replace(/%/g, "");

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

// ============================================================================
// Enum Normalization
// ============================================================================

function normalizeTrend(value) {
  const normalized = normalizeString(
    value,
    TREND.FLAT,
  ).toLowerCase();

  if (
    [
      TREND.UP,
      TREND.POSITIVE,
    ].includes(normalized)
  ) {
    return TREND.UP;
  }

  if (
    [
      TREND.DOWN,
      TREND.NEGATIVE,
    ].includes(normalized)
  ) {
    return TREND.DOWN;
  }

  return TREND.FLAT;
}

function normalizeStatus(value) {
  const normalized = normalizeString(
    value,
    STATUS.DEFAULT,
  ).toLowerCase();

  return Object.values(STATUS).includes(
    normalized,
  )
    ? normalized
    : STATUS.DEFAULT;
}

function normalizeSize(value) {
  const normalized = normalizeString(
    value,
    SIZE.MEDIUM,
  ).toLowerCase();

  return Object.values(SIZE).includes(
    normalized,
  )
    ? normalized
    : SIZE.MEDIUM;
}

function normalizeFormat(value) {
  const normalized = normalizeString(
    value,
    FORMAT.NUMBER,
  ).toLowerCase();

  return Object.values(FORMAT).includes(
    normalized,
  )
    ? normalized
    : FORMAT.NUMBER;
}

// ============================================================================
// KPI Data Resolution
// ============================================================================

function getKpiId(kpi) {
  return (
    kpi?.id ??
    kpi?._id ??
    kpi?.kpiId ??
    kpi?.metricId ??
    null
  );
}

function getKpiTitle(kpi) {
  return normalizeString(
    kpi?.title ??
      kpi?.name ??
      kpi?.label ??
      kpi?.metricName,
    DEFAULT_TITLE,
  );
}

function getKpiValue(kpi) {
  return (
    kpi?.value ??
    kpi?.amount ??
    kpi?.total ??
    kpi?.currentValue ??
    kpi?.current ??
    DEFAULT_VALUE
  );
}

function getKpiDescription(kpi) {
  return normalizeString(
    kpi?.description ??
      kpi?.subtitle ??
      kpi?.helperText ??
      kpi?.helpText,
  );
}

function getKpiTrend(kpi) {
  return normalizeTrend(
    kpi?.trend ??
      kpi?.trendDirection ??
      kpi?.direction,
  );
}

function getKpiChange(kpi) {
  return (
    kpi?.change ??
    kpi?.changePercent ??
    kpi?.percentageChange ??
    kpi?.trendValue ??
    null
  );
}

// ============================================================================
// Formatter Infrastructure
// ============================================================================

function createNumberFormatter(
  locale,
  options = {},
) {
  try {
    return new Intl.NumberFormat(
      locale || DEFAULT_LOCALE,
      options,
    );
  } catch {
    return new Intl.NumberFormat(
      DEFAULT_LOCALE,
      options,
    );
  }
}

function formatNumber(
  value,
  locale = DEFAULT_LOCALE,
  maximumFractionDigits = DEFAULT_DECIMAL_PLACES,
) {
  const amount = normalizeNumber(value);

  const fractionDigits =
    clampFractionDigits(
      maximumFractionDigits,
      DEFAULT_DECIMAL_PLACES,
    );

  return createNumberFormatter(
    locale,
    {
      maximumFractionDigits:
        fractionDigits,
      minimumFractionDigits: 0,
    },
  ).format(amount);
}

function formatCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
  maximumFractionDigits = DEFAULT_DECIMAL_PLACES,
) {
  const amount = normalizeNumber(value);

  const normalizedCurrency =
    normalizeString(
      currency,
      DEFAULT_CURRENCY,
    ).toUpperCase();

  const fractionDigits =
    clampFractionDigits(
      maximumFractionDigits,
      DEFAULT_DECIMAL_PLACES,
    );

  try {
    return new Intl.NumberFormat(
      locale || DEFAULT_LOCALE,
      {
        style: "currency",
        currency: normalizedCurrency,
        maximumFractionDigits:
          fractionDigits,
        minimumFractionDigits: 0,
      },
    ).format(amount);
  } catch {
    return `${normalizedCurrency} ${formatNumber(
      amount,
      locale,
      fractionDigits,
    )}`;
  }
}

function formatPercentage(
  value,
  locale = DEFAULT_LOCALE,
  maximumFractionDigits =
    DEFAULT_PERCENTAGE_DECIMAL_PLACES,
) {
  const amount = normalizeNumber(value);

  const fractionDigits =
    clampFractionDigits(
      maximumFractionDigits,
      DEFAULT_PERCENTAGE_DECIMAL_PLACES,
    );

  return createNumberFormatter(
    locale,
    {
      style: "percent",
      maximumFractionDigits:
        fractionDigits,
      minimumFractionDigits: 0,
    },
  ).format(amount / 100);
}

function formatCompact(
  value,
  locale = DEFAULT_LOCALE,
) {
  const amount = normalizeNumber(value);

  try {
    return createNumberFormatter(
      locale,
      {
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: 1,
      },
    ).format(amount);
  } catch {
    return formatNumber(
      amount,
      locale,
      1,
    );
  }
}

function formatValue({
  value,
  format = FORMAT.NUMBER,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
  maximumFractionDigits =
    DEFAULT_DECIMAL_PLACES,
  prefix = "",
  suffix = "",
}) {
  const normalizedFormat =
    normalizeFormat(format);

  const normalizedPrefix =
    normalizeString(prefix);

  const normalizedSuffix =
    normalizeString(suffix);

  const numericValue =
    normalizeNumber(value);

  let formatted;

  switch (normalizedFormat) {
    case FORMAT.CURRENCY:
      formatted = formatCurrency(
        numericValue,
        currency,
        locale,
        maximumFractionDigits,
      );
      break;

    case FORMAT.PERCENTAGE:
      formatted = formatPercentage(
        numericValue,
        locale,
        maximumFractionDigits,
      );
      break;

    case FORMAT.COMPACT:
      formatted = formatCompact(
        numericValue,
        locale,
      );
      break;

    case FORMAT.INTEGER:
      formatted = formatNumber(
        numericValue,
        locale,
        0,
      );
      break;

    case FORMAT.DECIMAL:
      formatted = formatNumber(
        numericValue,
        locale,
        maximumFractionDigits,
      );
      break;

    case FORMAT.TEXT:
      formatted = normalizeString(
        value,
        "—",
      );
      break;

    case FORMAT.NUMBER:
    default:
      formatted = formatNumber(
        numericValue,
        locale,
        maximumFractionDigits,
      );
      break;
  }

  return `${normalizedPrefix}${formatted}${normalizedSuffix}`;
}

// ============================================================================
// Date Formatting
// ============================================================================

function formatDate(
  value,
  locale = DEFAULT_LOCALE,
) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(
      locale || DEFAULT_LOCALE,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

// ============================================================================
// Trend Helpers
// ============================================================================

function getTrendIcon(trend) {
  switch (normalizeTrend(trend)) {
    case TREND.UP:
      return ArrowUpRight;

    case TREND.DOWN:
      return ArrowDownRight;

    case TREND.FLAT:
    default:
      return Minus;
  }
}

function getTrendLabel(trend) {
  switch (normalizeTrend(trend)) {
    case TREND.UP:
      return "Increasing";

    case TREND.DOWN:
      return "Decreasing";

    case TREND.FLAT:
    default:
      return "No significant change";
  }
}

// ============================================================================
// Status Helpers
// ============================================================================

function getStatusIcon(status) {
  switch (normalizeStatus(status)) {
    case STATUS.SUCCESS:
      return CheckCircle2;

    case STATUS.WARNING:
      return AlertCircle;

    case STATUS.ERROR:
      return XCircle;

    case STATUS.PENDING:
      return Clock3;

    case STATUS.INFO:
      return ShieldCheck;

    case STATUS.DEFAULT:
    default:
      return null;
  }
}

function getStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case STATUS.SUCCESS:
      return "Success";

    case STATUS.WARNING:
      return "Warning";

    case STATUS.ERROR:
      return "Error";

    case STATUS.PENDING:
      return "Pending";

    case STATUS.INFO:
      return "Information";

    case STATUS.DEFAULT:
    default:
      return "";
  }
}

// ============================================================================
// URL Helpers
// ============================================================================

function isExternalHref(href) {
  return /^(https?:\/\/|mailto:|tel:)/i.test(
    normalizeString(href),
  );
}

function isUnsafeHref(href) {
  return /^\s*(javascript:|data:text\/html|vbscript:)/i.test(
    normalizeString(href),
  );
}

// ============================================================================
// KPI Widget
// ============================================================================

function KPIWidget({
  kpi = null,
  id,
  title,
  label,
  value,
  description,
  subtitle,

  format = FORMAT.NUMBER,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
  maximumFractionDigits =
    DEFAULT_DECIMAL_PLACES,

  prefix = "",
  suffix = "",

  trend,
  change,
  changeLabel,

  previousValue,
  comparisonLabel,

  status = STATUS.DEFAULT,

  icon: CustomIcon,

  href,
  to,

  onClick,

  showTrend = true,
  showDescription = true,
  showComparison = true,
  showStatus = false,

  loading = false,
  error = false,

  errorMessage =
    "Unable to load this metric.",

  empty = false,
  emptyLabel =
    "No data available",

  compact = false,

  size = SIZE.MEDIUM,

  disabled = false,

  className = "",

  testId =
    DEFAULT_TEST_ID,

  ariaLabel,
}) {
  // ==========================================================================
  // Normalize KPI Source
  // ==========================================================================

  const normalizedKpi =
    kpi &&
    typeof kpi === "object"
      ? kpi
      : {};

  const resolvedId =
    normalizeString(
      id ??
        getKpiId(
          normalizedKpi,
        ),
    );

  const resolvedTitle =
    normalizeString(
      title ??
        label ??
        getKpiTitle(
          normalizedKpi,
        ),
      DEFAULT_TITLE,
    );

  const resolvedValue =
    value ??
    getKpiValue(
      normalizedKpi,
    );

  const resolvedDescription =
    normalizeString(
      description ??
        subtitle ??
        getKpiDescription(
          normalizedKpi,
        ),
    );

  const resolvedFormat =
    normalizeFormat(
      format ??
        normalizedKpi.format,
    );

  const resolvedCurrency =
    normalizeString(
      currency ??
        normalizedKpi.currency,
      DEFAULT_CURRENCY,
    ).toUpperCase();

  const resolvedLocale =
    normalizeString(
      locale ??
        normalizedKpi.locale,
      DEFAULT_LOCALE,
    );

  const resolvedMaximumFractionDigits =
    clampFractionDigits(
      maximumFractionDigits,
      DEFAULT_DECIMAL_PLACES,
    );

  const resolvedTrend =
    normalizeTrend(
      trend ??
        getKpiTrend(
          normalizedKpi,
        ),
    );

  const resolvedChange =
    change ??
    getKpiChange(
      normalizedKpi,
    );

  const resolvedChangeLabel =
    normalizeString(
      changeLabel ??
        normalizedKpi.changeLabel ??
        normalizedKpi.trendLabel,
    );

  const resolvedPreviousValue =
    previousValue ??
    normalizedKpi.previousValue ??
    normalizedKpi.previous ??
    null;

  const resolvedComparisonLabel =
    normalizeString(
      comparisonLabel ??
        normalizedKpi.comparisonLabel ??
        normalizedKpi.periodLabel,
      "vs previous period",
    );

  const resolvedStatus =
    normalizeStatus(
      status ??
        normalizedKpi.status,
    );

  const resolvedHref = normalizeString(
    href ??
      to ??
      normalizedKpi.href ??
      normalizedKpi.to,
  );

  const resolvedIcon =
    CustomIcon ||
    normalizedKpi.icon ||
    DEFAULT_ICON;

  const resolvedSize =
    normalizeSize(
      size ??
        normalizedKpi.size,
    );

  const resolvedDisabled =
    normalizeBoolean(
      disabled,
      false,
    );

  const resolvedLoading =
    normalizeBoolean(
      loading,
      false,
    );

  const resolvedError =
    normalizeBoolean(
      error,
      false,
    );

  const resolvedEmpty =
    normalizeBoolean(
      empty,
      false,
    );

  const resolvedAriaLabel =
    normalizeString(
      ariaLabel,
      `${resolvedTitle}: ${formatValue({
        value: resolvedValue,
        format: resolvedFormat,
        currency:
          resolvedCurrency,
        locale:
          resolvedLocale,
        maximumFractionDigits:
          resolvedMaximumFractionDigits,
      })}`,
    );

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const formattedValue =
    useMemo(
      () =>
        formatValue({
          value:
            resolvedValue,
          format:
            resolvedFormat,
          currency:
            resolvedCurrency,
          locale:
            resolvedLocale,
          maximumFractionDigits:
            resolvedMaximumFractionDigits,
          prefix,
          suffix,
        }),
      [
        resolvedValue,
        resolvedFormat,
        resolvedCurrency,
        resolvedLocale,
        resolvedMaximumFractionDigits,
        prefix,
        suffix,
      ],
    );

  const formattedChange =
    useMemo(() => {
      if (
        resolvedChange ===
          null ||
        resolvedChange ===
          undefined ||
        resolvedChange === ""
      ) {
        return null;
      }

      const numericChange =
        normalizeNumber(
          resolvedChange,
          NaN,
        );

      if (
        !Number.isFinite(
          numericChange,
        )
      ) {
        return null;
      }

      if (
        resolvedFormat ===
        FORMAT.PERCENTAGE
      ) {
        return formatPercentage(
          numericChange,
          resolvedLocale,
          resolvedMaximumFractionDigits,
        );
      }

      const sign =
        numericChange >= 0
          ? "+"
          : "";

      return `${sign}${formatNumber(
        numericChange,
        resolvedLocale,
        resolvedMaximumFractionDigits,
      )}%`;
    }, [
      resolvedChange,
      resolvedFormat,
      resolvedLocale,
      resolvedMaximumFractionDigits,
    ]);

  const formattedPreviousValue =
    useMemo(() => {
      if (
        resolvedPreviousValue ===
          null ||
        resolvedPreviousValue ===
          undefined ||
        resolvedPreviousValue ===
          ""
      ) {
        return null;
      }

      return formatValue({
        value:
          resolvedPreviousValue,
        format:
          resolvedFormat,
        currency:
          resolvedCurrency,
        locale:
          resolvedLocale,
        maximumFractionDigits:
          resolvedMaximumFractionDigits,
      });
    }, [
      resolvedPreviousValue,
      resolvedFormat,
      resolvedCurrency,
      resolvedLocale,
      resolvedMaximumFractionDigits,
    ]);

  const StatusIcon =
    getStatusIcon(
      resolvedStatus,
    );

  const TrendIcon =
    getTrendIcon(
      resolvedTrend,
    );

  const StatusLabel =
    getStatusLabel(
      resolvedStatus,
    );

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const isInteractionBlocked =
    resolvedDisabled ||
    resolvedLoading ||
    resolvedError ||
    resolvedEmpty;

  const handleClick =
    useCallback(
      (event) => {
        if (
          isInteractionBlocked
        ) {
          event?.preventDefault?.();
          return;
        }

        if (
          typeof onClick ===
          "function"
        ) {
          onClick(
            normalizedKpi,
            event,
          );
        }
      },
      [
        isInteractionBlocked,
        onClick,
        normalizedKpi,
      ],
    );

  const handleKeyDown =
    useCallback(
      (event) => {
        if (
          isInteractionBlocked
        ) {
          return;
        }

        if (
          event.key !==
            "Enter" &&
          event.key !== " "
        ) {
          return;
        }

        if (!resolvedHref) {
          event.preventDefault();
        }

        if (
          typeof onClick ===
          "function"
        ) {
          onClick(
            normalizedKpi,
            event,
          );
        }
      },
      [
        isInteractionBlocked,
        resolvedHref,
        onClick,
        normalizedKpi,
      ],
    );

  // ==========================================================================
  // Class Names
  // ==========================================================================

  const widgetClassName =
    [
      "kpi-widget",
      `kpi-widget--${resolvedSize}`,

      compact
        ? "kpi-widget--compact"
        : "",

      resolvedDisabled
        ? "kpi-widget--disabled"
        : "",

      resolvedLoading
        ? "kpi-widget--loading"
        : "",

      resolvedError
        ? "kpi-widget--error"
        : "",

      resolvedEmpty
        ? "kpi-widget--empty"
        : "",

      `kpi-widget--status-${resolvedStatus}`,

      className,
    ]
      .filter(Boolean)
      .join(" ");

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (resolvedLoading) {
    return (
      <article
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-kpi-widget"
        data-state="loading"
        aria-busy="true"
        aria-label={`Loading ${resolvedTitle}`}
      >
        <div className="kpi-widget-header">
          <div
            className="kpi-widget-icon kpi-widget-icon--skeleton"
            aria-hidden="true"
          />

          <div className="kpi-widget-heading">
            <span
              className="kpi-widget-skeleton kpi-widget-skeleton--label"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="kpi-widget-value">
          <span
            className="kpi-widget-skeleton kpi-widget-skeleton--value"
            aria-hidden="true"
          />
        </div>

        <div className="kpi-widget-footer">
          <span
            className="kpi-widget-skeleton kpi-widget-skeleton--footer"
            aria-hidden="true"
          />
        </div>
      </article>
    );
  }

  // ==========================================================================
  // Error State
  // ==========================================================================

  if (resolvedError) {
    return (
      <article
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-kpi-widget"
        data-state="error"
        aria-live="polite"
      >
        <div className="kpi-widget-state">
          <div className="kpi-widget-state-icon kpi-widget-state-icon--error">
            <AlertCircle
              size={22}
              aria-hidden="true"
              focusable="false"
            />
          </div>

          <strong>
            {resolvedTitle}
          </strong>

          <p>
            {normalizeString(
              errorMessage,
              "Unable to load this metric.",
            )}
          </p>
        </div>
      </article>
    );
  }

  // ==========================================================================
  // Empty State
  // ==========================================================================

  if (resolvedEmpty) {
    return (
      <article
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-kpi-widget"
        data-state="empty"
        aria-label={`${resolvedTitle}: ${normalizeString(
          emptyLabel,
          "No data available",
        )}`}
      >
        <div className="kpi-widget-state">
          <div className="kpi-widget-state-icon">
            <BarChart3
              size={22}
              aria-hidden="true"
              focusable="false"
            />
          </div>

          <strong>
            {resolvedTitle}
          </strong>

          <p>
            {normalizeString(
              emptyLabel,
              "No data available",
            )}
          </p>
        </div>
      </article>
    );
  }

  // ==========================================================================
  // Content
  // ==========================================================================

  const Icon =
    typeof resolvedIcon ===
    "function"
      ? resolvedIcon
      : DEFAULT_ICON;

  const content = (
    <>
      {/* ====================================================================
          Header
          ==================================================================== */}

      <div className="kpi-widget-header">
        <div
          className="kpi-widget-icon"
          aria-hidden="true"
        >
          <Icon
            size={
              compact
                ? 18
                : 21
            }
            focusable="false"
          />
        </div>

        <div className="kpi-widget-heading">
          <span className="kpi-widget-label">
            {resolvedTitle}
          </span>

          {showStatus &&
          StatusIcon ? (
            <span
              className={`kpi-widget-status kpi-widget-status--${resolvedStatus}`}
              data-status={
                resolvedStatus
              }
              aria-label={
                StatusLabel
              }
            >
              <StatusIcon
                size={14}
                aria-hidden="true"
                focusable="false"
              />

              <span>
                {StatusLabel}
              </span>
            </span>
          ) : null}
        </div>

        {resolvedHref ? (
          <span
            className="kpi-widget-link-icon"
            aria-hidden="true"
          >
            {isExternalHref(
              resolvedHref,
            ) ? (
              <ExternalLink
                size={16}
                focusable="false"
              />
            ) : (
              <ArrowRight
                size={17}
                focusable="false"
              />
            )}
          </span>
        ) : null}
      </div>

      {/* ====================================================================
          Value
          ==================================================================== */}

      <div
        className="kpi-widget-value"
        data-testid={`${testId}-value`}
        aria-label={formattedValue}
      >
        {formattedValue}
      </div>

      {/* ====================================================================
          Description
          ==================================================================== */}

      {showDescription &&
      resolvedDescription ? (
        <p className="kpi-widget-description">
          {resolvedDescription}
        </p>
      ) : null}

      {/* ====================================================================
          Trend
          ==================================================================== */}

      {showTrend &&
      (formattedChange ||
        resolvedChangeLabel) ? (
        <div
          className={`kpi-widget-trend kpi-widget-trend--${resolvedTrend}`}
          data-trend={
            resolvedTrend
          }
          aria-label={`${getTrendLabel(
            resolvedTrend,
          )}${
            formattedChange
              ? ` ${formattedChange}`
              : ""
          }${
            resolvedChangeLabel
              ? ` ${resolvedChangeLabel}`
              : ""
          }`}
        >
          <TrendIcon
            size={16}
            aria-hidden="true"
            focusable="false"
          />

          {formattedChange ? (
            <strong>
              {formattedChange}
            </strong>
          ) : null}

          {resolvedChangeLabel ? (
            <span>
              {
                resolvedChangeLabel
              }
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ====================================================================
          Comparison
          ==================================================================== */}

      {showComparison &&
      formattedPreviousValue ? (
        <div className="kpi-widget-comparison">
          <span>
            {
              resolvedComparisonLabel
            }
          </span>

          <strong>
            {
              formattedPreviousValue
            }
          </strong>
        </div>
      ) : null}
    </>
  );

  // ==========================================================================
  // Unsafe Navigation Protection
  // ==========================================================================

  const safeHref =
    isUnsafeHref(resolvedHref)
      ? ""
      : resolvedHref;

  // ==========================================================================
  // External Navigation
  // ==========================================================================

  if (
    safeHref &&
    isExternalHref(safeHref)
  ) {
    const isHttpExternal =
      /^https?:\/\//i.test(
        safeHref,
      );

    return (
      <a
        href={safeHref}
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-kpi-widget"
        data-kpi-id={
          resolvedId || undefined
        }
        data-state="ready"
        data-status={
          resolvedStatus
        }
        aria-label={
          resolvedAriaLabel
        }
        aria-disabled={
          resolvedDisabled
            ? "true"
            : undefined
        }
        tabIndex={
          resolvedDisabled
            ? -1
            : undefined
        }
        onClick={
          handleClick
        }
        target={
          isHttpExternal
            ? "_blank"
            : undefined
        }
        rel={
          isHttpExternal
            ? "noopener noreferrer"
            : undefined
        }
      >
        {content}
      </a>
    );
  }

  // ==========================================================================
  // Internal Navigation
  // ==========================================================================

  if (safeHref) {
    return (
      <Link
        to={safeHref}
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-kpi-widget"
        data-kpi-id={
          resolvedId || undefined
        }
        data-state="ready"
        data-status={
          resolvedStatus
        }
        aria-label={
          resolvedAriaLabel
        }
        aria-disabled={
          resolvedDisabled
            ? "true"
            : undefined
        }
        tabIndex={
          resolvedDisabled
            ? -1
            : undefined
        }
        onClick={
          handleClick
        }
      >
        {content}
      </Link>
    );
  }

  // ==========================================================================
  // Non-Navigational Widget
  // ==========================================================================

  const isClickable =
    typeof onClick ===
      "function" &&
    !resolvedDisabled;

  return (
    <article
      className={widgetClassName}
      data-testid={testId}
      data-component="titech-kpi-widget"
      data-kpi-id={
        resolvedId || undefined
      }
      data-state="ready"
      data-status={
        resolvedStatus
      }
      aria-label={
        isClickable
          ? resolvedAriaLabel
          : undefined
      }
      role={
        isClickable
          ? "button"
          : undefined
      }
      tabIndex={
        isClickable
          ? 0
          : undefined
      }
      aria-disabled={
        resolvedDisabled
          ? "true"
          : undefined
      }
      onClick={
        isClickable
          ? handleClick
          : undefined
      }
      onKeyDown={
        isClickable
          ? handleKeyDown
          : undefined
      }
    >
      {content}
    </article>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

KPIWidget.propTypes = {
  /**
   * Optional complete KPI object.
   */
  kpi:
    PropTypes.object,

  /**
   * Stable KPI identifier.
   */
  id:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  title:
    PropTypes.string,

  label:
    PropTypes.string,

  value:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  description:
    PropTypes.string,

  subtitle:
    PropTypes.string,

  format:
    PropTypes.oneOf(
      Object.values(FORMAT),
    ),

  currency:
    PropTypes.string,

  locale:
    PropTypes.string,

  maximumFractionDigits:
    PropTypes.number,

  prefix:
    PropTypes.string,

  suffix:
    PropTypes.string,

  trend:
    PropTypes.oneOf([
      TREND.UP,
      TREND.DOWN,
      TREND.FLAT,
      TREND.POSITIVE,
      TREND.NEGATIVE,
      TREND.NEUTRAL,
    ]),

  change:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  changeLabel:
    PropTypes.string,

  previousValue:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  comparisonLabel:
    PropTypes.string,

  status:
    PropTypes.oneOf(
      Object.values(STATUS),
    ),

  icon:
    PropTypes.elementType,

  href:
    PropTypes.string,

  to:
    PropTypes.string,

  onClick:
    PropTypes.func,

  showTrend:
    PropTypes.bool,

  showDescription:
    PropTypes.bool,

  showComparison:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.bool,

  errorMessage:
    PropTypes.string,

  empty:
    PropTypes.bool,

  emptyLabel:
    PropTypes.string,

  compact:
    PropTypes.bool,

  size:
    PropTypes.oneOf(
      Object.values(SIZE),
    ),

  disabled:
    PropTypes.bool,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,
};

// ============================================================================
// Default Props
// ============================================================================

KPIWidget.defaultProps = {
  kpi: null,

  id: null,

  title:
    DEFAULT_TITLE,

  label:
    "",

  value:
    DEFAULT_VALUE,

  description:
    "",

  subtitle:
    "",

  format:
    FORMAT.NUMBER,

  currency:
    DEFAULT_CURRENCY,

  locale:
    DEFAULT_LOCALE,

  maximumFractionDigits:
    DEFAULT_DECIMAL_PLACES,

  prefix:
    "",

  suffix:
    "",

  trend:
    TREND.FLAT,

  change:
    null,

  changeLabel:
    "",

  previousValue:
    null,

  comparisonLabel:
    "vs previous period",

  status:
    STATUS.DEFAULT,

  icon:
    DEFAULT_ICON,

  href:
    "",

  to:
    "",

  onClick:
    undefined,

  showTrend:
    true,

  showDescription:
    true,

  showComparison:
    true,

  showStatus:
    false,

  loading:
    false,

  error:
    false,

  errorMessage:
    "Unable to load this metric.",

  empty:
    false,

  emptyLabel:
    "No data available",

  compact:
    false,

  size:
    SIZE.MEDIUM,

  disabled:
    false,

  className:
    "",

  testId:
    DEFAULT_TEST_ID,

  ariaLabel:
    "",
};

// ============================================================================
// Static Constants
// ============================================================================

KPIWidget.TREND =
  TREND;

KPIWidget.STATUS =
  STATUS;

KPIWidget.FORMAT =
  FORMAT;

KPIWidget.SIZE =
  SIZE;

// ============================================================================
// Static Utilities
// ============================================================================

KPIWidget.formatNumber =
  formatNumber;

KPIWidget.formatCurrency =
  formatCurrency;

KPIWidget.formatPercentage =
  formatPercentage;

KPIWidget.formatCompact =
  formatCompact;

KPIWidget.formatValue =
  formatValue;

KPIWidget.formatDate =
  formatDate;

KPIWidget.normalizeNumber =
  normalizeNumber;

KPIWidget.normalizeTrend =
  normalizeTrend;

KPIWidget.normalizeStatus =
  normalizeStatus;

KPIWidget.normalizeFormat =
  normalizeFormat;

KPIWidget.normalizeSize =
  normalizeSize;

// ============================================================================
// Metadata
// ============================================================================

KPIWidget.displayName =
  "TITechKPIWidget";

// ============================================================================
// Export
// ============================================================================

export default memo(
  KPIWidget,
);