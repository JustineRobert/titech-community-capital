// ============================================================================
// TITech Community Capital
// Enterprise Dashboard Widgets
// File: frontend/src/pages/dashboard/DashboardWidgets.jsx
//
// Production Grade
// Multi-Tenant | Realtime | Feature Flags | RBAC | Executive Analytics
// Defensive Rendering | Accessibility | Operational Resilience
// ============================================================================

import React, {
  memo,
  useCallback,
  useMemo,
} from "react";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Calendar,
  CreditCard,
  DollarSign,
  FileText,
  PiggyBank,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import {
  Card,
  FeatureGate,
  PermissionGate,
  StatusBadge,
  Button,
} from "../../ui";

import "./DashboardWidgets.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 5;

const DEFAULT_SYSTEM_HEALTH = {
  api: "healthy",
  database: "healthy",
  queue: "healthy",
  mobileMoney: "healthy",
};

const DEFAULT_EXECUTIVE = {
  portfolioValue: 0,
  revenue: 0,
  recoveryRate: 0,
};

const DEFAULT_MOBILE_MONEY = {
  deposits: 0,
  withdrawals: 0,
  transactions: 0,
};

const DEFAULT_FRAUD = {
  flagged: 0,
  review: 0,
  riskScore: 0,
};

const DEFAULT_REGULATORY = {
  pending: 0,
  submitted: 0,
  dueSoon: 0,
};

// ============================================================================
// Helpers
// ============================================================================

const toSafeArray = (
  value
) =>
  Array.isArray(value)
    ? value
    : [];

const toSafeNumber = (
  value,
  fallback = 0
) => {
  const numericValue =
    Number(value);

  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : fallback;
};

const clampPercentage = (
  value
) =>
  Math.min(
    100,
    Math.max(
      0,
      toSafeNumber(value)
    )
  );

const formatCurrency = (
  amount = 0
) =>
  new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  ).format(
    toSafeNumber(amount)
  );

const formatPercentage = (
  value = 0
) =>
  `${toSafeNumber(value).toFixed(
    1
  )}%`;

