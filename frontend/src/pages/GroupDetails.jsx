// ============================================================================
// TITech Community Capital – Group Details Page
// File: frontend/src/pages/GroupDetails.jsx
// Enterprise Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Coins,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  AlertCircle,
} from 'lucide-react';

import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';
import TITECH_BRAND from '../branding/brand';

import './GroupDetails.css';

// ============================================================================
// Constants
// ============================================================================

const GROUP_REFRESH_INTERVAL = 60_000;

const EMPTY_GROUP = {
  id: null,
  name: '',
  description: '',
  type: '',
  members: [],
  memberRoles: [],
  memberCount: null,
  activeMemberCount: null,
  nextContributionDate: null,
  status: 'active',
};

// ============================================================================
// Utility Helpers
// ============================================================================

const getGroupId = (group) =>
  group?.id ||
  group?._id ||
  group?.groupId ||
  null;

const normalizeGroup = (payload) => {
  const source =
    payload?.data?.data ||
    payload?.data ||
    payload?.group ||
    payload ||
    null;

  if (!source || typeof source !== 'object') {
    return null;
  }

  return {
    ...EMPTY_GROUP,
    ...source,
    id: getGroupId(source),
    // Group.members is a compatibility projection of user references. It is
    // not itself proof of a populated member profile or a financial balance.
    members: Array.isArray(source.members)
      ? source.members
      : [],
    memberRoles: Array.isArray(source.memberRoles)
      ? source.memberRoles
      : [],
    memberCount: source.memberCount !== null && source.memberCount !== undefined && Number.isSafeInteger(Number(source.memberCount))
      ? Number(source.memberCount)
      : null,
    activeMemberCount: source.activeMemberCount !== null && source.activeMemberCount !== undefined && Number.isSafeInteger(Number(source.activeMemberCount))
      ? Number(source.activeMemberCount)
      : null,
  };
};

const getMemberId = (member, index) =>
  member?.id ||
  member?._id ||
  member?.userId ||
  member?.email ||
  `member-${index}`;

const getMemberName = (member) =>
  member?.name ||
  member?.fullName ||
  member?.user?.name ||
  member?.user?.fullName ||
  member?.email ||
  'Community Member';

const getMemberEmail = (member) =>
  member?.email ||
  member?.user?.email ||
  '';

const getMemberRole = (member) =>
  member?.role ||
  member?.userRole ||
  'member';

const normalizeRole = (role) =>
  String(role || 'member')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const canManageMembershipForUser = (user, group) => {
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
    .filter(Boolean)
    .map((role) => String(role).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (roles.some((role) => ['platform_admin', 'tenant_admin', 'admin', 'administrator'].includes(role))) {
    return true;
  }

  const userId = String(user?.id || user?._id || user?.userId || '');
  if (!userId || !group) return false;
  if (String(group?.createdBy?._id || group?.createdBy || '') === userId) return true;

  return (group?.memberRoles || []).some((membership) =>
    String(membership?.userId?._id || membership?.userId || membership?.user?._id || '') === userId &&
    membership?.role === 'group_admin' &&
    ['active', 'reinstated'].includes(membership?.membershipStatus)
  );
};

const formatDateValue = (value) => {
  if (!value) {
    return 'Not scheduled';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not scheduled';
  }

  return new Intl.DateTimeFormat('en-UG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const formatDateTime = (value) => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat('en-UG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';

  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    maximumFractionDigits: 0,
  }).format(amount);
};

// ============================================================================
// Loading State
// ============================================================================

function GroupDetailsSkeleton() {
  return (
    <main
      className="group-details-page"
      aria-busy="true"
      aria-label="Loading group details"
    >
      <div className="group-details-container">
        <div className="group-details-skeleton-header">
          <div className="skeleton skeleton-back" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-description" />
        </div>

        <div className="group-details-skeleton-grid">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="group-details-skeleton-card"
            >
              <div className="skeleton skeleton-icon" />
              <div className="skeleton skeleton-small" />
              <div className="skeleton skeleton-value" />
            </div>
          ))}
        </div>

        <div className="group-details-skeleton-content">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      </div>
    </main>
  );
}

// ============================================================================
// Error State
// ============================================================================

