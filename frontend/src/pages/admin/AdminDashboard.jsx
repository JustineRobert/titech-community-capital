// ============================================================================
// TITech Community Capital
// Enterprise Admin Dashboard
// File: frontend/src/pages/admin/AdminDashboard.jsx
//
// Production Grade
//
// Responsibilities:
// - Platform administration overview
// - Governance KPIs
// - Administrative quick actions
// - Recent administrative activity
// - Resilient API orchestration
// - Abort-safe requests
// - Partial endpoint failure handling
// - Secure role-aware rendering
// - Accessibility
// - Refresh lifecycle management
// - Financial-safe number formatting
// - TITech platform consistency
// ============================================================================

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Landmark,
  RefreshCw,
  Settings,
  Shield,
  UserCheck,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

import { Link, useNavigate } from "react-router-dom";

import { toast } from "react-toastify";

import { useAuth } from "../../context/AuthContext";
import { normalizeTitechRole, TITECH_ROLES } from "../../security/rbacPolicy";
import api from "../../services/api";
import TITECH_BRAND from "../../branding/brand";
import {
  getAdminDashboardErrorMessage,
  normalizeAdminActivity,
  normalizeAdminStats,
  unwrapAdminDashboardResponse,
} from "./adminDashboardData.mjs";

import "./AdminDashboard.css";

// ============================================================================
// Constants
// ============================================================================

const DASHBOARD_REFRESH_INTERVAL = 60_000;

// This is a platform-wide administration centre. Tenant administrators use
// their tenant-scoped workspace and are not granted global activity access.
const ADMIN_ROLES = new Set([
  TITECH_ROLES.PLATFORM_ADMIN,
]);

// `null` means the backend has not supplied a trustworthy metric. An actual
// numeric zero remains zero; missing or malformed data must not be fabricated.
const DEFAULT_STATS = Object.freeze({
  totalUsers: null,
  activeUsers: null,
  activeGroups: null,
  pendingApprovals: null,
  activeLoans: null,
  totalSavings: null,
});

const DEFAULT_ACTIVITY = Object.freeze([]);

const ENDPOINTS = Object.freeze({
  stats: "/api/admin/stats",
  activity: "/api/admin/activity",
});

const QUICK_ACTIONS = Object.freeze([
  {
    id: "access-governance",
    label: "Access Governance",
    description: "Roles, permissions and controlled access",
    path: "/admin/access",
    icon: Shield,
  },
  {
    id: "settings",
    label: "Institution Settings",
    description: "Settings available in the active route tree",
    path: "/settings",
    icon: Settings,
  },
]);

// ============================================================================
// Utility Helpers
// ============================================================================

function normalizeRole(role) {
  return normalizeTitechRole(role) || "";
}

