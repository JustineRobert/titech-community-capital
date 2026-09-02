// ============================================================================
// TITech Community Capital
// Reports & Analytics
// File: frontend/src/pages/Reports.jsx
//
// Enterprise Production Grade
// ----------------------------------------------------------------------------
// - Financial / portfolio / member / transaction analytics
// - Safe API request lifecycle and cancellation
// - Manual + automatic refresh
// - Export handling with blob/download support
// - Date-range validation
// - Normalized API data
// - Loading / empty / error states
// - KPI cards with trend indicators
// - Responsive analytics layout
// - Accessible controls and status messaging
// - Recharts-compatible data normalization
// - No Redux / actions dependency
// - TITech branding only
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  FileBarChart2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  PieChart as PieChartIcon,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toast } from "react-toastify";

import api from "../services/api";

import "./Reports.css";

// ============================================================================
// CONSTANTS
// ============================================================================

const AUTO_REFRESH_INTERVAL = 300000; // 5 minutes

const DASHBOARD_ENDPOINT = "/api/reports/dashboard";

const REPORT_TYPES = [
  {
    value: "portfolio",
    label: "Portfolio",
  },
  {
    value: "financial",
    label: "Financial",
  },
  {
    value: "members",
    label: "Members",
  },
  {
    value: "transactions",
    label: "Transactions",
  },
  {
    value: "loans",
    label: "Loans",
  },
  {
    value: "savings",
    label: "Savings",
  },
  {
    value: "compliance",
    label: "Compliance",
  },
  {
    value: "audit",
    label: "Audit",
  },
];

const EXPORT_FORMATS = [
  {
    value: "pdf",
    label: "PDF",
    icon: FileText,
  },
  {
    value: "excel",
    label: "Excel",
    icon: FileSpreadsheet,
  },
  {
    value: "csv",
    label: "CSV",
    icon: FileBarChart2,
  },
];

const CHART_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#64748b",
];

const DEFAULT_REPORT_DATA = {
  summary: {
    members: 0,
    activeMembers: 0,
    savings: 0,
    loans: 0,
    transactions: 0,
    portfolioValue: 0,
    overdueLoans: 0,
    pendingCompliance: 0,
  },

  trends: {
    members: 0,
    savings: 0,
    loans: 0,
    transactions: 0,
    portfolio: 0,
  },

  loans: [],
  savings: [],
  portfolio: [],
  transactions: [],

  updatedAt: null,
};

// ============================================================================
// GENERAL HELPERS
// ============================================================================

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function firstDefined(...values) {
  return values.find(
    (value) =>
      value !== undefined &&
      value !== null
  );
}

function toNumber(value, fallback = 0) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(
      value.replace(/,/g, "")
    );

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampPercentage(value) {
  return Math.max(
    -999,
    Math.min(999, toNumber(value))
  );
}

function formatCurrency(value) {
  const amount = toNumber(value);

  try {
    return new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `UGX ${Math.round(
      amount
    ).toLocaleString("en-UG")}`;
  }
}

function formatNumber(value) {
  return toNumber(value).toLocaleString(
    "en-UG"
  );
}

function formatCompactCurrency(value) {
  const amount = toNumber(value);

  try {
    return new Intl.NumberFormat("en-UG", {
      notation: "compact",
      maximumFractionDigits: 1,
      style: "currency",
      currency: "UGX",
    }).format(amount);
  } catch {
    return formatCurrency(amount);
  }
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
      }
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function formatRelativeTime(value) {
  if (!value) {
    return "—";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "—";
  }

  const difference =
    Date.now() - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (difference < minute) {
    return "Just now";
  }

  if (difference < hour) {
    return `${Math.max(
      1,
      Math.floor(difference / minute)
    )}m ago`;
  }

  if (difference < day) {
    return `${Math.floor(
      difference / hour
    )}h ago`;
  }

  if (difference < 7 * day) {
    return `${Math.floor(
      difference / day
    )}d ago`;
  }

  return formatDate(value);
}

