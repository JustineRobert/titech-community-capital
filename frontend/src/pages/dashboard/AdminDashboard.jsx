// ============================================================================
// TITech Community Capital
// Enterprise Admin Dashboard
//
// File:
// frontend/src/pages/dashboard/AdminDashboard.jsx
//
// Production Grade
// Multi-Tenant | Executive Analytics | Financial Safety
// Feature Flags | Permission Boundaries | Resilient Rendering
// Accessible UI | Defensive Data Handling | Responsive Charts
// ============================================================================

"use strict";

import React, {
  memo,
  useId,
  useMemo,
} from "react";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CreditCard,
  DollarSign,
  FileText,
  Landmark,
  PiggyBank,
  ShieldAlert,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

import {
  Card,
  FeatureGate,
  PermissionGate,
  StatusBadge,
} from "../../ui";

import "./AdminDashboard.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TENANT_NAME =
  "TITech Community Capital";

const DEFAULT_METRICS = Object.freeze({
  totalMembers: 0,
  totalSavings: 0,
  totalLoans: 0,
  activeLoans: 0,
  loanPortfolio: 0,
  totalTransactions: 0,
  mobileMoneyVolume: 0,
  fraudCases: 0,
  regulatoryReports: 0,
});

const DEFAULT_EXECUTIVE_METRICS =
  Object.freeze({
    memberGrowth: null,
    savingsGrowth: null,
    loanGrowth: null,
    transactionGrowth: null,
    revenue: 0,
    expenses: 0,
    profit: 0,
    recoveryRate: 0,
  });

const DEFAULT_SYSTEM_HEALTH =
  Object.freeze({
    api: "unknown",
    database: "unknown",
    queue: "unknown",
    mobileMoney: "unknown",
  });

const DEFAULT_FRAUD = Object.freeze([
  {
    name: "Clean",
    value: 100,
  },
  {
    name: "Flagged",
    value: 0,
  },
]);

const CHART_HEIGHT = 320;

const FRAUD_COLORS = [
  "#10b981",
  "#f59e0b",
  "#ef4444",
];

const STATUS_VALUES = new Set([
  "healthy",
  "operational",
  "connected",
  "warning",
  "degraded",
  "critical",
  "error",
  "offline",
  "unknown",
]);

// ============================================================================
// Safe Numeric Helpers
// ============================================================================

function toFiniteNumber(
  value,
  fallback = 0
) {
  const numericValue =
    Number(value);

  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : fallback;
}

function toNonNegativeNumber(
  value,
  fallback = 0
) {
  const numericValue =
    toFiniteNumber(
      value,
      fallback
    );

  return numericValue >= 0
    ? numericValue
    : fallback;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function currency(value) {
  return new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  ).format(
    toFiniteNumber(value)
  );
}

function number(value) {
  return new Intl.NumberFormat(
    "en-UG"
  ).format(
    toFiniteNumber(value)
  );
}

function percentage(
  value,
  fractionDigits = 1
) {
  const numericValue =
    toFiniteNumber(value);

  return `${numericValue.toFixed(
    fractionDigits
  )}%`;
}

function trendPercentage(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }

  return numericValue;
}

// ============================================================================
// Data Normalization
// ============================================================================

function normalizeArray(
  value
) {
  return Array.isArray(value)
    ? value
    : [];
}

function normalizeChartData(
  value,
  {
    labelKey = "name",
    valueKey = "value",
  } = {}
) {
  return normalizeArray(
    value
  )
    .map(
      (item, index) => {
        if (
          !item ||
          typeof item !== "object"
        ) {
          return null;
        }

        const label =
          item[labelKey] ??
          item.status ??
          item.label ??
          `Item ${index + 1}`;

        const numericValue =
          toNonNegativeNumber(
            item[valueKey]
          );

        return {
          ...item,
          [labelKey]: String(
            label
          ),
          [valueKey]:
            numericValue,
        };
      }
    )
    .filter(Boolean);
}

function normalizeFraudData(
  value
) {
  const data =
    normalizeChartData(
      value
    );

  if (!data.length) {
    return [...DEFAULT_FRAUD];
  }

  const total = data.reduce(
    (sum, item) =>
      sum +
      toNonNegativeNumber(
        item.value
      ),
    0
  );

  if (total <= 0) {
    return [...DEFAULT_FRAUD];
  }

  return data;
}

