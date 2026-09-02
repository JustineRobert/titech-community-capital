// ============================================================================
// TITech Community Capital LTD
// Enterprise Transactions Chart
// File: frontend/src/components/TransactionsChart.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Enterprise financial transaction visualization for TITech Community Capital.
//
// Features
// ----------------------------------------------------------------------------
// ✓ Responsive transaction chart
// ✓ Daily / weekly / monthly aggregation
// ✓ Income / expense / net transaction views
// ✓ Safe transaction normalization
// ✓ Defensive financial-value parsing
// ✓ Accessible chart container
// ✓ Loading state
// ✓ Empty state
// ✓ Error state
// ✓ Retry support
// ✓ Custom formatter support
// ✓ Currency-aware display
// ✓ Tooltip with transaction details
// ✓ Summary metrics
// ✓ Stable test selectors
// ✓ Dark-mode friendly CSS variables
// ✓ No routing dependency
// ✓ No authorization dependency
// ✓ No direct financial mutation
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is PRESENTATION ONLY.
//
// It must never be treated as:
// ✓ A financial ledger
// ✓ A source of truth for balances
// ✓ An authorization boundary
// ✓ A transaction-validation layer
// ✓ A tenant-isolation boundary
//
// Financial values must originate from trusted backend/API responses.
// The backend remains authoritative for ledger state and financial posting.
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import {
  Bar,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import "./TransactionsChart.css";

// ============================================================================
// Constants
// ============================================================================

export const TRANSACTION_CHART_MODES =
  Object.freeze({
    NET: "net",
    INFLOW_OUTFLOW: "inflow_outflow",
    INFLOW: "inflow",
    OUTFLOW: "outflow",
  });

export const TRANSACTION_CHART_PERIODS =
  Object.freeze({
    DAY: "day",
    WEEK: "week",
    MONTH: "month",
  });

const DEFAULT_HEIGHT = 360;

const DEFAULT_CURRENCY = "UGX";

const DEFAULT_TITLE =
  "Transactions Overview";

const DEFAULT_DESCRIPTION =
  "Monitor transaction inflows, outflows and net movement over time.";

const DEFAULT_TEST_ID =
  "titech-transactions-chart";

const MAX_TOOLTIP_ITEMS = 8;

const NUMBER_FORMATTER_CACHE =
  new Map();

// ============================================================================
// Utility Helpers
// ============================================================================

function cn(...classes) {
  return classes
    .filter(Boolean)
    .join(" ");
}

function safeString(
  value,
  fallback = "",
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    const result = String(value).trim();

    return result || fallback;
  } catch {
    return fallback;
  }
}

