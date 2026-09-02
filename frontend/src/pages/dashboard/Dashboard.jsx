// ============================================================================
// TITech Community Capital
// Enterprise Dashboard
//
// File:
// frontend/src/pages/dashboard/Dashboard.jsx
//
// Production Grade
// Multi-Tenant | Real-Time | Executive Analytics
// Feature Flags | Permission Boundaries | Financial Safety
// Offline Awareness | Accessible UI | Resilient Rendering
// Async Safety | Defensive API Handling | Session Awareness
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
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  CreditCard,
  Database,
  FileCheck2,
  Landmark,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

import { useNavigate } from "react-router-dom";

import { toast } from "react-toastify";

import { useAuth } from "../../context/AuthContext";
import useDashboardData from "../../hooks/useDashboardData";
import useRealtimeDashboard from "../../hooks/useRealtimeDashboard";

import FeatureGate from "../../components/FeatureGate";
import PermissionGate from "../../components/PermissionGate";

import {
  PageHeader,
  StatCard,
  LoadingScreen,
  Card,
  Button,
} from "../../ui";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TENANT_NAME =
  "TITech Community Capital";

const ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
]);

const MAX_NOTIFICATION_BADGE =
  99;

// ============================================================================
// Helpers
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

// ----------------------------------------------------------------------------
// Currency
// ----------------------------------------------------------------------------

function formatCurrency(
  value = 0
) {
  const numericValue =
    toFiniteNumber(value);

  return new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  ).format(
    numericValue
  );
}

// ----------------------------------------------------------------------------
// Number
// ----------------------------------------------------------------------------

function formatNumber(
  value = 0
) {
  const numericValue =
    toFiniteNumber(value);

  return new Intl.NumberFormat(
    "en-UG"
  ).format(
    numericValue
  );
}

// ----------------------------------------------------------------------------
// Percentage
// ----------------------------------------------------------------------------

function formatPercentage(
  value = 0
) {
  const numericValue =
    toFiniteNumber(value);

  return `${numericValue.toFixed(
    1
  )}%`;
}

// ----------------------------------------------------------------------------
// Date
// ----------------------------------------------------------------------------

function formatDate(
  date
) {
  if (!date) {
    return "Never";
  }

  const parsed =
    new Date(date);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return "Unknown";
  }

  return parsed.toLocaleString(
    "en-UG",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  );
}

// ----------------------------------------------------------------------------
// User
// ----------------------------------------------------------------------------

function getUserDisplayName(
  user
) {
  return (
    user?.name ||
    user?.fullName ||
    user?.displayName ||
    user?.email ||
    "User"
  );
}

// ----------------------------------------------------------------------------
// Tenant
// ----------------------------------------------------------------------------

function getTenantDisplayName(
  user
) {
  return (
    user?.tenant?.name ||
    user?.tenantName ||
    user?.organization?.name ||
    DEFAULT_TENANT_NAME
  );
}

// ----------------------------------------------------------------------------
// Collections
// ----------------------------------------------------------------------------

function normalizeCollection(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}

// ----------------------------------------------------------------------------
// Status
// ----------------------------------------------------------------------------

function normalizeHealthStatus(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return {
      label: "Healthy",
      healthy: true,
    };
  }

  if (
    typeof value === "object"
  ) {
    const status =
      value.status ||
      value.state ||
      value.health;

    return normalizeHealthStatus(
      status
    );
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  const healthy =
    [
      "healthy",
      "ok",
      "operational",
      "up",
      "connected",
      "ready",
    ].includes(
      normalized
    );

  return {
    label:
      String(value),
    healthy,
  };
}

// ----------------------------------------------------------------------------
// Safe error message
//
// Do not expose raw backend exception messages to normal users.
// ----------------------------------------------------------------------------

function getSafeErrorMessage(
  error
) {
  if (
    !error
  ) {
    return "An unexpected error occurred while loading the dashboard.";
  }

  const status =
    error?.response?.status;

  if (
    status === 401
  ) {
    return "Your session has expired. Please sign in again.";
  }

  if (
    status === 403
  ) {
    return "You do not have permission to view this dashboard.";
  }

  if (
    status >= 500
  ) {
    return "The TITech dashboard service is temporarily unavailable.";
  }

  if (
    !navigator.onLine
  ) {
    return "You appear to be offline. Please reconnect and try again.";
  }

  return (
    error?.userMessage ||
    "We could not load the dashboard. Please try again."
  );
}

