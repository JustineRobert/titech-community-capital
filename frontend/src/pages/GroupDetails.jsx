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
  CheckCircle2,
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

import './GroupDetails.css';

// ============================================================================
// Constants
// ============================================================================

const MAX_CONTRIBUTION_AMOUNT = 1_000_000_000;
const MIN_CONTRIBUTION_AMOUNT = 1;
const GROUP_REFRESH_INTERVAL = 60_000;

const EMPTY_GROUP = {
  id: null,
  name: '',
  description: '',
  type: '',
  members: [],
  totalContributions: 0,
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
    members: Array.isArray(source.members)
      ? source.members
      : [],
    totalContributions: Number(
      source.totalContributions ??
        source.totalContribution ??
        source.balance ??
        0
    ),
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

  return new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
};

const generateIdempotencyKey = () => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `titech-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
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
  const [contributionAmount, setContributionAmount] =
    useState('');
  const [contributing, setContributing] =
    useState(false);
  const [successMessage, setSuccessMessage] =
    useState('');
  const [lastUpdated, setLastUpdated] =
    useState(null);

  // ==========================================================================
  // Validation
  // ==========================================================================

  const contributionValidation = useMemo(() => {
    const raw = String(
      contributionAmount ?? ''
    ).trim();

    if (!raw) {
      return {
        valid: false,
        message: '',
        amount: 0,
      };
    }

    if (!/^\d+$/.test(raw)) {
      return {
        valid: false,
        message:
          'Enter a whole-number UGX amount.',
        amount: 0,
      };
    }

    const amount = Number(raw);

    if (!Number.isSafeInteger(amount)) {
      return {
        valid: false,
        message:
          'The contribution amount is too large.',
        amount: 0,
      };
    }

    if (
      amount <
      MIN_CONTRIBUTION_AMOUNT
    ) {
      return {
        valid: false,
        message:
          'Contribution must be at least UGX 1.',
        amount,
      };
    }

    if (
      amount >
      MAX_CONTRIBUTION_AMOUNT
    ) {
      return {
        valid: false,
        message: `Contribution cannot exceed ${formatCurrency(
          MAX_CONTRIBUTION_AMOUNT
        )}.`,
        amount,
      };
    }

    return {
      valid: true,
      message: '',
      amount,
    };
  }, [contributionAmount]);

  // ==========================================================================
  // Fetch Group
  // ==========================================================================

  const fetchGroupData = useCallback(
    async ({ silent = false } = {}) => {
      if (!groupId) {
        setError('A valid group identifier is required.');
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
          return;
        }

        setGroup(normalizedGroup);
        setLastUpdated(new Date());
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

        const status =
          err?.response?.status;

        const message =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          (status === 403
            ? 'You do not have permission to access this group.'
            : status === 404
              ? 'This group could not be found.'
              : 'Failed to load group details. Please try again.');

        setError(message);

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
        }
      }
    },
    [groupId]
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
  // Contribution
  // ==========================================================================

  const handleContribute = useCallback(
    async (event) => {
      event.preventDefault();

      setSuccessMessage('');
      setError('');

      if (!groupId) {
        const message =
          'Unable to identify the group.';
        setError(message);
        toast.error(message);
        return;
      }

      if (
        !contributionValidation.valid
      ) {
        const message =
          contributionValidation.message ||
          'Enter a valid contribution amount.';

        setError(message);
        toast.error(message);
        return;
      }

      if (contributing) {
        return;
      }

      setContributing(true);

      const idempotencyKey =
        generateIdempotencyKey();

      try {
        const response =
          await api.post(
            `/api/groups/${encodeURIComponent(
              groupId
            )}/contribute`,
            {
              amount:
                contributionValidation.amount,
              currency: 'UGX',
              groupId,
            },
            {
              headers: {
                'Idempotency-Key':
                  idempotencyKey,
                'X-Client-Request-ID':
                  idempotencyKey,
              },
            }
          );

        if (!mountedRef.current) {
          return;
        }

        const responseGroup =
          normalizeGroup(response);

        if (responseGroup) {
          setGroup(responseGroup);
        } else {
          await fetchGroupData({
            silent: true,
          });
        }

        setContributionAmount('');
        setSuccessMessage(
          `Your ${formatCurrency(
            contributionValidation.amount
          )} contribution was submitted successfully.`
        );

        toast.success(
          'Contribution submitted successfully.'
        );

        logger?.info?.(
          'TITech group contribution submitted',
          {
            groupId,
            userId:
              user?.id ||
              user?._id ||
              undefined,
            amount:
              contributionValidation.amount,
            currency: 'UGX',
          }
        );
      } catch (err) {
        if (
          err?.name === 'AbortError' ||
          err?.code === 'ERR_CANCELED'
        ) {
          return;
        }

        if (!mountedRef.current) {
          return;
        }

        const status =
          err?.response?.status;

        const message =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          (status === 401
            ? 'Your session has expired. Please sign in again.'
            : status === 403
              ? 'You are not authorized to contribute to this group.'
              : status === 409
                ? 'This contribution may already have been submitted.'
                : status === 422
                  ? 'The contribution amount was rejected by the server.'
                  : 'Contribution failed. Please try again.');

        setError(message);

        toast.error(message);

        logger?.error?.(
          'TITech group contribution failed',
          {
            groupId,
            status,
            error: message,
          }
        );
      } finally {
        if (mountedRef.current) {
          setContributing(false);
        }
      }
    },
    [
      groupId,
      contributionValidation,
      contributing,
      fetchGroupData,
      user,
    ]
  );

  // ==========================================================================
  // Derived Group Information
  // ==========================================================================

  const members = useMemo(
    () =>
      Array.isArray(group?.members)
        ? group.members
        : [],
    [group]
  );

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

  const activeMemberCount = useMemo(
    () =>
      members.filter(
        (member) =>
          String(
            member?.status ||
              'active'
          ).toLowerCase() === 'active'
      ).length,
    [members]
  );

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

                <span className="group-status-badge">
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
              Currency: UGX
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
        {/* Success */}
        {/* ================================================================= */}

        {successMessage && (
          <div
            className="group-inline-alert group-inline-alert-success"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2
              size={18}
              aria-hidden="true"
            />

            <span>
              {successMessage}
            </span>

            <button
              type="button"
              onClick={() =>
                setSuccessMessage('')
              }
              className="alert-dismiss"
              aria-label="Dismiss success message"
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
            label="Total Contributions"
            value={formatCurrency(
              group.totalContributions
            )}
            helper="Recorded group balance"
          />

          <GroupStatCard
            icon={Users}
            label="Members"
            value={members.length}
            helper={`${activeMemberCount} active`}
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

            <section className="group-panel contribution-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-eyebrow">
                    Community Finance
                  </span>

                  <h2>
                    Make a Contribution
                  </h2>

                  <p>
                    Add funds to this group
                    using a secure TITech
                    contribution transaction.
                  </p>
                </div>

                <div className="panel-icon">
                  <Coins
                    size={22}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <form
                onSubmit={
                  handleContribute
                }
                className="contribution-form"
                noValidate
              >
                <div className="form-field">
                  <label
                    htmlFor="contributionAmount"
                  >
                    Contribution Amount
                    <span
                      className="required-indicator"
                      aria-hidden="true"
                    >
                      *
                    </span>
                  </label>

                  <div className="currency-input">
                    <span className="currency-prefix">
                      UGX
                    </span>

                    <input
                      id="contributionAmount"
                      name="contributionAmount"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={
                        contributionAmount
                      }
                      onChange={(event) => {
                        const value =
                          event.target.value;

                        if (
                          /^\d*$/.test(
                            value
                          )
                        ) {
                          setContributionAmount(
                            value
                          );
                          setError('');
                          setSuccessMessage(
                            ''
                          );
                        }
                      }}
                      placeholder="0"
                      disabled={
                        contributing
                      }
                      aria-invalid={
                        Boolean(
                          contributionAmount &&
                            !contributionValidation.valid
                        )
                      }
                      aria-describedby="contribution-help contribution-validation"
                      maxLength={12}
                    />
                  </div>

                  <div
                    id="contribution-help"
                    className="form-help"
                  >
                    Enter a whole-number UGX
                    amount between{' '}
                    {formatCurrency(
                      MIN_CONTRIBUTION_AMOUNT
                    )}{' '}
                    and{' '}
                    {formatCurrency(
                      MAX_CONTRIBUTION_AMOUNT
                    )}
                    .
                  </div>

                  {contributionAmount &&
                    !contributionValidation.valid &&
                    contributionValidation.message && (
                      <div
                        id="contribution-validation"
                        className="field-error"
                        role="alert"
                      >
                        <AlertCircle
                          size={15}
                          aria-hidden="true"
                        />

                        {
                          contributionValidation.message
                        }
                      </div>
                    )}
                </div>

                <div className="contribution-security-note">
                  <ShieldCheck
                    size={17}
                    aria-hidden="true"
                  />

                  <div>
                    <strong>
                      Secure transaction
                    </strong>

                    <span>
                      Your contribution is
                      processed through the
                      TITech financial API with
                      duplicate-request
                      protection.
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-primary contribution-submit"
                  disabled={
                    contributing ||
                    !contributionValidation.valid
                  }
                >
                  {contributing ? (
                    <>
                      <Loader2
                        size={18}
                        className="spin"
                        aria-hidden="true"
                      />

                      Processing…
                    </>
                  ) : (
                    <>
                      <Wallet
                        size={18}
                        aria-hidden="true"
                      />

                      Contribute{' '}
                      {contributionValidation.valid
                        ? formatCurrency(
                            contributionValidation.amount
                          )
                        : ''}
                    </>
                  )}
                </button>
              </form>
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
                  {members.length}
                </span>
              </div>

              {members.length === 0 ? (
                <div className="members-empty-state">
                  <UserRound
                    size={26}
                    aria-hidden="true"
                  />

                  <p>
                    No members are currently
                    listed for this group.
                  </p>
                </div>
              ) : (
                <div className="members-list">
                  {members.map(
                    (
                      member,
                      index
                    ) => (
                      <MemberCard
                        key={getMemberId(
                          member,
                          index
                        )}
                        member={
                          member
                        }
                        index={
                          index
                        }
                      />
                    )
                  )}
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
                  Total Contributions
                </span>

                <strong>
                  {formatCurrency(
                    group.totalContributions
                  )}
                </strong>
              </div>

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
                  {members.length}
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

        <footer className="group-details-footer">
          <ShieldCheck
            size={18}
            aria-hidden="true"
          />

          <div>
            <strong>
              TITech Community Capital
            </strong>

            <span>
              Community financial activity is
              protected by authenticated API
              access, transaction validation,
              audit-ready request handling, and
              duplicate-request safeguards.
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}