const formatDate = (
  value
) => {
  if (!value) {
    return "N/A";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat(
    "en-UG",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(date);
};

const getItemKey = (
  item,
  index,
  prefix
) => {
  if (
    item &&
    typeof item === "object"
  ) {
    const candidate =
      item.id ??
      item._id ??
      item.uuid ??
      item.key;

    if (
      candidate !==
        undefined &&
      candidate !== null &&
      String(candidate)
        .trim()
        .length > 0
    ) {
      return `${prefix}-${candidate}`;
    }
  }

  return `${prefix}-${index}`;
};

// ============================================================================
// Widget Card
// ============================================================================

function WidgetCard({
  title,
  icon: Icon,
  children,
  actions = null,
  className = "",
  ariaLabel,
}) {
  return (
    <Card
      className={`dashboard-widget-card ${className}`.trim()}
    >
      <div className="dashboard-widget-header">
        <div className="dashboard-widget-title">
          {Icon && (
            <Icon
              size={20}
              aria-hidden="true"
              focusable="false"
            />
          )}

          <h3>{title}</h3>
        </div>

        {actions && (
          <div className="dashboard-widget-header-actions">
            {actions}
          </div>
        )}
      </div>

      <div
        className="dashboard-widget-body"
        aria-label={
          ariaLabel || title
        }
      >
        {children}
      </div>
    </Card>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function WidgetEmptyState({
  children,
}) {
  return (
    <p className="dashboard-widget-empty">
      {children}
    </p>
  );
}

// ============================================================================
// Metric Row
// ============================================================================

function WidgetMetric({
  label,
  value,
}) {
  return (
    <div className="dashboard-widget-metric">
      <span>{label}</span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

// ============================================================================
// Dashboard Widgets
// ============================================================================

function DashboardWidgets({
  metrics: _metrics = {},
  notifications = [],
  activities = [],
  upcomingEvents = [],
  systemHealth = {},
  executive = {},
  mobileMoney = {},
  fraud = {},
  regulatory = {},

  onViewAllNotifications,
  onViewAllActivities,
  onExportReports,

  onAddMember,
  onOpenSavings,
  onCreateLoan,
  onOpenTransactions,
  onOpenGroups,

  maxItems = DEFAULT_LIMIT,
}) {
  // ==========================================================================
  // Defensive Normalization
  // ==========================================================================

  const safeNotifications =
    useMemo(
      () =>
        toSafeArray(
          notifications
        ),
      [notifications]
    );

  const safeActivities =
    useMemo(
      () =>
        toSafeArray(
          activities
        ),
      [activities]
    );

  const safeUpcomingEvents =
    useMemo(
      () =>
        toSafeArray(
          upcomingEvents
        ),
      [upcomingEvents]
    );

  const recentNotifications =
    useMemo(
      () =>
        safeNotifications.slice(
          0,
          Math.max(
            1,
            toSafeNumber(
              maxItems,
              DEFAULT_LIMIT
            )
          )
        ),
      [
        safeNotifications,
        maxItems,
      ]
    );

  const recentActivities =
    useMemo(
      () =>
        safeActivities.slice(
          0,
          Math.max(
            1,
            toSafeNumber(
              maxItems,
              DEFAULT_LIMIT
            )
          )
        ),
      [
        safeActivities,
        maxItems,
      ]
    );

  const recentEvents =
    useMemo(
      () =>
        safeUpcomingEvents.slice(
          0,
          Math.max(
            1,
            toSafeNumber(
              maxItems,
              DEFAULT_LIMIT
            )
          )
        ),
      [
        safeUpcomingEvents,
        maxItems,
      ]
    );

  // ==========================================================================
  // Normalized Metrics
  // ==========================================================================

  const executiveMetrics =
    useMemo(
      () => ({
        ...DEFAULT_EXECUTIVE,
        ...(executive &&
        typeof executive ===
          "object"
          ? executive
          : {}),
      }),
      [executive]
    );

  const mobileMoneyMetrics =
    useMemo(
      () => ({
        ...DEFAULT_MOBILE_MONEY,
        ...(mobileMoney &&
        typeof mobileMoney ===
          "object"
          ? mobileMoney
          : {}),
      }),
      [mobileMoney]
    );

  const fraudMetrics =
    useMemo(
      () => ({
        ...DEFAULT_FRAUD,
        ...(fraud &&
        typeof fraud ===
          "object"
          ? fraud
          : {}),
      }),
      [fraud]
    );

  const regulatoryMetrics =
    useMemo(
      () => ({
        ...DEFAULT_REGULATORY,
        ...(regulatory &&
        typeof regulatory ===
          "object"
          ? regulatory
          : {}),
      }),
      [regulatory]
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

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleViewAllNotifications =
    useCallback(() => {
      onViewAllNotifications?.();
    }, [
      onViewAllNotifications,
    ]);

  const handleViewAllActivities =
    useCallback(() => {
      onViewAllActivities?.();
    }, [
      onViewAllActivities,
    ]);

  const handleExportReports =
    useCallback(() => {
      onExportReports?.();
    }, [
      onExportReports,
    ]);

  const handleAddMember =
    useCallback(() => {
      onAddMember?.();
    }, [onAddMember]);

  const handleOpenSavings =
    useCallback(() => {
      onOpenSavings?.();
    }, [onOpenSavings]);

  const handleCreateLoan =
    useCallback(() => {
      onCreateLoan?.();
    }, [onCreateLoan]);

  const handleOpenTransactions =
    useCallback(() => {
      onOpenTransactions?.();
    }, [
      onOpenTransactions,
    ]);

  const handleOpenGroups =
    useCallback(() => {
      onOpenGroups?.();
    }, [onOpenGroups]);

  // ==========================================================================
  // Action Availability
  // ==========================================================================

  const hasNotificationAction =
    typeof onViewAllNotifications ===
    "function";

  const hasActivityAction =
    typeof onViewAllActivities ===
    "function";

  const hasExportAction =
    typeof onExportReports ===
    "function";

  const hasAddMemberAction =
    typeof onAddMember ===
    "function";

  const hasSavingsAction =
    typeof onOpenSavings ===
    "function";

  const hasLoanAction =
    typeof onCreateLoan ===
    "function";

  const hasTransactionAction =
    typeof onOpenTransactions ===
    "function";

  const hasGroupsAction =
    typeof onOpenGroups ===
    "function";

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div
      className="dashboard-widgets-grid"
      aria-label="Dashboard widgets"
    >
      {/* ================================================================== */}
      {/* Notifications */}
      {/* ================================================================== */}

      <WidgetCard
        title="Notifications"
        icon={Activity}
        actions={
          hasNotificationAction ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={
                handleViewAllNotifications
              }
              aria-label="View all notifications"
            >
              View All
            </Button>
          ) : null
        }
      >
        {recentNotifications.length ===
        0 ? (
          <WidgetEmptyState>
            No notifications.
          </WidgetEmptyState>
        ) : (
          <ul
            className="dashboard-widget-list"
            aria-label="Recent notifications"
          >
            {recentNotifications.map(
              (
                notification,
                index
              ) => (
                <li
                  key={getItemKey(
                    notification,
                    index,
                    "notification"
                  )}
                >
                  <p>
                    {notification?.title ||
                      notification?.message ||
                      "Notification"}
                  </p>

                  <small>
                    {formatDate(
                      notification?.createdAt ??
                        notification?.date
                    )}
                  </small>
                </li>
              )
            )}
          </ul>
        )}
      </WidgetCard>

      {/* ================================================================== */}
      {/* Activity Feed */}
      {/* ================================================================== */}

      <WidgetCard
        title="Recent Activity"
        icon={TrendingUp}
        actions={
          hasActivityAction ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={
                handleViewAllActivities
              }
              aria-label="View all recent activity"
            >
              View All
            </Button>
          ) : null
        }
      >
        {recentActivities.length ===
        0 ? (
          <WidgetEmptyState>
            No recent activity.
          </WidgetEmptyState>
        ) : (
          <ul
            className="dashboard-widget-list"
            aria-label="Recent activity"
          >
            {recentActivities.map(
              (
                item,
                index
              ) => (
                <li
                  key={getItemKey(
                    item,
                    index,
                    "activity"
                  )}
                >
                  <p>
                    {item?.message ||
                      item?.title ||
                      "Activity recorded"}
                  </p>

                  <small>
                    {formatDate(
                      item?.createdAt ??
                        item?.date
                    )}
                  </small>
                </li>
              )
            )}
          </ul>
        )}
      </WidgetCard>

      {/* ================================================================== */}
      {/* Upcoming Events */}
      {/* ================================================================== */}

      <WidgetCard
        title="Upcoming Events"
        icon={Calendar}
      >
        {recentEvents.length ===
        0 ? (
          <WidgetEmptyState>
            No upcoming events.
          </WidgetEmptyState>
        ) : (
          <ul
            className="dashboard-widget-list"
            aria-label="Upcoming events"
          >
            {recentEvents.map(
              (
                event,
                index
              ) => (
                <li
                  key={getItemKey(
                    event,
                    index,
                    "event"
                  )}
                >
                  <strong>
                    {event?.title ||
                      event?.name ||
                      "Upcoming event"}
                  </strong>

                  <small>
                    {formatDate(
                      event?.date ??
                        event?.startDate ??
                        event?.scheduledAt
                    )}
                  </small>
                </li>
              )
            )}
          </ul>
        )}
      </WidgetCard>

      {/* ================================================================== */}
      {/* Executive Dashboard */}
      {/* ================================================================== */}

      <FeatureGate features="executive_dashboard">
        <WidgetCard
          title="Executive Overview"
          icon={DollarSign}
        >
          <div
            className="dashboard-widget-metrics"
            aria-label="Executive financial metrics"
          >
            <WidgetMetric
              label="Portfolio"
              value={formatCurrency(
                executiveMetrics.portfolioValue
              )}
            />

            <WidgetMetric
              label="Revenue"
              value={formatCurrency(
                executiveMetrics.revenue
              )}
            />

            <WidgetMetric
              label="Recovery"
              value={`${clampPercentage(
                executiveMetrics.recoveryRate
              )}%`}
            />
          </div>
        </WidgetCard>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Mobile Money */}
      {/* ================================================================== */}

      <FeatureGate features="mobile_money">
        <WidgetCard
          title="Mobile Money"
          icon={Smartphone}
        >
          <div
            className="dashboard-widget-metrics"
            aria-label="Mobile money metrics"
          >
            <WidgetMetric
              label="Deposits"
              value={formatCurrency(
                mobileMoneyMetrics.deposits
              )}
            />

            <WidgetMetric
              label="Withdrawals"
              value={formatCurrency(
                mobileMoneyMetrics.withdrawals
              )}
            />

            <WidgetMetric
              label="Transactions"
              value={toSafeNumber(
                mobileMoneyMetrics.transactions
              ).toLocaleString(
                "en-UG"
              )}
            />
          </div>
        </WidgetCard>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Fraud Monitoring */}
      {/* ================================================================== */}

      <FeatureGate features="fraud_detection">
        <WidgetCard
          title="Fraud Monitoring"
          icon={AlertTriangle}
          className="warning"
        >
          <div
            className="dashboard-widget-metrics"
            aria-label="Fraud monitoring metrics"
          >
            <WidgetMetric
              label="Flagged"
              value={toSafeNumber(
                fraudMetrics.flagged
              ).toLocaleString(
                "en-UG"
              )}
            />

            <WidgetMetric
              label="Under Review"
              value={toSafeNumber(
                fraudMetrics.review
              ).toLocaleString(
                "en-UG"
              )}
            />

            <WidgetMetric
              label="Risk Score"
              value={`${clampPercentage(
                fraudMetrics.riskScore
              )}%`}
            />
          </div>
        </WidgetCard>
      </FeatureGate>

      {/* ================================================================== */}
      {/* Regulatory Reporting */}
      {/* ================================================================== */}

      <FeatureGate features="regulatory_reporting">
        <WidgetCard
          title="Regulatory Reports"
          icon={FileText}
          actions={
            hasExportAction ? (
              <Button
                type="button"
                size="sm"
                onClick={
                  handleExportReports
                }
                aria-label="Export regulatory reports"
              >
                Export
              </Button>
            ) : null
          }
        >
          <div
            className="dashboard-widget-metrics"
            aria-label="Regulatory reporting metrics"
          >
            <WidgetMetric
              label="Pending"
              value={toSafeNumber(
                regulatoryMetrics.pending
              ).toLocaleString(
                "en-UG"
              )}
            />

            <WidgetMetric
              label="Submitted"
              value={toSafeNumber(
                regulatoryMetrics.submitted
              ).toLocaleString(
                "en-UG"
              )}
            />

            <WidgetMetric
              label="Due Soon"
              value={toSafeNumber(
                regulatoryMetrics.dueSoon
              ).toLocaleString(
                "en-UG"
              )}
            />
          </div>
        </WidgetCard>
      </FeatureGate>

      {/* ================================================================== */}
      {/* System Health */}
      {/* ================================================================== */}

      <PermissionGate permissions="view_system_health">
        <WidgetCard
          title="System Health"
          icon={Activity}
        >
          <div
            className="dashboard-widget-health"
            aria-label="System health status"
            aria-live="polite"
          >
            <div>
              <span>API</span>

              <StatusBadge
                status={health.api}
              />
            </div>

            <div>
              <span>
                Database
              </span>

              <StatusBadge
                status={
                  health.database
                }
              />
            </div>

            <div>
              <span>
                Queue
              </span>

              <StatusBadge
                status={
                  health.queue
                }
              />
            </div>

            <div>
              <span>
                Mobile Money
              </span>

              <StatusBadge
                status={
                  health.mobileMoney
                }
              />
            </div>
          </div>
        </WidgetCard>
      </PermissionGate>

      {/* ================================================================== */}
      {/* Quick Actions */}
      {/* ================================================================== */}

      <WidgetCard
        title="Quick Actions"
        icon={ArrowUpRight}
      >
        <div
          className="dashboard-widget-actions"
          aria-label="Dashboard quick actions"
        >
          <Button
            type="button"
            onClick={
              handleAddMember
            }
            disabled={
              !hasAddMemberAction
            }
            title={
              hasAddMemberAction
                ? "Add a new member"
                : "Action unavailable"
            }
          >
            <Users
              size={16}
              aria-hidden="true"
            />
            Add Member
          </Button>

          <Button
            type="button"
            onClick={
              handleOpenSavings
            }
            disabled={
              !hasSavingsAction
            }
            title={
              hasSavingsAction
                ? "Open savings"
                : "Action unavailable"
            }
          >
            <PiggyBank
              size={16}
              aria-hidden="true"
            />
            Savings
          </Button>

          <Button
            type="button"
            onClick={
              handleCreateLoan
            }
            disabled={
              !hasLoanAction
            }
            title={
              hasLoanAction
                ? "Create a new loan"
                : "Action unavailable"
            }
          >
            <CreditCard
              size={16}
              aria-hidden="true"
            />
            New Loan
          </Button>

          <Button
            type="button"
            onClick={
              handleOpenTransactions
            }
            disabled={
              !hasTransactionAction
            }
            title={
              hasTransactionAction
                ? "Open transactions"
                : "Action unavailable"
            }
          >
            <Wallet
              size={16}
              aria-hidden="true"
            />
            Transactions
          </Button>

          <Button
            type="button"
            onClick={
              handleOpenGroups
            }
            disabled={
              !hasGroupsAction
            }
            title={
              hasGroupsAction
                ? "Open groups"
                : "Action unavailable"
            }
          >
            <Building2
              size={16}
              aria-hidden="true"
            />
            Groups
          </Button>
        </div>
      </WidgetCard>
    </div>
  );
}

// ============================================================================
// Export
// ============================================================================

export default memo(
  DashboardWidgets
);