function safeNumber(
  value,
  fallback = 0,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  if (
    typeof value === "bigint"
  ) {
    return Number(value);
  }

  if (
    typeof value === "object"
  ) {
    if (
      value.$numberDecimal !==
      undefined
    ) {
      return safeNumber(
        value.$numberDecimal,
        fallback,
      );
    }

    if (
      value.amount !== undefined
    ) {
      return safeNumber(
        value.amount,
        fallback,
      );
    }

    if (
      value.value !== undefined
    ) {
      return safeNumber(
        value.value,
        fallback,
      );
    }
  }

  const normalized =
    String(value)
      .replace(/,/g, "")
      .replace(/\s/g, "")
      .trim();

  if (!normalized) {
    return fallback;
  }

  const parsed =
    Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function getDateValue(
  transaction,
) {
  return (
    transaction?.date ??
    transaction?.transactionDate ??
    transaction?.createdAt ??
    transaction?.updatedAt ??
    transaction?.timestamp ??
    transaction?.occurredAt ??
    null
  );
}

function parseDate(
  value,
) {
  if (
    value instanceof Date
  ) {
    return Number.isNaN(
      value.getTime(),
    )
      ? null
      : value;
  }

  if (
    !value
  ) {
    return null;
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function getTransactionAmount(
  transaction,
) {
  const candidates = [
    transaction?.amount,
    transaction?.value,
    transaction?.totalAmount,
    transaction?.transactionAmount,
    transaction?.creditAmount,
    transaction?.debitAmount,
  ];

  for (
    const candidate of candidates
  ) {
    if (
      candidate !==
        null &&
      candidate !==
        undefined
    ) {
      return Math.abs(
        safeNumber(candidate),
      );
    }
  }

  return 0;
}

function getTransactionType(
  transaction,
) {
  const rawType =
    transaction?.type ??
    transaction?.transactionType ??
    transaction?.category ??
    transaction?.direction ??
    transaction?.operation ??
    "";

  return safeString(
    rawType,
  ).toLowerCase();
}

function isInflow(
  transaction,
) {
  if (
    transaction?.direction
  ) {
    const direction =
      safeString(
        transaction.direction,
      ).toLowerCase();

    if (
      [
        "in",
        "inflow",
        "credit",
        "deposit",
        "income",
        "received",
        "receive",
      ].includes(direction)
    ) {
      return true;
    }

    if (
      [
        "out",
        "outflow",
        "debit",
        "withdrawal",
        "expense",
        "sent",
        "send",
      ].includes(direction)
    ) {
      return false;
    }
  }

  const type =
    getTransactionType(
      transaction,
    );

  if (
    [
      "credit",
      "deposit",
      "contribution",
      "saving",
      "savings",
      "loan_repayment",
      "repayment",
      "income",
      "received",
      "receipt",
      "refund",
      "cash_in",
      "momo_in",
      "airtel_money_in",
    ].some((value) =>
      type.includes(value),
    )
  ) {
    return true;
  }

  if (
    [
      "debit",
      "withdrawal",
      "withdraw",
      "expense",
      "loan_disbursement",
      "disbursement",
      "cash_out",
      "momo_out",
      "airtel_money_out",
      "payment",
    ].some((value) =>
      type.includes(value),
    )
  ) {
    return false;
  }

  if (
    transaction?.credit !==
      undefined
  ) {
    return true;
  }

  if (
    transaction?.debit !==
      undefined
  ) {
    return false;
  }

  return safeNumber(
    transaction?.amount,
  ) >= 0;
}

function getCurrency(
  transaction,
  fallback,
) {
  return safeString(
    transaction?.currency ??
      transaction?.currencyCode ??
      fallback,
    fallback,
  ).toUpperCase();
}

function getTransactionLabel(
  transaction,
) {
  return safeString(
    transaction?.description ??
      transaction?.reference ??
      transaction?.transactionType ??
      transaction?.type ??
      "Transaction",
    "Transaction",
  );
}

// ============================================================================
// Date Aggregation
// ============================================================================

function startOfDay(
  date,
) {
  const result =
    new Date(date);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  return result;
}

function startOfWeek(
  date,
) {
  const result =
    startOfDay(date);

  const day =
    result.getDay();

  const difference =
    day === 0
      ? 6
      : day - 1;

  result.setDate(
    result.getDate() -
      difference,
  );

  return result;
}

function startOfMonth(
  date,
) {
  const result =
    startOfDay(date);

  result.setDate(1);

  return result;
}

function getPeriodStart(
  date,
  period,
) {
  switch (period) {
    case TRANSACTION_CHART_PERIODS.WEEK:
      return startOfWeek(date);

    case TRANSACTION_CHART_PERIODS.MONTH:
      return startOfMonth(date);

    case TRANSACTION_CHART_PERIODS.DAY:
    default:
      return startOfDay(date);
  }
}

function createPeriodKey(
  date,
  period,
) {
  const start =
    getPeriodStart(
      date,
      period,
    );

  return start
    .toISOString()
    .slice(0, 10);
}

// ============================================================================
// Formatting
// ============================================================================

function getNumberFormatter(
  currency,
) {
  const normalizedCurrency =
    safeString(
      currency,
      DEFAULT_CURRENCY,
    ).toUpperCase();

  if (
    NUMBER_FORMATTER_CACHE.has(
      normalizedCurrency,
    )
  ) {
    return NUMBER_FORMATTER_CACHE.get(
      normalizedCurrency,
    );
  }

  let formatter;

  try {
    formatter =
      new Intl.NumberFormat(
        undefined,
        {
          maximumFractionDigits: 2,
          minimumFractionDigits: 0,
        },
      );
  } catch {
    formatter = {
      format(value) {
        return Number(
          value || 0,
        ).toLocaleString();
      },
    };
  }

  NUMBER_FORMATTER_CACHE.set(
    normalizedCurrency,
    formatter,
  );

  return formatter;
}

function formatAmount(
  amount,
  currency,
  compact = false,
) {
  const numericAmount =
    safeNumber(amount);

  if (
    compact
  ) {
    try {
      return new Intl.NumberFormat(
        undefined,
        {
          notation: "compact",
          maximumFractionDigits: 1,
        },
      ).format(
        numericAmount,
      );
    } catch {
      return getNumberFormatter(
        currency,
      ).format(
        numericAmount,
      );
    }
  }

  return getNumberFormatter(
    currency,
  ).format(
    numericAmount,
  );
}

function formatDateLabel(
  date,
  period,
) {
  if (
    !date
  ) {
    return "";
  }

  const options =
    period ===
    TRANSACTION_CHART_PERIODS.MONTH
      ? {
          month: "short",
          year: "numeric",
        }
      : period ===
          TRANSACTION_CHART_PERIODS.WEEK
        ? {
            day: "numeric",
            month: "short",
          }
        : {
            day: "numeric",
            month: "short",
          };

  try {
    return new Intl.DateTimeFormat(
      undefined,
      options,
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

// ============================================================================
// Transaction Normalization
// ============================================================================

function normalizeTransactions(
  transactions,
  currency,
  period,
) {
  if (
    !Array.isArray(
      transactions,
    )
  ) {
    return [];
  }

  const buckets =
    new Map();

  transactions.forEach(
    (
      transaction,
    ) => {
      if (
        !transaction ||
        typeof transaction !==
          "object"
      ) {
        return;
      }

      const date =
        parseDate(
          getDateValue(
            transaction,
          ),
        );

      if (
        !date
      ) {
        return;
      }

      const amount =
        getTransactionAmount(
          transaction,
        );

      if (
        !Number.isFinite(
          amount,
        )
      ) {
        return;
      }

      const key =
        createPeriodKey(
          date,
          period,
        );

      const existing =
        buckets.get(key);

      const incoming =
        isInflow(
          transaction,
        );

      const transactionCurrency =
        getCurrency(
          transaction,
          currency,
        );

      if (
        existing
      ) {
        if (
          incoming
        ) {
          existing.inflow +=
            amount;
        } else {
          existing.outflow +=
            amount;
        }

        existing.transactionCount +=
          1;

        if (
          existing.labels.length <
          MAX_TOOLTIP_ITEMS
        ) {
          existing.labels.push(
            getTransactionLabel(
              transaction,
            ),
          );
        }

        return;
      }

      buckets.set(
        key,
        {
          key,
          date:
            getPeriodStart(
              date,
              period,
            ),
          label:
            formatDateLabel(
              getPeriodStart(
                date,
                period,
              ),
              period,
            ),
          inflow:
            incoming
              ? amount
              : 0,
          outflow:
            incoming
              ? 0
              : amount,
          net:
            incoming
              ? amount
              : -amount,
          transactionCount: 1,
          labels: [
            getTransactionLabel(
              transaction,
            ),
          ],
          currency:
            transactionCurrency,
        },
      );
    },
  );

  return Array.from(
    buckets.values(),
  )
    .map(
      (bucket) => ({
        ...bucket,
        net:
          bucket.inflow -
          bucket.outflow,
      }),
    )
    .sort(
      (a, b) =>
        a.date.getTime() -
        b.date.getTime(),
    );
}

// ============================================================================
// Summary
// ============================================================================

function calculateSummary(
  data,
) {
  return data.reduce(
    (
      summary,
      item,
    ) => {
      summary.inflow +=
        safeNumber(
          item.inflow,
        );

      summary.outflow +=
        safeNumber(
          item.outflow,
        );

      summary.net +=
        safeNumber(
          item.net,
        );

      summary.transactionCount +=
        safeNumber(
          item.transactionCount,
        );

      return summary;
    },
    {
      inflow: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
    },
  );
}

// ============================================================================
// Tooltip
// ============================================================================

function EnterpriseTooltip({
  active,
  payload,
  label,
  currency,
  mode,
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

  const item =
    payload[0]?.payload;

  if (
    !item
  ) {
    return null;
  }

  const visiblePayload =
    payload.slice(
      0,
      MAX_TOOLTIP_ITEMS,
    );

  return (
    <div
      className="titech-transactions-chart__tooltip"
      role="status"
    >
      <div className="titech-transactions-chart__tooltip-title">
        {label}
      </div>

      <div className="titech-transactions-chart__tooltip-items">
        {visiblePayload.map(
          (entry) => (
            <div
              className="titech-transactions-chart__tooltip-row"
              key={
                entry.dataKey
              }
            >
              <span className="titech-transactions-chart__tooltip-label">
                {entry.name}
              </span>

              <strong className="titech-transactions-chart__tooltip-value">
                {currency}{" "}
                {formatAmount(
                  entry.value,
                  currency,
                )}
              </strong>
            </div>
          ),
        )}

        {mode ===
          TRANSACTION_CHART_MODES.NET && (
          <div className="titech-transactions-chart__tooltip-row titech-transactions-chart__tooltip-row--net">
            <span className="titech-transactions-chart__tooltip-label">
              Net movement
            </span>

            <strong className="titech-transactions-chart__tooltip-value">
              {currency}{" "}
              {formatAmount(
                item.net,
                currency,
              )}
            </strong>
          </div>
        )}
      </div>

      <div className="titech-transactions-chart__tooltip-meta">
        {item.transactionCount}{" "}
        {item.transactionCount ===
        1
          ? "transaction"
          : "transactions"}
      </div>
    </div>
  );
}

EnterpriseTooltip.propTypes =
  {
    active:
      PropTypes.bool,
    payload:
      PropTypes.arrayOf(
        PropTypes.object,
      ),
    label:
      PropTypes.string,
    currency:
      PropTypes.string,
    mode:
      PropTypes.string,
  };

// ============================================================================
// Summary Metric
// ============================================================================

function SummaryMetric({
  icon: Icon,
  label,
  value,
  tone,
  currency,
}) {
  return (
    <div
      className={cn(
        "titech-transactions-chart__metric",
        `titech-transactions-chart__metric--${tone}`,
      )}
    >
      <div className="titech-transactions-chart__metric-icon">
        <Icon
          size={18}
          aria-hidden="true"
        />
      </div>

      <div className="titech-transactions-chart__metric-content">
        <span className="titech-transactions-chart__metric-label">
          {label}
        </span>

        <strong className="titech-transactions-chart__metric-value">
          {currency}{" "}
          {formatAmount(
            value,
            currency,
            true,
          )}
        </strong>
      </div>
    </div>
  );
}

SummaryMetric.propTypes =
  {
    icon:
      PropTypes.elementType
        .isRequired,
    label:
      PropTypes.string
        .isRequired,
    value:
      PropTypes.number
        .isRequired,
    tone:
      PropTypes.string
        .isRequired,
    currency:
      PropTypes.string
        .isRequired,
  };

// ============================================================================
// Empty State
// ============================================================================

function ChartEmptyState({
  title,
  description,
  testId,
}) {
  return (
    <div
      className="titech-transactions-chart__empty"
      data-testid={`${testId}-empty`}
      role="status"
      aria-live="polite"
    >
      <div className="titech-transactions-chart__empty-icon">
        <BarChart3
          size={28}
          aria-hidden="true"
        />
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>
    </div>
  );
}

ChartEmptyState.propTypes =
  {
    title:
      PropTypes.string
        .isRequired,
    description:
      PropTypes.string
        .isRequired,
    testId:
      PropTypes.string
        .isRequired,
  };

// ============================================================================
// Main Component
// ============================================================================

function TransactionsChart({
  transactions = [],
  data,
  currency = DEFAULT_CURRENCY,

  title =
    DEFAULT_TITLE,
  description =
    DEFAULT_DESCRIPTION,

  mode =
    TRANSACTION_CHART_MODES.INFLOW_OUTFLOW,

  period =
    TRANSACTION_CHART_PERIODS.MONTH,

  height =
    DEFAULT_HEIGHT,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showLegend = true,
  showGrid = true,

  emptyTitle =
    "No transaction activity",
  emptyDescription =
    "There are no transactions available for the selected period.",

  className = "",
  testId =
    DEFAULT_TEST_ID,

  formatValue = null,
}) {
  const titleId =
    useId();

  const descriptionId =
    useId();

  const [activeMode, setActiveMode] =
    useState(
      mode,
    );

  const [activePeriod, setActivePeriod] =
    useState(
      period,
    );

  // ========================================================================
  // Normalize incoming data
  // ========================================================================

  const normalizedData =
    useMemo(() => {
      if (
        Array.isArray(data)
      ) {
        return data
          .map(
            (item) => {
              if (
                !item ||
                typeof item !==
                  "object"
              ) {
                return null;
              }

              const date =
                parseDate(
                  item.date ??
                    item.period ??
                    item.timestamp,
                );

              return {
                ...item,
                date:
                  date ||
                  new Date(),
                label:
                  item.label ||
                  (date
                    ? formatDateLabel(
                        date,
                        activePeriod,
                      )
                    : ""),
                inflow:
                  safeNumber(
                    item.inflow ??
                      item.credit ??
                      item.income,
                  ),
                outflow:
                  safeNumber(
                    item.outflow ??
                      item.debit ??
                      item.expense,
                  ),
                net:
                  safeNumber(
                    item.net,
                  ) ||
                  safeNumber(
                    item.inflow ??
                      item.credit ??
                      item.income,
                  ) -
                    safeNumber(
                      item.outflow ??
                        item.debit ??
                        item.expense,
                    ),
                transactionCount:
                  safeNumber(
                    item.transactionCount ??
                      item.count ??
                      0,
                  ),
              };
            },
          )
          .filter(Boolean);
      }

      return normalizeTransactions(
        transactions,
        currency,
        activePeriod,
      );
    }, [
      data,
      transactions,
      currency,
      activePeriod,
    ]);

  // ========================================================================
  // Summary
  // ========================================================================

  const summary =
    useMemo(
      () =>
        calculateSummary(
          normalizedData,
        ),
      [normalizedData],
    );

  // ========================================================================
  // Mode
  // ========================================================================

  const chartData =
    useMemo(
      () =>
        normalizedData.map(
          (item) => ({
            ...item,
            net:
              safeNumber(
                item.inflow,
              ) -
              safeNumber(
                item.outflow,
              ),
          }),
        ),
      [normalizedData],
    );

  const isEmpty =
    !loading &&
    !error &&
    chartData.length ===
      0;

  // ========================================================================
  // Formatting
  // ========================================================================

  const valueFormatter =
    useCallback(
      (value) => {
        if (
          typeof formatValue ===
          "function"
        ) {
          try {
            return formatValue(
              value,
              currency,
            );
          } catch {
            // Fall through to safe formatter.
          }
        }

        return `${currency} ${formatAmount(
          value,
          currency,
        )}`;
      },
      [
        formatValue,
        currency,
      ],
    );

  // ========================================================================
  // Render Loading
  // ========================================================================

  if (
    loading
  ) {
    return (
      <section
        className={cn(
          "titech-transactions-chart",
          "titech-transactions-chart--loading",
          className,
        )}
        data-testid={
          testId
        }
        data-state="loading"
        aria-labelledby={
          titleId
        }
        aria-describedby={
          descriptionId
        }
        aria-busy="true"
      >
        <header className="titech-transactions-chart__header">
          <div>
            <div className="titech-transactions-chart__eyebrow">
              TITech Financial Analytics
            </div>

            <h2
              id={titleId}
              className="titech-transactions-chart__title"
            >
              {title}
            </h2>

            <p
              id={descriptionId}
              className="titech-transactions-chart__description"
            >
              {description}
            </p>
          </div>

          <div
            className="titech-transactions-chart__loading-icon"
            aria-hidden="true"
          >
            <RefreshCw
              size={20}
              className="titech-spin"
            />
          </div>
        </header>

        <div
          className="titech-transactions-chart__skeleton"
          aria-hidden="true"
        >
          <div className="titech-transactions-chart__skeleton-bar" />
          <div className="titech-transactions-chart__skeleton-bar" />
          <div className="titech-transactions-chart__skeleton-bar" />
          <div className="titech-transactions-chart__skeleton-bar" />
          <div className="titech-transactions-chart__skeleton-bar" />
        </div>
      </section>
    );
  }

  // ========================================================================
  // Render Error
  // ========================================================================

  if (
    error
  ) {
    return (
      <section
        className={cn(
          "titech-transactions-chart",
          "titech-transactions-chart--error",
          className,
        )}
        data-testid={
          testId
        }
        data-state="error"
        role="alert"
      >
        <div className="titech-transactions-chart__error-icon">
          <AlertTriangle
            size={28}
            aria-hidden="true"
          />
        </div>

        <h2>
          Unable to load transactions
        </h2>

        <p>
          Transaction analytics are
          temporarily unavailable.
          Please try again.
        </p>

        {typeof onRetry ===
          "function" && (
          <button
            type="button"
            className="titech-transactions-chart__retry"
            onClick={
              onRetry
            }
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
            />
            Try again
          </button>
        )}
      </section>
    );
  }

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <section
      className={cn(
        "titech-transactions-chart",
        className,
      )}
      data-testid={
        testId
      }
      data-state={
        isEmpty
          ? "empty"
          : "ready"
      }
      aria-labelledby={
        titleId
      }
      aria-describedby={
        descriptionId
      }
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <header className="titech-transactions-chart__header">
        <div className="titech-transactions-chart__heading">
          <div className="titech-transactions-chart__eyebrow">
            TITech Financial Analytics
          </div>

          <h2
            id={titleId}
            className="titech-transactions-chart__title"
          >
            {title}
          </h2>

          <p
            id={descriptionId}
            className="titech-transactions-chart__description"
          >
            {description}
          </p>
        </div>

        <div className="titech-transactions-chart__header-icon">
          <WalletCards
            size={22}
            aria-hidden="true"
          />
        </div>
      </header>

      {/* ================================================================== */}
      {/* Controls */}
      {/* ================================================================== */}

      <div
        className="titech-transactions-chart__controls"
        role="group"
        aria-label="Transaction chart controls"
      >
        <div
          className="titech-transactions-chart__control-group"
          role="group"
          aria-label="Transaction period"
        >
          {Object.values(
            TRANSACTION_CHART_PERIODS,
          ).map(
            (
              value,
            ) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "titech-transactions-chart__control",
                  activePeriod ===
                    value &&
                    "is-active",
                )}
                aria-pressed={
                  activePeriod ===
                  value
                }
                onClick={() =>
                  setActivePeriod(
                    value,
                  )
                }
              >
                {value
                  .charAt(0)
                  .toUpperCase() +
                  value.slice(
                    1,
                  )}
              </button>
            ),
          )}
        </div>

        <div
          className="titech-transactions-chart__control-group"
          role="group"
          aria-label="Transaction view"
        >
          {[
            {
              value:
                TRANSACTION_CHART_MODES.INFLOW_OUTFLOW,
              label:
                "In / Out",
            },
            {
              value:
                TRANSACTION_CHART_MODES.NET,
              label:
                "Net",
            },
          ].map(
            (
              option,
            ) => (
              <button
                key={
                  option.value
                }
                type="button"
                className={cn(
                  "titech-transactions-chart__control",
                  activeMode ===
                    option.value &&
                    "is-active",
                )}
                aria-pressed={
                  activeMode ===
                  option.value
                }
                onClick={() =>
                  setActiveMode(
                    option.value,
                  )
                }
              >
                {
                  option.label
                }
              </button>
            ),
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Summary */}
      {/* ================================================================== */}

      {showSummary &&
        !isEmpty && (
          <div className="titech-transactions-chart__metrics">
            <SummaryMetric
              icon={
                ArrowUpRight
              }
              label="Total inflow"
              value={
                summary.inflow
              }
              tone="positive"
              currency={
                currency
              }
            />

            <SummaryMetric
              icon={
                ArrowDownRight
              }
              label="Total outflow"
              value={
                summary.outflow
              }
              tone="negative"
              currency={
                currency
              }
            />

            <SummaryMetric
              icon={
                summary.net >=
                0
                  ? TrendingUp
                  : TrendingDown
              }
              label="Net movement"
              value={Math.abs(
                summary.net,
              )}
              tone={
                summary.net >=
                0
                  ? "positive"
                  : "negative"
              }
              currency={
                currency
              }
            />

            <div className="titech-transactions-chart__metric titech-transactions-chart__metric--neutral">
              <div className="titech-transactions-chart__metric-icon">
                <WalletCards
                  size={18}
                  aria-hidden="true"
                />
              </div>

              <div className="titech-transactions-chart__metric-content">
                <span className="titech-transactions-chart__metric-label">
                  Transactions
                </span>

                <strong className="titech-transactions-chart__metric-value">
                  {summary.transactionCount.toLocaleString()}
                </strong>
              </div>
            </div>
          </div>
        )}

      {/* ================================================================== */}
      {/* Empty */}
      {/* ================================================================== */}

      {isEmpty ? (
        <ChartEmptyState
          title={
            emptyTitle
          }
          description={
            emptyDescription
          }
          testId={
            testId
          }
        />
      ) : (
        <div
          className="titech-transactions-chart__visualization"
          style={{
            height,
          }}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <BarChart
              data={
                chartData
              }
              margin={{
                top: 12,
                right: 12,
                left: 4,
                bottom: 4,
              }}
            >
              {showGrid && (
                <CartesianGrid
                  className="titech-transactions-chart__grid"
                  vertical={false}
                  strokeDasharray="4 4"
                />
              )}

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                className="titech-transactions-chart__axis"
              />

              <YAxis
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(
                  value,
                ) =>
                  formatAmount(
                    value,
                    currency,
                    true,
                  )
                }
                className="titech-transactions-chart__axis"
              />

              <Tooltip
                cursor={{
                  className:
                    "titech-transactions-chart__cursor",
                }}
                content={
                  <EnterpriseTooltip
                    currency={
                      currency
                    }
                    mode={
                      activeMode
                    }
                  />
                }
              />

              {showLegend && (
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={36}
                />
              )}

              {(activeMode ===
                TRANSACTION_CHART_MODES.INFLOW_OUTFLOW ||
                activeMode ===
                  TRANSACTION_CHART_MODES.INFLOW) && (
                <Bar
                  dataKey="inflow"
                  name="Inflow"
                  className="titech-transactions-chart__bar titech-transactions-chart__bar--inflow"
                  radius={[
                    5,
                    5,
                    0,
                    0,
                  ]}
                  maxBarSize={42}
                />
              )}

              {(activeMode ===
                TRANSACTION_CHART_MODES.INFLOW_OUTFLOW ||
                activeMode ===
                  TRANSACTION_CHART_MODES.OUTFLOW) && (
                <Bar
                  dataKey="outflow"
                  name="Outflow"
                  className="titech-transactions-chart__bar titech-transactions-chart__bar--outflow"
                  radius={[
                    5,
                    5,
                    0,
                    0,
                  ]}
                  maxBarSize={42}
                />
              )}

              {activeMode ===
                TRANSACTION_CHART_MODES.NET && (
                <Bar
                  dataKey="net"
                  name="Net movement"
                  className="titech-transactions-chart__bar titech-transactions-chart__bar--net"
                  radius={[
                    5,
                    5,
                    0,
                    0,
                  ]}
                  maxBarSize={42}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ================================================================== */}
      {/* Footer */}
      {/* ================================================================== */}

      {!isEmpty && (
        <footer className="titech-transactions-chart__footer">
          <span>
            Showing{" "}
            {chartData.length}{" "}
            reporting{" "}
            {chartData.length ===
            1
              ? "period"
              : "periods"}
          </span>

          <span
            className="titech-transactions-chart__footer-note"
            title={valueFormatter(
              summary.net,
            )}
          >
            Net movement:{" "}
            {valueFormatter(
              summary.net,
            )}
          </span>
        </footer>
      )}
    </section>
  );
}

TransactionsChart.propTypes =
  {
    transactions:
      PropTypes.arrayOf(
        PropTypes.object,
      ),

    data:
      PropTypes.arrayOf(
        PropTypes.object,
      ),

    currency:
      PropTypes.string,

    title:
      PropTypes.string,

    description:
      PropTypes.string,

    mode:
      PropTypes.oneOf(
        Object.values(
          TRANSACTION_CHART_MODES,
        ),
      ),

    period:
      PropTypes.oneOf(
        Object.values(
          TRANSACTION_CHART_PERIODS,
        ),
      ),

    height:
      PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.string,
      ]),

    loading:
      PropTypes.bool,

    error:
      PropTypes.any,

    onRetry:
      PropTypes.func,

    showSummary:
      PropTypes.bool,

    showLegend:
      PropTypes.bool,

    showGrid:
      PropTypes.bool,

    emptyTitle:
      PropTypes.string,

    emptyDescription:
      PropTypes.string,

    className:
      PropTypes.string,

    testId:
      PropTypes.string,

    formatValue:
      PropTypes.func,
  };

// ============================================================================
// Defaults
// ============================================================================

TransactionsChart.defaultProps =
  {
    transactions: [],
    data: undefined,
    currency:
      DEFAULT_CURRENCY,

    title:
      DEFAULT_TITLE,

    description:
      DEFAULT_DESCRIPTION,

    mode:
      TRANSACTION_CHART_MODES.INFLOW_OUTFLOW,

    period:
      TRANSACTION_CHART_PERIODS.MONTH,

    height:
      DEFAULT_HEIGHT,

    loading: false,
    error: null,
    onRetry: null,

    showSummary: true,
    showLegend: true,
    showGrid: true,

    emptyTitle:
      "No transaction activity",

    emptyDescription:
      "There are no transactions available for the selected period.",

    className: "",
    testId:
      DEFAULT_TEST_ID,

    formatValue: null,
  };

// ============================================================================
// Static Metadata
// ============================================================================

TransactionsChart.displayName =
  "TITechTransactionsChart";

TransactionsChart.MODE =
  TRANSACTION_CHART_MODES;

TransactionsChart.PERIOD =
  TRANSACTION_CHART_PERIODS;

// ============================================================================
// Export
// ============================================================================

export default memo(
  TransactionsChart,
);