function formatInteger(value) {
  if (value === null || value === undefined) return "Unavailable";
  return new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value) {
  if (value === null || value === undefined) return "Unavailable";
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    currencyDisplay: "symbol",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const getErrorMessage = getAdminDashboardErrorMessage;

// ============================================================================
// Stat Card
// ============================================================================

const StatCard = memo(
  ({
    title,
    value,
    icon: Icon,
    color = "blue",
    description,
  }) => (
    <article
      className={`admin-stat-card ${color}`}
      aria-label={`${title}: ${value}`}
    >
      <div
        className="stat-icon"
        aria-hidden="true"
      >
        <Icon size={24} />
      </div>

      <div className="stat-content">
        <span>
          {title}
        </span>

        <h3>
          {value}
        </h3>

        {description && (
          <small>
            {description}
          </small>
        )}
      </div>
    </article>
  )
);

StatCard.displayName =
  "StatCard";

// ============================================================================
// Quick Action
// ============================================================================

const QuickAction = memo(
  ({
    action,
  }) => {
    const Icon =
      action.icon;

    return (
      <Link
        to={action.path}
        className="action-card"
        aria-label={`${action.label}: ${action.description}`}
      >
        <span
          className="action-icon"
          aria-hidden="true"
        >
          <Icon size={22} />
        </span>

        <span className="action-content">
          <strong>
            {action.label}
          </strong>

          <small>
            {action.description}
          </small>
        </span>
      </Link>
    );
  }
);

QuickAction.displayName =
  "QuickAction";

// ============================================================================
// Activity Item
// ============================================================================

const ActivityItem = memo(
  ({
    event,
  }) => (
    <article className="activity-item">
      <div
        className="activity-icon"
        aria-hidden="true"
      >
        <Activity size={16} />
      </div>

      <div className="activity-content">
        <strong>
          {event.action}
        </strong>

        <p>
          {event.description}
        </p>

        {(event.actor || event.resource) && (
          <small className="activity-context">
            {event.actor ? `By ${event.actor}` : ""}
            {event.actor && event.resource ? " · " : ""}
            {event.resource ? `On ${event.resource}` : ""}
          </small>
        )}

        <time
          dateTime={
            event.createdAt || undefined
          }
        >
          {formatDate(
            event.createdAt
          )}
        </time>
      </div>
    </article>
  )
);

ActivityItem.displayName =
  "ActivityItem";

// ============================================================================
// Loading State
// ============================================================================

const DashboardLoading =
  memo(() => (
    <div
      className="admin-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <RefreshCw
        size={24}
        className="admin-loading-icon"
        aria-hidden="true"
      />

      <span>
        Loading administration center...
      </span>
    </div>
  ));

DashboardLoading.displayName =
  "DashboardLoading";

// ============================================================================
// Partial Failure State
// ============================================================================

const DashboardNotice =
  memo(
    ({
      message,
      onRetry,
      refreshing,
    }) => (
      <div
        className="admin-notice"
        role="alert"
      >
        <AlertTriangle
          size={20}
          aria-hidden="true"
        />

        <div className="admin-notice-content">
          <strong>
            Some dashboard data could not be loaded.
          </strong>

          <span>
            {message}
          </span>
        </div>

        <button
          type="button"
          className="refresh-btn secondary"
          onClick={onRetry}
          disabled={refreshing}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
          />

          Retry
        </button>
      </div>
    )
  );

DashboardNotice.displayName =
  "DashboardNotice";

// ============================================================================
// Admin Dashboard
// ============================================================================

function AdminDashboard() {
  const navigate =
    useNavigate();

  const {
    user,
  } = useAuth();

  const mountedRef =
    useRef(false);

  const requestControllerRef =
    useRef(null);

  const requestInFlightRef =
    useRef(false);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    stats,
    setStats,
  ] = useState(
    DEFAULT_STATS
  );

  const [
    recentEvents,
    setRecentEvents,
  ] = useState(
    DEFAULT_ACTIVITY
  );

  const [activityError, setActivityError] = useState("");

  const [
    dashboardError,
    setDashboardError,
  ] = useState("");

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  // ==========================================================================
  // Authorization
  // ==========================================================================

  const isAdmin = useMemo(() => {
    const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
      .map(normalizeRole)
      .filter(Boolean);
    return roles.some((role) => ADMIN_ROLES.has(role));
  }, [user?.role, user?.roles]);

  // ==========================================================================
  // Dashboard Loader
  // ==========================================================================

  const loadDashboard =
    useCallback(
      async (
        silent = false
      ) => {
        if (
          requestInFlightRef.current
        ) {
          return;
        }

        requestInFlightRef.current =
          true;

        if (!silent) {
          setRefreshing(
            true
          );
        }

        requestControllerRef.current?.abort();

        const controller =
          new AbortController();

        requestControllerRef.current =
          controller;

        try {
          const results =
            await Promise.allSettled([
              api.get(
                ENDPOINTS.stats,
                {
                  signal:
                    controller.signal,
                }
              ),

              api.get(
                ENDPOINTS.activity,
                {
                  signal:
                    controller.signal,
                }
              ),
            ]);

          if (
            controller.signal.aborted ||
            !mountedRef.current
          ) {
            return;
          }

          const [
            statsResult,
            activityResult,
          ] = results;

          let hasFailure =
            false;

          const failureMessages =
            [];

          // ------------------------------------------------------------------
          // Statistics
          // ------------------------------------------------------------------

          if (
            statsResult.status ===
            "fulfilled"
          ) {
            setStats(
              normalizeAdminStats(
                unwrapAdminDashboardResponse(
                  statsResult.value
                )
              )
            );
          } else {
            hasFailure = true;

            failureMessages.push(
              `Statistics: ${getErrorMessage(
                statsResult.reason
              )}`
            );
          }

          // ------------------------------------------------------------------
          // Activity
          // ------------------------------------------------------------------

          if (
            activityResult.status ===
            "fulfilled"
          ) {
            setRecentEvents(
              normalizeAdminActivity(
                unwrapAdminDashboardResponse(
                  activityResult.value
                )
              )
            );
            setActivityError("");
          } else {
            hasFailure = true;

            const message = getErrorMessage(activityResult.reason);
            setActivityError(message);
            failureMessages.push(`Activity: ${message}`);
          }

          if (
            hasFailure
          ) {
            setDashboardError(
              failureMessages.join(
                " "
              )
            );
          } else {
            setDashboardError(
              ""
            );
          }

          if (!hasFailure) {
            setLastUpdated(new Date());
          }
        } catch (
          error
        ) {
          if (
            controller.signal
              .aborted ||
            error?.name ===
              "AbortError" ||
            error?.name ===
              "CanceledError" ||
            error?.code ===
              "ERR_CANCELED"
          ) {
            return;
          }

          if (
            !mountedRef.current
          ) {
            return;
          }

          const message =
            getErrorMessage(
              error
            );

          setDashboardError(
            message
          );

          toast.error(
            "Unable to refresh the administration dashboard."
          );
        } finally {
          if (
            mountedRef.current
          ) {
            setLoading(
              false
            );

            setRefreshing(
              false
            );
          }

          if (
            requestControllerRef.current ===
            controller
          ) {
            requestControllerRef.current =
              null;
          }

          requestInFlightRef.current =
            false;
        }
      },
      []
    );

  // ==========================================================================
  // Authorization + Lifecycle
  // ==========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      requestControllerRef.current?.abort();

      requestControllerRef.current =
        null;

      requestInFlightRef.current =
        false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      navigate(
        "/login",
        {
          replace: true,
        }
      );

      return;
    }

    if (!isAdmin) {
      toast.error(
        "Administrator access required."
      );

      navigate(
        "/dashboard",
        {
          replace: true,
        }
      );

      return;
    }

    loadDashboard();
  }, [
    user,
    isAdmin,
    navigate,
    loadDashboard,
  ]);

  // ==========================================================================
  // Automatic Refresh
  // ==========================================================================

  useEffect(() => {
    if (
      !user ||
      !isAdmin
    ) {
      return undefined;
    }

    const timer =
      window.setInterval(
        () => {
          loadDashboard(
            true
          );
        },
        DASHBOARD_REFRESH_INTERVAL
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [
    user,
    isAdmin,
    loadDashboard,
  ]);

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const formattedStats =
    useMemo(
      () => ({
        totalUsers:
          formatInteger(
            stats.totalUsers
          ),

        activeUsers:
          formatInteger(
            stats.activeUsers
          ),

        activeGroups:
          formatInteger(
            stats.activeGroups
          ),

        pendingApprovals:
          formatInteger(
            stats.pendingApprovals
          ),

        activeLoans:
          formatInteger(
            stats.activeLoans
          ),

        totalSavings:
          formatCurrency(
            stats.totalSavings
          ),
      }),
      [stats]
    );

  const activityCount =
    recentEvents.length;

  // ==========================================================================
  // Loading
  // ==========================================================================

  if (
    loading &&
    !dashboardError
  ) {
    return (
      <DashboardLoading />
    );
  }

  // ==========================================================================
  // Unauthorized Fallback
  // ==========================================================================

  if (
    !user ||
    !isAdmin
  ) {
    return null;
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="admin-dashboard"
      aria-labelledby="admin-dashboard-title"
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <header className="admin-header">
        <div className="admin-header-content">
          <div>
            <span className="admin-eyebrow">
              {TITECH_BRAND.organizationName} · {TITECH_BRAND.fullName} · {TITECH_BRAND.tagline}
            </span>

            <h1 id="admin-dashboard-title">
              Administration Center
            </h1>

            <p>
              Platform governance,
              monitoring, security
              and operational controls.
            </p>
          </div>

          <div className="admin-header-actions">
            {lastUpdated && (
              <span
                className="admin-last-updated"
                aria-live="polite"
              >
                <Clock
                  size={15}
                  aria-hidden="true"
                />

                <span>
                  Updated{" "}
                  {formatDate(
                    lastUpdated
                  )}
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={() =>
                loadDashboard(
                  false
                )
              }
              className="refresh-btn"
              disabled={
                refreshing
              }
              aria-label="Refresh administration dashboard"
              aria-busy={
                refreshing
              }
            >
              <RefreshCw
                size={18}
                className={
                  refreshing
                    ? "admin-refreshing"
                    : undefined
                }
                aria-hidden="true"
              />

              {refreshing
                ? "Refreshing..."
                : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* Dashboard Health Notice */}
      {/* ================================================================== */}

      {dashboardError && (
        <DashboardNotice
          message={
            dashboardError
          }
          onRetry={() =>
            loadDashboard(
              false
            )
          }
          refreshing={
            refreshing
          }
        />
      )}

      {/* ================================================================== */}
      {/* Platform Overview */}
      {/* ================================================================== */}

      <section
        className="admin-section"
        aria-labelledby="platform-overview-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="platform-overview-title">
              Platform Overview
            </h2>

            <p>
              Current operational
              indicators across
              TITech Community Capital.
            </p>
          </div>
        </div>

        <div className="stats-grid">
          <StatCard
            title="Total Users"
            value={
              formattedStats.totalUsers
            }
            icon={Users}
            color="blue"
            description="Registered platform users"
          />

          <StatCard
            title="Active Users"
            value={
              formattedStats.activeUsers
            }
            icon={UserCheck}
            color="green"
            description="Currently active accounts"
          />

          <StatCard
            title="Active Groups"
            value={
              formattedStats.activeGroups
            }
            icon={Wallet}
            color="gold"
            description="Operational community groups"
          />

          <StatCard
            title="Pending Approvals"
            value={
              formattedStats.pendingApprovals
            }
            icon={Clock}
            color="orange"
            description="Items requiring attention"
          />

          <StatCard
            title="Active Loans"
            value={
              formattedStats.activeLoans
            }
            icon={Landmark}
            color="purple"
            description="Currently active facilities"
          />

          <StatCard
            title="Total Savings"
            value={
              formattedStats.totalSavings
            }
            icon={Wallet}
            color="teal"
            description="Aggregate recorded savings"
          />
        </div>
      </section>

      {/* ================================================================== */}
      {/* Quick Actions */}
      {/* ================================================================== */}

      <section
        className="admin-section"
        aria-labelledby="quick-actions-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="quick-actions-title">
              Administrative Controls
            </h2>

            <p>
              Access frequently used
              administration functions.
            </p>
          </div>
        </div>

        <nav
          className="admin-actions"
          aria-label="Administrative controls"
        >
          {QUICK_ACTIONS.map(
            (action) => (
              <QuickAction
                key={
                  action.id
                }
                action={
                  action
                }
              />
            )
          )}
        </nav>
      </section>

      {/* ================================================================== */}
      {/* Recent Activity */}
      {/* ================================================================== */}

      <section
        className="admin-panel"
        aria-labelledby="recent-activity-title"
      >
        <div className="admin-panel-header">
          <div className="panel-title">
            <span
              className="panel-title-icon"
              aria-hidden="true"
            >
              <Activity
                size={18}
              />
            </span>

            <div>
              <h2 id="recent-activity-title">
                Recent Activity
              </h2>

              <p>
                Latest administrative
                and platform events.
              </p>
            </div>
          </div>

          <span
            className="activity-count"
            aria-label={`${activityCount} recent events`}
          >
            {formatInteger(
              activityCount
            )}{" "}
            events
          </span>
        </div>

        {activityError ? (
          <div className="empty-state" role="status">
            <AlertTriangle size={24} aria-hidden="true" />
            <strong>Activity unavailable</strong>
            <span>{activityError}</span>
          </div>
        ) : recentEvents.length === 0 ? (
          <div className="empty-state" role="status">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>No recent activity</strong>
            <span>There are no audit events available for this view.</span>
          </div>
        ) : (
          <div className="activity-list">
            {recentEvents.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* Operational Footer */}
      {/* ================================================================== */}

      <footer className="admin-dashboard-footer">
        <div>
          <CheckCircle2
            size={16}
            aria-hidden="true"
          />

          <span>
            TITech administration
            controls are protected
            by role-based access
            control.
          </span>
        </div>

        <span>
          Auto-refresh:{" "}
          {DASHBOARD_REFRESH_INTERVAL /
            1000}
          s
        </span>
      </footer>
    </main>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export default memo(
  AdminDashboard
);