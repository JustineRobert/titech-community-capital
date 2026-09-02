// ============================================================================
// TITech Community Capital
// Enterprise Executive Dashboard
// File: frontend/src/pages/dashboard/ExecutiveDashboard.jsx
//
// Production Grade
// Multi-Tenant | Executive Analytics | Board Reporting
// Financial Safety | Defensive Rendering | Accessibility | Responsive Ready
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useMemo,
} from "react";

import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Building2,
  CreditCard,
  DollarSign,
  Download,
  Landmark,
  PieChart as PieChartIcon,
  ShieldAlert,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  BarChart,
  Bar,
} from "recharts";

import {
  Card,
  Button,
  StatusBadge,
} from "../../ui";

import "./ExecutiveDashboard.css";

// ============================================================================
// Constants
// ============================================================================

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#7c3aed",
];

const DEFAULT_METRICS = Object.freeze({
  totalAssets: 0,
  totalLiabilities: 0,
  totalSavings: 0,
  loanPortfolio: 0,
  revenue: 0,
  expenses: 0,
  profit: 0,
  activeMembers: 0,
  activeGroups: 0,
  recoveryRate: 0,
  defaultRate: 0,
  mobileMoneyVolume: 0,
});

const EMPTY_ARRAY = Object.freeze([]);

const EMPTY_OBJECT = Object.freeze({});

// ============================================================================
// Formatting Helpers
// ============================================================================

const numberFormatter = new Intl.NumberFormat(
  "en-UG",
  {
    maximumFractionDigits: 0,
  }
);

const decimalFormatter = new Intl.NumberFormat(
  "en-UG",
  {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }
);

const currencyFormatter = new Intl.NumberFormat(
  "en-UG",
  {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }
);

function toSafeNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue)
    ? numericValue
    : 0;
}

function money(value) {
  return currencyFormatter.format(
    toSafeNumber(value)
  );
}

function formatNumber(value) {
  return numberFormatter.format(
    toSafeNumber(value)
  );
}

function percentage(value) {
  return `${decimalFormatter.format(
    toSafeNumber(value)
  )}%`;
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : EMPTY_ARRAY;
}

// ============================================================================
// Chart Data Helpers
// ============================================================================

function normalizeChartData(data) {
  return normalizeArray(data).filter(
    item =>
      item &&
      typeof item === "object"
  );
}

function getChartColor(index) {
  return COLORS[
    index % COLORS.length
  ];
}

// ============================================================================
// Metric Card
// ============================================================================

const MetricCard = memo(
  function MetricCard({
    title,
    value,
    icon: Icon,
    trend,
    negative = false,
  }) {
    const hasTrend =
      trend !== undefined &&
      trend !== null &&
      Number.isFinite(
        Number(trend)
      );

    return (
      <Card className="executive-metric-card">
        <div className="executive-metric-header">
          <div className="executive-metric-content">
            <p>{title}</p>

            <h3>{value}</h3>
          </div>

          <div
            className="executive-icon"
            aria-hidden="true"
          >
            <Icon size={24} />
          </div>
        </div>

        {hasTrend && (
          <div
            className={`executive-trend ${
              negative
                ? "negative"
                : "positive"
            }`}
            aria-label={`${
              negative
                ? "Negative"
                : "Positive"
            } trend ${Math.abs(
              Number(trend)
            )} percent`}
          >
            {negative ? (
              <TrendingDown
                size={14}
                aria-hidden="true"
              />
            ) : (
              <TrendingUp
                size={14}
                aria-hidden="true"
              />
            )}

            <span>
              {decimalFormatter.format(
                Math.abs(
                  Number(trend)
                )
              )}
              %
            </span>
          </div>
        )}
      </Card>
    );
  }
);

MetricCard.displayName =
  "ExecutiveMetricCard";

// ============================================================================
// Chart Empty State
// ============================================================================

