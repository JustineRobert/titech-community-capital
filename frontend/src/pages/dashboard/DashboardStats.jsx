// ============================================================================
// TITech Community Capital
// Enterprise Dashboard Statistics
//
// File:
// frontend/src/pages/dashboard/DashboardStats.jsx
//
// Production Grade
// Multi-Tenant | Realtime | Analytics Ready
// Financial Safety | Feature Flags | Resilient Rendering
// Accessibility | Defensive Data Handling
// ============================================================================

"use strict";

import React, {
  memo,
  useMemo,
} from "react";

import {
  AlertTriangle,
  Building2,
  CreditCard,
  DollarSign,
  PiggyBank,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import {
  Card,
  FeatureGate,
} from "../../ui";

import "./DashboardStats.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PLAN =
  "Standard";

const DEFAULT_TENANT_STATUS =
  "Active";

const CORE_STAT_COUNT =
  4;

const SAFE_NUMBER_FORMATTER =
  new Intl.NumberFormat(
    "en-UG"
  );

const UGX_FORMATTER =
  new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  );

// ============================================================================
// Data Normalization
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
  value
) {
  const numericValue =
    toFiniteNumber(value);

  return numericValue >= 0
    ? numericValue
    : 0;
}

function formatNumber(
  value
) {
  return SAFE_NUMBER_FORMATTER.format(
    toFiniteNumber(value)
  );
}

function formatCurrency(
  amount
) {
  return UGX_FORMATTER.format(
    toFiniteNumber(amount)
  );
}

function formatPercentage(
  value,
  fractionDigits = 1
) {
  const numericValue =
    toFiniteNumber(value);

  return `${numericValue.toFixed(
    fractionDigits
  )}%`;
}

// ============================================================================
// Trend Calculation
// ============================================================================

/**
 * Calculates percentage change between two periods.
 *
 * Returns null when there is no meaningful comparison baseline.
 *
 * Examples:
 * current=120, previous=100 => +20%
 * current=80, previous=100  => -20%
 * current=100, previous=0   => null
 */
function calculateTrend(
  current = 0,
  previous = 0
) {
  const currentValue =
    toFiniteNumber(current);

  const previousValue =
    toFiniteNumber(previous);

  if (
    previousValue === 0
  ) {
    return null;
  }

  return (
    ((currentValue -
      previousValue) /
      Math.abs(
        previousValue
      )) *
    100
  );
}

// ============================================================================
// Trend Badge
// ============================================================================

const TrendBadge = memo(
  function TrendBadge({
    value,
  }) {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(
        Number(value)
      )
    ) {
      return (
        <span
          className="dashboard-trend neutral"
          role="status"
          aria-label="No comparison data available"
          title="No comparison data available"
        >
          —
        </span>
      );
    }

    const numericValue =
      Number(value);

    const positive =
      numericValue > 0;

    const negative =
      numericValue < 0;

    const trendLabel =
      positive
        ? "increased"
        : negative
          ? "decreased"
          : "unchanged";

    const Icon =
      positive
        ? TrendingUp
        : negative
          ? TrendingDown
          : TrendingUp;

    return (
      <span
        className={`dashboard-trend ${
          positive
            ? "positive"
            : negative
              ? "negative"
              : "neutral"
        }`}
        role="status"
        aria-label={`${trendLabel} ${formatPercentage(
          Math.abs(
            numericValue
          )
        )}`}
        title={`${trendLabel} ${formatPercentage(
          Math.abs(
            numericValue
          )
        )}`}
      >
        <Icon
          size={14}
          aria-hidden="true"
        />

        <span>
          {formatPercentage(
            Math.abs(
              numericValue
            )
          )}
        </span>
      </span>
    );
  }
);

// ============================================================================
// KPI Configuration
// ============================================================================

