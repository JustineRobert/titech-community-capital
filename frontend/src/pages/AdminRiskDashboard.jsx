// ============================================================================
// TITech Community Capital
// Enterprise Risk Intelligence Dashboard
//
// File:
// frontend/src/pages/AdminRiskDashboard.jsx
//
// Production Grade
//
// Capabilities:
// - Enterprise RBAC
// - Risk profile intelligence
// - Fraud monitoring
// - Portfolio monitoring
// - Risk distribution analytics
// - Fraud trend analytics
// - Portfolio analytics
// - Automatic refresh
// - Manual refresh
// - Defensive API handling
// - Request cancellation
// - Error recovery
// - Financial-safe formatting
// - Accessible administration UI
// ============================================================================

"use strict";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

import {
  Line,
  Bar,
  Pie,
} from "react-chartjs-2";

import {
  Shield,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  RefreshCw,
  Activity,
  Clock,
  ShieldAlert,
  CheckCircle,
  XCircle,
  Users,
  BarChart3,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

import {
  useNavigate,
} from "react-router-dom";

import {
  toast,
} from "react-toastify";

import {
  useAuth,
} from "../context/AuthContext";

import api from "../services/api";

import "./AdminRiskDashboard.css";

// ============================================================================
// CHART REGISTRATION
// ============================================================================

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

// ============================================================================
// CONSTANTS
// ============================================================================

const AUTO_REFRESH_INTERVAL =
  60 * 1000;

const AUTHORIZED_ROLES = new Set([
  "admin",
  "super_admin",
  "risk_manager",
  "auditor",
]);

const RISK_LEVELS = {
  LOW: "APPROVE",
  MEDIUM: "REVIEW",
  HIGH: "REJECT",
};

const EMPTY_PORTFOLIO = {
  totalLoans: 0,
  activeLoans: 0,
  defaults: 0,
  totalLoanValue: 0,
  outstandingBalance: 0,
  defaultRate: 0,
};

// ============================================================================
// SAFE HELPERS
// ============================================================================

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
};

const toNumber = (
  value,
  fallback = 0
) => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
};

const safeString = (
  value,
  fallback = ""
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
};

const normalizeRole = (
  role
) =>
  safeString(role)
    .trim()
    .toLowerCase();

const getApiPayload = (
  response,
  fallback = []
) => {
  const data =
    response?.data;

  if (
    data &&
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  if (
    data &&
    Array.isArray(data.items)
  ) {
    return data.items;
  }

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  return fallback;
};

const getObjectPayload = (
  response,
  fallback = {}
) => {
  const data =
    response?.data;

  if (
    data?.data &&
    typeof data.data === "object" &&
    !Array.isArray(data.data)
  ) {
    return data.data;
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    return data;
  }

  return fallback;
};

// ============================================================================
// FORMATTERS
// ============================================================================

const formatInteger = (
  value
) =>
  toNumber(value).toLocaleString(
    undefined,
    {
      maximumFractionDigits: 0,
    }
  );

const formatDecimal = (
  value,
  digits = 1
) =>
  toNumber(value).toLocaleString(
    undefined,
    {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }
  );

const formatPercentage = (
  value,
  digits = 1
) =>
  `${formatDecimal(
    value,
    digits
  )}%`;

const formatCurrency = (
  value,
  currency = "UGX"
) =>
  new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }
  ).format(
    toNumber(value)
  );

const formatDateTime = (
  value
) => {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleString();
};

const formatRelativeDate = (
  value
) => {
  if (!value) {
    return "Unknown";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Unknown";
  }

  const diff =
    Date.now() -
    date.getTime();

  const minutes =
    Math.floor(
      diff /
        (1000 * 60)
    );

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  if (days < 30) {
    return `${days}d ago`;
  }

  return formatDateTime(
    value
  );
};

// ============================================================================
// KPI CARD
// ============================================================================