const ChartEmptyState = memo(
  function ChartEmptyState({
    message = "No data available for this period.",
  }) {
    return (
      <div
        className="executive-chart-empty"
        role="status"
        aria-live="polite"
      >
        <BarChart3
          size={28}
          aria-hidden="true"
        />

        <span>{message}</span>
      </div>
    );
  }
);

ChartEmptyState.displayName =
  "ExecutiveChartEmptyState";

// ============================================================================
// Chart Header
// ============================================================================

const ChartHeader = memo(
  function ChartHeader({
    title,
    icon: Icon,
  }) {
    return (
      <div className="executive-chart-header">
        <h3>{title}</h3>

        {Icon && (
          <Icon
            size={20}
            aria-hidden="true"
          />
        )}
      </div>
    );
  }
);

ChartHeader.displayName =
  "ExecutiveChartHeader";

// ============================================================================
// Executive Dashboard
// ============================================================================

function ExecutiveDashboard({
  metrics = EMPTY_OBJECT,
  portfolioHistory = EMPTY_ARRAY,
  revenueHistory = EMPTY_ARRAY,
  savingsBreakdown = EMPTY_ARRAY,
  loanPerformance = EMPTY_ARRAY,
  riskMetrics = EMPTY_OBJECT,
  strategicKPIs = EMPTY_OBJECT,
  onExportBoardReport,
  onExportFinancials,
}) {
  // ==========================================================================
  // Defensive Normalization
  // ==========================================================================

  const data = useMemo(
    () => ({
      ...DEFAULT_METRICS,
      ...(metrics &&
      typeof metrics === "object"
        ? metrics
        : EMPTY_OBJECT),
    }),
    [metrics]
  );

  const safePortfolioHistory =
    useMemo(
      () =>
        normalizeChartData(
          portfolioHistory
        ),
      [portfolioHistory]
    );

  const safeRevenueHistory =
    useMemo(
      () =>
        normalizeChartData(
          revenueHistory
        ),
      [revenueHistory]
    );

  const safeSavingsBreakdown =
    useMemo(
      () =>
        normalizeChartData(
          savingsBreakdown
        ),
      [savingsBreakdown]
    );

  const safeLoanPerformance =
    useMemo(
      () =>
        normalizeChartData(
          loanPerformance
        ),
      [loanPerformance]
    );

  const safeRiskMetrics = useMemo(
    () =>
      riskMetrics &&
      typeof riskMetrics === "object"
        ? riskMetrics
        : EMPTY_OBJECT,
    [riskMetrics]
  );

  const safeStrategicKPIs =
    useMemo(
      () =>
        strategicKPIs &&
        typeof strategicKPIs ===
          "object"
          ? strategicKPIs
          : EMPTY_OBJECT,
      [strategicKPIs]
    );

  // ==========================================================================
  // Export Handlers
  // ==========================================================================

  const handleBoardReportExport =
    useCallback(async () => {
      if (
        typeof onExportBoardReport !==
        "function"
      ) {
        return;
      }

      await onExportBoardReport();
    }, [onExportBoardReport]);

  const handleFinancialExport =
    useCallback(async () => {
      if (
        typeof onExportFinancials !==
        "function"
      ) {
        return;
      }

      await onExportFinancials();
    }, [onExportFinancials]);

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const revenueGrowth = toSafeNumber(
    safeStrategicKPIs.revenueGrowth
  );

  const profitGrowth = toSafeNumber(
    safeStrategicKPIs.profitGrowth
  );

  const recoveryRate = toSafeNumber(
    data.recoveryRate
  );

  const defaultRate = toSafeNumber(
    data.defaultRate
  );

  const fraudAlerts = toSafeNumber(
    safeRiskMetrics.fraudAlerts
  );

  const amlCases = toSafeNumber(
    safeRiskMetrics.amlCases
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="executive-dashboard"
      aria-label="TITech Community Capital Executive Dashboard"
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <section
        className="executive-header"
        aria-labelledby="executive-dashboard-title"
      >
        <div className="executive-header-content">
          <span className="executive-eyebrow">
            TITech Community Capital
          </span>

          <h1 id="executive-dashboard-title">
            Executive Dashboard
          </h1>

          <p>
            Strategic performance,
            portfolio analytics and
            board-level insights.
          </p>
        </div>

        <div
          className="executive-actions"
          aria-label="Executive reports"
        >
          <Button
            onClick={
              handleBoardReportExport
            }
            disabled={
              typeof onExportBoardReport !==
              "function"
            }
            aria-label="Export board report"
          >
            <Download
              size={16}
              aria-hidden="true"
            />

            Board Report
          </Button>

          <Button
            variant="secondary"
            onClick={
              handleFinancialExport
            }
            disabled={
              typeof onExportFinancials !==
              "function"
            }
            aria-label="Export financial report"
          >
            <Download
              size={16}
              aria-hidden="true"
            />

            Financials
          </Button>
        </div>
      </section>

      {/* ================================================================== */}
      {/* Executive Metrics */}
      {/* ================================================================== */}

      <section
        className="executive-metrics-grid"
        aria-label="Executive financial and operational metrics"
      >
        <MetricCard
          title="Assets"
          value={money(
            data.totalAssets
          )}
          icon={Landmark}
        />

        <MetricCard
          title="Liabilities"
          value={money(
            data.totalLiabilities
          )}
          icon={AlertTriangle}
          negative={
            toSafeNumber(
              data.totalLiabilities
            ) > 0
          }
        />

        <MetricCard
          title="Revenue"
          value={money(
            data.revenue
          )}
          icon={DollarSign}
          trend={revenueGrowth}
        />

        <MetricCard
          title="Profit"
          value={money(
            data.profit
          )}
          icon={Banknote}
          trend={profitGrowth}
          negative={
            toSafeNumber(
              data.profit
            ) < 0
          }
        />

        <MetricCard
          title="Loan Portfolio"
          value={money(
            data.loanPortfolio
          )}
          icon={CreditCard}
        />

        <MetricCard
          title="Savings"
          value={money(
            data.totalSavings
          )}
          icon={Wallet}
        />

        <MetricCard
          title="Members"
          value={formatNumber(
            data.activeMembers
          )}
          icon={Users}
        />

        <MetricCard
          title="Groups"
          value={formatNumber(
            data.activeGroups
          )}
          icon={Building2}
        />

        <MetricCard
          title="Mobile Money"
          value={money(
            data.mobileMoneyVolume
          )}
          icon={Smartphone}
        />
      </section>

      {/* ================================================================== */}
      {/* Analytics Charts */}
      {/* ================================================================== */}

      <section
        className="executive-chart-grid"
        aria-label="Executive analytics"
      >
        {/* ================================================================ */}
        {/* Portfolio Growth */}
        {/* ================================================================ */}

        <Card className="executive-chart-card">
          <ChartHeader
            title="Portfolio Growth"
            icon={BarChart3}
          />

          {safePortfolioHistory.length >
          0 ? (
            <ResponsiveContainer
              width="100%"
              height={320}
            >
              <AreaChart
                data={
                  safePortfolioHistory
                }
                margin={{
                  top: 16,
                  right: 20,
                  left: 0,
                  bottom: 8,
                }}
              >
                <defs>
                  <linearGradient
                    id="executivePortfolioGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#2563eb"
                      stopOpacity={0.35}
                    />

                    <stop
                      offset="100%"
                      stopColor="#2563eb"
                      stopOpacity={0.03}
                    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                />

                <YAxis
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip />

                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#executivePortfolioGradient)"
                  activeDot={{
                    r: 5,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState />
          )}
        </Card>

        {/* ================================================================ */}
        {/* Revenue */}
        {/* ================================================================ */}

        <Card className="executive-chart-card">
          <ChartHeader
            title="Revenue Trend"
            icon={DollarSign}
          />

          {safeRevenueHistory.length >
          0 ? (
            <ResponsiveContainer
              width="100%"
              height={320}
            >
              <LineChart
                data={
                  safeRevenueHistory
                }
                margin={{
                  top: 16,
                  right: 20,
                  left: 0,
                  bottom: 8,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                />

                <YAxis
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip />

                <Legend />

                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{
                    r: 5,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState />
          )}
        </Card>

        {/* ================================================================ */}
        {/* Savings Mix */}
        {/* ================================================================ */}

        <Card className="executive-chart-card">
          <ChartHeader
            title="Savings Mix"
            icon={PieChartIcon}
          />

          {safeSavingsBreakdown.length >
          0 ? (
            <ResponsiveContainer
              width="100%"
              height={320}
            >
              <PieChart>
                <Pie
                  data={
                    safeSavingsBreakdown
                  }
                  dataKey="value"
                  nameKey="name"
                  outerRadius={110}
                  innerRadius={55}
                  paddingAngle={2}
                  label
                >
                  {safeSavingsBreakdown.map(
                    (
                      item,
                      index
                    ) => (
                      <Cell
                        key={
                          item.id ||
                          item.name ||
                          `savings-${index}`
                        }
                        fill={getChartColor(
                          index
                        )}
                      />
                    )
                  )}
                </Pie>

                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState />
          )}
        </Card>

        {/* ================================================================ */}
        {/* Loan Performance */}
        {/* ================================================================ */}

        <Card className="executive-chart-card">
          <ChartHeader
            title="Loan Performance"
            icon={CreditCard}
          />

          {safeLoanPerformance.length >
          0 ? (
            <ResponsiveContainer
              width="100%"
              height={320}
            >
              <BarChart
                data={
                  safeLoanPerformance
                }
                margin={{
                  top: 16,
                  right: 20,
                  left: 0,
                  bottom: 8,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                />

                <YAxis
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip />

                <Bar
                  dataKey="value"
                  fill="#2563eb"
                  radius={[
                    6,
                    6,
                    0,
                    0,
                  ]}
                  maxBarSize={56}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState />
          )}
        </Card>
      </section>

      {/* ================================================================== */}
      {/* Risk & Governance */}
      {/* ================================================================== */}

      <section
        className="executive-risk-grid"
        aria-label="Risk and governance"
      >
        {/* ================================================================ */}
        {/* Risk Metrics */}
        {/* ================================================================ */}

        <Card className="executive-risk-card">
          <ChartHeader
            title="Risk & Governance"
            icon={ShieldAlert}
          />

          <div className="executive-risk-metrics">
            <div>
              <span>
                Recovery Rate
              </span>

              <strong>
                {percentage(
                  recoveryRate
                )}
              </strong>
            </div>

            <div>
              <span>
                Default Rate
              </span>

              <strong>
                {percentage(
                  defaultRate
                )}
              </strong>
            </div>

            <div>
              <span>
                Fraud Alerts
              </span>

              <strong>
                {formatNumber(
                  fraudAlerts
                )}
              </strong>
            </div>

            <div>
              <span>
                AML Cases
              </span>

              <strong>
                {formatNumber(
                  amlCases
                )}
              </strong>
            </div>
          </div>
        </Card>

        {/* ================================================================ */}
        {/* Board Status */}
        {/* ================================================================ */}

        <Card className="executive-risk-card">
          <ChartHeader
            title="Board Status"
            icon={ArrowUpRight}
          />

          <div
            className="executive-status-list"
            aria-label="Board status indicators"
          >
            <div>
              <span>
                Financial Health
              </span>

              <StatusBadge status="success">
                Strong
              </StatusBadge>
            </div>

            <div>
              <span>
                Liquidity
              </span>

              <StatusBadge status="success">
                Healthy
              </StatusBadge>
            </div>

            <div>
              <span>
                Regulatory
              </span>

              <StatusBadge status="warning">
                Review
              </StatusBadge>
            </div>

            <div>
              <span>
                Risk
              </span>

              <StatusBadge status="success">
                Controlled
              </StatusBadge>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}

export default memo(
  ExecutiveDashboard
);