function buildCoreStats(
  metrics,
  previousMetrics
) {
  const current =
    metrics || {};

  const previous =
    previousMetrics || {};

  return [
    {
      key:
        "totalSavings",

      title:
        "Total Savings",

      value:
        formatCurrency(
          current.totalSavings
        ),

      trend:
        calculateTrend(
          current.totalSavings,
          previous.totalSavings
        ),

      icon:
        PiggyBank,

      tone:
        "primary",

      description:
        "Total savings recorded within your authorized scope.",
    },

    {
      key:
        "groups",

      title:
        "Groups",

      value:
        formatNumber(
          current.totalGroups
        ),

      trend:
        calculateTrend(
          current.totalGroups,
          previous.totalGroups
        ),

      icon:
        Building2,

      tone:
        "primary",

      description:
        "Community groups within your authorized tenant scope.",
    },

    {
      key:
        "members",

      title:
        "Members",

      value:
        formatNumber(
          current.totalMembers
        ),

      trend:
        calculateTrend(
          current.totalMembers,
          previous.totalMembers
        ),

      icon:
        Users,

      tone:
        "primary",

      description:
        "Members associated with your authorized tenant scope.",
    },

    {
      key:
        "activeLoans",

      title:
        "Active Loans",

      value:
        formatNumber(
          current.activeLoans
        ),

      trend:
        calculateTrend(
          current.activeLoans,
          previous.activeLoans
        ),

      icon:
        CreditCard,

      tone:
        "primary",

      description:
        "Loans currently considered active by the dashboard data source.",
    },
  ];
}

// ============================================================================
// KPI Card
// ============================================================================

const DashboardStatCard =
  memo(
    function DashboardStatCard({
      stat,
    }) {
      const Icon =
        stat.icon;

      return (
        <Card
          className={`dashboard-stat-card dashboard-stat-card-${stat.tone}`}
          aria-label={`${stat.title}: ${stat.value}`}
        >
          <div className="dashboard-stat-header">
            <div
              className="dashboard-stat-icon"
              aria-hidden="true"
            >
              <Icon
                size={22}
              />
            </div>

            <TrendBadge
              value={
                stat.trend
              }
            />
          </div>

          <div className="dashboard-stat-body">
            <h3>
              {stat.title}
            </h3>

            <p
              className="dashboard-stat-value"
              aria-label={`${stat.title} value`}
            >
              {stat.value}
            </p>

            <span className="dashboard-stat-description">
              {stat.description}
            </span>
          </div>
        </Card>
      );
    }
  );

// ============================================================================
// Loading Skeleton
// ============================================================================

function DashboardStatsSkeleton() {
  return (
    <section
      className="dashboard-stats-section"
      aria-label="Loading dashboard statistics"
      aria-busy="true"
    >
      <div className="dashboard-stats-grid">
        {Array.from({
          length:
            CORE_STAT_COUNT,
        }).map(
          (_, index) => (
            <Card
              key={
                `dashboard-stat-skeleton-${index}`
              }
              className="dashboard-stat-skeleton"
            >
              <div
                className="skeleton-icon"
                aria-hidden="true"
              />

              <div className="skeleton-content">
                <div
                  className="skeleton-line"
                  aria-hidden="true"
                />

                <div
                  className="skeleton-line short"
                  aria-hidden="true"
                />

                <div
                  className="skeleton-line tiny"
                  aria-hidden="true"
                />
              </div>
            </Card>
          )
        )}
      </div>

      <span className="sr-only">
        Loading dashboard
        statistics...
      </span>
    </section>
  );
}

// ============================================================================
// Executive Statistics
// ============================================================================

function ExecutiveStatistics({
  metrics,
}) {
  return (
    <FeatureGate features="executive_dashboard">
      <section
        className="dashboard-stat-section dashboard-stat-section-executive"
        aria-labelledby="dashboard-executive-statistics"
      >
        <div className="dashboard-section-heading">
          <div>
            <h3
              id="dashboard-executive-statistics"
            >
              Executive Statistics
            </h3>

            <p>
              High-level financial
              performance indicators.
            </p>
          </div>
        </div>

        <div className="dashboard-stats-grid executive">
          <Card className="dashboard-stat-card">
            <div className="dashboard-stat-header">
              <div
                className="dashboard-stat-icon"
                aria-hidden="true"
              >
                <DollarSign
                  size={22}
                />
              </div>
            </div>

            <div className="dashboard-stat-body">
              <h4>
                Portfolio Value
              </h4>

              <p className="dashboard-stat-value">
                {formatCurrency(
                  metrics.portfolioValue
                )}
              </p>

              <span className="dashboard-stat-description">
                Current portfolio
                value reported by
                the authorized
                dashboard data source.
              </span>
            </div>
          </Card>

          <Card className="dashboard-stat-card">
            <div className="dashboard-stat-header">
              <div
                className="dashboard-stat-icon"
                aria-hidden="true"
              >
                <Wallet
                  size={22}
                />
              </div>
            </div>

            <div className="dashboard-stat-body">
              <h4>
                Revenue
              </h4>

              <p className="dashboard-stat-value">
                {formatCurrency(
                  metrics.revenue
                )}
              </p>

              <span className="dashboard-stat-description">
                Revenue reported for
                the current dashboard
                reporting period.
              </span>
            </div>
          </Card>
        </div>
      </section>
    </FeatureGate>
  );
}