const RiskKpiCard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = "primary",
  trend,
  trendLabel,
}) => {
  const hasTrend =
    trend !== null &&
    trend !== undefined;

  const trendPositive =
    toNumber(trend) >= 0;

  return (
    <article
      className={`risk-kpi-card ${variant}`}
    >
      <div className="risk-kpi-header">
        <div className="risk-kpi-icon">
          <Icon
            size={24}
            aria-hidden="true"
          />
        </div>

        {hasTrend && (
          <div
            className={`risk-kpi-trend ${
              trendPositive
                ? "positive"
                : "negative"
            }`}
          >
            {trendPositive ? (
              <ArrowUpRight
                size={15}
                aria-hidden="true"
              />
            ) : (
              <ArrowDownRight
                size={15}
                aria-hidden="true"
              />
            )}

            {formatPercentage(
              Math.abs(
                toNumber(trend)
              )
            )}
          </div>
        )}
      </div>

      <div className="risk-kpi-content">
        <span>
          {title}
        </span>

        <strong>
          {value}
        </strong>

        {subtitle && (
          <small>
            {subtitle}
          </small>
        )}

        {trendLabel && (
          <small>
            {trendLabel}
          </small>
        )}
      </div>
    </article>
  );
};

// ============================================================================
// EMPTY CHART STATE
// ============================================================================

const ChartEmptyState = ({
  message =
    "No data available for this period.",
}) => (
  <div
    className="risk-chart-empty"
    role="status"
  >
    <BarChart3
      size={36}
      aria-hidden="true"
    />

    <p>
      {message}
    </p>
  </div>
);

// ============================================================================
// LOADING STATE
// ============================================================================

