// ============================================================================
// TITech Community Capital
// Enterprise Dashboard
// File: frontend/src/pages/Dashboard.jsx
// Production Grade
//
// Responsibilities:
// - Authenticated community dashboard
// - Group overview
// - Savings/member/loan KPIs
// - Admin analytics
// - Notification monitoring
// - Automatic refresh
// - Defensive API response handling
// - Abortable requests
// - Accessible responsive UI
// - Graceful loading/error/empty states
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LogOut,
  Menu,
  PiggyBank,
  RefreshCw,
  Users,
  Wallet,
  X,
} from "lucide-react";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toast } from "react-toastify";

import api from "../services/api";
import { useAuth } from "../context/AuthContext";

import "./Dashboard.css";

// ============================================================================
// Constants
// ============================================================================

const AUTO_REFRESH_INTERVAL = 60_000;
const MAX_RETRIES = 3;

const DEFAULT_FRAUD_DATA = [
  {
    name: "Clean",
    value: 100,
  },
  {
    name: "Flagged",
    value: 0,
  },
];

const DEFAULT_STATS = {
  savings: 0,
  loans: [],
  fraud: DEFAULT_FRAUD_DATA,
  members: 0,
  activeLoans: 0,
  totalDisbursed: 0,
};

const FRAUD_COLORS = ["#10b981", "#ef4444"];

// ============================================================================
// Utility Helpers
// ============================================================================

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED" ||
    error?.code === "ECONNABORTED" ||
    error?.message?.toLowerCase?.().includes("canceled")
  );
}

function getErrorMessage(error, fallback = "Something went wrong.") {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
}

function normalizeArrayResponse(response, keys = []) {
  const payload = response?.data ?? response ?? null;

  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    if (Array.isArray(payload.data)) {
      return payload.data;
    }

    if (Array.isArray(payload.results)) {
      return payload.results;
    }

    if (Array.isArray(payload.items)) {
      return payload.items;
    }
  }

  return [];
}

function normalizeStatsResponse(response) {
  const payload = response?.data ?? response ?? {};

  if (!payload || typeof payload !== "object") {
    return DEFAULT_STATS;
  }

  return {
    ...DEFAULT_STATS,
    ...payload,
    loans: Array.isArray(payload.loans)
      ? payload.loans
      : DEFAULT_STATS.loans,
    fraud: Array.isArray(payload.fraud)
      ? payload.fraud
      : DEFAULT_STATS.fraud,
  };
}

function getEntityId(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return entity._id ?? entity.id ?? entity.groupId ?? null;
}

function getUserDisplayName(user) {
  if (!user) {
    return "Member";
  }

  return (
    user.name ||
    user.fullName ||
    user.displayName ||
    user.firstName ||
    user.email ||
    "Member"
  );
}

function getGroupMemberCount(group) {
  if (!group || typeof group !== "object") {
    return 0;
  }

  if (Number.isFinite(Number(group.memberCount))) {
    return Number(group.memberCount);
  }

  if (Array.isArray(group.members)) {
    return group.members.length;
  }

  return 0;
}

// ============================================================================
// Skeleton
// ============================================================================