// ============================================================================
// Mobile Money Statistics
// ============================================================================

function MobileMoneyStatistics({
  metrics,
}) {
  return (
    <FeatureGate features="mobile_money">
      <section
        className="dashboard-stat-section"
        aria-labelledby="dashboard-mobile-money-statistics"
      >
        <div className="dashboard-section-heading">
          <div>
            <h3
              id="dashboard-mobile-money-statistics"
            >
              Mobile Money
            </h3>

            <p>
              Mobile-money transaction
              volume within the
              authorized scope.
            </p>
          </div>
        </div>

        <div className="dashboard-stats-grid">
          <Card className="dashboard-stat-card">
            <div className="dashboard-stat-header">
              <div
                className="dashboard-stat-icon"
                aria-hidden="true"
              >
                <Smartphone
                  size={22}
                />
              </div>
            </div>

            <div className="dashboard-stat-body">
              <h4>
                MoMo Volume
              </h4>

              <p className="dashboard-stat-value">
                {formatCurrency(
                  metrics.mobileMoneyVolume
                )}
              </p>

              <span className="dashboard-stat-description">
                Aggregate mobile-money
                transaction volume.
              </span>
            </div>
          </Card>
        </div>
      </section>
    </FeatureGate>
  );
}

// ============================================================================
// Fraud Statistics
// ============================================================================

function FraudStatistics({
  metrics,
}) {
  const flagged =
    toNonNegativeNumber(
      metrics.flaggedTransactions
    );

  return (
    <FeatureGate features="fraud_detection">
      <section
        className="dashboard-stat-section"
        aria-labelledby="dashboard-fraud-statistics"
      >
        <div className="dashboard-section-heading">
          <div>
            <h3
              id="dashboard-fraud-statistics"
            >
              Risk Monitoring
            </h3>

            <p>
              Transaction risk indicators
              available to authorized
              users.
            </p>
          </div>
        </div>

        <div className="dashboard-stats-grid">
          <Card className="dashboard-stat-card warning">
            <div className="dashboard-stat-header">
              <div
                className="dashboard-stat-icon"
                aria-hidden="true"
              >
                <AlertTriangle
                  size={22}
                />
              </div>
            </div>

            <div className="dashboard-stat-body">
              <h4>
                Flagged Transactions
              </h4>

              <p
                className="dashboard-stat-value"
                aria-label={`${formatNumber(
                  flagged
                )} flagged transactions`}
              >
                {formatNumber(
                  flagged
                )}
              </p>

              <span className="dashboard-stat-description">
                Transactions currently
                flagged by the
                authorized risk-monitoring
                data source.
              </span>
            </div>
          </Card>
        </div>
      </section>
    </FeatureGate>
  );
}

// ============================================================================
// Tenant Information
// ============================================================================