const RiskDashboardSkeleton = () => (
  <div
    className="risk-dashboard"
    aria-busy="true"
    aria-label="Loading risk intelligence dashboard"
  >
    <div className="risk-loading-header">
      <div className="risk-skeleton risk-skeleton-title" />
      <div className="risk-skeleton risk-skeleton-button" />
    </div>

    <div className="risk-kpis">
      {Array.from(
        { length: 5 }
      ).map((_, index) => (
        <div
          className="risk-skeleton risk-skeleton-card"
          key={index}
        />
      ))}
    </div>

    <div className="risk-grid">
      <div className="risk-skeleton risk-skeleton-chart" />
      <div className="risk-skeleton risk-skeleton-chart" />
    </div>

    <div className="risk-skeleton risk-skeleton-large-chart" />
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminRiskDashboard() {
  const navigate =
    useNavigate();

  const {
    user,
  } = useAuth();

  const mountedRef =
    useRef(false);

  const requestRef =
    useRef(null);

  const refreshInProgressRef =
    useRef(false);

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    riskProfiles,
    setRiskProfiles,
  ] = useState([]);

  const [
    fraudLogs,
    setFraudLogs,
  ] = useState([]);

  const [
    portfolio,
    setPortfolio,
  ] = useState(
    EMPTY_PORTFOLIO
  );

  const [
    error,
    setError,
  ] = useState("");

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  // ==========================================================================
  // RBAC
  // ==========================================================================

  const normalizedRole =
    useMemo(
      () =>
        normalizeRole(
          user?.role
        ),
      [user?.role]
    );

  const isAuthorized =
    useMemo(
      () =>
        AUTHORIZED_ROLES.has(
          normalizedRole
        ),
      [normalizedRole]
    );

  const canManageRisk =
    useMemo(
      () =>
        [
          "admin",
          "super_admin",
          "risk_manager",
        ].includes(
          normalizedRole
        ),
      [normalizedRole]
    );

  // ==========================================================================
  // DATA LOADER
  // ==========================================================================

  const loadDashboard =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (
          !isAuthorized
        ) {
          return;
        }

        if (
          refreshInProgressRef.current
        ) {
          return;
        }

        refreshInProgressRef.current =
          true;

        if (!silent) {
          setRefreshing(true);
        }

        setError("");

        // Cancel previous request if necessary.
        if (
          requestRef.current
        ) {
          try {
            requestRef.current.abort();
          } catch {
            // Ignore abort failures.
          }
        }

        const controller =
          new AbortController();

        requestRef.current =
          controller;

        try {
          const [
            riskResponse,
            fraudResponse,
            portfolioResponse,
          ] =
            await Promise.all([
              api.get(
                "/api/risk/profiles",
                {
                  signal:
                    controller.signal,
                }
              ),

              api.get(
                "/api/fraud/logs",
                {
                  signal:
                    controller.signal,
                }
              ),

              api.get(
                "/api/admin/portfolio",
                {
                  signal:
                    controller.signal,
                }
              ),
            ]);

          if (
            !mountedRef.current ||
            controller.signal
              .aborted
          ) {
            return;
          }

          const nextRiskProfiles =
            getApiPayload(
              riskResponse
            );

          const nextFraudLogs =
            getApiPayload(
              fraudResponse
            );

          const nextPortfolio =
            {
              ...EMPTY_PORTFOLIO,
              ...getObjectPayload(
                portfolioResponse
              ),
            };

          setRiskProfiles(
            nextRiskProfiles
          );

          setFraudLogs(
            nextFraudLogs
          );

          setPortfolio(
            nextPortfolio
          );

          setLastUpdated(
            new Date()
          );
        } catch (err) {
          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          console.error(
            "TITech Risk Dashboard:",
            err
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          const status =
            err?.response?.status;

          if (
            status === 401
          ) {
            toast.error(
              "Your session has expired. Please sign in again."
            );

            navigate(
              "/login",
              {
                replace: true,
              }
            );

            return;
          }

          if (
            status === 403
          ) {
            toast.error(
              "You are not authorized to access risk intelligence."
            );

            navigate(
              "/dashboard",
              {
                replace: true,
              }
            );

            return;
          }

          const message =
            err?.response?.data
              ?.message ||
            err?.message ||
            "Failed to load risk dashboard.";

          setError(
            message
          );

          if (!silent) {
            toast.error(
              message
            );
          }
        } finally {
          if (
            mountedRef.current &&
            requestRef.current ===
              controller
          ) {
            setRefreshing(
              false
            );
          }

          refreshInProgressRef.current =
            false;
        }
      },
      [
        isAuthorized,
        navigate,
      ]
    );

  // ==========================================================================
  // INITIALIZATION / AUTO REFRESH
  // ==========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    if (!user) {
      navigate(
        "/login",
        {
          replace: true,
        }
      );

      return () => {
        mountedRef.current =
          false;
      };
    }

    if (!isAuthorized) {
      toast.error(
        "Risk intelligence access is restricted."
      );

      navigate(
        "/dashboard",
        {
          replace: true,
        }
      );

      return () => {
        mountedRef.current =
          false;
      };
    }

    loadDashboard();

    const interval =
      window.setInterval(
        () => {
          loadDashboard({
            silent: true,
          });
        },
        AUTO_REFRESH_INTERVAL
      );

    return () => {
      mountedRef.current =
        false;

      window.clearInterval(
        interval
      );

      if (
        requestRef.current
      ) {
        try {
          requestRef.current.abort();
        } catch {
          // Ignore cleanup failures.
        }
      }
    };
  }, [
    user,
    isAuthorized,
    navigate,
    loadDashboard,
  ]);

  // ==========================================================================
  // NORMALIZED DATA
  // ==========================================================================

  const normalizedRiskProfiles =
    useMemo(
      () =>
        toArray(
          riskProfiles
        ).filter(Boolean),
      [riskProfiles]
    );

  const normalizedFraudLogs =
    useMemo(
      () =>
        toArray(
          fraudLogs
        ).filter(Boolean),
      [fraudLogs]
    );

  // ==========================================================================
  // RISK METRICS
  // ==========================================================================

  const metrics =
    useMemo(() => {
      const lowRisk =
        normalizedRiskProfiles.filter(
          (profile) =>
            safeString(
              profile?.riskLevel
            ).toUpperCase() ===
            RISK_LEVELS.LOW
        ).length;

      const mediumRisk =
        normalizedRiskProfiles.filter(
          (profile) =>
            safeString(
              profile?.riskLevel
            ).toUpperCase() ===
            RISK_LEVELS.MEDIUM
        ).length;

      const highRisk =
        normalizedRiskProfiles.filter(
          (profile) =>
            safeString(
              profile?.riskLevel
            ).toUpperCase() ===
            RISK_LEVELS.HIGH
        ).length;

      const totalRiskProfiles =
        normalizedRiskProfiles.length;

      const averageFraudScore =
        normalizedFraudLogs.length
          ? normalizedFraudLogs.reduce(
              (
                sum,
                item
              ) =>
                sum +
                toNumber(
                  item?.fraudScore
                ),
              0
            ) /
            normalizedFraudLogs.length
          : 0;

      const highFraudEvents =
        normalizedFraudLogs.filter(
          (item) =>
            toNumber(
              item?.fraudScore
            ) >= 70
        ).length;

      const reviewRequired =
        mediumRisk;

      const riskRate =
        totalRiskProfiles
          ? (
              (highRisk /
                totalRiskProfiles) *
              100
            )
          : 0;

      const defaultRate =
        toNumber(
          portfolio?.defaultRate
        ) ||
        (toNumber(
          portfolio?.totalLoans
        )
          ? (
              (toNumber(
                portfolio?.defaults
              ) /
                toNumber(
                  portfolio?.totalLoans
                )) *
              100
            )
          : 0);

      return {
        lowRisk,
        mediumRisk,
        highRisk,
        totalRiskProfiles,
        averageFraudScore,
        highFraudEvents,
        reviewRequired,
        highRiskRate:
          riskRate,
        defaultRate,
      };
    }, [
      normalizedRiskProfiles,
      normalizedFraudLogs,
      portfolio,
    ]);

  // ==========================================================================
  // RISK DISTRIBUTION
  // ==========================================================================

  const riskDistribution =
    useMemo(
      () => ({
        labels: [
          "Low Risk",
          "Review Required",
          "High Risk",
        ],
        datasets: [
          {
            label:
              "Risk Profiles",
            data: [
              metrics.lowRisk,
              metrics.mediumRisk,
              metrics.highRisk,
            ],
            backgroundColor: [
              "#10B981",
              "#F59E0B",
              "#EF4444",
            ],
            borderWidth: 1,
          },
        ],
      }),
      [metrics]
    );

  // ==========================================================================
  // FRAUD TREND
  // ==========================================================================

  const sortedFraudLogs =
    useMemo(() => {
      return [
        ...normalizedFraudLogs,
      ]
        .filter(
          (item) =>
            item?.createdAt
        )
        .sort(
          (
            a,
            b
          ) =>
            new Date(
              a.createdAt
            ).getTime() -
            new Date(
              b.createdAt
            ).getTime()
        )
        .slice(-30);
    }, [
      normalizedFraudLogs,
    ]);

  const fraudTrendData =
    useMemo(
      () => ({
        labels:
          sortedFraudLogs.map(
            (item) =>
              new Date(
                item.createdAt
              ).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  day: "numeric",
                }
              )
          ),
        datasets: [
          {
            label:
              "Fraud Score",
            data:
              sortedFraudLogs.map(
                (item) =>
                  toNumber(
                    item.fraudScore
                  )
              ),
            borderColor:
              "#EF4444",
            backgroundColor:
              "rgba(239, 68, 68, 0.10)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      }),
      [sortedFraudLogs]
    );

  // ==========================================================================
  // PORTFOLIO CHART
  // ==========================================================================

  const portfolioData =
    useMemo(
      () => ({
        labels: [
          "Total Loans",
          "Active Loans",
          "Defaults",
        ],
        datasets: [
          {
            label:
              "Loan Portfolio",
            data: [
              toNumber(
                portfolio?.totalLoans
              ),
              toNumber(
                portfolio?.activeLoans
              ),
              toNumber(
                portfolio?.defaults
              ),
            ],
            backgroundColor: [
              "#2563EB",
              "#10B981",
              "#EF4444",
            ],
            borderRadius: 6,
            maxBarThickness: 70,
          },
        ],
      }),
      [portfolio]
    );

  // ==========================================================================
  // CHART OPTIONS
  // ==========================================================================

  const pieOptions =
    useMemo(
      () => ({
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            position: "bottom",
          },

          tooltip: {
            callbacks: {
              label:
                (context) => {
                  const value =
                    toNumber(
                      context.raw
                    );

                  const total =
                    metrics
                      .totalRiskProfiles;

                  const percentage =
                    total
                      ? (
                          (value /
                            total) *
                          100
                        ).toFixed(
                          1
                        )
                      : "0.0";

                  return `${context.label}: ${value} (${percentage}%)`;
                },
            },
          },
        },
      }),
      [metrics]
    );

  const lineOptions =
    useMemo(
      () => ({
        responsive: true,
        maintainAspectRatio: false,

        interaction: {
          intersect: false,
          mode: "index",
        },

        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 100,
            title: {
              display: true,
              text: "Fraud Score",
            },
          },

          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 0,
            },
          },
        },

        plugins: {
          legend: {
            display: true,
          },
        },
      }),
      []
    );

  const barOptions =
    useMemo(
      () => ({
        responsive: true,
        maintainAspectRatio: false,

        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
            },
          },
        },

        plugins: {
          legend: {
            display: false,
          },
        },
      }),
      []
    );

  // ==========================================================================
  // RECENT HIGH-RISK EVENTS
  // ==========================================================================

  const recentHighRiskEvents =
    useMemo(
      () =>
        [
          ...normalizedFraudLogs,
        ]
          .filter(
            (item) =>
              toNumber(
                item?.fraudScore
              ) >= 70
          )
          .sort(
            (
              a,
              b
            ) =>
              new Date(
                b.createdAt || 0
              ).getTime() -
              new Date(
                a.createdAt || 0
              ).getTime()
          )
          .slice(0, 5),
      [normalizedFraudLogs]
    );

  // ==========================================================================
  // MANUAL REFRESH
  // ==========================================================================

  const handleRefresh =
    useCallback(
      async () => {
        if (
          refreshing
        ) {
          return;
        }

        await loadDashboard();
      },
      [
        refreshing,
        loadDashboard,
      ]
    );

  // ==========================================================================
  // LOADING
  // ==========================================================================

  if (
    loading &&
    !error
  ) {
    return (
      <RiskDashboardSkeleton />
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main
      className="risk-dashboard"
      aria-labelledby="risk-dashboard-title"
    >
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="risk-header">
        <div className="risk-header-content">
          <div className="risk-header-icon">
            <Shield
              size={30}
              aria-hidden="true"
            />
          </div>

          <div>
            <h1 id="risk-dashboard-title">
              Risk Intelligence Dashboard
            </h1>

            <p>
              Enterprise risk, fraud and
              portfolio intelligence for
              TITech Community Capital.
            </p>

            {lastUpdated && (
              <div className="risk-last-updated">
                <Clock
                  size={14}
                  aria-hidden="true"
                />

                <span>
                  Updated{" "}
                  {formatRelativeDate(
                    lastUpdated
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="risk-header-actions">
          <span className="risk-role-badge">
            {normalizedRole
              .replace(
                /_/g,
                " "
              )
              .replace(
                /\b\w/g,
                (letter) =>
                  letter.toUpperCase()
              )}
          </span>

          <button
            type="button"
            onClick={
              handleRefresh
            }
            disabled={
              refreshing
            }
            className="refresh-btn"
            aria-label="Refresh risk dashboard"
          >
            <RefreshCw
              size={18}
              className={
                refreshing
                  ? "animate-spin"
                  : ""
              }
              aria-hidden="true"
            />

            {refreshing
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>
      </header>

      {/* ================================================================== */}
      {/* ERROR */}
      {/* ================================================================== */}

      {error && (
        <div
          className="risk-error"
          role="alert"
        >
          <AlertTriangle
            size={19}
            aria-hidden="true"
          />

          <div>
            <strong>
              Risk dashboard unavailable
            </strong>

            <p>
              {error}
            </p>
          </div>

          <button
            type="button"
            onClick={
              handleRefresh
            }
            disabled={
              refreshing
            }
          >
            Retry
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* KPI CARDS */}
      {/* ================================================================== */}

      <section
        className="risk-kpis"
        aria-label="Risk intelligence metrics"
      >
        <RiskKpiCard
          title="Low Risk"
          value={formatInteger(
            metrics.lowRisk
          )}
          subtitle="Profiles approved"
          icon={Shield}
          variant="success"
        />

        <RiskKpiCard
          title="Review Required"
          value={formatInteger(
            metrics.reviewRequired
          )}
          subtitle="Manual assessment"
          icon={Eye}
          variant="warning"
        />

        <RiskKpiCard
          title="High Risk"
          value={formatInteger(
            metrics.highRisk
          )}
          subtitle={formatPercentage(
            metrics.highRiskRate
          ) + " of profiles"}
          icon={ShieldAlert}
          variant="danger"
        />

        <RiskKpiCard
          title="Average Fraud Score"
          value={formatDecimal(
            metrics.averageFraudScore
          )}
          subtitle="Across monitored events"
          icon={Activity}
          variant="primary"
        />

        <RiskKpiCard
          title="Total Loans"
          value={formatInteger(
            portfolio?.totalLoans
          )}
          subtitle={
            formatCurrency(
              portfolio?.totalLoanValue
            )
          }
          icon={DollarSign}
          variant="primary"
        />
      </section>

      {/* ================================================================== */}
      {/* SECONDARY METRICS */}
      {/* ================================================================== */}

      <section
        className="risk-secondary-metrics"
        aria-label="Portfolio and fraud metrics"
      >
        <div className="risk-secondary-card">
          <div>
            <Users
              size={20}
              aria-hidden="true"
            />

            <span>
              Risk Profiles
            </span>
          </div>

          <strong>
            {formatInteger(
              metrics.totalRiskProfiles
            )}
          </strong>
        </div>

        <div className="risk-secondary-card">
          <div>
            <AlertTriangle
              size={20}
              aria-hidden="true"
            />

            <span>
              High Fraud Events
            </span>
          </div>

          <strong>
            {formatInteger(
              metrics.highFraudEvents
            )}
          </strong>
        </div>

        <div className="risk-secondary-card">
          <div>
            <Activity
              size={20}
              aria-hidden="true"
            />

            <span>
              Active Loans
            </span>
          </div>

          <strong>
            {formatInteger(
              portfolio?.activeLoans
            )}
          </strong>
        </div>

        <div className="risk-secondary-card">
          <div>
            <XCircle
              size={20}
              aria-hidden="true"
            />

            <span>
              Default Rate
            </span>
          </div>

          <strong>
            {formatPercentage(
              metrics.defaultRate
            )}
          </strong>
        </div>
      </section>

      {/* ================================================================== */}
      {/* CHARTS */}
      {/* ================================================================== */}

      <section
        className="risk-grid"
        aria-label="Risk analytics"
      >
        <article className="chart-card">
          <div className="chart-card-header">
            <div>
              <h2>
                Credit Risk Distribution
              </h2>

              <p>
                Current risk classification
                across monitored profiles.
              </p>
            </div>

            <Shield
              size={20}
              aria-hidden="true"
            />
          </div>

          <div className="chart-container pie-chart-container">
            {metrics.totalRiskProfiles >
            0 ? (
              <Pie
                data={
                  riskDistribution
                }
                options={
                  pieOptions
                }
              />
            ) : (
              <ChartEmptyState />
            )}
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-card-header">
            <div>
              <h2>
                Fraud Trends
              </h2>

              <p>
                Latest monitored fraud
                intelligence events.
              </p>
            </div>

            <TrendingUp
              size={20}
              aria-hidden="true"
            />
          </div>

          <div className="chart-container">
            {sortedFraudLogs.length >
            0 ? (
              <Line
                data={
                  fraudTrendData
                }
                options={
                  lineOptions
                }
              />
            ) : (
              <ChartEmptyState
                message="No fraud events have been recorded."
              />
            )}
          </div>
        </article>
      </section>

      {/* ================================================================== */}
      {/* PORTFOLIO */}
      {/* ================================================================== */}

      <section className="chart-card full-width">
        <div className="chart-card-header">
          <div>
            <h2>
              Portfolio Overview
            </h2>

            <p>
              Loan portfolio exposure,
              active facilities and
              defaults.
            </p>
          </div>

          <DollarSign
            size={20}
            aria-hidden="true"
          />
        </div>

        <div className="portfolio-summary">
          <div>
            <span>
              Outstanding Balance
            </span>

            <strong>
              {formatCurrency(
                portfolio?.outstandingBalance
              )}
            </strong>
          </div>

          <div>
            <span>
              Default Exposure
            </span>

            <strong>
              {formatInteger(
                portfolio?.defaults
              )}
            </strong>
          </div>

          <div>
            <span>
              Default Rate
            </span>

            <strong>
              {formatPercentage(
                metrics.defaultRate
              )}
            </strong>
          </div>
        </div>

        <div className="chart-container portfolio-chart-container">
          {toNumber(
            portfolio?.totalLoans
          ) > 0 ? (
            <Bar
              data={
                portfolioData
              }
              options={
                barOptions
              }
            />
          ) : (
            <ChartEmptyState
              message="No loan portfolio data is currently available."
            />
          )}
        </div>
      </section>

      {/* ================================================================== */}
      {/* HIGH-RISK EVENTS */}
      {/* ================================================================== */}

      <section className="risk-events-section">
        <div className="risk-section-header">
          <div>
            <h2>
              Recent High-Risk Events
            </h2>

            <p>
              Fraud events requiring
              heightened operational
              attention.
            </p>
          </div>

          <ShieldAlert
            size={22}
            aria-hidden="true"
          />
        </div>

        {recentHighRiskEvents.length ===
        0 ? (
          <div className="risk-events-empty">
            <CheckCircle
              size={24}
              aria-hidden="true"
            />

            <div>
              <strong>
                No high-risk events detected
              </strong>

              <p>
                No recent fraud event has
                exceeded the high-risk
                monitoring threshold.
              </p>
            </div>
          </div>
        ) : (
          <div className="risk-events-list">
            {recentHighRiskEvents.map(
              (
                event,
                index
              ) => (
                <article
                  className="risk-event"
                  key={
                    event?._id ||
                    event?.id ||
                    `${event?.createdAt}-${index}`
                  }
                >
                  <div className="risk-event-icon">
                    <AlertTriangle
                      size={18}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="risk-event-content">
                    <div>
                      <strong>
                        High Fraud Risk
                      </strong>

                      <span>
                        Score{" "}
                        {formatDecimal(
                          event?.fraudScore,
                          1
                        )}
                      </span>
                    </div>

                    <p>
                      {event?.description ||
                        event?.reason ||
                        event?.eventType ||
                        "Fraud monitoring event detected."}
                    </p>

                    <small>
                      {formatDateTime(
                        event?.createdAt
                      )}
                    </small>
                  </div>
                </article>
              )
            )}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* OPERATIONAL ACCESS NOTICE */}
      {/* ================================================================== */}

      {!canManageRisk && (
        <aside className="risk-access-notice">
          <Shield
            size={18}
            aria-hidden="true"
          />

          <span>
            You have read-only risk
            intelligence access. Risk
            management actions are
            restricted to authorized
            TITech administrators and
            risk managers.
          </span>
        </aside>
      )}
    </main>
  );
}