function GroupCardSkeleton() {
  return (
    <div
      className="group-card-skeleton"
      aria-hidden="true"
    >
      <div className="skeleton-title" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <main
      className="dashboard-loading"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="dashboard-loading-header">
        <div className="skeleton-title" />
        <div className="skeleton-line" />
      </div>

      <div className="stats-grid">
        <GroupCardSkeleton />
        <GroupCardSkeleton />
        <GroupCardSkeleton />
        <GroupCardSkeleton />
      </div>

      <div className="groups-grid">
        <GroupCardSkeleton />
        <GroupCardSkeleton />
        <GroupCardSkeleton />
      </div>
    </main>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyGroupsState({ onCreateGroup }) {
  return (
    <div className="dashboard-empty-state">
      <Users
        size={40}
        aria-hidden="true"
      />

      <h3>No community groups yet</h3>

      <p>
        You are not currently viewing any community groups.
        Create a group to start managing members, contributions,
        savings, and community activities.
      </p>

      {typeof onCreateGroup === "function" && (
        <button
          type="button"
          className="btn-primary"
          onClick={onCreateGroup}
        >
          Create Group
          <ChevronRight
            size={18}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// KPI Card
// ============================================================================

function StatCard({
  icon: Icon,
  title,
  value,
  description,
}) {
  return (
    <article className="stat-card">
      <div
        className="stat-card-icon"
        aria-hidden="true"
      >
        <Icon size={26} />
      </div>

      <div className="stat-card-content">
        <h3>{title}</h3>

        <p className="stat-card-value">
          {value}
        </p>

        {description && (
          <span className="stat-card-description">
            {description}
          </span>
        )}
      </div>
    </article>
  );
}

// ============================================================================
// Admin Analytics
// ============================================================================

function AdminDashboard({ stats }) {
  const loanData = useMemo(() => {
    if (!Array.isArray(stats?.loans)) {
      return [];
    }

    return stats.loans
      .map((loan) => ({
        status:
          loan?.status ||
          loan?.name ||
          "Unknown",
        count: Number(
          loan?.count ??
            loan?.value ??
            0
        ),
      }))
      .filter(
        (loan) =>
          loan.count >= 0
      );
  }, [stats?.loans]);

  const fraudData = useMemo(() => {
    if (
      !Array.isArray(stats?.fraud) ||
      stats.fraud.length === 0
    ) {
      return DEFAULT_FRAUD_DATA;
    }

    return stats.fraud
      .map((entry) => ({
        name:
          entry?.name ||
          "Unknown",
        value: Number(
          entry?.value ?? 0
        ),
      }))
      .filter(
        (entry) =>
          Number.isFinite(
            entry.value
          ) &&
          entry.value >= 0
      );
  }, [stats?.fraud]);

  return (
    <section
      className="admin-dashboard"
      aria-labelledby="admin-analytics-heading"
    >
      <div className="section-heading">
        <div>
          <span className="section-eyebrow">
            TITech Administration
          </span>

          <h2 id="admin-analytics-heading">
            Administration Analytics
          </h2>
        </div>
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <div className="chart-card-header">
            <div>
              <h3>Loan Distribution</h3>

              <p>
                Current loan portfolio status.
              </p>
            </div>
          </div>

          {loanData.length === 0 ? (
            <div className="chart-empty-state">
              <CreditCard
                size={32}
                aria-hidden="true"
              />

              <span>
                No loan analytics available.
              </span>
            </div>
          ) : (
            <div
              className="chart-container"
              role="img"
              aria-label="Loan distribution chart"
            >
              <ResponsiveContainer
                width="100%"
                height={320}
              >
                <BarChart
                  data={loanData}
                  margin={{
                    top: 16,
                    right: 16,
                    left: 0,
                    bottom: 16,
                  }}
                >
                  <XAxis
                    dataKey="status"
                    tickLine={false}
                    axisLine={false}
                  />

                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                  />

                  <Tooltip />

                  <Bar
                    dataKey="count"
                    name="Loans"
                    radius={[
                      4,
                      4,
                      0,
                      0,
                    ]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="chart-card">
          <div className="chart-card-header">
            <div>
              <h3>Fraud Monitoring</h3>

              <p>
                Current transaction monitoring summary.
              </p>
            </div>
          </div>

          <div
            className="chart-container"
            role="img"
            aria-label="Fraud monitoring chart"
          >
            <ResponsiveContainer
              width="100%"
              height={320}
            >
              <PieChart>
                <Pie
                  data={fraudData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={55}
                  paddingAngle={2}
                >
                  {fraudData.map(
                    (entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
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
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </section>
  );
}

// ============================================================================
// Group Card
// ============================================================================

function GroupCard({
  group,
  formatCurrency,
  formatDate,
  onOpen,
}) {
  const groupId =
    getEntityId(group);

  const memberCount =
    getGroupMemberCount(group);

  const contribution =
    Number(
      group?.totalContributions ??
        group?.contributions ??
        group?.totalSavings ??
        0
    );

  return (
    <article
      className="group-card"
      tabIndex={groupId ? 0 : -1}
      role={groupId ? "button" : undefined}
      aria-label={
        groupId
          ? `Open ${group?.name || "community group"}`
          : undefined
      }
      onClick={() => {
        if (groupId) {
          onOpen(groupId);
        }
      }}
      onKeyDown={(event) => {
        if (
          groupId &&
          (event.key === "Enter" ||
            event.key === " ")
        ) {
          event.preventDefault();
          onOpen(groupId);
        }
      }}
    >
      <div className="group-card-header">
        <div>
          <h3>
            {group?.name ||
              "Unnamed Group"}
          </h3>

          {group?.type && (
            <span className="group-type">
              {String(group.type)}
            </span>
          )}
        </div>

        {groupId && (
          <ChevronRight
            size={20}
            aria-hidden="true"
          />
        )}
      </div>

      <p className="group-description">
        {group?.description ||
          "No group description available."}
      </p>

      <div className="group-card-metrics">
        <div>
          <span>Members</span>

          <strong>
            {memberCount}
          </strong>
        </div>

        <div>
          <span>Contributions</span>

          <strong>
            {formatCurrency(
              contribution
            )}
          </strong>
        </div>
      </div>

      <div className="group-card-footer">
        <span>
          Next contribution
        </span>

        <strong>
          {formatDate(
            group?.nextContributionDate
          )}
        </strong>
      </div>
    </article>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================

export default function Dashboard() {
  const navigate =
    useNavigate();

  const {
    user,
    logout,
  } = useAuth();

  const mountedRef =
    useRef(false);

  const requestControllerRef =
    useRef(null);

  const refreshTimerRef =
    useRef(null);

  const refreshInFlightRef =
    useRef(false);

  const notificationCleanupRef =
    useRef(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    groups,
    setGroups,
  ] = useState([]);

  const [
    stats,
    setStats,
  ] = useState(
    DEFAULT_STATS
  );

  const [
    error,
    setError,
  ] = useState("");

  const [
    retryCount,
    setRetryCount,
  ] = useState(0);

  const [
    menuOpen,
    setMenuOpen,
  ] = useState(false);

  const [
    notifCount,
    setNotifCount,
  ] = useState(0);

  // ==========================================================================
  // Role
  // ==========================================================================

  const isAdmin = useMemo(() => {
    const role = String(
      user?.role || ""
    ).toLowerCase();

    return [
      "admin",
      "super_admin",
    ].includes(role);
  }, [user?.role]);

  // ==========================================================================
  // Formatters
  // ==========================================================================

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(
        "en-UG",
        {
          style: "currency",
          currency: "UGX",
          maximumFractionDigits: 0,
        }
      ),
    []
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(
        "en-UG",
        {
          year: "numeric",
          month: "short",
          day: "numeric",
        }
      ),
    []
  );

  const formatCurrency =
    useCallback(
      (value) => {
        const numericValue =
          Number(value);

        if (
          !Number.isFinite(
            numericValue
          )
        ) {
          return currencyFormatter.format(
            0
          );
        }

        return currencyFormatter.format(
          numericValue
        );
      },
      [currencyFormatter]
    );

  const formatDate =
    useCallback(
      (date) => {
        if (!date) {
          return "Not scheduled";
        }

        const parsedDate =
          new Date(date);

        if (
          Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          return "Not scheduled";
        }

        return dateFormatter.format(
          parsedDate
        );
      },
      [dateFormatter]
    );

  // ==========================================================================
  // API Calls
  // ==========================================================================

  const fetchGroups =
    useCallback(
      async (signal) => {
        const response =
          await api.get(
            "/api/groups",
            {
              signal,
            }
          );

        return normalizeArrayResponse(
          response,
          [
            "groups",
            "communityGroups",
          ]
        );
      },
      []
    );

  const fetchStats =
    useCallback(
      async (signal) => {
        if (!isAdmin) {
          return DEFAULT_STATS;
        }

        const response =
          await api.get(
            "/api/admin/stats",
            {
              signal,
            }
          );

        return normalizeStatsResponse(
          response
        );
      },
      [isAdmin]
    );

  // ==========================================================================
  // Dashboard Loader
  // ==========================================================================

  const loadDashboard =
    useCallback(
      async ({
        silent = false,
        isRetry = false,
      } = {}) => {
        if (!mountedRef.current) {
          return;
        }

        if (
          refreshInFlightRef.current
        ) {
          return;
        }

        refreshInFlightRef.current =
          true;

        if (!silent) {
          setLoading(true);
        }

        if (silent) {
          setRefreshing(true);
        }

        setError("");

        // Cancel previous dashboard request.
        if (
          requestControllerRef.current
        ) {
          requestControllerRef.current.abort();
        }

        const controller =
          new AbortController();

        requestControllerRef.current =
          controller;

        try {
          const [
            groupsResult,
            statsResult,
          ] = await Promise.all([
            fetchGroups(
              controller.signal
            ),
            fetchStats(
              controller.signal
            ),
          ]);

          if (
            !mountedRef.current ||
            controller.signal.aborted
          ) {
            return;
          }

          setGroups(
            Array.isArray(
              groupsResult
            )
              ? groupsResult
              : []
          );

          setStats(
            statsResult ||
              DEFAULT_STATS
          );

          setRetryCount(0);
        } catch (err) {
          if (
            isAbortError(err) ||
            controller.signal.aborted
          ) {
            return;
          }

          const message =
            getErrorMessage(
              err,
              "Failed to load the TITech Community Capital dashboard."
            );

          if (
            mountedRef.current
          ) {
            setError(message);

            if (
              isRetry
            ) {
              toast.error(
                message
              );
            }
          }
        } finally {
          if (
            mountedRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }

          refreshInFlightRef.current =
            false;
        }
      },
      [
        fetchGroups,
        fetchStats,
      ]
    );

  // ==========================================================================
  // Initial Load + Auto Refresh
  // ==========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    void loadDashboard();

    refreshTimerRef.current =
      window.setInterval(() => {
        void loadDashboard({
          silent: true,
        });
      }, AUTO_REFRESH_INTERVAL);

    return () => {
      mountedRef.current =
        false;

      if (
        refreshTimerRef.current
      ) {
        window.clearInterval(
          refreshTimerRef.current
        );

        refreshTimerRef.current =
          null;
      }

      if (
        requestControllerRef.current
      ) {
        requestControllerRef.current.abort();

        requestControllerRef.current =
          null;
      }

      refreshInFlightRef.current =
        false;
    };
  }, [loadDashboard]);

  // ==========================================================================
  // Socket Notifications
  // ==========================================================================

  useEffect(() => {
    let active = true;

    const initializeNotifications =
      async () => {
        try {
          const module =
            await import(
              "../services/socket"
            );

          if (!active) {
            return;
          }

          const socket =
            module?.default ||
            module?.socket;

          if (
            !socket ||
            typeof socket.on !==
              "function"
          ) {
            return;
          }

          const handleNotification =
            () => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              setNotifCount(
                (previous) =>
                  previous + 1
              );
            };

          socket.on(
            "notification",
            handleNotification
          );

          notificationCleanupRef.current =
            () => {
              try {
                socket.off?.(
                  "notification",
                  handleNotification
                );
              } catch {
                // Socket cleanup should never break dashboard unmounting.
              }
            };
        } catch {
          // Notifications are optional. Dashboard functionality must continue.
        }
      };

    void initializeNotifications();

    return () => {
      active = false;

      notificationCleanupRef.current?.();

      notificationCleanupRef.current =
        null;
    };
  }, []);

  // ==========================================================================
  // Menu
  // ==========================================================================

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handleEscape =
      (event) => {
        if (
          event.key ===
          "Escape"
        ) {
          setMenuOpen(false);
        }
      };

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [menuOpen]);

  // ==========================================================================
  // Logout
  // ==========================================================================

  const handleLogout =
    useCallback(
      async () => {
        try {
          setMenuOpen(false);

          await logout();

          if (
            mountedRef.current
          ) {
            navigate(
              "/login",
              {
                replace: true,
              }
            );
          }
        } catch (err) {
          if (
            !isAbortError(err)
          ) {
            toast.error(
              getErrorMessage(
                err,
                "Logout failed. Please try again."
              )
            );
          }
        }
      },
      [
        logout,
        navigate,
      ]
    );

  // ==========================================================================
  // Retry
  // ==========================================================================

  const handleRetry =
    useCallback(
      async () => {
        if (
          retryCount >=
          MAX_RETRIES
        ) {
          toast.error(
            "Maximum retry attempts reached. Please refresh the page or try again later."
          );

          return;
        }

        setRetryCount(
          (previous) =>
            previous + 1
        );

        await loadDashboard({
          isRetry: true,
        });
      },
      [
        retryCount,
        loadDashboard,
      ]
    );

  // ==========================================================================
  // Manual Refresh
  // ==========================================================================

  const handleRefresh =
    useCallback(
      async () => {
        await loadDashboard({
          silent: true,
        });

        if (
          mountedRef.current &&
          !error
        ) {
          toast.success(
            "Dashboard refreshed."
          );
        }
      },
      [
        loadDashboard,
        error,
      ]
    );

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const handleOpenGroup =
    useCallback(
      (groupId) => {
        if (!groupId) {
          toast.error(
            "Unable to open this group."
          );

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

  const handleCreateGroup =
    useCallback(() => {
      navigate(
        "/groups/create"
      );
    }, [navigate]);

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const displayName =
    useMemo(
      () =>
        getUserDisplayName(
          user
        ),
      [user]
    );

  const groupCount =
    groups.length;

  const memberCount =
    Number(
      stats?.members ?? 0
    );

  const activeLoans =
    Number(
      stats?.activeLoans ?? 0
    );

  // ==========================================================================
  // Authentication State
  // ==========================================================================

  if (!user) {
    return (
      <main className="dashboard-error">
        <AlertCircle
          size={48}
          aria-hidden="true"
        />

        <h1>
          Authentication Required
        </h1>

        <p>
          Your session is no longer
          available. Please sign in again
          to continue using TITech
          Community Capital.
        </p>

        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            navigate(
              "/login",
              {
                replace: true,
              }
            )
          }
        >
          Go to Login
        </button>
      </main>
    );
  }

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (loading) {
    return (
      <DashboardLoadingState />
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main className="dashboard-container">
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <header className="dashboard-header">
        <div className="dashboard-header-content">
          <div>
            <span className="dashboard-eyebrow">
              TITech Community Capital
            </span>

            <h1>
              Welcome,{" "}
              {displayName}
            </h1>

            <p>
              Manage your community groups,
              savings, members, and financial
              activity.
            </p>
          </div>

          <div className="dashboard-actions">
            <button
              type="button"
              className="dashboard-icon-button"
              onClick={
                handleRefresh
              }
              disabled={
                refreshing
              }
              aria-label={
                refreshing
                  ? "Refreshing dashboard"
                  : "Refresh dashboard"
              }
              title="Refresh dashboard"
            >
              <RefreshCw
                size={20}
                className={
                  refreshing
                    ? "spin"
                    : ""
                }
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              className="dashboard-icon-button notification-button"
              onClick={() =>
                setNotifCount(
                  0
                )
              }
              aria-label={
                notifCount > 0
                  ? `${notifCount} unread notifications`
                  : "Notifications"
              }
              title="Notifications"
            >
              <Bell
                size={20}
                aria-hidden="true"
              />

              {notifCount > 0 && (
                <span
                  className="notification-badge"
                  aria-hidden="true"
                >
                  {notifCount >
                  99
                    ? "99+"
                    : notifCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className="dashboard-icon-button"
              onClick={() =>
                setMenuOpen(
                  (previous) =>
                    !previous
                )
              }
              aria-expanded={
                menuOpen
              }
              aria-controls="dashboard-navigation-menu"
              aria-label={
                menuOpen
                  ? "Close dashboard menu"
                  : "Open dashboard menu"
              }
            >
              {menuOpen ? (
                <X
                  aria-hidden="true"
                />
              ) : (
                <Menu
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="dashboard-navigation-menu"
            className="dashboard-menu"
            aria-label="Dashboard navigation"
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                navigate(
                  "/dashboard"
                );
              }}
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                navigate(
                  "/groups"
                );
              }}
            >
              Community Groups
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                navigate(
                  "/groups/create"
                );
              }}
            >
              Create Group
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate(
                    "/admin"
                  );
                }}
              >
                Administration
              </button>
            )}

            <button
              type="button"
              className="dashboard-menu-danger"
              onClick={
                handleLogout
              }
            >
              <LogOut
                size={18}
                aria-hidden="true"
              />
              Sign Out
            </button>
          </nav>
        )}
      </header>

      {/* ================================================================== */}
      {/* Error Banner */}
      {/* ================================================================== */}

      {error && (
        <section
          className="error-box"
          role="alert"
          aria-live="assertive"
        >
          <div className="error-box-icon">
            <AlertCircle
              size={22}
              aria-hidden="true"
            />
          </div>

          <div className="error-box-content">
            <strong>
              Dashboard data could not
              be fully loaded
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            onClick={
              handleRetry
            }
            disabled={
              retryCount >=
              MAX_RETRIES ||
              refreshing
            }
            className="error-retry-button"
          >
            <RefreshCw
              size={17}
              aria-hidden="true"
            />

            Retry
          </button>
        </section>
      )}

      {/* ================================================================== */}
      {/* KPI Cards */}
      {/* ================================================================== */}

      <section
        className="stats-grid"
        aria-labelledby="dashboard-overview-heading"
      >
        <h2
          id="dashboard-overview-heading"
          className="sr-only"
        >
          Dashboard Overview
        </h2>

        <StatCard
          icon={PiggyBank}
          title="Total Savings"
          value={formatCurrency(
            stats?.savings
          )}
          description="Community savings balance"
        />

        <StatCard
          icon={Wallet}
          title="Groups"
          value={groupCount}
          description="Accessible community groups"
        />

        <StatCard
          icon={Users}
          title="Members"
          value={memberCount}
          description="Registered community members"
        />

        <StatCard
          icon={CreditCard}
          title="Active Loans"
          value={activeLoans}
          description="Currently active loans"
        />
      </section>

      {/* ================================================================== */}
      {/* Admin Analytics */}
      {/* ================================================================== */}

      {isAdmin && (
        <AdminDashboard
          stats={stats}
        />
      )}

      {/* ================================================================== */}
      {/* Community Groups */}
      {/* ================================================================== */}

      <section
        className="groups-section"
        aria-labelledby="community-groups-heading"
      >
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">
              Community
            </span>

            <h2 id="community-groups-heading">
              Community Groups
            </h2>

            <p>
              Groups you can currently access
              through TITech Community Capital.
            </p>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={
              handleCreateGroup
            }
          >
            Create Group
            <ChevronRight
              size={18}
              aria-hidden="true"
            />
          </button>
        </div>

        {groups.length === 0 ? (
          <EmptyGroupsState
            onCreateGroup={
              handleCreateGroup
            }
          />
        ) : (
          <div className="groups-grid">
            {groups.map(
              (group, index) => {
                const groupId =
                  getEntityId(
                    group
                  );

                return (
                  <GroupCard
                    key={
                      groupId ||
                      `group-${index}`
                    }
                    group={
                      group
                    }
                    formatCurrency={
                      formatCurrency
                    }
                    formatDate={
                      formatDate
                    }
                    onOpen={
                      handleOpenGroup
                    }
                  />
                );
              }
            )}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* Dashboard Footer */}
      {/* ================================================================== */}

      <footer className="dashboard-footer">
        <div className="dashboard-footer-status">
          <CheckCircle2
            size={17}
            aria-hidden="true"
          />

          <span>
            TITech Community Capital
            services operational
          </span>
        </div>

        <span>
          Dashboard refreshes automatically
          every 60 seconds.
        </span>
      </footer>

      {/* ================================================================== */}
      {/* Persistent Logout */}
      {/* ================================================================== */}

      <button
        type="button"
        className="logout-btn"
        onClick={
          handleLogout
        }
        aria-label="Sign out of TITech Community Capital"
      >
        <LogOut
          size={18}
          aria-hidden="true"
        />

        Logout
      </button>
    </main>
  );
}