function TenantInformation({
  tenant,
}) {
  const tenantName =
    tenant?.name ||
    tenant?.displayName ||
    "TITech Community Capital";

  const tenantPlan =
    tenant?.plan ||
    DEFAULT_PLAN;

  const tenantStatus =
    tenant?.status ||
    DEFAULT_TENANT_STATUS;

  const featureCount =
    Array.isArray(
      tenant?.features
    )
      ? tenant.features.length
      : toNonNegativeNumber(
          tenant?.featureCount
        );

  return (
    <section
      className="dashboard-stat-section"
      aria-labelledby="dashboard-tenant-information"
    >
      <Card className="dashboard-tenant-card">
        <div className="dashboard-tenant-header">
          <div
            className="dashboard-stat-icon"
            aria-hidden="true"
          >
            <Building2
              size={20}
            />
          </div>

          <div>
            <h3
              id="dashboard-tenant-information"
            >
              {tenantName}
            </h3>

            <p>
              Tenant configuration
              and service status.
            </p>
          </div>
        </div>

        <div className="dashboard-tenant-details">
          <div>
            <span>
              Plan
            </span>

            <strong>
              {tenantPlan}
            </strong>
          </div>

          <div>
            <span>
              Features
            </span>

            <strong>
              {formatNumber(
                featureCount
              )}
            </strong>
          </div>

          <div>
            <span>
              Status
            </span>

            <strong>
              {tenantStatus}
            </strong>
          </div>
        </div>
      </Card>
    </section>
  );
}

// ============================================================================
// Dashboard Statistics
// ============================================================================

function DashboardStats({
  metrics = {},
  previousMetrics = {},
  loading = false,
  tenant = null,
}) {
  // ==========================================================================
  // Defensive Metric Snapshot
  // ==========================================================================

  const safeMetrics =
    useMemo(
      () => ({
        totalSavings:
          toNonNegativeNumber(
            metrics?.totalSavings
          ),

        totalGroups:
          toNonNegativeNumber(
            metrics?.totalGroups
          ),

        totalMembers:
          toNonNegativeNumber(
            metrics?.totalMembers
          ),

        activeLoans:
          toNonNegativeNumber(
            metrics?.activeLoans
          ),

        portfolioValue:
          toNonNegativeNumber(
            metrics?.portfolioValue
          ),

        revenue:
          toNonNegativeNumber(
            metrics?.revenue
          ),

        mobileMoneyVolume:
          toNonNegativeNumber(
            metrics?.mobileMoneyVolume
          ),

        flaggedTransactions:
          toNonNegativeNumber(
            metrics?.flaggedTransactions
          ),
      }),
      [metrics]
    );

  const safePreviousMetrics =
    useMemo(
      () => ({
        totalSavings:
          toNonNegativeNumber(
            previousMetrics?.totalSavings
          ),

        totalGroups:
          toNonNegativeNumber(
            previousMetrics?.totalGroups
          ),

        totalMembers:
          toNonNegativeNumber(
            previousMetrics?.totalMembers
          ),

        activeLoans:
          toNonNegativeNumber(
            previousMetrics?.activeLoans
          ),
      }),
      [previousMetrics]
    );

  const coreStats =
    useMemo(
      () =>
        buildCoreStats(
          safeMetrics,
          safePreviousMetrics
        ),
      [
        safeMetrics,
        safePreviousMetrics,
      ]
    );

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (loading) {
    return (
      <DashboardStatsSkeleton />
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <section
      className="dashboard-statistics"
      aria-label="Dashboard statistics"
    >
      {/* ================================================================== */}
      {/* Core Statistics */}
      {/* ================================================================== */}

      <section
        className="dashboard-stat-section"
        aria-labelledby="dashboard-core-statistics"
      >
        <div className="dashboard-section-heading">
          <div>
            <h2
              id="dashboard-core-statistics"
            >
              Overview
            </h2>

            <p>
              Current operational
              statistics for your
              authorized scope.
            </p>
          </div>
        </div>

        <div className="dashboard-stats-grid">
          {coreStats.map(
            stat => (
              <DashboardStatCard
                key={stat.key}
                stat={stat}
              />
            )
          )}
        </div>
      </section>

      {/* ================================================================== */}
      {/* Executive Statistics */}
      {/* ================================================================== */}

      <ExecutiveStatistics
        metrics={
          safeMetrics
        }
      />

      {/* ================================================================== */}
      {/* Mobile Money */}
      {/* ================================================================== */}

      <MobileMoneyStatistics
        metrics={
          safeMetrics
        }
      />

      {/* ================================================================== */}
      {/* Fraud */}
      {/* ================================================================== */}

      <FraudStatistics
        metrics={
          safeMetrics
        }
      />

      {/* ================================================================== */}
      {/* Tenant */}
      {/* ================================================================== */}

      {tenant && (
        <TenantInformation
          tenant={tenant}
        />
      )}
    </section>
  );
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  DashboardStats
);