function formatReportType(type) {
  const match = REPORT_TYPES.find(
    (entry) => entry.value === type
  );

  return (
    match?.label ||
    String(type || "Portfolio")
  );
}

function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unable to load the requested report."
  );
}

function getPayload(response) {
  return (
    response?.data?.data ||
    response?.data ||
    response ||
    {}
  );
}

function getFilenameFromHeaders(
  headers,
  fallback
) {
  const disposition =
    headers?.["content-disposition"] ||
    headers?.get?.(
      "content-disposition"
    );

  if (!disposition) {
    return fallback;
  }

  const utfMatch =
    disposition.match(
      /filename\*=UTF-8''([^;]+)/i
    );

  if (utfMatch?.[1]) {
    return decodeURIComponent(
      utfMatch[1]
    );
  }

  const standardMatch =
    disposition.match(
      /filename="?([^"]+)"?/i
    );

  return (
    standardMatch?.[1] ||
    fallback
  );
}

function triggerBrowserDownload(
  blob,
  filename
) {
  if (!(blob instanceof Blob)) {
    throw new Error(
      "The export response was not a valid file."
    );
  }

  const url =
    window.URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();

  window.URL.revokeObjectURL(url);
}

// ============================================================================
// DATA NORMALIZATION
// ============================================================================

function normalizeChartData(
  items,
  fallbackLabel = "Item"
) {
  return toArray(items)
    .map((item, index) => {
      if (
        typeof item === "number" ||
        typeof item === "string"
      ) {
        return {
          name: `${fallbackLabel} ${index + 1}`,
          value: toNumber(item),
        };
      }

      if (!isObject(item)) {
        return null;
      }

      return {
        name: String(
          firstDefined(
            item.name,
            item.label,
            item.category,
            item.type,
            `${fallbackLabel} ${index + 1}`
          )
        ),
        value: toNumber(
          firstDefined(
            item.value,
            item.amount,
            item.total,
            item.balance
          )
        ),
        count: toNumber(
          firstDefined(
            item.count,
            item.quantity,
            item.totalCount,
            0
          )
        ),
      };
    })
    .filter(Boolean);
}

function normalizeReportData(payload) {
  const source = isObject(payload)
    ? payload
    : {};

  const rawSummary = isObject(
    source.summary
  )
    ? source.summary
    : {};

  const rawTrends = isObject(
    source.trends
  )
    ? source.trends
    : {};

  return {
    summary: {
      members: toNumber(
        firstDefined(
          rawSummary.members,
          rawSummary.totalMembers,
          rawSummary.users
        )
      ),

      activeMembers: toNumber(
        firstDefined(
          rawSummary.activeMembers,
          rawSummary.activeUsers
        )
      ),

      savings: toNumber(
        firstDefined(
          rawSummary.savings,
          rawSummary.totalSavings,
          rawSummary.savingsBalance
        )
      ),

      loans: toNumber(
        firstDefined(
          rawSummary.loans,
          rawSummary.totalLoans,
          rawSummary.loanValue
        )
      ),

      transactions: toNumber(
        firstDefined(
          rawSummary.transactions,
          rawSummary.totalTransactions
        )
      ),

      portfolioValue: toNumber(
        firstDefined(
          rawSummary.portfolioValue,
          rawSummary.portfolio,
          rawSummary.loanPortfolio
        )
      ),

      overdueLoans: toNumber(
        firstDefined(
          rawSummary.overdueLoans,
          rawSummary.overdue,
          rawSummary.delinquentLoans
        )
      ),

      pendingCompliance: toNumber(
        firstDefined(
          rawSummary.pendingCompliance,
          rawSummary.pendingKyc,
          rawSummary.pendingKYC
        )
      ),
    },

    trends: {
      members: clampPercentage(
        firstDefined(
          rawTrends.members,
          rawTrends.memberGrowth,
          0
        )
      ),

      savings: clampPercentage(
        firstDefined(
          rawTrends.savings,
          rawTrends.savingsGrowth,
          0
        )
      ),

      loans: clampPercentage(
        firstDefined(
          rawTrends.loans,
          rawTrends.loanGrowth,
          0
        )
      ),

      transactions: clampPercentage(
        firstDefined(
          rawTrends.transactions,
          rawTrends.transactionGrowth,
          0
        )
      ),

      portfolio: clampPercentage(
        firstDefined(
          rawTrends.portfolio,
          rawTrends.portfolioGrowth,
          0
        )
      ),
    },

    loans: normalizeChartData(
      firstDefined(
        source.loans,
        source.loanPortfolio,
        []
      ),
      "Loan"
    ),

    savings: normalizeChartData(
      firstDefined(
        source.savings,
        source.savingsDistribution,
        []
      ),
      "Savings"
    ),

    portfolio: normalizeChartData(
      firstDefined(
        source.portfolio,
        source.portfolioBreakdown,
        []
      ),
      "Portfolio"
    ),

    transactions: toArray(
      firstDefined(
        source.transactions,
        source.recentTransactions,
        []
      )
    ),

    updatedAt: firstDefined(
      source.updatedAt,
      source.generatedAt,
      source.timestamp,
      null
    ),
  };
}

