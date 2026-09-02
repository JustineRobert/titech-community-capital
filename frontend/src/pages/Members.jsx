// ============================================================================
// TITech Community Capital
// Enterprise Members Management Page
// File: frontend/src/pages/Members.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Display and manage TITech Community Capital members
// - Securely retrieve member records from the API
// - Support search, filtering and pagination
// - Support automatic and manual refresh
// - Handle API errors safely
// - Prevent stale requests from updating the UI
// - Remain compatible with React Strict Mode
// - Provide accessible loading, empty and error states
// - Restrict member-management actions to authorized administrators
// - Avoid exposing backend implementation details
// - Maintain TITech terminology consistently
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Edit,
  Eye,
  RefreshCw,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// ============================================================================
// Constants
// ============================================================================

const MEMBERS_ENDPOINT = '/api/members';

const PAGE_SIZE = 10;

const AUTO_REFRESH_INTERVAL = 60_000;

const SEARCH_DEBOUNCE_MS = 250;

const REQUEST_TIMEOUT_MESSAGE =
  'The members service is taking longer than expected. Please try again.';

const GENERIC_LOAD_ERROR =
  'We could not load the member directory. Please try again.';

const GENERIC_REFRESH_ERROR =
  'We could not refresh the member directory. Please try again.';

const EMPTY_MEMBERS_MESSAGE =
  'No members match the current search and filter criteria.';

const STATUS_OPTIONS = [
  {
    value: 'all',
    label: 'All statuses',
  },
  {
    value: 'active',
    label: 'Active',
  },
  {
    value: 'suspended',
    label: 'Suspended',
  },
  {
    value: 'pending',
    label: 'Pending',
  },
  {
    value: 'inactive',
    label: 'Inactive',
  },
];

// ============================================================================
// Utility Helpers
// ============================================================================

const normalizeString = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const getMemberId = (member) =>
  member?._id ??
  member?.id ??
  member?.memberId ??
  member?.memberNumber ??
  null;

const getMemberName = (member) => {
  if (member?.name) {
    return String(member.name).trim();
  }

  const fullName = [
    member?.firstName,
    member?.middleName,
    member?.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  return fullName || 'Unnamed member';
};

const getMemberEmail = (member) =>
  String(member?.email ?? '').trim();

const getMemberPhone = (member) =>
  String(
    member?.phone ??
      member?.phoneNumber ??
      member?.mobileNumber ??
      '',
  ).trim();

const getMemberNumber = (member) =>
  String(
    member?.memberNumber ??
      member?.membershipNumber ??
      member?.memberNo ??
      '',
  ).trim();

const normalizeStatus = (status) => {
  const value = normalizeString(status);

  if (!value) {
    return 'active';
  }

  return value.replace(/\s+/g, '_');
};

const getStatusLabel = (status) => {
  const normalized = normalizeStatus(status);

  return (
    normalized
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) =>
        character.toUpperCase(),
      ) || 'Active'
  );
};

const formatDate = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

const isAbortError = (error) => {
  const name = String(error?.name ?? '');

  const code = String(error?.code ?? '');

  const message = normalizeString(error?.message);

  return (
    name === 'AbortError' ||
    code === 'ERR_CANCELED' ||
    code === 'ECONNABORTED' ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('aborted')
  );
};

const getApiErrorMessage = (
  error,
  fallback = GENERIC_LOAD_ERROR,
) => {
  if (isAbortError(error)) {
    return fallback;
  }

  const status = Number(
    error?.response?.status ??
      error?.status ??
      error?.statusCode ??
      0,
  );

  // Do not expose low-level authentication/session details.
  if (status === 401) {
    return 'Your session may have expired. Please sign in again.';
  }

  if (status === 403) {
    return 'You do not have permission to view the member directory.';
  }

  if (status === 404) {
    return 'The member directory is currently unavailable.';
  }

  const serverMessage =
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    error?.message;

  if (
    typeof serverMessage === 'string' &&
    serverMessage.trim() &&
    serverMessage.length <= 240
  ) {
    return serverMessage.trim();
  }

  return fallback;
};

/**
 * Supports common API response envelopes without coupling the page
 * to one backend serialization format.
 *
 * Supported examples:
 *
 * []
 *
 * { data: [] }
 *
 * { data: { members: [] } }
 *
 * { members: [] }
 *
 * { results: [] }
 */
