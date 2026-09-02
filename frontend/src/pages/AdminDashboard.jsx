// ============================================================================
// frontend/src/pages/AdminDashboard.jsx
// TITech Community Capital
// Enterprise Administration Dashboard
//
// Production Grade
// -----------------------------------------------------------------------------
// Responsibilities
// - Enterprise admin dashboard
// - Platform KPI monitoring
// - User activity overview
// - Community group approval workflow
// - Compliance / risk / audit module navigation
// - Authentication-aware access control
// - Defensive API response normalization
// - Safe async lifecycle handling
// - Refresh and loading state management
// - Production-grade error handling
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useNavigate } from 'react-router-dom';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  Shield,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';

import { toast } from 'react-toastify';

import { useAuth } from '../context/AuthContext';
import api from '../services/api';

import './AdminDashboard.css';

// ============================================================================
// Constants
// ============================================================================

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
]);

const MAX_VISIBLE_USERS = 10;
const MAX_VISIBLE_GROUP_REQUESTS = 10;

const ADMIN_ROUTES = {
  users: '/admin/users',
  sessions: '/admin/sessions',
  settings: '/admin/settings',
  audit: '/admin/audit',
  compliance: '/admin/compliance',
  risk: '/admin/risk',
  groups: '/admin/groups',
};

// ============================================================================
// Utilities
// ============================================================================

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.results)) {
    return value.results;
  }

  return [];
};

const extractData = (response) => {
  const payload = response?.data;

  if (payload?.data !== undefined) {
    return payload.data;
  }

  if (payload?.items !== undefined) {
    return payload.items;
  }

  return payload;
};

const getEntityId = (entity) => {
  if (!entity) {
    return '';
  }

  return String(
    entity.id ??
      entity._id ??
      entity.userId ??
      entity.groupId ??
      ''
  );
};