// ============================================================================
// SMALL UI COMPONENTS
// ============================================================================

function TrendIndicator({ value }) {
  const percentage =
    clampPercentage(value);

  const isPositive =
    percentage >= 0;

  return (
    <span
      className={`report-trend ${
        isPositive
          ? "report-trend-positive"
          : "report-trend-negative"
      }`}
    >
      {isPositive ? (
        <TrendingUp
          size={14}
          aria-hidden="true"
        />
      ) : (
        <TrendingDown
          size={14}
          aria-hidden="true"
        />
      )}

      {isPositive ? "+" : ""}
      {percentage.toFixed(1)}%
    </span>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  caption,
  tone = "blue",
}) {
  return (
    <article
      className={`report-stat-card report-stat-card-${tone}`}
    >
      <div className="report-stat-card-top">
        <span className="report-stat-label">
          {title}
        </span>

        <span className="report-stat-icon">
          <Icon
            size={20}
            aria-hidden="true"
          />
        </span>
      </div>

      <strong className="report-stat-value">
        {value}
      </strong>

      <div className="report-stat-footer">
        {trend !== undefined && (
          <TrendIndicator value={trend} />
        )}

        {caption && (
          <span className="report-stat-caption">
            {caption}
          </span>
        )}
      </div>
    </article>
  );
}

function LoadingSkeleton() {
  return (
    <div
      className="reports-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading reports"
    >
      <div className="reports-skeleton-header">
        <div className="reports-skeleton-block reports-skeleton-title" />
        <div className="reports-skeleton-block reports-skeleton-subtitle" />
      </div>

      <div className="reports-skeleton-grid">
        {[1, 2, 3, 4].map(
          (item) => (
            <div
              key={item}
              className="reports-skeleton-card"
            >
              <div className="reports-skeleton-line reports-skeleton-small" />
              <div className="reports-skeleton-line reports-skeleton-large" />
              <div className="reports-skeleton-line reports-skeleton-medium" />
            </div>
          )
        )}
      </div>

      <span className="sr-only">
        Loading TITech reports…
      </span>
    </div>
  );
}