function GroupDetailsError({
  message,
  onRetry,
  onBack,
  retrying,
}) {
  return (
    <main className="group-details-page">
      <div className="group-details-container">
        <section
          className="group-details-state group-details-error-state"
          role="alert"
          aria-live="assertive"
        >
          <div className="state-icon state-icon-error">
            <AlertCircle size={30} aria-hidden="true" />
          </div>

          <h1>Unable to load group</h1>

          <p>
            {message ||
              'We could not retrieve this group at the moment. Please try again.'}
          </p>

          <div className="state-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onBack}
              disabled={retrying}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Back to Dashboard
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2
                  size={17}
                  className="spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw
                  size={17}
                  aria-hidden="true"
                />
              )}

              {retrying ? 'Retrying…' : 'Try Again'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function GroupNotFound({ onBack }) {
  return (
    <main className="group-details-page">
      <div className="group-details-container">
        <section
          className="group-details-state"
          role="status"
        >
          <div className="state-icon state-icon-neutral">
            <Users size={30} aria-hidden="true" />
          </div>

          <h1>Group not found</h1>

          <p>
            The requested community group may have been removed,
            archived, or you may not have permission to access it.
          </p>

          <button
            type="button"
            className="btn-primary"
            onClick={onBack}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back to Dashboard
          </button>
        </section>
      </div>
    </main>
  );
}

// ============================================================================
// Stat Card
// ============================================================================

function GroupStatCard({
  icon: Icon,
  label,
  value,
  helper,
}) {
  return (
    <article className="group-stat-card">
      <div className="group-stat-icon">
        <Icon size={20} aria-hidden="true" />
      </div>

      <div className="group-stat-content">
        <span className="group-stat-label">
          {label}
        </span>

        <strong className="group-stat-value">
          {value}
        </strong>

        {helper && (
          <span className="group-stat-helper">
            {helper}
          </span>
        )}
      </div>
    </article>
  );
}

// ============================================================================
// Member Card
// ============================================================================

function MemberCard({ member, index }) {
  const name = getMemberName(member);
  const email = getMemberEmail(member);
  const role = normalizeRole(getMemberRole(member));

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <article className="group-member-card">
      <div
        className="member-avatar"
        aria-hidden="true"
      >
        {initials || 'M'}
      </div>

      <div className="member-card-content">
        <div className="member-name-row">
          <h3>{name}</h3>

          <span className="member-role-badge">
            {role}
          </span>
        </div>

        {email && (
          <p className="member-email">
            {email}
          </p>
        )}

        <span className="member-index">
          Member #{index + 1}
        </span>
      </div>
    </article>
  );
}