const extractMembers = (response) => {
  const payload = response?.data ?? response;

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.members)) {
    return payload.members;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.data?.members)) {
    return payload.data.members;
  }

  if (Array.isArray(payload?.data?.results)) {
    return payload.data.results;
  }

  return [];
};

// ============================================================================
// Skeleton
// ============================================================================

function MemberSkeletonRow() {
  return (
    <tr
      className="member-skeleton-row"
      aria-hidden="true"
    >
      <td>
        <span className="member-skeleton member-skeleton-name" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-short" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-medium" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-medium" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-status" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-short" />
      </td>

      <td>
        <span className="member-skeleton member-skeleton-actions" />
      </td>
    </tr>
  );
}

function MembersTableSkeleton() {
  return (
    <div className="members-table-wrapper">
      <table className="members-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Member No.</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
            <th scope="col">Status</th>
            <th scope="col">Joined</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>

        <tbody>
          {Array.from({ length: 6 }).map((_, index) => (
            <MemberSkeletonRow key={index} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);

  return (
    <span
      className={`member-status member-status-${normalized}`}
      aria-label={`Status: ${getStatusLabel(normalized)}`}
    >
      <span
        className="member-status-indicator"
        aria-hidden="true"
      />

      {getStatusLabel(normalized)}
    </span>
  );
}

// ============================================================================
// Statistics Card
// ============================================================================

function StatsCard({
  title,
  value,
  icon: Icon,
  description,
}) {
  return (
    <article
      className="member-stat-card"
      aria-label={`${title}: ${value}`}
    >
      <div
        className="member-stat-icon"
        aria-hidden="true"
      >
        <Icon size={22} />
      </div>

      <div className="member-stat-content">
        <p className="member-stat-title">
          {title}
        </p>

        <p className="member-stat-value">
          {value.toLocaleString()}
        </p>

        {description && (
          <span className="member-stat-description">
            {description}
          </span>
        )}
      </div>
    </article>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function MembersEmptyState({
  hasFilters,
  onClearFilters,
}) {
  return (
    <div
      className="members-empty-state"
      role="status"
      aria-live="polite"
    >
      <div
        className="members-empty-icon"
        aria-hidden="true"
      >
        <Users size={28} />
      </div>

      <h2>
        {hasFilters
          ? 'No matching members'
          : 'No members found'}
      </h2>

      <p>
        {hasFilters
          ? EMPTY_MEMBERS_MESSAGE
          : 'There are currently no members available in the directory.'}
      </p>

      {hasFilters && (
        <button
          type="button"
          className="members-clear-filters-btn"
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Error State
// ============================================================================

function MembersErrorState({
  message,
  onRetry,
  loading,
}) {
  return (
    <section
      className="members-error-state"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="members-error-icon"
        aria-hidden="true"
      >
        <AlertCircle size={26} />
      </div>

      <div className="members-error-content">
        <h2>Unable to load members</h2>

        <p>{message}</p>

        <button
          type="button"
          className="members-retry-btn"
          onClick={onRetry}
          disabled={loading}
        >
          <RefreshCw
            size={17}
            className={
              loading
                ? 'members-spin'
                : undefined
            }
            aria-hidden="true"
          />

          <span>
            {loading
              ? 'Retrying...'
              : 'Try again'}
          </span>
        </button>
      </div>
    </section>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function Members() {
  const navigate = useNavigate();

  const { user } = useAuth();

  const mountedRef = useRef(false);

  const requestControllerRef = useRef(null);

  const requestSequenceRef = useRef(0);

  const refreshTimerRef = useRef(null);

  const searchDebounceRef = useRef(null);

  const [members, setMembers] = useState([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState('');

  const [searchInput, setSearchInput] = useState('');

  const [search, setSearch] = useState('');

  const [statusFilter, setStatusFilter] =
    useState('all');

  const [page, setPage] = useState(1);

  // ==========================================================================
  // Authorization
  // ==========================================================================

  const normalizedRole = normalizeString(
    user?.role,
  );

  const isAdmin = useMemo(
    () =>
      [
        'admin',
        'super_admin',
        'superadmin',
        'administrator',
      ].includes(normalizedRole),
    [normalizedRole],
  );

  // ==========================================================================
  // Search Debouncing
  // ==========================================================================

  useEffect(() => {
    if (searchDebounceRef.current) {
      window.clearTimeout(
        searchDebounceRef.current,
      );
    }

    searchDebounceRef.current =
      window.setTimeout(() => {
        if (mountedRef.current) {
          setSearch(searchInput.trim());
        }
      }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchDebounceRef.current) {
        window.clearTimeout(
          searchDebounceRef.current,
        );
      }
    };
  }, [searchInput]);

  // ==========================================================================
  // Fetch Members
  // ==========================================================================

  const fetchMembers = useCallback(
    async ({
      silent = false,
      showSuccessToast = false,
    } = {}) => {
      const requestId =
        ++requestSequenceRef.current;

      // Cancel the previous request if possible.
      if (requestControllerRef.current) {
        try {
          requestControllerRef.current.abort();
        } catch {
          // Cancellation is best effort.
        }
      }

      const controller =
        typeof AbortController !== 'undefined'
          ? new AbortController()
          : null;

      requestControllerRef.current =
        controller;

      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError('');

      try {
        const requestConfig = controller
          ? {
              signal: controller.signal,
            }
          : undefined;

        const response = await api.get(
          MEMBERS_ENDPOINT,
          requestConfig,
        );

        // Ignore stale responses.
        if (
          requestId !==
          requestSequenceRef.current
        ) {
          return;
        }

        if (!mountedRef.current) {
          return;
        }

        const normalizedMembers =
          extractMembers(response);

        setMembers(normalizedMembers);

        if (showSuccessToast) {
          toast.success(
            'Member directory refreshed successfully.',
            {
              autoClose: 2200,
              toastId:
                'titech-members-refresh-success',
            },
          );
        }
      } catch (requestError) {
        if (
          isAbortError(requestError) ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        if (!mountedRef.current) {
          return;
        }

        const message = getApiErrorMessage(
          requestError,
          silent
            ? GENERIC_REFRESH_ERROR
            : GENERIC_LOAD_ERROR,
        );

        setError(message);

        if (silent) {
          toast.error(message, {
            autoClose: 3500,
            toastId:
              'titech-members-refresh-error',
          });
        }
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
    [],
  );

  // ==========================================================================
  // Initial Load + Automatic Refresh
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchMembers();

    refreshTimerRef.current =
      window.setInterval(() => {
        if (!document.hidden) {
          fetchMembers({
            silent: true,
          });
        }
      }, AUTO_REFRESH_INTERVAL);

    return () => {
      mountedRef.current = false;

      if (refreshTimerRef.current) {
        window.clearInterval(
          refreshTimerRef.current,
        );

        refreshTimerRef.current = null;
      }

      if (requestControllerRef.current) {
        try {
          requestControllerRef.current.abort();
        } catch {
          // Cancellation is best effort.
        }

        requestControllerRef.current = null;
      }
    };
  }, [fetchMembers]);

  // ==========================================================================
  // Manual Refresh
  // ==========================================================================

  const handleRefresh = useCallback(() => {
    if (refreshing || loading) {
      return;
    }

    fetchMembers({
      silent: true,
      showSuccessToast: true,
    });
  }, [
    fetchMembers,
    loading,
    refreshing,
  ]);

  // ==========================================================================
  // Filtering
  // ==========================================================================

  const filteredMembers = useMemo(() => {
    const normalizedSearch =
      normalizeString(search);

    return members.filter((member) => {
      const memberName =
        normalizeString(
          getMemberName(member),
        );

      const email =
        normalizeString(
          getMemberEmail(member),
        );

      const phone =
        normalizeString(
          getMemberPhone(member),
        );

      const memberNumber =
        normalizeString(
          getMemberNumber(member),
        );

      const memberStatus =
        normalizeStatus(
          member?.status,
        );

      const matchesSearch =
        !normalizedSearch ||
        memberName.includes(
          normalizedSearch,
        ) ||
        email.includes(
          normalizedSearch,
        ) ||
        phone.includes(
          normalizedSearch,
        ) ||
        memberNumber.includes(
          normalizedSearch,
        );

      const matchesStatus =
        statusFilter === 'all' ||
        memberStatus ===
          statusFilter;

      return (
        matchesSearch &&
        matchesStatus
      );
    });
  }, [
    members,
    search,
    statusFilter,
  ]);

  // ==========================================================================
  // Reset Pagination When Filters Change
  // ==========================================================================

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // ==========================================================================
  // Pagination
  // ==========================================================================

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredMembers.length /
        PAGE_SIZE,
    ),
  );

  useEffect(() => {
    setPage((currentPage) =>
      Math.min(
        Math.max(currentPage, 1),
        totalPages,
      ),
    );
  }, [totalPages]);

  const paginatedMembers = useMemo(() => {
    const start =
      (page - 1) * PAGE_SIZE;

    return filteredMembers.slice(
      start,
      start + PAGE_SIZE,
    );
  }, [
    filteredMembers,
    page,
  ]);

  const pageStart =
    filteredMembers.length === 0
      ? 0
      : (page - 1) * PAGE_SIZE + 1;

  const pageEnd =
    filteredMembers.length === 0
      ? 0
      : Math.min(
          page * PAGE_SIZE,
          filteredMembers.length,
        );

  // ==========================================================================
  // Statistics
  // ==========================================================================

  const stats = useMemo(() => {
    let active = 0;
    let suspended = 0;
    let pending = 0;
    let inactive = 0;

    members.forEach((member) => {
      const status = normalizeStatus(
        member?.status,
      );

      switch (status) {
        case 'suspended':
          suspended += 1;
          break;

        case 'pending':
          pending += 1;
          break;

        case 'inactive':
          inactive += 1;
          break;

        case 'active':
        default:
          active += 1;
          break;
      }
    });

    return {
      total: members.length,
      active,
      suspended,
      pending,
      inactive,
    };
  }, [members]);

  // ==========================================================================
  // Clear Filters
  // ==========================================================================

  const handleClearFilters =
    useCallback(() => {
      setSearchInput('');
      setSearch('');
      setStatusFilter('all');
      setPage(1);
    }, []);

  const hasFilters =
    Boolean(search) ||
    statusFilter !== 'all';

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const handleAddMember = useCallback(() => {
    if (!isAdmin) {
      toast.error(
        'You do not have permission to add members.',
        {
          autoClose: 3000,
          toastId:
            'titech-members-add-forbidden',
        },
      );

      return;
    }

    navigate('/members/new');
  }, [isAdmin, navigate]);

  const handleViewMember = useCallback(
    (memberId) => {
      if (!memberId) {
        toast.error(
          'This member record could not be opened.',
          {
            autoClose: 3000,
            toastId:
              'titech-member-invalid-id',
          },
        );

        return;
      }

      navigate(
        `/members/${encodeURIComponent(
          String(memberId),
        )}`,
      );
    },
    [navigate],
  );

  const handleEditMember = useCallback(
    (memberId) => {
      if (!isAdmin) {
        toast.error(
          'You do not have permission to edit members.',
          {
            autoClose: 3000,
            toastId:
              'titech-members-edit-forbidden',
          },
        );

        return;
      }

      if (!memberId) {
        toast.error(
          'This member record could not be edited.',
          {
            autoClose: 3000,
            toastId:
              'titech-member-invalid-edit-id',
          },
        );

        return;
      }

      navigate(
        `/members/${encodeURIComponent(
          String(memberId),
        )}/edit`,
      );
    },
    [isAdmin, navigate],
  );

  // ==========================================================================
  // Retry
  // ==========================================================================

  const handleRetry = useCallback(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (loading && members.length === 0) {
    return (
      <main
        className="members-page"
        aria-labelledby="members-page-title"
      >
        <header className="members-header">
          <div>
            <p className="members-eyebrow">
              TITech Community Capital
            </p>

            <h1 id="members-page-title">
              Members
            </h1>

            <p>
              Loading the community member
              directory...
            </p>
          </div>
        </header>

        <MembersTableSkeleton />
      </main>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="members-page"
      aria-labelledby="members-page-title"
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <header className="members-header">
        <div className="members-header-content">
          <p className="members-eyebrow">
            TITech Community Capital
          </p>

          <h1 id="members-page-title">
            Members
          </h1>

          <p className="members-header-description">
            Manage and monitor registered
            community members.
          </p>
        </div>

        <div className="members-header-actions">
          <button
            type="button"
            className="members-refresh-btn"
            onClick={handleRefresh}
            disabled={
              refreshing || loading
            }
            aria-label="Refresh member directory"
          >
            <RefreshCw
              size={18}
              className={
                refreshing
                  ? 'members-spin'
                  : undefined
              }
              aria-hidden="true"
            />

            <span>
              {refreshing
                ? 'Refreshing...'
                : 'Refresh'}
            </span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className="primary-btn"
              onClick={handleAddMember}
            >
              <UserPlus
                size={18}
                aria-hidden="true"
              />

              <span>Add Member</span>
            </button>
          )}
        </div>
      </header>

      {/* ================================================================== */}
      {/* Statistics */}
      {/* ================================================================== */}

      <section
        className="members-stats"
        aria-label="Member statistics"
      >
        <StatsCard
          title="Total Members"
          value={stats.total}
          icon={Users}
          description="All registered members"
        />

        <StatsCard
          title="Active"
          value={stats.active}
          icon={Users}
          description="Currently active"
        />

        <StatsCard
          title="Pending"
          value={stats.pending}
          icon={Users}
          description="Awaiting activation"
        />

        <StatsCard
          title="Suspended"
          value={stats.suspended}
          icon={Users}
          description="Currently suspended"
        />
      </section>

      {/* ================================================================== */}
      {/* Error State */}
      {/* ================================================================== */}

      {error && (
        <MembersErrorState
          message={error}
          onRetry={handleRetry}
          loading={loading}
        />
      )}

      {/* ================================================================== */}
      {/* Filters */}
      {/* ================================================================== */}

      <section
        className="members-toolbar"
        aria-label="Member directory filters"
      >
        <div className="members-search-wrapper">
          <Search
            size={19}
            className="members-search-icon"
            aria-hidden="true"
          />

          <label
            htmlFor="members-search"
            className="sr-only"
          >
            Search members
          </label>

          <input
            id="members-search"
            type="search"
            value={searchInput}
            onChange={(event) =>
              setSearchInput(
                event.target.value,
              )
            }
            placeholder="Search by name, email, phone or member number..."
            autoComplete="off"
            spellCheck="false"
            aria-label="Search members by name, email, phone or member number"
          />

          {searchInput && (
            <button
              type="button"
              className="members-search-clear"
              onClick={() =>
                setSearchInput('')
              }
              aria-label="Clear member search"
            >
              ×
            </button>
          )}
        </div>

        <div className="members-filter-control">
          <label
            htmlFor="member-status-filter"
            className="members-filter-label"
          >
            Status
          </label>

          <select
            id="member-status-filter"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value,
              )
            }
            aria-label="Filter members by status"
          >
            {STATUS_OPTIONS.map(
              (option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ),
            )}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            className="members-clear-filters-btn"
            onClick={handleClearFilters}
          >
            Clear filters
          </button>
        )}
      </section>

      {/* ================================================================== */}
      {/* Search Result Summary */}
      {/* ================================================================== */}

      <div
        className="members-result-summary"
        role="status"
        aria-live="polite"
      >
        <span>
          Showing{' '}
          <strong>
            {pageStart.toLocaleString()}–
            {pageEnd.toLocaleString()}
          </strong>{' '}
          of{' '}
          <strong>
            {filteredMembers.length.toLocaleString()}
          </strong>{' '}
          matching member
          {filteredMembers.length === 1
            ? ''
            : 's'}
        </span>

        {refreshing && (
          <span className="members-refresh-status">
            <RefreshCw
              size={14}
              className="members-spin"
              aria-hidden="true"
            />

            Updating...
          </span>
        )}
      </div>

      {/* ================================================================== */}
      {/* Empty State */}
      {/* ================================================================== */}

      {!error &&
        filteredMembers.length === 0 && (
          <MembersEmptyState
            hasFilters={hasFilters}
            onClearFilters={
              handleClearFilters
            }
          />
        )}

      {/* ================================================================== */}
      {/* Members Table */}
      {/* ================================================================== */}

      {filteredMembers.length > 0 && (
        <section
          className="members-table-section"
          aria-label="Member directory"
        >
          <div className="members-table-wrapper">
            <table className="members-table">
              <caption className="sr-only">
                TITech Community Capital
                member directory
              </caption>

              <thead>
                <tr>
                  <th scope="col">
                    Name
                  </th>

                  <th scope="col">
                    Member No.
                  </th>

                  <th scope="col">
                    Email
                  </th>

                  <th scope="col">
                    Phone
                  </th>

                  <th scope="col">
                    Status
                  </th>

                  <th scope="col">
                    Joined
                  </th>

                  <th
                    scope="col"
                    className="members-actions-header"
                  >
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedMembers.map(
                  (member, index) => {
                    const memberId =
                      getMemberId(
                        member,
                      );

                    const memberName =
                      getMemberName(
                        member,
                      );

                    const email =
                      getMemberEmail(
                        member,
                      );

                    const phone =
                      getMemberPhone(
                        member,
                      );

                    const memberNumber =
                      getMemberNumber(
                        member,
                      );

                    return (
                      <tr
                        key={
                          memberId ??
                          `member-${index}`
                        }
                      >
                        <td
                          data-label="Name"
                        >
                          <div className="member-name-cell">
                            <div
                              className="member-avatar"
                              aria-hidden="true"
                            >
                              {memberName
                                .charAt(
                                  0,
                                )
                                .toUpperCase()}
                            </div>

                            <span className="member-name">
                              {memberName}
                            </span>
                          </div>
                        </td>

                        <td
                          data-label="Member No."
                        >
                          <span className="member-number">
                            {memberNumber ||
                              '-'}
                          </span>
                        </td>

                        <td
                          data-label="Email"
                        >
                          {email ? (
                            <span className="member-email">
                              {email}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>

                        <td
                          data-label="Phone"
                        >
                          {phone || '-'}
                        </td>

                        <td
                          data-label="Status"
                        >
                          <StatusBadge
                            status={
                              member?.status
                            }
                          />
                        </td>

                        <td
                          data-label="Joined"
                        >
                          {formatDate(
                            member?.createdAt ??
                              member?.joinedAt ??
                              member?.registrationDate,
                          )}
                        </td>

                        <td
                          data-label="Actions"
                        >
                          <div className="action-buttons">
                            <button
                              type="button"
                              className="member-action-btn"
                              onClick={() =>
                                handleViewMember(
                                  memberId,
                                )
                              }
                              aria-label={`View ${memberName}`}
                              title={`View ${memberName}`}
                            >
                              <Eye
                                size={17}
                                aria-hidden="true"
                              />

                              <span className="sr-only">
                                View
                              </span>
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                className="member-action-btn"
                                onClick={() =>
                                  handleEditMember(
                                    memberId,
                                  )
                                }
                                aria-label={`Edit ${memberName}`}
                                title={`Edit ${memberName}`}
                              >
                                <Edit
                                  size={17}
                                  aria-hidden="true"
                                />

                                <span className="sr-only">
                                  Edit
                                </span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* Pagination */}
      {/* ================================================================== */}

      {filteredMembers.length > 0 && (
        <nav
          className="members-pagination"
          aria-label="Member directory pagination"
        >
          <div className="members-pagination-summary">
            Page{' '}
            <strong>{page}</strong>{' '}
            of{' '}
            <strong>
              {totalPages}
            </strong>
          </div>

          <div className="members-pagination-controls">
            <button
              type="button"
              className="members-pagination-btn"
              onClick={() =>
                setPage(
                  (currentPage) =>
                    Math.max(
                      currentPage -
                        1,
                      1,
                    ),
                )
              }
              disabled={page <= 1}
              aria-label="Go to previous page"
            >
              <ChevronLeft
                size={18}
                aria-hidden="true"
              />

              <span>Previous</span>
            </button>

            <span
              className="members-pagination-page"
              aria-current="page"
            >
              {page}
            </span>

            <button
              type="button"
              className="members-pagination-btn"
              onClick={() =>
                setPage(
                  (currentPage) =>
                    Math.min(
                      currentPage +
                        1,
                      totalPages,
                    ),
                )
              }
              disabled={
                page >= totalPages
              }
              aria-label="Go to next page"
            >
              <span>Next</span>

              <ChevronRight
                size={18}
                aria-hidden="true"
              />
            </button>
          </div>
        </nav>
      )}

      {/* ================================================================== */}
      {/* Footer */}
      {/* ================================================================== */}

      <footer className="members-page-footer">
        <span>
          TITech Community Capital
        </span>

        <span aria-hidden="true">
          •
        </span>

        <span>
          Member Management
        </span>
      </footer>
    </main>
  );
}