function EmptyChartState({
  title,
  description,
}) {
  return (
    <div className="report-empty-chart">
      <PieChartIcon
        size={28}
        aria-hidden="true"
      />

      <strong>{title}</strong>

      <p>{description}</p>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  icon: Icon,
  action,
}) {
  return (
    <div className="report-section-header">
      <div className="report-section-heading">
        {Icon && (
          <span className="report-section-icon">
            <Icon
              size={18}
              aria-hidden="true"
            />
          </span>
        )}

        <div>
          <h2>{title}</h2>

          {subtitle && (
            <p>{subtitle}</p>
          )}
        </div>
      </div>

      {action}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Reports() {
  const mountedRef =
    useRef(false);

  const requestRef =
    useRef(null);

  const refreshIntervalRef =
    useRef(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [exporting, setExporting] =
    useState("");

  const [error, setError] =
    useState("");

  const [reportType, setReportType] =
    useState("portfolio");

  const [dateRange, setDateRange] =
    useState({
      from: "",
      to: "",
    });

  const [lastUpdated, setLastUpdated] =
    useState(null);

  const [reportData, setReportData] =
    useState(DEFAULT_REPORT_DATA);

  // ==========================================================================
  // Date validation
  // ==========================================================================

  const dateRangeError =
    useMemo(() => {
      if (
        dateRange.from &&
        dateRange.to &&
        dateRange.from > dateRange.to
      ) {
        return "The start date cannot be later than the end date.";
      }

      return "";
    }, [dateRange]);

  // ==========================================================================
  // Fetch reports
  // ==========================================================================

  const fetchReports = useCallback(
    async ({
      silent = false,
    } = {}) => {
      if (dateRangeError) {
        setError(dateRangeError);
        return;
      }

      if (requestRef.current) {
        try {
          requestRef.current.abort?.();
        } catch {
          // Ignore cancellation failures.
        }
      }

      let controller = null;

      if (typeof AbortController !== "undefined") {
        controller =
          new AbortController();

        requestRef.current =
          controller;
      }

      setError("");

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response =
          await api.get(
            DASHBOARD_ENDPOINT,
            {
              params: {
                reportType,
                from:
                  dateRange.from ||
                  undefined,
                to:
                  dateRange.to ||
                  undefined,
              },

              ...(controller
                ? {
                    signal:
                      controller.signal,
                  }
                : {}),
            }
          );

        if (!mountedRef.current) {
          return;
        }

        const payload =
          getPayload(response);

        const normalized =
          normalizeReportData(
            payload
          );

        setReportData(
          normalized
        );

        setLastUpdated(
          normalized.updatedAt ||
            new Date().toISOString()
        );
      } catch (err) {
        const cancelled =
          err?.name ===
            "AbortError" ||
          err?.code ===
            "ERR_CANCELED";

        if (
          cancelled ||
          !mountedRef.current
        ) {
          return;
        }

        setError(
          getErrorMessage(err)
        );
      } finally {
        if (
          mountedRef.current
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [
      dateRange.from,
      dateRange.to,
      dateRangeError,
      reportType,
    ]
  );

  // ==========================================================================
  // Initial + dependency refresh
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchReports();

    return () => {
      mountedRef.current =
        false;

      if (
        requestRef.current
      ) {
        try {
          requestRef.current.abort?.();
        } catch {
          // Ignore cancellation failures.
        }
      }
    };
  }, [fetchReports]);

  // ==========================================================================
  // Auto refresh
  // ==========================================================================

  useEffect(() => {
    if (
      refreshIntervalRef.current
    ) {
      clearInterval(
        refreshIntervalRef.current
      );
    }

    refreshIntervalRef.current =
      setInterval(() => {
        fetchReports({
          silent: true,
        });
      }, AUTO_REFRESH_INTERVAL);

    return () => {
      if (
        refreshIntervalRef.current
      ) {
        clearInterval(
          refreshIntervalRef.current
        );

        refreshIntervalRef.current =
          null;
      }
    };
  }, [fetchReports]);

  // ==========================================================================
  // Export report
  // ==========================================================================

  const exportReport =
    useCallback(
      async (format) => {
        if (dateRangeError) {
          toast.error(
            dateRangeError
          );

          return;
        }

        if (exporting) {
          return;
        }

        setExporting(format);

        try {
          const fallbackExtensions = {
            pdf: "pdf",
            excel: "xlsx",
            csv: "csv",
          };

          const fallbackFilename =
            `titech-${reportType}-report.${
              fallbackExtensions[
                format
              ] || format
            }`;

          const response =
            await api.get(
              `/api/reports/export/${format}`,
              {
                params: {
                  reportType,
                  from:
                    dateRange.from ||
                    undefined,
                  to:
                    dateRange.to ||
                    undefined,
                },

                responseType:
                  "blob",
              }
            );

          const blob =
            response?.data;

          const filename =
            getFilenameFromHeaders(
              response?.headers,
              fallbackFilename
            );

          triggerBrowserDownload(
            blob,
            filename
          );

          toast.success(
            `${format.toUpperCase()} report downloaded successfully.`
          );
        } catch (err) {
          console.error(
            "TITech report export failed:",
            err
          );

          toast.error(
            getErrorMessage(
              err
            ) ||
              "Unable to export report."
          );
        } finally {
          if (
            mountedRef.current
          ) {
            setExporting("");
          }
        }
      },
      [
        dateRange.from,
        dateRange.to,
        dateRangeError,
        exporting,
        reportType,
      ]
    );

  // ==========================================================================
  // Derived values
  // ==========================================================================

  const summary =
    reportData.summary ||
    DEFAULT_REPORT_DATA.summary;

  const trends =
    reportData.trends ||
    DEFAULT_REPORT_DATA.trends;

  const reportLabel =
    formatReportType(
      reportType
    );

  const hasLoanData =
    reportData.loans.length >
    0;

  const hasSavingsData =
    reportData.savings.length >
    0;

  const hasPortfolioData =
    reportData.portfolio.length >
    0;

  const complianceAttention =
    summary.pendingCompliance >
    0;

  // ==========================================================================
  // Render loading
  // ==========================================================================

  if (loading) {
    return (
      <main className="reports-page">
        <LoadingSkeleton />
      </main>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main className="reports-page">
      <div className="reports-container">
        {/* ===================================================================
            HEADER
            ================================================================= */}

        <header className="reports-header">
          <div className="reports-heading">
            <span className="reports-eyebrow">
              TITech Intelligence
            </span>

            <h1>
              Reports &amp; Analytics
            </h1>

            <p>
              Monitor financial performance,
              portfolio health, member activity,
              transactions, compliance, and
              operational trends from one
              centralized reporting workspace.
            </p>
          </div>

          <div className="reports-header-actions">
            <div className="reports-last-updated">
              <span>
                Last updated
              </span>

              <strong>
                {formatDateTime(
                  lastUpdated
                )}
              </strong>
            </div>

            <button
              type="button"
              className="report-refresh-button"
              onClick={() =>
                fetchReports({
                  silent: true,
                })
              }
              disabled={
                refreshing ||
                Boolean(
                  dateRangeError
                )
              }
              aria-label="Refresh reports"
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={
                  refreshing
                    ? "report-spin"
                    : ""
                }
              />

              {refreshing
                ? "Refreshing…"
                : "Refresh"}
            </button>
          </div>
        </header>

        {/* ===================================================================
            FILTERS
            ================================================================= */}

        <section
          className="reports-filter-panel"
          aria-labelledby="reports-filter-title"
        >
          <div className="reports-filter-header">
            <div>
              <div className="reports-filter-title">
                <Filter
                  size={17}
                  aria-hidden="true"
                />

                <h2 id="reports-filter-title">
                  Reporting Filters
                </h2>
              </div>

              <p>
                Select a reporting domain and
                optional date range.
              </p>
            </div>

            <span className="reports-filter-current">
              {reportLabel} report
            </span>
          </div>

          <div className="reports-filter-grid">
            <label className="report-field">
              <span>
                Report type
              </span>

              <div className="report-select-wrapper">
                <select
                  value={reportType}
                  onChange={(event) =>
                    setReportType(
                      event.target.value
                    )
                  }
                  aria-label="Report type"
                >
                  {REPORT_TYPES.map(
                    (type) => (
                      <option
                        key={type.value}
                        value={
                          type.value
                        }
                      >
                        {type.label}
                      </option>
                    )
                  )}
                </select>

                <ChevronDown
                  size={16}
                  aria-hidden="true"
                />
              </div>
            </label>

            <label className="report-field">
              <span>
                From
              </span>

              <div className="report-date-wrapper">
                <Calendar
                  size={16}
                  aria-hidden="true"
                />

                <input
                  type="date"
                  value={
                    dateRange.from
                  }
                  max={
                    dateRange.to ||
                    undefined
                  }
                  onChange={(event) =>
                    setDateRange(
                      (previous) => ({
                        ...previous,
                        from:
                          event.target
                            .value,
                      })
                    )
                  }
                  aria-label="Report start date"
                />
              </div>
            </label>

            <label className="report-field">
              <span>
                To
              </span>

              <div className="report-date-wrapper">
                <Calendar
                  size={16}
                  aria-hidden="true"
                />

                <input
                  type="date"
                  value={
                    dateRange.to
                  }
                  min={
                    dateRange.from ||
                    undefined
                  }
                  onChange={(event) =>
                    setDateRange(
                      (previous) => ({
                        ...previous,
                        to:
                          event.target
                            .value,
                      })
                    )
                  }
                  aria-label="Report end date"
                />
              </div>
            </label>

            <div className="report-filter-action">
              <button
                type="button"
                onClick={() =>
                  fetchReports({
                    silent: false,
                  })
                }
                disabled={
                  refreshing ||
                  Boolean(
                    dateRangeError
                  )
                }
              >
                {refreshing ? (
                  <Loader2
                    size={16}
                    className="report-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <BarChart3
                    size={16}
                    aria-hidden="true"
                  />
                )}

                Apply Filters
              </button>
            </div>
          </div>

          {dateRangeError && (
            <p
              className="report-filter-error"
              role="alert"
            >
              <AlertCircle
                size={15}
                aria-hidden="true"
              />

              {dateRangeError}
            </p>
          )}
        </section>

        {/* ===================================================================
            ERROR
            ================================================================= */}

        {error && (
          <section
            className="reports-error"
            role="alert"
          >
            <div className="reports-error-icon">
              <AlertCircle
                size={19}
                aria-hidden="true"
              />
            </div>

            <div className="reports-error-content">
              <strong>
                Report data is unavailable
              </strong>

              <p>
                {error}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                fetchReports()
              }
            >
              Retry
            </button>
          </section>
        )}

        {/* ===================================================================
            KPI GRID
            ================================================================= */}

        <section
          className="report-stats"
          aria-label="Report summary"
        >
          <StatCard
            title="Members"
            value={formatNumber(
              summary.members
            )}
            trend={
              trends.members
            }
            caption={`${formatNumber(
              summary.activeMembers
            )} active`}
            icon={Users}
            tone="blue"
          />

          <StatCard
            title="Savings"
            value={formatCompactCurrency(
              summary.savings
            )}
            trend={
              trends.savings
            }
            caption="Total savings balance"
            icon={Wallet}
            tone="green"
          />

          <StatCard
            title="Loans"
            value={formatCompactCurrency(
              summary.loans
            )}
            trend={
              trends.loans
            }
            caption={`${formatNumber(
              summary.overdueLoans
            )} overdue`}
            icon={CreditCard}
            tone="purple"
          />

          <StatCard
            title="Transactions"
            value={formatNumber(
              summary.transactions
            )}
            trend={
              trends.transactions
            }
            caption="Processed transactions"
            icon={TrendingUp}
            tone="amber"
          />

          <StatCard
            title="Portfolio Value"
            value={formatCompactCurrency(
              summary.portfolioValue
            )}
            trend={
              trends.portfolio
            }
            caption="Current managed portfolio"
            icon={BarChart3}
            tone="indigo"
          />

          <StatCard
            title="Compliance"
            value={formatNumber(
              summary.pendingCompliance
            )}
            caption={
              complianceAttention
                ? "Items require review"
                : "No pending items"
            }
            icon={ShieldCheck}
            tone={
              complianceAttention
                ? "red"
                : "green"
            }
          />
        </section>

        {/* ===================================================================
            EXPORT CENTER
            ================================================================= */}

        <section className="reports-export-panel">
          <div className="reports-export-heading">
            <div className="reports-export-icon">
              <Download
                size={19}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2>
                Export Report
              </h2>

              <p>
                Download the current{" "}
                <strong>
                  {reportLabel}
                </strong>{" "}
                report using the selected date range.
              </p>
            </div>
          </div>

          <div className="report-export-actions">
            {EXPORT_FORMATS.map(
              (format) => {
                const ExportIcon =
                  format.icon;

                return (
                  <button
                    key={
                      format.value
                    }
                    type="button"
                    onClick={() =>
                      exportReport(
                        format.value
                      )
                    }
                    disabled={
                      Boolean(
                        exporting
                      ) ||
                      Boolean(
                        dateRangeError
                      )
                    }
                  >
                    {exporting ===
                    format.value ? (
                      <Loader2
                        size={16}
                        className="report-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ExportIcon
                        size={16}
                        aria-hidden="true"
                      />
                    )}

                    {exporting ===
                    format.value
                      ? "Exporting…"
                      : format.label}
                  </button>
                );
              }
            )}
          </div>
        </section>

        {/* ===================================================================
            CHARTS
            ================================================================= */}

        <section className="reports-charts">
          {/* Loan portfolio */}
          <article className="chart-card">
            <SectionHeader
              title="Loan Portfolio"
              subtitle="Portfolio value by reported category"
              icon={CreditCard}
              action={
                <span className="chart-card-meta">
                  {formatCurrency(
                    summary.loans
                  )}
                </span>
              }
            />

            <div className="chart-container">
              {hasLoanData ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <BarChart
                    data={
                      reportData.loans
                    }
                    margin={{
                      top: 10,
                      right: 10,
                      left: 0,
                      bottom: 10,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                    />

                    <XAxis
                      dataKey="name"
                      tick={{
                        fontSize: 12,
                      }}
                      axisLine={false}
                      tickLine={false}
                    />

                    <YAxis
                      tick={{
                        fontSize: 12,
                      }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(
                        value
                      ) =>
                        formatCompactCurrency(
                          value
                        )
                      }
                    />

                    <Tooltip
                      formatter={(value) =>
                        formatCurrency(
                          value
                        )
                      }
                    />

                    <Bar
                      dataKey="value"
                      name="Value"
                      fill={
                        CHART_COLORS[0]
                      }
                      radius={[
                        6,
                        6,
                        0,
                        0,
                      ]}
                      maxBarSize={54}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChartState
                  title="No loan data"
                  description="Loan portfolio analytics are not available for the selected period."
                />
              )}
            </div>
          </article>

          {/* Savings */}
          <article className="chart-card">
            <SectionHeader
              title="Savings Distribution"
              subtitle="Savings composition across reported categories"
              icon={Wallet}
              action={
                <span className="chart-card-meta">
                  {formatCurrency(
                    summary.savings
                  )}
                </span>
              }
            />

            <div className="chart-container">
              {hasSavingsData ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <PieChart>
                    <Pie
                      data={
                        reportData.savings
                      }
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="48%"
                      innerRadius={
                        65
                      }
                      outerRadius={
                        105
                      }
                      paddingAngle={2}
                    >
                      {reportData.savings.map(
                        (
                          entry,
                          index
                        ) => (
                          <Cell
                            key={`savings-${entry.name}-${index}`}
                            fill={
                              CHART_COLORS[
                                index %
                                  CHART_COLORS.length
                              ]
                            }
                          />
                        )
                      )}
                    </Pie>

                    <Tooltip
                      formatter={(
                        value
                      ) =>
                        formatCurrency(
                          value
                        )
                      }
                    />

                    <Legend
                      verticalAlign="bottom"
                      height={36}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChartState
                  title="No savings data"
                  description="Savings distribution is not available for the selected period."
                />
              )}
            </div>
          </article>

          {/* Portfolio breakdown */}
          <article className="chart-card chart-card-wide">
            <SectionHeader
              title="Portfolio Breakdown"
              subtitle="Current portfolio composition"
              icon={PieChartIcon}
              action={
                <span className="chart-card-meta">
                  {formatCurrency(
                    summary.portfolioValue
                  )}
                </span>
              }
            />

            <div className="chart-container">
              {hasPortfolioData ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <BarChart
                    data={
                      reportData.portfolio
                    }
                    layout="vertical"
                    margin={{
                      top: 10,
                      right: 20,
                      left: 20,
                      bottom: 10,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                    />

                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(
                        value
                      ) =>
                        formatCompactCurrency(
                          value
                        )
                      }
                    />

                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      axisLine={false}
                      tickLine={false}
                    />

                    <Tooltip
                      formatter={(value) =>
                        formatCurrency(
                          value
                        )
                      }
                    />

                    <Bar
                      dataKey="value"
                      name="Value"
                      fill={
                        CHART_COLORS[1]
                      }
                      radius={[
                        0,
                        6,
                        6,
                        0,
                      ]}
                      maxBarSize={30}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChartState
                  title="No portfolio breakdown"
                  description="Portfolio composition is not available for the selected period."
                />
              )}
            </div>
          </article>
        </section>

        {/* ===================================================================
            ANALYTICS MODULES
            ================================================================= */}

        <section
          className="report-cards"
          aria-label="Report modules"
        >
          <article className="report-card">
            <span className="report-card-icon report-card-icon-blue">
              <BarChart3
                size={25}
                aria-hidden="true"
              />
            </span>

            <h2>
              Portfolio Report
            </h2>

            <p>
              Review loan portfolio value,
              delinquency exposure, repayment
              performance, and portfolio
              composition.
            </p>

            <div className="report-card-footer">
              <span>
                Current portfolio
              </span>

              <strong>
                {formatCurrency(
                  summary.portfolioValue
                )}
              </strong>
            </div>
          </article>

          <article className="report-card">
            <span className="report-card-icon report-card-icon-green">
              <FileCheck2
                size={25}
                aria-hidden="true"
              />
            </span>

            <h2>
              Regulatory Reports
            </h2>

            <p>
              Support compliance, audit, KYC,
              transaction monitoring, and
              statutory reporting workflows.
            </p>

            <div className="report-card-footer">
              <span>
                Pending review
              </span>

              <strong
                className={
                  complianceAttention
                    ? "report-card-alert-value"
                    : ""
                }
              >
                {formatNumber(
                  summary.pendingCompliance
                )}
              </strong>
            </div>
          </article>

          <article className="report-card">
            <span className="report-card-icon report-card-icon-purple">
              <TrendingUp
                size={25}
                aria-hidden="true"
              />
            </span>

            <h2>
              Executive Analytics
            </h2>

            <p>
              Monitor strategic KPIs, growth
              trends, member activity, savings,
              loans, and transaction performance.
            </p>

            <div className="report-card-footer">
              <span>
                Member growth
              </span>

              <TrendIndicator
                value={
                  trends.members
                }
              />
            </div>
          </article>

          <article className="report-card">
            <span className="report-card-icon report-card-icon-amber">
              <Calendar
                size={25}
                aria-hidden="true"
              />
            </span>

            <h2>
              Reporting Period
            </h2>

            <p>
              The current report uses the
              selected reporting domain and
              date window.
            </p>

            <div className="report-card-footer">
              <span>
                Period
              </span>

              <strong>
                {dateRange.from &&
                dateRange.to
                  ? `${dateRange.from} → ${dateRange.to}`
                  : "All available"}
              </strong>
            </div>
          </article>
        </section>

        {/* ===================================================================
            REPORT STATUS FOOTER
            ================================================================= */}

        <footer className="reports-footer">
          <div className="reports-footer-status">
            {error ? (
              <XCircle
                size={16}
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                size={16}
                aria-hidden="true"
              />
            )}

            <span>
              TITech reporting services{" "}
              <strong>
                {error
                  ? "require attention"
                  : "operational"}
              </strong>
            </span>
          </div>

          <span>
            Auto-refresh: every 5 minutes
          </span>
        </footer>
      </div>
    </main>
  );
}

// ============================================================================
// ACCESSIBILITY UTILITY
// ============================================================================

/*
 * Keep this class available to Reports.css even if the project does not use
 * a global accessibility utility stylesheet.
 */