const getGroupRequestErrorMessage = (error) => {
  const status = error?.response?.status;
  const responseMessage = error?.response?.data?.message;
  const safeMessage = typeof responseMessage === 'string' ? responseMessage : null;
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');

  if (status === 401) return 'Your session has expired. Sign in again, then reopen this group.';
  if (status === 403) return safeMessage || 'You do not have permission to access this group.';
  if (status === 404) return safeMessage || 'This group could not be found in your authorized organization.';
  if (status === 409) return safeMessage || 'The requested group operation conflicts with the current saved state.';
  if (status === 422) return safeMessage || 'The server rejected the group data. Review the saved information and try again.';
  if (status === 429) return 'Too many group requests were made. Wait briefly, then refresh.';
  if (status === 502 || status === 503) return 'The TITech API or a required service is temporarily unavailable. Retry the group read when service is restored.';
  if (status === 504 || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) {
    return 'The group request timed out. Refresh to retrieve the current server state before repeating any operation.';
  }
  if (!error?.response && (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'This device is offline. Your group data was not refreshed; reconnect and retry.';
  }
  if (!error?.response) {
    return 'TITech could not reach the API. Check the connection and API availability, then retry. No change is confirmed by this failed read.';
  }
  if (status >= 500) return 'TITech could not complete this group request because the service encountered an internal error.';
  return safeMessage || 'The group request could not be completed. Review the response and retry when appropriate.';
};

// ============================================================================
// Main Component
// ============================================================================

export default function GroupDetails() {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const { user } = useAuth();

  const mountedRef = useRef(false);
  const abortRef = useRef(null);
  const requestSequenceRef = useRef(0);

  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [financialPosition, setFinancialPosition] = useState({
    status: 'loading',
    balance: null,
    currency: null,
    entryCount: null,
  });
  const [lastUpdated, setLastUpdated] =
    useState(null);
  const [membershipRequests, setMembershipRequests] = useState([]);
  const [membershipRequestsLoading, setMembershipRequestsLoading] = useState(false);
  const [moderatingUserId, setModeratingUserId] = useState(null);

  // ==========================================================================
  // Fetch Group
  // ==========================================================================

  // ==========================================================================
  // Authoritative Financial Position
  // ==========================================================================

  const loadFinancialPosition = useCallback(
    async (signal) => {
      setFinancialPosition({
        status: 'loading',
        balance: null,
        currency: null,
        entryCount: null,
      });

      try {
        const response = await api.get(
          `/api/v1/group-wallets/${encodeURIComponent(groupId)}/balance`,
          { signal },
        );
        const data = response?.data?.data ?? response?.data ?? response;
        const balanceValue = data?.balance;
        const normalizedBalance = String(balanceValue ?? '');

        if (
          data?.success !== true ||
          data?.source !== 'authoritative-ledger' ||
          String(data?.groupId || '') !== String(groupId) ||
          !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedBalance) ||
          !Number.isFinite(Number(normalizedBalance))
        ) {
          throw new Error('The ledger balance response did not satisfy the authoritative group-balance contract.');
        }

        if (signal?.aborted || !mountedRef.current) return;

        setFinancialPosition({
          status: 'available',
          balance: normalizedBalance,
          currency: /^[A-Z]{3}$/.test(String(data.currency || 'UGX').toUpperCase())
            ? String(data.currency || 'UGX').toUpperCase()
            : 'UGX',
          entryCount: Number.isSafeInteger(Number(data.entryCount))
            ? Number(data.entryCount)
            : null,
        });
      } catch (balanceError) {
        if (signal?.aborted || balanceError?.code === 'ERR_CANCELED') return;

        setFinancialPosition({
          status: 'unavailable',
          balance: null,
          currency: null,
          entryCount: null,
        });
        logger?.warn?.('TITech group ledger balance unavailable', {
          groupId,
          status: balanceError?.response?.status,
          code: balanceError?.response?.data?.code || balanceError?.code,
        });
      }
    },
    [groupId],
  );

  const formatFinancialPosition = useCallback(() => {
    if (financialPosition.status === 'loading') return 'Loading…';
    if (financialPosition.status !== 'available') return 'Unavailable';
    if (financialPosition.currency !== 'UGX') {
      return `${financialPosition.balance} ${financialPosition.currency}`;
    }
    return formatCurrency(financialPosition.balance);
  }, [financialPosition]);

  const fetchGroupData = useCallback(
    async ({ silent = false } = {}) => {
      if (!groupId) {
        setError('A valid group identifier is required.');
        setFinancialPosition({ status: 'unavailable', balance: null, currency: null, entryCount: null });
        setLoading(false);
        return;
      }

      const requestId =
        ++requestSequenceRef.current;

      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError('');

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // Ignore abort cleanup errors.
        }
      }

      const controller =
        new AbortController();

      abortRef.current = controller;

      try {
        const response = await api.get(
          `/api/groups/${encodeURIComponent(
            groupId
          )}`,
          {
            signal: controller.signal,
          }
        );

        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        const normalizedGroup =
          normalizeGroup(response);

        if (!normalizedGroup) {
          setGroup(null);
          setError('');
          setFinancialPosition({ status: 'unavailable', balance: null, currency: null, entryCount: null });
          return;
        }

        setGroup(normalizedGroup);
        setLastUpdated(new Date());
        void loadFinancialPosition(controller.signal);

        // Request moderation data only for users who are likely to have the
        // corresponding group scope. This is presentation optimization only:
        // the API independently verifies tenant and group-admin authority.
        if (canManageMembershipForUser(user, normalizedGroup)) {
          setMembershipRequestsLoading(true);
          try {
            const requestResponse = await api.get(
              `/api/groups/${encodeURIComponent(groupId)}/membership-requests`,
              { signal: controller.signal },
            );
            const requestData =
              requestResponse?.data?.data ??
              requestResponse?.data ??
              [];
            setMembershipRequests(Array.isArray(requestData) ? requestData : []);
          } catch (requestError) {
            if (!controller.signal.aborted) {
              logger?.warn?.('TITech membership requests unavailable', {
                groupId,
                status: requestError?.response?.status,
              });
            }
            setMembershipRequests([]);
          } finally {
            if (mountedRef.current && !controller.signal.aborted) {
              setMembershipRequestsLoading(false);
            }
          }
        } else {
          setMembershipRequests([]);
          setMembershipRequestsLoading(false);
        }
      } catch (err) {
        if (
          err?.name === 'AbortError' ||
          err?.code === 'ERR_CANCELED' ||
          controller.signal.aborted
        ) {
          return;
        }

        if (!mountedRef.current) {
          return;
        }

        const status = err?.response?.status;
        const message = getGroupRequestErrorMessage(err);

        setError(message);
        setFinancialPosition({
          status: 'unavailable',
          balance: null,
          currency: null,
          entryCount: null,
        });

        logger?.warn?.(
          'TITech GroupDetails fetch failed',
          {
            groupId,
            status,
            error: message,
          }
        );
      } finally {
        if (
          mountedRef.current &&
          requestId ===
            requestSequenceRef.current
        ) {
          setLoading(false);
          setRefreshing(false);
          setMembershipRequestsLoading(false);
        }
      }
    },
    [groupId, user, loadFinancialPosition]
  );

  // ==========================================================================
  // Initialization / Cleanup
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchGroupData();

    return () => {
      mountedRef.current = false;

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // Ignore cleanup errors.
        }
      }
    };
  }, [fetchGroupData]);

  // ==========================================================================
  // Auto Refresh
  // ==========================================================================

  useEffect(() => {
    if (!groupId) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      if (
        document.visibilityState ===
        'visible'
      ) {
        fetchGroupData({
          silent: true,
        });
      }
    }, GROUP_REFRESH_INTERVAL);

    return () => {
      window.clearInterval(interval);
    };
  }, [groupId, fetchGroupData]);

  // ==========================================================================
  // Group membership administration
  // ==========================================================================

  const canManageMembershipRequests = canManageMembershipForUser(user, group);

  const handleMembershipDecision = useCallback(async (targetUserId, action) => {
    if (!groupId || !targetUserId || !['approve', 'reject'].includes(action) || moderatingUserId) return;
    setModeratingUserId(String(targetUserId));
    try {
      await api.patch(
        `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetUserId)}`,
        { action },
      );
      toast.success(action === 'approve' ? 'Membership approved.' : 'Membership request rejected.');
      await fetchGroupData({ silent: true });
    } catch (decisionError) {
      const message =
        decisionError?.response?.data?.message ||
        (decisionError?.response?.status === 403
          ? 'You are not authorized to manage membership for this group.'
          : 'The membership decision could not be saved. Refresh and verify the request status.');
      toast.error(message);
      logger?.warn?.('TITech membership decision failed', {
        groupId,
        targetUserId: String(targetUserId),
        action,
        status: decisionError?.response?.status,
      });
    } finally {
      if (mountedRef.current) setModeratingUserId(null);
    }
  }, [groupId, moderatingUserId, fetchGroupData]);

  // ==========================================================================
  // Derived Group Information
  // ==========================================================================

  const members = useMemo(
    () => (Array.isArray(group?.members)
      ? group.members.filter((member) =>
          member && typeof member === 'object' && !Array.isArray(member) &&
          (member.name || member.fullName || member.email || member.user?.name || member.user?.fullName || member.user?.email)
        )
      : []),
    [group],
  );

  const memberCount = useMemo(() => {
    if (Number.isSafeInteger(group?.memberCount) && group.memberCount >= 0) {
      return group.memberCount;
    }
    if (Array.isArray(group?.members)) return group.members.length;
    return null;
  }, [group]);

  const groupType = useMemo(() => {
    if (!group?.type) {
      return 'Community Group';
    }

    return String(group.type)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) =>
        char.toUpperCase()
      );
  }, [group]);

  const activeMemberCount = useMemo(() => {
    if (Number.isSafeInteger(group?.activeMemberCount) && group.activeMemberCount >= 0) {
      return group.activeMemberCount;
    }
    if (Array.isArray(group?.memberRoles)) {
      return group.memberRoles.filter((membership) =>
        !membership?.removedAt &&
        ['active', 'reinstated'].includes(String(membership?.membershipStatus || '').toLowerCase())
      ).length;
    }
    return null;
  }, [group]);

  // ==========================================================================
  // Render States
  // ==========================================================================

  if (loading) {
    return <GroupDetailsSkeleton />;
  }

  if (error && !group) {
    return (
      <GroupDetailsError
        message={error}
        onRetry={() =>
          fetchGroupData()
        }
        onBack={() =>
          navigate('/dashboard')
        }
        retrying={refreshing}
      />
    );
  }

  if (!group) {
    return (
      <GroupNotFound
        onBack={() =>
          navigate('/dashboard')
        }
      />
    );
  }

  // ==========================================================================
  // Main Render
  // ==========================================================================

  return (
    <main className="group-details-page">
      <div className="group-details-container">
        {/* ================================================================= */}
        {/* Page Header */}
        {/* ================================================================= */}

        <header className="group-details-header">
          <div className="group-header-navigation">
            <button
              type="button"
              className="btn-back"
              onClick={() =>
                navigate('/dashboard')
              }
              aria-label="Back to dashboard"
            >
              <ArrowLeft
                size={18}
                aria-hidden="true"
              />

              <span>
                Dashboard
              </span>
            </button>

            <button
              type="button"
              className="btn-icon"
              onClick={() =>
                fetchGroupData({
                  silent: true,
                })
              }
              disabled={refreshing}
              aria-label="Refresh group details"
              title="Refresh group details"
            >
              {refreshing ? (
                <Loader2
                  size={18}
                  className="spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw
                  size={18}
                  aria-hidden="true"
                />
              )}
            </button>
          </div>

          <div className="group-title-area">
            <div className="group-title-icon">
              <Users
                size={28}
                aria-hidden="true"
              />
            </div>

            <div>
              <div className="group-title-meta">
                <span className="group-platform-label">
                  TITech Community Capital
                </span>

                <span
                  className="group-status-badge"
                  data-status={String(group.status || 'active').toLowerCase().replace(/_/g, '-')}
                  aria-label={`Group status: ${String(group.status || 'active').replace(/_/g, ' ')}`}
                >
                  <span
                    className="status-dot"
                    aria-hidden="true"
                  />
                  {String(
                    group.status ||
                      'active'
                  )
                    .replace(
                      /_/g,
                      ' '
                    )
                    .replace(
                      /\b\w/g,
                      (char) =>
                        char.toUpperCase()
                    )}
                </span>
              </div>

              <h1>
                {group.name ||
                  'Community Group'}
              </h1>

              <p>
                {group.description ||
                  'Community savings and financial collaboration group.'}
              </p>
            </div>
          </div>

          <div className="group-header-details">
            <span>
              <ShieldCheck
                size={15}
                aria-hidden="true"
              />
              Secure community finance
            </span>

            <span>
              <Coins
                size={15}
                aria-hidden="true"
              />
              Currency: {financialPosition.status === 'available'
                ? financialPosition.currency
                : 'Not available'}
            </span>

            {lastUpdated && (
              <span>
                <Clock3
                  size={15}
                  aria-hidden="true"
                />
                Updated{' '}
                {formatDateTime(
                  lastUpdated
                )}
              </span>
            )}
          </div>
        </header>

        {/* ================================================================= */}
        {/* Global Error */}
        {/* ================================================================= */}

        {error && group && (
          <div
            className="group-inline-alert group-inline-alert-error"
            role="alert"
          >
            <AlertCircle
              size={18}
              aria-hidden="true"
            />

            <span>
              {error}
            </span>

            <button
              type="button"
              onClick={() => {
                setError('');
              }}
              className="alert-dismiss"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* KPI Cards */}
        {/* ================================================================= */}

        <section
          className="group-stats-grid"
          aria-label="Group statistics"
        >
          <GroupStatCard
            icon={Wallet}
            label="Group Balance"
            value={formatFinancialPosition()}
            helper={financialPosition.status === 'available'
              ? 'Authoritative ledger position'
              : 'Ledger position is not available'}
          />

          <GroupStatCard
            icon={Users}
            label="Members"
            value={memberCount ?? 'Unavailable'}
            helper={`${activeMemberCount ?? 'Unknown'} active`}
          />

          <GroupStatCard
            icon={TrendingUp}
            label="Group Type"
            value={groupType}
            helper="Community finance"
          />

          <GroupStatCard
            icon={CalendarDays}
            label="Next Contribution"
            value={formatDateValue(
              group.nextContributionDate
            )}
            helper="Scheduled date"
          />
        </section>

        {/* ================================================================= */}
        {/* Main Content */}
        {/* ================================================================= */}

        <div className="group-details-layout">
          {/* =============================================================== */}
          {/* Left Column */}
          {/* =============================================================== */}

          <div className="group-details-main">
            {/* ============================================================= */}
            {/* Contribution Panel */}
            {/* ============================================================= */}

            <section className="group-panel contribution-panel" aria-labelledby="group-contribution-title">
              <div className="panel-header">
                <div>
                  <span className="panel-eyebrow">Community Finance</span>
                  <h2 id="group-contribution-title">Contribution availability</h2>
                  <p>Contribution initiation is not enabled in this group workspace.</p>
                </div>
                <div className="panel-icon">
                  <Coins size={22} aria-hidden="true" />
                </div>
              </div>

              <div className="group-contribution-unavailable" role="status" aria-live="polite">
                <Info size={19} aria-hidden="true" />
                <div>
                  <strong>Contribution flow is awaiting authorized integration</strong>
                  <p>There is no mounted group-scoped contribution instruction route connected to this page. The canonical financial API requires verified member, account and payment-reference context; it is not a substitute for a provider authorization and settlement workflow.</p>
                  <p>No payment has been initiated and no contribution has been recorded from this screen. Contact your institution's authorized finance officer for the approved contribution process.</p>
                </div>
              </div>
            </section>

            {/* ============================================================= */}
            {/* Group Information */}
            {/* ============================================================= */}

            <section className="group-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-eyebrow">
                    About this group
                  </span>

                  <h2>
                    Group Information
                  </h2>
                </div>

                <div className="panel-icon">
                  <Info
                    size={22}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div className="group-information-grid">
                <div className="information-item">
                  <span>
                    Group Name
                  </span>

                  <strong>
                    {group.name ||
                      'N/A'}
                  </strong>
                </div>

                <div className="information-item">
                  <span>
                    Group Type
                  </span>

                  <strong>
                    {groupType}
                  </strong>
                </div>

                <div className="information-item">
                  <span>
                    Status
                  </span>

                  <strong className="status-text">
                    {String(
                      group.status ||
                        'active'
                    )
                      .replace(
                        /_/g,
                        ' '
                      )
                      .replace(
                        /\b\w/g,
                        (char) =>
                          char.toUpperCase()
                      )}
                  </strong>
                </div>

                <div className="information-item">
                  <span>
                    Currency
                  </span>

                  <strong>
                    Ugandan Shilling
                    (UGX)
                  </strong>
                </div>
              </div>

              {group.description && (
                <div className="group-description-block">
                  <span>
                    Description
                  </span>

                  <p>
                    {group.description}
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* =============================================================== */}
          {/* Right Column */}
          {/* =============================================================== */}

          <aside className="group-details-sidebar">
            {canManageMembershipRequests ? (
              <section className="group-panel membership-requests-panel" aria-labelledby="membership-requests-title">
                <div className="panel-header">
                  <div>
                    <span className="panel-eyebrow">Group administration</span>
                    <h2 id="membership-requests-title">Pending join requests</h2>
                  </div>
                  <span className="members-count-badge">{membershipRequests.length}</span>
                </div>
                {membershipRequestsLoading ? (
                  <p role="status">Loading membership requests…</p>
                ) : membershipRequests.length === 0 ? (
                  <p>No pending membership requests.</p>
                ) : (
                  <ul className="membership-request-list">
                    {membershipRequests.map((request) => (
                      <li className="membership-request-item" key={request.userId}>
                        <div>
                          <strong>{request.name || 'Community Member'}</strong>
                          {request.email ? <span>{request.email}</span> : null}
                          <small>Awaiting administrator review</small>
                        </div>
                        <div className="membership-request-actions">
                          <button type="button" className="btn-primary" disabled={Boolean(moderatingUserId)} onClick={() => void handleMembershipDecision(request.userId, 'approve')}>
                            {moderatingUserId === request.userId ? 'Saving…' : 'Approve'}
                          </button>
                          <button type="button" className="btn-secondary" disabled={Boolean(moderatingUserId)} onClick={() => void handleMembershipDecision(request.userId, 'reject')}>Reject</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="group-panel members-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-eyebrow">
                    Community
                  </span>

                  <h2>
                    Members
                  </h2>
                </div>

                <span className="members-count-badge">
                  {memberCount ?? '—'}
                </span>
              </div>

              {members.length > 0 ? (
                <div className="members-list">
                  {members.map((member, index) => (
                    <MemberCard
                      key={getMemberId(member, index)}
                      member={member}
                      index={index}
                    />
                  ))}
                </div>
              ) : (
                <div className="members-empty-state">
                  <UserRound size={26} aria-hidden="true" />
                  <p>
                    {memberCount === null
                      ? 'Member information is unavailable.'
                      : `${memberCount} member record${memberCount === 1 ? '' : 's'} are associated with this group.`}
                  </p>
                  <p>
                    Individual member profiles are not included in the group-details response. This page does not invent names or expose raw member identifiers.
                  </p>
                </div>
              )}
            </section>

            {/* ============================================================= */}
            {/* Financial Summary */}
            {/* ============================================================= */}

            <section className="group-panel financial-summary-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-eyebrow">
                    Financial Overview
                  </span>

                  <h2>
                    Group Balance
                  </h2>
                </div>

                <Wallet
                  size={21}
                  aria-hidden="true"
                />
              </div>

              <div className="financial-total">
                <span>
                  Ledger Balance
                </span>

                <strong>
                  {formatFinancialPosition()}
                </strong>
              </div>

              <p className="financial-source-note" role="status">
                {financialPosition.status === 'available'
                  ? `Source: authoritative ledger · ${financialPosition.entryCount ?? 'Entry count unavailable'} entries`
                  : financialPosition.status === 'loading'
                    ? 'Retrieving the tenant- and group-authorized ledger position…'
                    : 'The authoritative ledger position could not be retrieved. No zero balance is assumed.'}
              </p>

              <div className="financial-divider" />

              <div className="financial-meta">
                <span>
                  <Users
                    size={15}
                    aria-hidden="true"
                  />
                  Members
                </span>

                <strong>
                  {memberCount ?? 'Unavailable'}
                </strong>
              </div>

              <div className="financial-meta">
                <span>
                  <CalendarDays
                    size={15}
                    aria-hidden="true"
                  />
                  Next contribution
                </span>

                <strong>
                  {formatDateValue(
                    group.nextContributionDate
                  )}
                </strong>
              </div>
            </section>
          </aside>
        </div>

        {/* ================================================================= */}
        {/* Footer Security Notice */}
        {/* ================================================================= */}

        <footer
          className="group-details-footer"
          aria-label="TITech Community Capital company information"
        >
          <ShieldCheck
            size={20}
            aria-hidden="true"
          />

          <div className="group-details-footer-copy">
            <strong>{TITECH_BRAND.fullName}</strong>
            <span className="group-details-footer-tagline">
              {TITECH_BRAND.tagline}
            </span>
            <span>
              {TITECH_BRAND.legalName}. ERN: {TITECH_BRAND.organization.entityRegistrationNumber}.
            </span>
            <span>
              Postal correspondence: {TITECH_BRAND.organization.postalAddress}, {TITECH_BRAND.organization.postalLocation}, {TITECH_BRAND.organization.country}.
            </span>
            <span className="group-details-footer-security">
              Community financial activity is protected by authenticated API access, transaction validation, audit-ready request handling, and duplicate-request safeguards.
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}