const getUserName = (user) => {
  if (!user) {
    return 'Unknown User';
  }

  return (
    user.name ||
    user.fullName ||
    user.displayName ||
    [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ') ||
    user.email ||
    'Unknown User'
  );
};

const getUserStatus = (user) => {
  return String(
    user?.status || 'active'
  ).toLowerCase();
};

const getGroupStatus = (group) => {
  return String(
    group?.status || 'pending'
  ).toLowerCase();
};

// ============================================================================
// Stat Card
// ============================================================================

const StatCard = ({
  title,
  value,
  icon: Icon,
  color = 'primary',
  description,
}) => {
  return (
    <article
      className={`admin-stat-card ${color}`}
      aria-label={`${title}: ${value}`}
    >
      <div className="admin-stat-icon">
        <Icon
          size={24}
          aria-hidden="true"
        />
      </div>

      <div className="admin-stat-content">
        <p>{title}</p>

        <h3>{value}</h3>

        {description && (
          <span>{description}</span>
        )}
      </div>
    </article>
  );
};

// ============================================================================
// Loading Skeleton
// ============================================================================

const LoadingSkeleton = () => {
  return (
    <div
      className="admin-loading"
      aria-busy="true"
      aria-label="Loading administration dashboard"
    >
      {Array.from(
        { length: 4 },
        (_, index) => (
          <div
            key={index}
            className="admin-skeleton-card"
            aria-hidden="true"
          />
        )
      )}
    </div>
  );
};

// ============================================================================
// Empty State
// ============================================================================

const EmptyState = ({
  message,
}) => {
  return (
    <div className="empty-admin-state">
      <CheckCircle
        size={22}
        aria-hidden="true"
      />

      <span>{message}</span>
    </div>
  );
};

// ============================================================================
// Admin Dashboard
// ============================================================================

const AdminDashboard = () => {
  const navigate = useNavigate();

  const {
    user,
    logout,
  } = useAuth();

  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [users, setUsers] =
    useState([]);

  const [groupRequests, setGroupRequests] =
    useState([]);

  const [
    approvingGroupIds,
    setApprovingGroupIds,
  ] = useState(() => new Set());

  const [error, setError] =
    useState('');

  // --------------------------------------------------------------------------
  // Authorization
  // --------------------------------------------------------------------------

  const normalizedRole = useMemo(
    () =>
      String(
        user?.role || ''
      )
        .trim()
        .toLowerCase(),
    [user?.role]
  );

  const isAdmin = useMemo(
    () =>
      ADMIN_ROLES.has(
        normalizedRole
      ),
    [normalizedRole]
  );

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------

  const metrics = useMemo(() => {
    const activeUsers =
      users.filter(
        (currentUser) =>
          getUserStatus(
            currentUser
          ) === 'active'
      ).length;

    const pendingGroups =
      groupRequests.filter(
        (group) =>
          getGroupStatus(
            group
          ) === 'pending'
      ).length;

    const approvedGroups =
      groupRequests.filter(
        (group) =>
          getGroupStatus(
            group
          ) === 'approved'
      ).length;

    return {
      totalUsers: users.length,
      activeUsers,
      pendingGroups,
      approvedGroups,
    };
  }, [
    users,
    groupRequests,
  ]);

  // --------------------------------------------------------------------------
  // Visible data
  // --------------------------------------------------------------------------

  const visibleUsers = useMemo(
    () =>
      users.slice(
        0,
        MAX_VISIBLE_USERS
      ),
    [users]
  );

  const visibleGroupRequests =
    useMemo(
      () =>
        groupRequests
          .filter(
            (group) =>
              getGroupStatus(
                group
              ) === 'pending'
          )
          .slice(
            0,
            MAX_VISIBLE_GROUP_REQUESTS
          ),
      [groupRequests]
    );

  // --------------------------------------------------------------------------
  // Fetch Dashboard Data
  // --------------------------------------------------------------------------

  const fetchDashboardData =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (
          !user ||
          !isAdmin
        ) {
          return;
        }

        const requestId =
          ++requestRef.current;

        try {
          if (silent) {
            setRefreshing(true);
          } else {
            setLoading(true);
          }

          setError('');

          const [
            usersResponse,
            requestsResponse,
          ] =
            await Promise.all([
              api.get(
                '/api/admin/users'
              ),
              api.get(
                '/api/admin/group-requests'
              ),
            ]);

          if (
            !mountedRef.current ||
            requestId !==
              requestRef.current
          ) {
            return;
          }

          const usersPayload =
            extractData(
              usersResponse
            );

          const requestsPayload =
            extractData(
              requestsResponse
            );

          const normalizedUsers =
            toArray(
              usersPayload
            );

          const normalizedRequests =
            toArray(
              requestsPayload
            );

          setUsers(
            normalizedUsers
          );

          setGroupRequests(
            normalizedRequests
          );
        } catch (err) {
          if (
            !mountedRef.current ||
            requestId !==
              requestRef.current
          ) {
            return;
          }

          console.error(
            'Admin dashboard request failed:',
            err
          );

          const status =
            err?.response?.status;

          if (
            status === 401
          ) {
            try {
              await logout();
            } catch (
              logoutError
            ) {
              console.error(
                'Admin logout failed:',
                logoutError
              );
            }

            if (
              mountedRef.current
            ) {
              navigate(
                '/login',
                {
                  replace: true,
                }
              );
            }

            return;
          }

          if (
            status === 403
          ) {
            const message =
              'Administrator access is required to view this dashboard.';

            setError(
              message
            );

            toast.error(
              message
            );

            navigate(
              '/dashboard',
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
            'Failed to load dashboard data';

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
            requestId ===
              requestRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      [
        isAdmin,
        logout,
        navigate,
        user,
      ]
    );

  // --------------------------------------------------------------------------
  // Approve Group
  // --------------------------------------------------------------------------

  const approveGroup =
    useCallback(
      async (groupId) => {
        const normalizedGroupId =
          String(
            groupId || ''
          ).trim();

        if (
          !normalizedGroupId
        ) {
          toast.error(
            'Unable to identify the group request.'
          );

          return;
        }

        if (
          approvingGroupIds.has(
            normalizedGroupId
          )
        ) {
          return;
        }

        const group =
          groupRequests.find(
            (request) =>
              getEntityId(
                request
              ) ===
              normalizedGroupId
          );

        const groupName =
          group?.name ||
          'this group';

        const confirmed =
          window.confirm(
            `Approve ${groupName}?`
          );

        if (!confirmed) {
          return;
        }

        setApprovingGroupIds(
          (previous) => {
            const next =
              new Set(
                previous
              );

            next.add(
              normalizedGroupId
            );

            return next;
          }
        );

        try {
          await api.post(
            `/api/admin/group-requests/${encodeURIComponent(
              normalizedGroupId
            )}/approve`
          );

          if (
            mountedRef.current
          ) {
            setGroupRequests(
              (previous) =>
                previous.map(
                  (request) =>
                    getEntityId(
                      request
                    ) ===
                    normalizedGroupId
                      ? {
                          ...request,
                          status:
                            'approved',
                        }
                      : request
                )
            );
          }

          toast.success(
            'Group approved successfully'
          );

          await fetchDashboardData({
            silent: true,
          });
        } catch (err) {
          console.error(
            'Failed to approve group:',
            err
          );

          const message =
            err?.response?.data
              ?.message ||
            err?.message ||
            'Approval failed';

          toast.error(
            message
          );
        } finally {
          if (
            mountedRef.current
          ) {
            setApprovingGroupIds(
              (previous) => {
                const next =
                  new Set(
                    previous
                  );

                next.delete(
                  normalizedGroupId
                );

                return next;
              }
            );
          }
        }
      },
      [
        approvingGroupIds,
        fetchDashboardData,
        groupRequests,
      ]
    );

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  const navigateTo =
    useCallback(
      (path) => {
        navigate(path);
      },
      [navigate]
    );

  // --------------------------------------------------------------------------
  // Initial Lifecycle
  // --------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      requestRef.current +=
        1;
    };
  }, []);

  // --------------------------------------------------------------------------
  // Authorization + Initial Data Load
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!user) {
      navigate(
        '/login',
        {
          replace: true,
        }
      );

      return;
    }

    if (!isAdmin) {
      toast.error(
        'Administrator access required'
      );

      navigate(
        '/dashboard',
        {
          replace: true,
        }
      );

      return;
    }

    fetchDashboardData();
  }, [
    user,
    isAdmin,
    navigate,
    fetchDashboardData,
  ]);

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <main
        className="admin-dashboard"
        aria-busy="true"
      >
        <LoadingSkeleton />
      </main>
    );
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <main className="admin-dashboard">
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="admin-header">
        <div>
          <h1>
            TITech Administration Center
          </h1>

          <p>
            System operations,
            governance and platform
            monitoring.
          </p>
        </div>

        <button
          type="button"
          className="refresh-btn"
          onClick={() =>
            fetchDashboardData({
              silent: true,
            })
          }
          disabled={refreshing}
          aria-label="Refresh administration dashboard"
        >
          <RefreshCw
            size={18}
            className={
              refreshing
                ? 'animate-spin'
                : ''
            }
            aria-hidden="true"
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}
        </button>
      </header>

      {/* ================================================================== */}
      {/* ERROR */}
      {/* ================================================================== */}

      {error && (
        <div
          className="admin-error"
          role="alert"
        >
          <AlertTriangle
            size={18}
            aria-hidden="true"
          />

          <span>
            {error}
          </span>

          <button
            type="button"
            onClick={() =>
              fetchDashboardData()
            }
            className="admin-error-retry"
          >
            Retry
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* KPIs */}
      {/* ================================================================== */}

      <section
        className="admin-stats-grid"
        aria-label="Platform metrics"
      >
        <StatCard
          title="Total Users"
          value={
            metrics.totalUsers
          }
          icon={Users}
          description="Registered platform users"
        />

        <StatCard
          title="Active Users"
          value={
            metrics.activeUsers
          }
          icon={UserCheck}
          color="success"
          description="Currently active accounts"
        />

        <StatCard
          title="Pending Groups"
          value={
            metrics.pendingGroups
          }
          icon={Clock}
          color="warning"
          description="Awaiting administrator review"
        />

        <StatCard
          title="Approved Groups"
          value={
            metrics.approvedGroups
          }
          icon={CheckCircle}
          color="success"
          description="Approved community groups"
        />
      </section>

      {/* ================================================================== */}
      {/* ADMIN MODULES */}
      {/* ================================================================== */}

      <section
        className="admin-modules-grid"
        aria-label="Administration modules"
      >
        <button
          type="button"
          className="module-card"
          onClick={() =>
            navigateTo(
              ADMIN_ROUTES.compliance
            )
          }
        >
          <Shield
            size={24}
            aria-hidden="true"
          />

          <h3>
            KYC & AML
          </h3>

          <p>
            Customer verification,
            sanctions screening and
            compliance monitoring.
          </p>

          <span className="module-link">
            Open Compliance
            <ArrowRight
              size={16}
              aria-hidden="true"
            />
          </span>
        </button>

        <button
          type="button"
          className="module-card"
          onClick={() =>
            navigateTo(
              ADMIN_ROUTES.risk
            )
          }
        >
          <TrendingUp
            size={24}
            aria-hidden="true"
          />

          <h3>
            Risk Engine
          </h3>

          <p>
            Fraud detection and
            behavioral risk scoring.
          </p>

          <span className="module-link">
            Open Risk
            <ArrowRight
              size={16}
              aria-hidden="true"
            />
          </span>
        </button>

        <button
          type="button"
          className="module-card"
          onClick={() =>
            navigateTo(
              ADMIN_ROUTES.groups
            )
          }
        >
          <Building2
            size={24}
            aria-hidden="true"
          />

          <h3>
            Community Groups
          </h3>

          <p>
            Savings groups,
            contributions and
            approvals.
          </p>

          <span className="module-link">
            Manage Groups
            <ArrowRight
              size={16}
              aria-hidden="true"
            />
          </span>
        </button>

        <button
          type="button"
          className="module-card"
          onClick={() =>
            navigateTo(
              ADMIN_ROUTES.audit
            )
          }
        >
          <Activity
            size={24}
            aria-hidden="true"
          />

          <h3>
            Audit Monitoring
          </h3>

          <p>
            Real-time audit events
            and compliance logs.
          </p>

          <span className="module-link">
            Open Audit
            <ArrowRight
              size={16}
              aria-hidden="true"
            />
          </span>
        </button>
      </section>

      {/* ================================================================== */}
      {/* PLATFORM USERS */}
      {/* ================================================================== */}

      <section
        className="admin-section"
        aria-labelledby="platform-users-heading"
      >
        <div className="admin-section-header">
          <div>
            <h2 id="platform-users-heading">
              Platform Users
            </h2>

            <p>
              Showing up to{' '}
              {MAX_VISIBLE_USERS}{' '}
              users from the
              current administration
              dataset.
            </p>
          </div>

          <button
            type="button"
            className="admin-section-action"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.users
              )
            }
          >
            Manage Users
            <ExternalLink
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>

        {visibleUsers.length ===
        0 ? (
          <EmptyState message="No users found." />
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <caption className="sr-only">
                Platform users
              </caption>

              <thead>
                <tr>
                  <th scope="col">
                    Name
                  </th>

                  <th scope="col">
                    Email
                  </th>

                  <th scope="col">
                    Role
                  </th>

                  <th scope="col">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleUsers.map(
                  (currentUser) => {
                    const id =
                      getEntityId(
                        currentUser
                      );

                    const status =
                      getUserStatus(
                        currentUser
                      );

                    return (
                      <tr
                        key={
                          id ||
                          currentUser.email ||
                          Math.random()
                        }
                      >
                        <td>
                          {getUserName(
                            currentUser
                          )}
                        </td>

                        <td>
                          {currentUser.email ||
                            '-'}
                        </td>

                        <td>
                          {currentUser.role ||
                            'member'}
                        </td>

                        <td>
                          <span
                            className={`status-badge ${status}`}
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* GROUP REQUESTS */}
      {/* ================================================================== */}

      <section
        className="admin-section"
        aria-labelledby="group-requests-heading"
      >
        <div className="admin-section-header">
          <div>
            <h2 id="group-requests-heading">
              Pending Group Approvals
            </h2>

            <p>
              Community groups awaiting
              administrator approval.
            </p>
          </div>

          <button
            type="button"
            className="admin-section-action"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.groups
              )
            }
          >
            Manage Groups
            <ExternalLink
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>

        {visibleGroupRequests.length ===
        0 ? (
          <EmptyState message="No pending group requests." />
        ) : (
          <div className="request-list">
            {visibleGroupRequests.map(
              (request) => {
                const id =
                  getEntityId(
                    request
                  );

                const isApproving =
                  approvingGroupIds.has(
                    id
                  );

                return (
                  <article
                    key={
                      id ||
                      request.name
                    }
                    className="request-card"
                  >
                    <div>
                      <h4>
                        {request.name ||
                          'Unnamed Group'}
                      </h4>

                      <p>
                        Owner:{' '}
                        {getUserName(
                          request.owner
                        )}
                      </p>

                      {request.createdAt && (
                        <small>
                          Submitted:{' '}
                          {new Date(
                            request.createdAt
                          ).toLocaleString()}
                        </small>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        approveGroup(
                          id
                        )
                      }
                      className="approve-btn"
                      disabled={
                        !id ||
                        isApproving
                      }
                      aria-label={`Approve ${
                        request.name ||
                        'group'
                      }`}
                    >
                      {isApproving ? (
                        <>
                          <RefreshCw
                            size={16}
                            className="animate-spin"
                            aria-hidden="true"
                          />
                          Approving...
                        </>
                      ) : (
                        <>
                          <CheckCircle
                            size={16}
                            aria-hidden="true"
                          />
                          Approve
                        </>
                      )}
                    </button>
                  </article>
                );
              }
            )}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* ADMIN QUICK ACTIONS */}
      {/* ================================================================== */}

      <section
        className="admin-section admin-quick-actions"
        aria-labelledby="quick-actions-heading"
      >
        <div className="admin-section-header">
          <div>
            <h2 id="quick-actions-heading">
              Administration
            </h2>

            <p>
              Access critical platform
              administration controls.
            </p>
          </div>
        </div>

        <div className="admin-quick-actions-grid">
          <button
            type="button"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.users
              )
            }
          >
            <Users
              size={18}
              aria-hidden="true"
            />
            Manage Users
          </button>

          <button
            type="button"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.sessions
              )
            }
          >
            <Shield
              size={18}
              aria-hidden="true"
            />
            Manage Sessions
          </button>

          <button
            type="button"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.audit
              )
            }
          >
            <Activity
              size={18}
              aria-hidden="true"
            />
            Audit Logs
          </button>

          <button
            type="button"
            onClick={() =>
              navigateTo(
                ADMIN_ROUTES.settings
              )
            }
          >
            <TrendingUp
              size={18}
              aria-hidden="true"
            />
            Platform Settings
          </button>
        </div>
      </section>
    </main>
  );
};

export default AdminDashboard;