function normalizeStatus(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "unknown";
  }

  if (
    typeof value === "object"
  ) {
    value =
      value.status ??
      value.state ??
      value.health ??
      "unknown";
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    STATUS_VALUES.has(
      normalized
    )
  ) {
    return normalized;
  }

  return "unknown";
}

function statusLabel(
  value
) {
  const normalized =
    normalizeStatus(value);

  const labels = {
    healthy: "Healthy",
    operational:
      "Operational",
    connected: "Connected",
    warning: "Warning",
    degraded: "Degraded",
    critical: "Critical",
    error: "Error",
    offline: "Offline",
    unknown: "Unknown",
  };

  return (
    labels[normalized] ||
    "Unknown"
  );
}

// ============================================================================
// Chart Empty State
// ============================================================================

function ChartEmptyState({
  message = "No data available",
}) {
  return (
    <div
      className="admin-chart-empty"
      role="status"
      aria-live="polite"
    >
      <BarChart3
        size={32}
        aria-hidden="true"
      />

      <span>
        {message}
      </span>
    </div>
  );
}

// ============================================================================
// KPI Card
// ============================================================================

const KPI = memo(
  function KPI({
    title,
    value,
    icon: Icon,
    trend,
    description,
  }) {
    const normalizedTrend =
      trendPercentage(trend);

    const trendIsPositive =
      normalizedTrend === null
        ? null
        : normalizedTrend >= 0;

    return (
      <Card
        className="admin-kpi"
        aria-label={`${title}: ${value}`}
      >
        <div className="admin-kpi-top">
          <div className="admin-kpi-content">
            <p>
              {title}
            </p>

            <h3>
              {value}
            </h3>

            {description && (
              <span className="admin-kpi-description">
                {description}
              </span>
            )}
          </div>

          <div
            className="admin-kpi-icon"
            aria-hidden="true"
          >
            {Icon ? (
              <Icon size={26} />
            ) : null}
          </div>
        </div>

        {normalizedTrend !==
          null && (
          <div
            className={`admin-kpi-trend ${
              trendIsPositive
                ? "positive"
                : "negative"
            }`}
            aria-label={`Trend ${
              trendIsPositive
                ? "increased"
                : "decreased"
            } by ${Math.abs(
              normalizedTrend
            )}%`}
          >
            <TrendingUp
              size={14}
              aria-hidden="true"
            />

            <span>
              {Math.abs(
                normalizedTrend
              ).toFixed(1)}
              %
            </span>
          </div>
        )}
      </Card>
    );
  }
);

// ============================================================================
// Admin Dashboard
// ============================================================================