// ============================================================================
// Dashboard
// ============================================================================

export default function Dashboard() {
  const navigate =
    useNavigate();

  // ========================================================================
  // Authentication
  // ========================================================================

  const {
    user,
    tenantId,
    online,
    authenticated,
    loading: authLoading,
    logout,
  } = useAuth();

  // ========================================================================
  // Lifecycle
  // ========================================================================

  const mountedRef =
    useRef(true);

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;
    };
  }, []);

  // ========================================================================
  // Local UI State
  // ========================================================================

  const [
    refreshLoading,
    setRefreshLoading,
  ] = useState(false);

  const [
    logoutLoading,
    setLogoutLoading,
  ] = useState(false);

  // ========================================================================
  // Derived Identity
  // ========================================================================

  const isAdmin =
    useMemo(
      () =>
        ADMIN_ROLES.has(
          user?.role
        ),
      [user?.role]
    );

  const displayName =
    useMemo(
      () =>
        getUserDisplayName(
          user
        ),
      [user]
    );

  const tenantName =
    useMemo(
      () =>
        getTenantDisplayName(
          user
        ),
      [user]
    );

  // ========================================================================
  // Dashboard Data
  // ========================================================================

  const {
    loading:
      dashboardLoading,
    error,
    groups: rawGroups,
    stats,
    metrics,
    refresh,
    lastUpdated,
    notifications:
      rawNotifications,
    systemHealth:
      rawSystemHealth,
  } =
    useDashboardData({
      autoRefresh: true,
      realtime: true,

      // This is NOT a security boundary.
      // Server-side authorization remains authoritative.
      isAdmin,

      enableExecutive: true,
      enableFraud: true,
      enableRegulatory: true,
      enableMobileMoney: true,
    });

  // ========================================================================
  // Normalize Dashboard Collections
  // ========================================================================

  const groups =
    useMemo(
      () =>
        normalizeCollection(
          rawGroups
        ),
      [rawGroups]
    );

  const notifications =
    useMemo(
      () =>
        normalizeCollection(
          rawNotifications
        ),
      [rawNotifications]
    );

  const systemHealth =
    useMemo(
      () =>
        rawSystemHealth &&
        typeof rawSystemHealth ===
          "object"
          ? rawSystemHealth
          : {},
      [rawSystemHealth]
    );

  // ========================================================================
  // Realtime
  // ========================================================================

  const realtime =
    useRealtimeDashboard();

  const realtimeConnected =
    Boolean(
      realtime?.connected
    );

  // ========================================================================
  // Derived Metrics
  // ========================================================================

  const safeMetrics =
    useMemo(
      () => ({
        totalSavings:
          toFiniteNumber(
            metrics?.totalSavings
          ),

        totalGroups:
          toFiniteNumber(
            metrics?.totalGroups
          ),

        totalMembers:
          toFiniteNumber(
            metrics?.totalMembers
          ),

        activeLoans:
          toFiniteNumber(
            metrics?.activeLoans
          ),
      }),
      [metrics]
    );

  // ========================================================================
  // Refresh
  // ========================================================================
  //
  // The dashboard owns a UI-level single-flight guard.
  //
  // The underlying API client should still maintain its own retry,
  // refresh-token, idempotency, and request-level protections.
  // ========================================================================

  const refreshInFlightRef =
    useRef(false);

  const handleRefresh =
    useCallback(
      async () => {
        if (
          refreshInFlightRef.current
        ) {
          return;
        }

        if (
          !online
        ) {
          toast.info(
            "You are offline. Dashboard refresh is unavailable until connectivity returns."
          );

          return;
        }

        refreshInFlightRef.current =
          true;

        if (
          mountedRef.current
        ) {
          setRefreshLoading(
            true
          );
        }

        try {
          await refresh();

          if (
            mountedRef.current
          ) {
            toast.success(
              "Dashboard updated."
            );
          }
        } catch (
          refreshError
        ) {
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              "[TITech Dashboard] Refresh failed",
              refreshError
            );
          }

          if (
            mountedRef.current
          ) {
            toast.error(
              "Failed to refresh dashboard."
            );
          }
        } finally {
          refreshInFlightRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setRefreshLoading(
              false
            );
          }
        }
      },
      [
        online,
        refresh,
      ]
    );

  // ========================================================================
  // Logout
  // ========================================================================

  const logoutInFlightRef =
    useRef(false);

  const handleLogout =
    useCallback(
      async () => {
        if (
          logoutInFlightRef.current
        ) {
          return;
        }

        logoutInFlightRef.current =
          true;

        if (
          mountedRef.current
        ) {
          setLogoutLoading(
            true
          );
        }

        try {
          await logout(
            false
          );

          navigate(
            "/login",
            {
              replace: true,
            }
          );
        } catch (
          logoutError
        ) {
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              "[TITech Dashboard] Logout failed",
              logoutError
            );
          }

          if (
            mountedRef.current
          ) {
            toast.error(
              "Unable to complete logout."
            );
          }
        } finally {
          logoutInFlightRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setLogoutLoading(
              false
            );
          }
        }
      },
      [
        logout,
        navigate,
      ]
    );

  // ========================================================================
  // Navigation
  // ========================================================================

  const handleGroupNavigation =
    useCallback(
      groupId => {
        if (!groupId) {
          return;
        }

        navigate(
          `/groups/${encodeURIComponent(
            String(groupId)
          )}`
        );
      },
      [navigate]
    );

  const handleNotifications =
    useCallback(() => {
      navigate(
        "/notifications"
      );
    }, [navigate]);

  // ========================================================================
  // Loading
  // ========================================================================

  if (
    authLoading ||
    dashboardLoading
  ) {
    return (
      <LoadingScreen
        message="Loading TITech dashboard..."
      />
    );
  }

  // ========================================================================
  // Authentication Guard
  // ========================================================================

  if (
    !authenticated
  ) {
    return (
      <main
        className="dashboard-error"
        role="alert"
        aria-live="polite"
      >
        <ShieldCheck
          size={48}
          aria-hidden="true"
        />

        <h1>
          Authentication required
        </h1>

        <p>
          Your session is no longer
          active. Please sign in again
          to continue.
        </p>

        <Button
          onClick={() =>
            navigate(
              "/login",
              {
                replace: true,
              }
            )
          }
        >
          Sign in
        </Button>
      </main>
    );
  }

  // ========================================================================
  // Error State
  // ========================================================================

  if (
    error
  ) {
    const errorMessage =
      getSafeErrorMessage(
        error
      );

    return (
      <main
        className="dashboard-error"
        role="alert"
        aria-live="assertive"
      >
        <AlertTriangle
          size={48}
          aria-hidden="true"
        />

        <h1>
          Dashboard unavailable
        </h1>

        <p>
          {errorMessage}
        </p>

        <div className="dashboard-error-actions">
          <Button
            onClick={
              handleRefresh
            }
            disabled={
              refreshLoading ||
              !online
            }
            aria-label={
              refreshLoading
                ? "Retrying dashboard"
                : "Retry dashboard"
            }
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={
                refreshLoading
                  ? "animate-spin"
                  : undefined
              }
            />

            {refreshLoading
              ? "Retrying..."
              : "Retry"}
          </Button>

          {!online && (
            <span
              className="dashboard-offline-status"
              role="status"
              aria-live="polite"
            >
              <WifiOff
                size={16}
                aria-hidden="true"
              />

              Offline
            </span>
          )}
        </div>
      </main>
    );
  }

  // ========================================================================
  // Health Status
  // ========================================================================

  const apiHealth =
    normalizeHealthStatus(
      systemHealth?.api
    );

  const databaseHealth =
    normalizeHealthStatus(
      systemHealth?.database
    );

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <main
      className="dashboard-page"
      aria-labelledby="dashboard-title"
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <PageHeader
        title={
          <span id="dashboard-title">
            Welcome,{" "}
            {displayName}
          </span>
        }
        subtitle={
          <span>
            {tenantName}

            {tenantId && (
              <span className="sr-only">
                Authenticated tenant
                session active
              </span>
            )}
          </span>
        }
      >
        <div
          className="dashboard-header-actions"
          role="toolbar"
          aria-label="Dashboard actions"
        >
          {/* ============================================================ */}
          {/* Network */}
          {/* ============================================================ */}

          <span
            className={`dashboard-connectivity-status ${
              online
                ? "is-online"
                : "is-offline"
            }`}
            role="status"
            aria-live="polite"
            title={
              online
                ? "Online"
                : "Offline"
            }
          >
            {online ? (
              <Wifi
                size={18}
                aria-hidden="true"
              />
            ) : (
              <WifiOff
                size={18}
                aria-hidden="true"
              />
            )}

            <span className="sr-only">
              {online
                ? "Online"
                : "Offline"}
            </span>
          </span>

          {/* ============================================================ */}
          {/* Refresh */}
          {/* ============================================================ */}

          <Button
            type="button"
            onClick={
              handleRefresh
            }
            disabled={
              refreshLoading ||
              !online
            }
            aria-label={
              refreshLoading
                ? "Refreshing dashboard"
                : "Refresh dashboard"
            }
            title={
              online
                ? "Refresh dashboard"
                : "Unavailable while offline"
            }
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={
                refreshLoading
                  ? "animate-spin"
                  : undefined
              }
            />
          </Button>

          {/* ============================================================ */}
          {/* Notifications */}
          {/* ============================================================ */}

          <Button
            type="button"
            onClick={
              handleNotifications
            }
            aria-label={`Notifications${
              notifications.length > 0
                ? `, ${notifications.length} available`
                : ""
            }`}
            title="Notifications"
          >
            <Bell
              size={18}
              aria-hidden="true"
            />

            {notifications.length >
              0 && (
              <span
                className="dashboard-notification-count"
                aria-hidden="true"
              >
                {notifications.length >
                MAX_NOTIFICATION_BADGE
                  ? `${MAX_NOTIFICATION_BADGE}+`
                  : notifications.length}
              </span>
            )}
          </Button>

          {/* ============================================================ */}
          {/* Realtime */}
          {/* ============================================================ */}

          <span
            className={`dashboard-realtime-status ${
              realtimeConnected
                ? "is-connected"
                : "is-disconnected"
            }`}
            role="status"
            aria-live="polite"
            title={
              realtimeConnected
                ? "Realtime connection active"
                : "Realtime connection unavailable"
            }
          >
            {realtimeConnected ? (
              <Wifi
                size={18}
                aria-hidden="true"
              />
            ) : (
              <WifiOff
                size={18}
                aria-hidden="true"
              />
            )}

            <span className="sr-only">
              {realtimeConnected
                ? "Realtime connected"
                : "Realtime disconnected"}
            </span>
          </span>

          {/* ============================================================ */}
          {/* Logout */}
          {/* ============================================================ */}

          <Button
            type="button"
            onClick={
              handleLogout
            }
            disabled={
              logoutLoading
            }
            aria-label={
              logoutLoading
                ? "Signing out"
                : "Sign out"
            }
            title="Sign out"
          >
            {logoutLoading ? (
              <RefreshCw
                size={18}
                aria-hidden="true"
                className="animate-spin"
              />
            ) : (
              <LogOut
                size={18}
                aria-hidden="true"
              />
            )}
          </Button>
        </div>
      </PageHeader>

      {/* ================================================================== */}
      {/* Offline Banner */}
      {/* ================================================================== */}

      {!online && (
        <section
          className="dashboard-offline-banner"
          role="status"
          aria-live="polite"
        >
          <WifiOff
            size={20}
            aria-hidden="true"
          />

          <div>
            <strong>
              You are offline
            </strong>

            <p>
              Dashboard information may
              be temporarily stale.
              Automatic synchronization
              will resume when connectivity
              returns.
            </p>
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* KPI Section */}
      {/* ================================================================== */}

      <section
        className="dashboard-section"
        aria-labelledby="dashboard-kpis"
      >
        <h2
          id="dashboard-kpis"
          className="sr-only"
        >
          Key performance indicators
        </h2>

        <div className="dashboard-stats-grid">
          <StatCard
            title="Savings"
            value={formatCurrency(
              safeMetrics.totalSavings
            )}
          />

          <StatCard
            title="Groups"
            value={formatNumber(
              safeMetrics.totalGroups
            )}
          />

          <StatCard
            title="Members"
            value={formatNumber(
              safeMetrics.totalMembers
            )}
          />

          <StatCard
            title="Active Loans"
            value={formatNumber(
              safeMetrics.activeLoans
            )}
          />
        </div>
      </section>

      {/* ================================================================== */}
      {/* Executive Analytics */}
      {/* ================================================================== */}

      <FeatureGate features="executive_dashboard">
        <section
          className="dashboard-section"
          aria-labelledby="executive-analytics"
        >
          <Card>
            <div className="dashboard-card-header">
              <div>
                <h2 id="executive-analytics">
                  Executive Analytics
                </h2>

                <p>
                  High-level portfolio,
                  revenue, and recovery
                  indicators.
                </p>
              </div>

              <Landmark
                size={24}
                aria-hidden="true"
              />
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-metric">
                <span>
                  Portfolio Value
                </span>

                <strong>
                  {formatCurrency(
                    stats
                      ?.executive
                      ?.portfolioValue
                  )}
                </strong>
              </div>

              <div className="dashboard-metric">
                <span>
                  Total Revenue
                </span>

                <strong>
                  {formatCurrency(
                    stats
                      ?.executive
                      ?.revenue
                  )}
                </strong>
              </div>

              <div className="dashboard-metric">
                <span>
                  Loan Recovery
                </span>

                <strong>
                  {formatPercentage(
                    stats
                      ?.executive
                      ?.recoveryRate
                  )}
                </strong>
              </div>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Mobile Money */}
      {/* ================================================================== */}

      <FeatureGate features="mobile_money">
        <section
          className="dashboard-section"
          aria-labelledby="mobile-money"
        >
          <Card>
            <div className="dashboard-card-header">
              <div>
                <h2 id="mobile-money">
                  Mobile Money
                </h2>

                <p>
                  Mobile-money transaction
                  activity.
                </p>
              </div>

              <Smartphone
                size={24}
                aria-hidden="true"
              />
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-metric">
                <span>
                  Deposits
                </span>

                <strong>
                  {formatCurrency(
                    stats
                      ?.mobileMoney
                      ?.deposits
                  )}
                </strong>
              </div>

              <div className="dashboard-metric">
                <span>
                  Withdrawals
                </span>

                <strong>
                  {formatCurrency(
                    stats
                      ?.mobileMoney
                      ?.withdrawals
                  )}
                </strong>
              </div>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Fraud Monitoring */}
      {/* ================================================================== */}

      <FeatureGate features="fraud_detection">
        <section
          className="dashboard-section"
          aria-labelledby="fraud-monitoring"
        >
          <Card>
            <div className="dashboard-card-header">
              <div>
                <h2 id="fraud-monitoring">
                  Fraud Monitoring
                </h2>

                <p>
                  Transaction risk indicators
                  for authorized operations
                  users.
                </p>
              </div>

              <ShieldCheck
                size={24}
                aria-hidden="true"
              />
            </div>

            <div
              className="dashboard-risk-indicator"
              role="status"
              aria-live="polite"
            >
              <span>
                Flagged Transactions
              </span>

              <strong>
                {formatNumber(
                  stats
                    ?.fraud
                    ?.flagged
                )}
              </strong>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Regulatory Reporting */}
      {/* ================================================================== */}

      <FeatureGate features="regulatory_reporting">
        <section
          className="dashboard-section"
          aria-labelledby="regulatory-reporting"
        >
          <Card>
            <div className="dashboard-card-header">
              <div>
                <h2 id="regulatory-reporting">
                  Regulatory Reporting
                </h2>

                <p>
                  Regulatory reporting
                  workflow status.
                </p>
              </div>

              <FileCheck2
                size={24}
                aria-hidden="true"
              />
            </div>

            <div
              className="dashboard-risk-indicator"
              role="status"
              aria-live="polite"
            >
              <span>
                Pending Reports
              </span>

              <strong>
                {formatNumber(
                  stats
                    ?.regulatory
                    ?.pending
                )}
              </strong>
            </div>
          </Card>
        </section>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Community Groups */}
      {/* ================================================================== */}

      <section
        className="dashboard-section"
        aria-labelledby="community-groups"
      >
        <Card>
          <div className="dashboard-card-header">
            <div>
              <h2 id="community-groups">
                Community Groups
              </h2>

              <p>
                Groups available within
                your authorized tenant
                scope.
              </p>
            </div>

            <Users
              size={24}
              aria-hidden="true"
            />
          </div>

          {groups.length === 0 ? (
            <div
              className="dashboard-empty-state"
              role="status"
            >
              <Users
                size={32}
                aria-hidden="true"
              />

              <p>
                No groups are currently
                available.
              </p>
            </div>
          ) : (
            <div
              className="groups-grid"
              role="list"
            >
              {groups.map(
                group => {
                  const groupId =
                    group?._id ||
                    group?.id;

                  if (!groupId) {
                    return null;
                  }

                  const memberCount =
                    Array.isArray(
                      group.members
                    )
                      ? group.members.length
                      : toFiniteNumber(
                          group.memberCount
                        );

                  return (
                    <Card
                      key={
                        String(
                          groupId
                        )
                      }
                      role="listitem"
                    >
                      <div
                        className="dashboard-group-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${
                          group.name ||
                          "community group"
                        }`}
                        onClick={() =>
                          handleGroupNavigation(
                            groupId
                          )
                        }
                        onKeyDown={event => {
                          if (
                            event.key ===
                              "Enter" ||
                            event.key ===
                              " "
                          ) {
                            event.preventDefault();

                            handleGroupNavigation(
                              groupId
                            );
                          }
                        }}
                      >
                        <h3>
                          {group.name ||
                            "Unnamed Group"}
                        </h3>

                        {group.description && (
                          <p>
                            {
                              group.description
                            }
                          </p>
                        )}

                        <div>
                          <small>
                            Members:{" "}
                            {formatNumber(
                              memberCount
                            )}
                          </small>

                          <br />

                          <small>
                            Contributions:{" "}
                            {formatCurrency(
                              group.totalContributions
                            )}
                          </small>
                        </div>
                      </div>
                    </Card>
                  );
                }
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ================================================================== */}
      {/* System Health */}
      {/* ================================================================== */}

      <PermissionGate permissions="view_system_health">
        <section
          className="dashboard-section"
          aria-labelledby="system-health"
        >
          <Card>
            <div className="dashboard-card-header">
              <div>
                <h2 id="system-health">
                  System Health
                </h2>

                <p>
                  Operational status visible
                  only to authorized users.
                </p>
              </div>

              <Activity
                size={24}
                aria-hidden="true"
              />
            </div>

            <div className="dashboard-health-grid">
              {/* ======================================================== */}
              {/* API */}
              {/* ======================================================== */}

              <div className="dashboard-health-item">
                {apiHealth.healthy ? (
                  <CheckCircle2
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    size={18}
                    aria-hidden="true"
                  />
                )}

                <span>
                  API
                </span>

                <strong>
                  {apiHealth.label}
                </strong>
              </div>

              {/* ======================================================== */}
              {/* Database */}
              {/* ======================================================== */}

              <div className="dashboard-health-item">
                {databaseHealth.healthy ? (
                  <CheckCircle2
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    size={18}
                    aria-hidden="true"
                  />
                )}

                <span>
                  Database
                </span>

                <strong>
                  {
                    databaseHealth.label
                  }
                </strong>
              </div>

              {/* ======================================================== */}
              {/* Realtime */}
              {/* ======================================================== */}

              <div className="dashboard-health-item">
                {realtimeConnected ? (
                  <Wifi
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <WifiOff
                    size={18}
                    aria-hidden="true"
                  />
                )}

                <span>
                  Realtime
                </span>

                <strong>
                  {realtimeConnected
                    ? "Connected"
                    : "Disconnected"}
                </strong>
              </div>

              {/* ======================================================== */}
              {/* Last Updated */}
              {/* ======================================================== */}

              <div className="dashboard-health-item">
                <Activity
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Last Updated
                </span>

                <strong>
                  {formatDate(
                    lastUpdated
                  )}
                </strong>
              </div>
            </div>
          </Card>
        </section>
      </PermissionGate>
    </main>
  );
}