function AdminDashboard({
  metrics = {},
  savingsHistory = [],
  loanDistribution = [],
  transactionHistory = [],
  fraudMetrics,
  systemHealth = {},
  executiveMetrics = {},
}) {
  // React's useId provides a stable unique prefix for chart definitions.
  const chartId =
    useId().replace(
      /:/g,
      ""
    );

  // ========================================================================
  // Defensive Metrics
  // ========================================================================

  const data =
    useMemo(
      () => ({
        ...DEFAULT_METRICS,
        ...(metrics &&
        typeof metrics ===
          "object"
          ? metrics
          : {}),
      }),
      [metrics]
    );

  const executive =
    useMemo(
      () => ({
        ...DEFAULT_EXECUTIVE_METRICS,
        ...(executiveMetrics &&
        typeof executiveMetrics ===
          "object"
          ? executiveMetrics
          : {}),
      }),
      [executiveMetrics]
    );

  const health =
    useMemo(
      () => ({
        ...DEFAULT_SYSTEM_HEALTH,
        ...(systemHealth &&
        typeof systemHealth ===
          "object"
          ? systemHealth
          : {}),
      }),
      [systemHealth]
    );

  // ========================================================================
  // Chart Data
  // ========================================================================

  const savingsData =
    useMemo(
      () =>
        normalizeChartData(
          savingsHistory
        ),
      [savingsHistory]
    );

  const loanData =
    useMemo(
      () =>
        normalizeChartData(
          loanDistribution,
          {
            labelKey:
              "status",
            valueKey:
              "count",
          }
        ),
      [loanDistribution]
    );

  const transactionData =
    useMemo(
      () =>
        normalizeChartData(
          transactionHistory
        ),
      [transactionHistory]
    );

  const fraudData =
    useMemo(
      () =>
        normalizeFraudData(
          fraudMetrics
        ),
      [fraudMetrics]
    );

  // ========================================================================
  // Derived Financial Values
  // ========================================================================

  const safeMetrics =
    useMemo(
      () => ({
        totalMembers:
          toNonNegativeNumber(
            data.totalMembers
          ),

        totalSavings:
          toNonNegativeNumber(
            data.totalSavings
          ),

        totalLoans:
          toNonNegativeNumber(
            data.totalLoans
          ),

        activeLoans:
          toNonNegativeNumber(
            data.activeLoans
          ),

        loanPortfolio:
          toNonNegativeNumber(
            data.loanPortfolio
          ),

        totalTransactions:
          toNonNegativeNumber(
            data.totalTransactions
          ),

        mobileMoneyVolume:
          toNonNegativeNumber(
            data.mobileMoneyVolume
          ),

        fraudCases:
          toNonNegativeNumber(
            data.fraudCases
          ),

        regulatoryReports:
          toNonNegativeNumber(
            data.regulatoryReports
          ),
      }),
      [data]
    );

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <main
      className="admin-dashboard"
      aria-labelledby="admin-dashboard-title"
    >
      {/* ================================================================== */}
      {/* Dashboard Heading */}
      {/* ================================================================== */}

      <header className="admin-dashboard-header">
        <div>
          <h1
            id="admin-dashboard-title"
          >
            Enterprise Admin Dashboard
          </h1>

          <p>
            TITech Community Capital
            operational, financial,
            security and regulatory
            intelligence.
          </p>
        </div>
      </header>

      {/* ================================================================== */}
      {/* KPI Section */}
      {/* ================================================================== */}

      <section
        aria-labelledby="admin-kpi-heading"
      >
        <div className="sr-only">
          <h2 id="admin-kpi-heading">
            Key performance indicators
          </h2>
        </div>

        <div className="admin-kpi-grid">
          <KPI
            title="Members"
            value={number(
              safeMetrics.totalMembers
            )}
            icon={Users}
            trend={
              executive.memberGrowth
            }
            description="Registered community members"
          />

          <KPI
            title="Savings"
            value={currency(
              safeMetrics.totalSavings
            )}
            icon={PiggyBank}
            trend={
              executive.savingsGrowth
            }
            description="Total recorded savings"
          />

          <KPI
            title="Loan Portfolio"
            value={currency(
              safeMetrics.loanPortfolio
            )}
            icon={CreditCard}
            trend={
              executive.loanGrowth
            }
            description="Outstanding loan portfolio"
          />

          <KPI
            title="Transactions"
            value={number(
              safeMetrics.totalTransactions
            )}
            icon={Wallet}
            trend={
              executive.transactionGrowth
            }
            description="Recorded financial transactions"
          />

          <FeatureGate features="mobile_money">
            <KPI
              title="Mobile Money"
              value={currency(
                safeMetrics.mobileMoneyVolume
              )}
              icon={Smartphone}
              description="Mobile-money transaction volume"
            />
          </FeatureGate>

          <FeatureGate features="fraud_detection">
            <KPI
              title="Fraud Cases"
              value={number(
                safeMetrics.fraudCases
              )}
              icon={ShieldAlert}
              description="Flagged risk cases"
            />
          </FeatureGate>
        </div>
      </section>

      {/* ================================================================== */}
      {/* Analytics Charts */}
      {/* ================================================================== */}

      <section
        className="admin-chart-grid"
        aria-labelledby="admin-analytics-heading"
      >
        <h2
          id="admin-analytics-heading"
          className="sr-only"
        >
          Administrative analytics
        </h2>

        {/* ================================================================ */}
        {/* Savings Trend */}
        {/* ================================================================ */}

        <Card
          className="admin-chart-card"
          aria-labelledby="savings-trend-heading"
        >
          <div className="admin-chart-header">
            <div>
              <h3 id="savings-trend-heading">
                Savings Trend
              </h3>

              <p>
                Historical savings
                performance.
              </p>
            </div>

            <BarChart3
              size={20}
              aria-hidden="true"
            />
          </div>

          {savingsData.length ===
          0 ? (
            <ChartEmptyState message="No savings history available." />
          ) : (
            <ResponsiveContainer
              width="100%"
              height={
                CHART_HEIGHT
              }
            >
              <AreaChart
                data={
                  savingsData
                }
                margin={{
                  top: 10,
                  right: 16,
                  left: 0,
                  bottom: 0,
                }}
              >
                <defs>
                  <linearGradient
                    id={`${chartId}-savings-gradient`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#2563eb"
                      stopOpacity={
                        0.4
                      }
                    />

                    <stop
                      offset="100%"
                      stopColor="#2563eb"
                      stopOpacity={
                        0.05
                      }
                    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                />

                <XAxis
                  dataKey="name"
                  tick={{
                    fontSize: 12,
                  }}
                />

                <YAxis
                  tick={{
                    fontSize: 12,
                  }}
                />

                <Tooltip
                  formatter={value =>
                    currency(
                      value
                    )
                  }
                />

                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#2563eb"
                  fill={`url(#${chartId}-savings-gradient)`}
                  strokeWidth={2}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ================================================================ */}
        {/* Loan Distribution */}
        {/* ================================================================ */}

        <Card
          className="admin-chart-card"
          aria-labelledby="loan-distribution-heading"
        >
          <div className="admin-chart-header">
            <div>
              <h3 id="loan-distribution-heading">
                Loan Distribution
              </h3>

              <p>
                Current loan portfolio
                by status.
              </p>
            </div>

            <DollarSign
              size={20}
              aria-hidden="true"
            />
          </div>

          {loanData.length ===
          0 ? (
            <ChartEmptyState message="No loan distribution data available." />
          ) : (
            <ResponsiveContainer
              width="100%"
              height={
                CHART_HEIGHT
              }
            >
              <BarChart
                data={loanData}
                margin={{
                  top: 10,
                  right: 16,
                  left: 0,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                />

                <XAxis
                  dataKey="status"
                  tick={{
                    fontSize: 12,
                  }}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{
                    fontSize: 12,
                  }}
                />

                <Tooltip />

                <Legend />

                <Bar
                  dataKey="count"
                  name="Loans"
                  fill="#2563eb"
                  radius={[
                    4,
                    4,
                    0,
                    0,
                  ]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ================================================================ */}
        {/* Transaction Volume */}
        {/* ================================================================ */}

        <Card
          className="admin-chart-card"
          aria-labelledby="transaction-volume-heading"
        >
          <div className="admin-chart-header">
            <div>
              <h3 id="transaction-volume-heading">
                Transaction Volume
              </h3>

              <p>
                Financial transaction
                activity over time.
              </p>
            </div>

            <Wallet
              size={20}
              aria-hidden="true"
            />
          </div>

          {transactionData.length ===
          0 ? (
            <ChartEmptyState message="No transaction history available." />
          ) : (
            <ResponsiveContainer
              width="100%"
              height={
                CHART_HEIGHT
              }
            >
              <AreaChart
                data={
                  transactionData
                }
                margin={{
                  top: 10,
                  right: 16,
                  left: 0,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                />

                <XAxis
                  dataKey="name"
                  tick={{
                    fontSize: 12,
                  }}
                />

                <YAxis
                  tick={{
                    fontSize: 12,
                  }}
                />

                <Tooltip
                  formatter={value =>
                    currency(
                      value
                    )
                  }
                />

                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#16a34a"
                  fill="#dcfce7"
                  strokeWidth={2}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ================================================================ */}
        {/* Fraud Analytics */}
        {/* ================================================================ */}

        <FeatureGate features="fraud_detection">
          <Card
            className="admin-chart-card"
            aria-labelledby="fraud-analytics-heading"
          >
            <div className="admin-chart-header">
              <div>
                <h3 id="fraud-analytics-heading">
                  Fraud Analytics
                </h3>

                <p>
                  Transaction risk
                  distribution.
                </p>
              </div>

              <AlertTriangle
                size={20}
                aria-hidden="true"
              />
            </div>

            <ResponsiveContainer
              width="100%"
              height={
                CHART_HEIGHT
              }
            >
              <PieChart>
                <Pie
                  data={
                    fraudData
                  }
                  outerRadius={100}
                  innerRadius={55}
                  dataKey="value"
                  nameKey="name"
                  label
                  isAnimationActive={
                    false
                  }
                >
                  {fraudData.map(
                    (
                      item,
                      index
                    ) => (
                      <Cell
                        key={`${item.name}-${index}`}
                        fill={
                          FRAUD_COLORS[
                            index %
                              FRAUD_COLORS.length
                          ]
                        }
                      />
                    )
                  )}
                </Pie>

                <Tooltip />

                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </FeatureGate>
      </section>

      {/* ================================================================== */}
      {/* Executive Summary */}
      {/* ================================================================== */}

      <FeatureGate features="executive_dashboard">
        <section
          aria-labelledby="executive-summary-heading"
        >
          <Card className="executive-summary-card">
            <div className="admin-chart-header">
              <div>
                <h2 id="executive-summary-heading">
                  Executive Summary
                </h2>

                <p>
                  High-level financial
                  performance indicators.
                </p>
              </div>

              <Landmark
                size={20}
                aria-hidden="true"
              />
            </div>

            <div className="executive-summary-grid">
              <div>
                <span>
                  Revenue
                </span>

                <strong>
                  {currency(
                    executive.revenue
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Expenses
                </span>

                <strong>
                  {currency(
                    executive.expenses
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Profit
                </span>

                <strong>
                  {currency(
                    executive.profit
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Recovery Rate
                </span>

                <strong>
                  {percentage(
                    executive.recoveryRate
                  )}
                </strong>
              </div>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Regulatory Reporting */}
      {/* ================================================================== */}

      <FeatureGate features="regulatory_reporting">
        <section
          aria-labelledby="regulatory-heading"
        >
          <Card className="regulatory-card">
            <div className="admin-chart-header">
              <div>
                <h2 id="regulatory-heading">
                  Regulatory Reporting
                </h2>

                <p>
                  Regulatory workflow
                  status.
                </p>
              </div>

              <FileText
                size={20}
                aria-hidden="true"
              />
            </div>

            <div className="regulatory-content">
              <div>
                <span>
                  Pending Reports
                </span>

                <strong>
                  {number(
                    safeMetrics.regulatoryReports
                  )}
                </strong>
              </div>

              <StatusBadge
                status={
                  safeMetrics.regulatoryReports >
                  0
                    ? "warning"
                    : "healthy"
                }
              >
                {safeMetrics.regulatoryReports >
                0
                  ? "Action Required"
                  : "Up to Date"}
              </StatusBadge>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* System Health */}
      {/* ================================================================== */}

      <PermissionGate permissions="view_system_health">
        <section
          aria-labelledby="system-health-heading"
        >
          <Card className="system-health-card">
            <div className="admin-chart-header">
              <div>
                <h2 id="system-health-heading">
                  System Health
                </h2>

                <p>
                  Operational health
                  indicators available
                  to authorized
                  administrators.
                </p>
              </div>

              <Activity
                size={20}
                aria-hidden="true"
              />
            </div>

            <div className="system-health-grid">
              {/* ---------------------------------------------------------- */}
              {/* API */}
              {/* ---------------------------------------------------------- */}

              <div>
                <span>
                  API
                </span>

                <StatusBadge
                  status={normalizeStatus(
                    health.api
                  )}
                >
                  {statusLabel(
                    health.api
                  )}
                </StatusBadge>
              </div>

              {/* ---------------------------------------------------------- */}
              {/* Database */}
              {/* ---------------------------------------------------------- */}

              <div>
                <span>
                  Database
                </span>

                <StatusBadge
                  status={normalizeStatus(
                    health.database
                  )}
                >
                  {statusLabel(
                    health.database
                  )}
                </StatusBadge>
              </div>

              {/* ---------------------------------------------------------- */}
              {/* Queue */}
              {/* ---------------------------------------------------------- */}

              <div>
                <span>
                  Queue
                </span>

                <StatusBadge
                  status={normalizeStatus(
                    health.queue
                  )}
                >
                  {statusLabel(
                    health.queue
                  )}
                </StatusBadge>
              </div>

              {/* ---------------------------------------------------------- */}
              {/* Mobile Money */}
              {/* ---------------------------------------------------------- */}

              <FeatureGate features="mobile_money">
                <div>
                  <span>
                    Mobile Money
                  </span>

                  <StatusBadge
                    status={normalizeStatus(
                      health.mobileMoney
                    )}
                  >
                    {statusLabel(
                      health.mobileMoney
                    )}
                  </StatusBadge>
                </div>
              </FeatureGate>
            </div>
          </Card>
        </section>
      </PermissionGate>
    </main>
  );
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  AdminDashboard
);