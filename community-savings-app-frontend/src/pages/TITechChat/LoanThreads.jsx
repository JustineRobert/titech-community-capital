/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat — Loan Threads
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/LoanThreads.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade loan-related conversation/thread browser for TITechChat.
 *
 * Responsibilities:
 *   - Display loan-related discussion threads.
 *   - Support search and status filtering.
 *   - Support controlled and uncontrolled data usage.
 *   - Provide accessible keyboard-friendly navigation.
 *   - Provide loading, empty and error states.
 *   - Provide retry handling through parent callbacks.
 *   - Support pagination / load-more callbacks.
 *   - Support unread indicators.
 *   - Support pinned / priority threads.
 *   - Support tenant/community context supplied by the parent.
 *   - Normalize defensive API/thread data without becoming an API layer.
 *   - Remain independent from authoritative loan/ledger decisions.
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is PRESENTATION / INTERACTION orchestration only.
 *
 * It MUST NOT:
 *   - approve or reject loans;
 *   - calculate authoritative loan balances;
 *   - determine loan eligibility;
 *   - mutate financial records directly;
 *   - bypass tenant isolation;
 *   - perform authorization decisions;
 *   - expose confidential financial information beyond data supplied by the
 *     authorized parent/application layer.
 *
 * The parent/application layer remains responsible for:
 *   - authentication;
 *   - authorization;
 *   - tenant isolation;
 *   - API access;
 *   - financial calculations;
 *   - loan state transitions;
 *   - audit logging;
 *   - compliance controls.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_NAME = 'LoanThreads';
const COMPONENT_VERSION = '3.0.0';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search loan conversations...';

const DEFAULT_EMPTY_TITLE =
  'No loan conversations';

const DEFAULT_EMPTY_DESCRIPTION =
  'Loan-related conversations will appear here when they are available.';

const DEFAULT_ERROR_MESSAGE =
  'We could not load loan conversations. Please try again.';

const THREAD_STATUS = Object.freeze({
  ALL: 'all',
  OPEN: 'open',
  PENDING: 'pending',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
});

const STATUS_LABELS = Object.freeze({
  [THREAD_STATUS.ALL]: 'All',
  [THREAD_STATUS.OPEN]: 'Open',
  [THREAD_STATUS.PENDING]: 'Pending',
  [THREAD_STATUS.RESOLVED]: 'Resolved',
  [THREAD_STATUS.CLOSED]: 'Closed',
  [THREAD_STATUS.ARCHIVED]: 'Archived',
});

const STATUS_VALUES = Object.freeze([
  THREAD_STATUS.ALL,
  THREAD_STATUS.OPEN,
  THREAD_STATUS.PENDING,
  THREAD_STATUS.RESOLVED,
  THREAD_STATUS.CLOSED,
  THREAD_STATUS.ARCHIVED,
]);

const DEFAULT_STATUS_OPTIONS = Object.freeze([
  THREAD_STATUS.ALL,
  THREAD_STATUS.OPEN,
  THREAD_STATUS.PENDING,
  THREAD_STATUS.RESOLVED,
  THREAD_STATUS.CLOSED,
]);

const LOAN_STATUS_LABELS = Object.freeze({
  pending: 'Pending',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  disbursed: 'Disbursed',
  active: 'Active',
  overdue: 'Overdue',
  defaulted: 'Defaulted',
  completed: 'Completed',
  cancelled: 'Cancelled',
  closed: 'Closed',
});

const SORT_OPTIONS = Object.freeze({
  RECENT: 'recent',
  OLDEST: 'oldest',
  UNREAD: 'unread',
  PRIORITY: 'priority',
});

const DEFAULT_SORT = SORT_OPTIONS.RECENT;

/* ============================================================================
 * UTILITY HELPERS
 * ========================================================================== */

function cx(...classes) {
  return classes
    .filter(Boolean)
    .join(' ');
}

function safeString(value, fallback = '') {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    const result = String(value).trim();

    return result || fallback;
  } catch {
    return fallback;
  }
}

function safeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallback;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeStatus(value) {
  const normalized =
    safeString(value, THREAD_STATUS.OPEN)
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');

  if (
    STATUS_VALUES.includes(normalized)
  ) {
    return normalized;
  }

  return THREAD_STATUS.OPEN;
}

function normalizeLoanStatus(value) {
  const normalized =
    safeString(value)
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');

  return (
    LOAN_STATUS_LABELS[normalized]
      ? normalized
      : normalized || null
  );
}

function getThreadId(thread, index) {
  return safeString(
    thread?.id ??
      thread?._id ??
      thread?.threadId ??
      thread?.conversationId ??
      `loan-thread-${index}`,
  );
}

function getDateValue(thread) {
  return (
    thread?.updatedAt ??
    thread?.lastMessageAt ??
    thread?.createdAt ??
    thread?.timestamp ??
    null
  );
}

function getTimestamp(thread) {
  const value = getDateValue(thread);

  if (!value) {
    return 0;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

function formatRelativeDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = Date.now();
  const difference =
    Math.max(0, now - date.getTime());

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  if (difference < minute) {
    return 'Just now';
  }

  if (difference < hour) {
    const minutes =
      Math.floor(difference / minute);

    return `${minutes}m ago`;
  }

  if (difference < day) {
    const hours =
      Math.floor(difference / hour);

    return `${hours}h ago`;
  }

  if (difference < 7 * day) {
    const days =
      Math.floor(difference / day);

    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    },
  ).format(date);
}

function normalizeThread(
  thread,
  index,
) {
  const raw =
    thread &&
    typeof thread === 'object'
      ? thread
      : {};

  const loan =
    raw.loan &&
    typeof raw.loan === 'object'
      ? raw.loan
      : {};

  const applicant =
    raw.applicant &&
    typeof raw.applicant === 'object'
      ? raw.applicant
      : {};

  const lastMessage =
    raw.lastMessage &&
    typeof raw.lastMessage === 'object'
      ? raw.lastMessage
      : {};

  const id =
    getThreadId(raw, index);

  const title =
    safeString(
      raw.title ??
        raw.subject ??
        raw.name,
      'Loan conversation',
    );

  const loanReference =
    safeString(
      raw.loanReference ??
        raw.loanNumber ??
        raw.reference ??
        loan.reference ??
        loan.loanNumber,
    );

  const memberName =
    safeString(
      raw.memberName ??
        raw.borrowerName ??
        applicant.name ??
        applicant.fullName,
    );

  const status =
    normalizeStatus(
      raw.threadStatus ??
        raw.status ??
        raw.conversationStatus,
    );

  const loanStatus =
    normalizeLoanStatus(
      raw.loanStatus ??
        loan.status,
    );

  const preview =
    safeString(
      raw.preview ??
        raw.lastMessagePreview ??
        lastMessage.content ??
        lastMessage.text,
      'No messages yet.',
    );

  const unreadCount =
    Math.max(
      0,
      safeNumber(
        raw.unreadCount,
        raw.unread
          ? 1
          : 0,
      ),
    );

  const priority =
    safeString(
      raw.priority,
      'normal',
    ).toLowerCase();

  const isPinned =
    safeBoolean(
      raw.isPinned ??
        raw.pinned,
    );

  const isArchived =
    safeBoolean(
      raw.isArchived ??
        raw.archived,
    );

  const isUnread =
    unreadCount > 0 ||
    safeBoolean(
      raw.isUnread ??
        raw.unread,
    );

  const tenantId =
    safeString(
      raw.tenantId ??
        raw.organizationId ??
        raw.communityId,
    );

  const participantCount =
    Math.max(
      0,
      safeNumber(
        raw.participantCount,
        Array.isArray(raw.participants)
          ? raw.participants.length
          : 0,
      ),
    );

  return Object.freeze({
    ...raw,

    id,
    title,
    loanReference,
    memberName,
    status,
    loanStatus,
    preview,
    unreadCount,
    priority,
    isPinned,
    isArchived,
    isUnread,
    tenantId,
    participantCount,

    updatedAt:
      getDateValue(raw),

    normalizedAt:
      getTimestamp(raw),
  });
}

function matchesSearch(
  thread,
  query,
) {
  const normalizedQuery =
    safeString(query).toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    thread.title,
    thread.loanReference,
    thread.memberName,
    thread.preview,
    thread.status,
    thread.loanStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(
    normalizedQuery,
  );
}

function matchesStatus(
  thread,
  status,
) {
  if (
    !status ||
    status === THREAD_STATUS.ALL
  ) {
    return true;
  }

  return thread.status === status;
}

function sortThreads(
  threads,
  sortBy,
) {
  const sorted = [
    ...threads,
  ];

  switch (sortBy) {
    case SORT_OPTIONS.OLDEST:
      return sorted.sort(
        (a, b) =>
          a.normalizedAt -
          b.normalizedAt,
      );

    case SORT_OPTIONS.UNREAD:
      return sorted.sort(
        (a, b) => {
          if (
            a.isUnread !==
            b.isUnread
          ) {
            return a.isUnread
              ? -1
              : 1;
          }

          return (
            b.normalizedAt -
            a.normalizedAt
          );
        },
      );

    case SORT_OPTIONS.PRIORITY:
      return sorted.sort(
        (a, b) => {
          const priorityRank = {
            urgent: 0,
            high: 1,
            normal: 2,
            low: 3,
          };

          const aRank =
            priorityRank[
              a.priority
            ] ?? 2;

          const bRank =
            priorityRank[
              b.priority
            ] ?? 2;

          if (
            aRank !==
            bRank
          ) {
            return (
              aRank -
              bRank
            );
          }

          return (
            b.normalizedAt -
            a.normalizedAt
          );
        },
      );

    case SORT_OPTIONS.RECENT:
    default:
      return sorted.sort(
        (a, b) =>
          b.normalizedAt -
          a.normalizedAt,
      );
  }
}

/* ============================================================================
 * ICONS
 * ========================================================================== */

function Icon({
  children,
  size = 18,
  label,
}) {
  return (
    <svg
      aria-hidden={
        label
          ? undefined
          : 'true'
      }
      aria-label={
        label || undefined
      }
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={
        label
          ? 'img'
          : undefined
      }
    >
      {children}
    </svg>
  );
}

function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle
        cx="11"
        cy="11"
        r="7"
      />
      <path d="m20 20-4-4" />
    </Icon>
  );
}

function LoanIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M8 7h8" />
      <path d="M8 11h5" />
      <path d="M8 15h8" />
      <path d="M8 19h4" />
    </Icon>
  );
}

function RefreshIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 11a8.1 8.1 0 0 0-14.7-4.7L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 14.7 4.7L21 15" />
      <path d="M21 20v-5h-5" />
    </Icon>
  );
}

function ChevronIcon(props) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

function PinIcon(props) {
  return (
    <Icon {...props}>
      <path d="m15 4 5 5" />
      <path d="M14 5 5 14l5 5 9-9" />
      <path d="M9 15 4 20" />
    </Icon>
  );
}

function MessageIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-4-.9L4 20l1.3-3.2A7.1 7.1 0 0 1 4 12.5 7.5 7.5 0 0 1 12 5a7.5 7.5 0 0 1 8 6.5Z" />
    </Icon>
  );
}

/* ============================================================================
 * PRESENTATIONAL SUBCOMPONENTS
 * ========================================================================== */

function StatusBadge({
  status,
}) {
  const label =
    STATUS_LABELS[status] ||
    status;

  return (
    <span
      className={cx(
        'titech-loan-threads__status',
        `titech-loan-threads__status--${status}`,
      )}
    >
      {label}
    </span>
  );
}

StatusBadge.propTypes = {
  status:
    PropTypes.string.isRequired,
};

function LoanStatusBadge({
  status,
}) {
  if (!status) {
    return null;
  }

  return (
    <span
      className={cx(
        'titech-loan-threads__loan-status',
        `titech-loan-threads__loan-status--${status}`,
      )}
    >
      {LOAN_STATUS_LABELS[
        status
      ] || status}
    </span>
  );
}

LoanStatusBadge.propTypes = {
  status:
    PropTypes.string,
};

function ThreadSkeleton() {
  return (
    <div
      className="titech-loan-threads__skeleton"
      aria-hidden="true"
    >
      <div className="titech-loan-threads__skeleton-icon" />

      <div className="titech-loan-threads__skeleton-content">
        <div className="titech-loan-threads__skeleton-line titech-loan-threads__skeleton-line--title" />
        <div className="titech-loan-threads__skeleton-line" />
        <div className="titech-loan-threads__skeleton-line titech-loan-threads__skeleton-line--short" />
      </div>
    </div>
  );
}

function LoadingState({
  count = 5,
}) {
  return (
    <div
      className="titech-loan-threads__loading"
      aria-label="Loading loan conversations"
      role="status"
    >
      {Array.from(
        {
          length: Math.max(
            1,
            Math.min(count, 10),
          ),
        },
        (_, index) => (
          <ThreadSkeleton
            key={index}
          />
        ),
      )}
    </div>
  );
}

LoadingState.propTypes = {
  count:
    PropTypes.number,
};

function EmptyState({
  title,
  description,
  onReset,
  hasFilters,
}) {
  return (
    <div
      className="titech-loan-threads__empty"
      role="status"
    >
      <div className="titech-loan-threads__empty-icon">
        <LoanIcon size={32} />
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>

      {hasFilters &&
        typeof onReset ===
          'function' && (
          <button
            type="button"
            className="titech-loan-threads__button titech-loan-threads__button--secondary"
            onClick={onReset}
          >
            Clear filters
          </button>
        )}
    </div>
  );
}

EmptyState.propTypes = {
  title:
    PropTypes.string.isRequired,

  description:
    PropTypes.string.isRequired,

  onReset:
    PropTypes.func,

  hasFilters:
    PropTypes.bool,
};

function ErrorState({
  message,
  onRetry,
}) {
  return (
    <div
      className="titech-loan-threads__error"
      role="alert"
    >
      <div>
        <strong>
          Unable to load loan conversations
        </strong>

        <p>
          {message}
        </p>
      </div>

      {typeof onRetry ===
        'function' && (
        <button
          type="button"
          className="titech-loan-threads__button titech-loan-threads__button--secondary"
          onClick={onRetry}
        >
          <RefreshIcon size={16} />
          Try again
        </button>
      )}
    </div>
  );
}

ErrorState.propTypes = {
  message:
    PropTypes.string.isRequired,

  onRetry:
    PropTypes.func,
};

function ThreadItem({
  thread,
  isSelected,
  onSelect,
  onMarkRead,
  onTogglePin,
  showMember,
  showLoanStatus,
  showUnreadCount,
  compact,
  renderThread,
}) {
  const handleClick =
    useCallback(() => {
      if (
        typeof onSelect ===
        'function'
      ) {
        onSelect(thread);
      }

      if (
        thread.isUnread &&
        typeof onMarkRead ===
          'function'
      ) {
        onMarkRead(thread);
      }
    }, [
      onMarkRead,
      onSelect,
      thread,
    ]);

  if (
    typeof renderThread ===
    'function'
  ) {
    return renderThread({
      thread,
      isSelected,
      onSelect: handleClick,
    });
  }

  return (
    <button
      type="button"
      className={cx(
        'titech-loan-threads__item',
        isSelected &&
          'is-selected',
        thread.isUnread &&
          'is-unread',
        thread.isPinned &&
          'is-pinned',
        compact &&
          'is-compact',
      )}
      onClick={handleClick}
      aria-current={
        isSelected
          ? 'page'
          : undefined
      }
      data-thread-id={
        thread.id
      }
    >
      <span className="titech-loan-threads__item-icon">
        <LoanIcon size={20} />
      </span>

      <span className="titech-loan-threads__item-main">
        <span className="titech-loan-threads__item-heading">
          <span className="titech-loan-threads__item-title">
            {thread.title}
          </span>

          {thread.isPinned && (
            <span
              className="titech-loan-threads__pin"
              title="Pinned conversation"
              aria-label="Pinned conversation"
            >
              <PinIcon size={14} />
            </span>
          )}
        </span>

        {(showMember ||
          thread.loanReference) && (
          <span className="titech-loan-threads__item-reference">
            {showMember &&
              thread.memberName && (
                <span>
                  {thread.memberName}
                </span>
              )}

            {thread.loanReference && (
              <span>
                {showMember &&
                  thread.memberName &&
                  ' · '}
                Loan #
                {thread.loanReference}
              </span>
            )}
          </span>
        )}

        <span className="titech-loan-threads__item-preview">
          {thread.preview}
        </span>

        <span className="titech-loan-threads__item-meta">
          <StatusBadge
            status={
              thread.status
            }
          />

          {showLoanStatus && (
            <LoanStatusBadge
              status={
                thread.loanStatus
              }
            />
          )}

          <span className="titech-loan-threads__item-time">
            {formatRelativeDate(
              thread.updatedAt,
            )}
          </span>
        </span>
      </span>

      <span className="titech-loan-threads__item-end">
        {showUnreadCount &&
          thread.unreadCount >
            0 && (
          <span
            className="titech-loan-threads__unread"
            aria-label={`${thread.unreadCount} unread messages`}
          >
            {thread.unreadCount >
            99
              ? '99+'
              : thread.unreadCount}
          </span>
        )}

        <ChevronIcon
          size={18}
        />
      </span>

      {onTogglePin && (
        <span className="titech-loan-threads__item-actions">
          <span
            role="button"
            tabIndex={0}
            className="titech-loan-threads__pin-button"
            onClick={(
              event,
            ) => {
              event.stopPropagation();
              onTogglePin(
                thread,
              );
            }}
            onKeyDown={(
              event,
            ) => {
              if (
                event.key ===
                  'Enter' ||
                event.key ===
                  ' '
              ) {
                event.preventDefault();
                event.stopPropagation();
                onTogglePin(
                  thread,
                );
              }
            }}
            aria-label={
              thread.isPinned
                ? 'Unpin conversation'
                : 'Pin conversation'
            }
          >
            <PinIcon
              size={15}
            />
          </span>
        </span>
      )}
    </button>
  );
}

ThreadItem.propTypes = {
  thread:
    PropTypes.object.isRequired,

  isSelected:
    PropTypes.bool,

  onSelect:
    PropTypes.func,

  onMarkRead:
    PropTypes.func,

  onTogglePin:
    PropTypes.func,

  showMember:
    PropTypes.bool,

  showLoanStatus:
    PropTypes.bool,

  showUnreadCount:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  renderThread:
    PropTypes.func,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

/**
 * LoanThreads
 *
 * @param {Object} props Component properties.
 * @returns {JSX.Element}
 */
export default function LoanThreads({
  threads = [],
  selectedThreadId = null,

  loading = false,
  error = null,

  hasMore = false,
  loadingMore = false,

  pageSize = DEFAULT_PAGE_SIZE,

  title = 'Loan Conversations',
  description = 'Discuss loan applications, reviews, repayments and related matters securely through TITechChat.',

  searchPlaceholder =
    DEFAULT_SEARCH_PLACEHOLDER,

  emptyTitle =
    DEFAULT_EMPTY_TITLE,

  emptyDescription =
    DEFAULT_EMPTY_DESCRIPTION,

  errorMessage =
    DEFAULT_ERROR_MESSAGE,

  statusOptions =
    DEFAULT_STATUS_OPTIONS,

  defaultStatus =
    THREAD_STATUS.ALL,

  defaultSort =
    DEFAULT_SORT,

  controlledSearch,

  controlledStatus,

  controlledSort,

  onSearchChange,
  onStatusChange,
  onSortChange,

  onSelectThread,
  onOpenThread,

  onRetry,
  onLoadMore,
  onMarkRead,
  onTogglePin,

  onClearFilters,

  renderThread,

  showHeader = true,
  showSearch = true,
  showFilters = true,
  showSort = true,
  showMember = true,
  showLoanStatus = true,
  showUnreadCount = true,
  showRefresh = true,
  showLoadMore = true,

  compact = false,

  className = '',
  testId = 'titech-loan-threads',
}) {
  const searchId =
    useId();

  const statusId =
    useId();

  const sortId =
    useId();

  const listRef =
    useRef(null);

  const [internalSearch, setInternalSearch] =
    useState('');

  const [internalStatus, setInternalStatus] =
    useState(
      normalizeStatus(
        defaultStatus,
      ),
    );

  const [internalSort, setInternalSort] =
    useState(
      SORT_OPTIONS[
        String(
          defaultSort,
        ).toUpperCase()
      ] ||
        SORT_OPTIONS.RECENT,
    );

  const [refreshing, setRefreshing] =
    useState(false);

  const [liveMessage, setLiveMessage] =
    useState('');

  const search =
    controlledSearch !== undefined
      ? safeString(
          controlledSearch,
        )
      : internalSearch;

  const status =
    controlledStatus !== undefined
      ? normalizeStatus(
          controlledStatus,
        )
      : internalStatus;

  const sortBy =
    controlledSort !== undefined
      ? controlledSort
      : internalSort;

  const normalizedPageSize =
    Math.max(
      1,
      Math.min(
        safeNumber(
          pageSize,
          DEFAULT_PAGE_SIZE,
        ),
        MAX_PAGE_SIZE,
      ),
    );

  const normalizedThreads =
    useMemo(
      () =>
        Array.isArray(threads)
          ? threads.map(
              normalizeThread,
            )
          : [],
      [threads],
    );

  const filteredThreads =
    useMemo(() => {
      const filtered =
        normalizedThreads.filter(
          (thread) =>
            matchesSearch(
              thread,
              search,
            ) &&
            matchesStatus(
              thread,
              status,
            ),
        );

      return sortThreads(
        filtered,
        sortBy,
      );
    }, [
      normalizedThreads,
      search,
      sortBy,
      status,
    ]);

  const unreadCount =
    useMemo(
      () =>
        normalizedThreads.reduce(
          (
            total,
            thread,
          ) =>
            total +
            (thread.unreadCount ||
              0),
          0,
        ),
      [normalizedThreads],
    );

  const hasActiveFilters =
    Boolean(
      safeString(search) ||
        status !==
          THREAD_STATUS.ALL,
    );

  const handleSearchChange =
    useCallback(
      (event) => {
        const value =
          event.target.value;

        if (
          controlledSearch ===
          undefined
        ) {
          setInternalSearch(
            value,
          );
        }

        if (
          typeof onSearchChange ===
          'function'
        ) {
          onSearchChange(
            value,
          );
        }
      },
      [
        controlledSearch,
        onSearchChange,
      ],
    );

  const handleStatusChange =
    useCallback(
      (event) => {
        const value =
          normalizeStatus(
            event.target.value,
          );

        if (
          controlledStatus ===
          undefined
        ) {
          setInternalStatus(
            value,
          );
        }

        if (
          typeof onStatusChange ===
          'function'
        ) {
          onStatusChange(
            value,
          );
        }
      },
      [
        controlledStatus,
        onStatusChange,
      ],
    );

  const handleSortChange =
    useCallback(
      (event) => {
        const value =
          safeString(
            event.target.value,
            SORT_OPTIONS.RECENT,
          );

        if (
          controlledSort ===
          undefined
        ) {
          setInternalSort(
            value,
          );
        }

        if (
          typeof onSortChange ===
          'function'
        ) {
          onSortChange(
            value,
          );
        }
      },
      [
        controlledSort,
        onSortChange,
      ],
    );

  const handleClearFilters =
    useCallback(() => {
      if (
        controlledSearch ===
        undefined
      ) {
        setInternalSearch('');
      }

      if (
        controlledStatus ===
        undefined
      ) {
        setInternalStatus(
          THREAD_STATUS.ALL,
        );
      }

      if (
        typeof onSearchChange ===
        'function'
      ) {
        onSearchChange('');
      }

      if (
        typeof onStatusChange ===
        'function'
      ) {
        onStatusChange(
          THREAD_STATUS.ALL,
        );
      }

      if (
        typeof onClearFilters ===
        'function'
      ) {
        onClearFilters();
      }

      setLiveMessage(
        'Loan conversation filters cleared.',
      );
    }, [
      controlledSearch,
      controlledStatus,
      onClearFilters,
      onSearchChange,
      onStatusChange,
    ]);

  const handleSelectThread =
    useCallback(
      (thread) => {
        if (
          typeof onSelectThread ===
          'function'
        ) {
          onSelectThread(
            thread,
          );
        }

        if (
          typeof onOpenThread ===
          'function'
        ) {
          onOpenThread(
            thread,
          );
        }
      },
      [
        onOpenThread,
        onSelectThread,
      ],
    );

  const handleRefresh =
    useCallback(async () => {
      if (
        typeof onRetry !==
        'function' ||
        refreshing
      ) {
        return;
      }

      try {
        setRefreshing(true);

        await Promise.resolve(
          onRetry(),
        );

        setLiveMessage(
          'Loan conversations refreshed.',
        );
      } catch {
        setLiveMessage(
          'Loan conversation refresh failed.',
        );
      } finally {
        setRefreshing(false);
      }
    }, [
      onRetry,
      refreshing,
    ]);

  const handleLoadMore =
    useCallback(async () => {
      if (
        typeof onLoadMore !==
          'function' ||
        loadingMore ||
        !hasMore
      ) {
        return;
      }

      await Promise.resolve(
        onLoadMore({
          pageSize:
            normalizedPageSize,
          search,
          status,
          sort:
            sortBy,
        }),
      );
    }, [
      hasMore,
      loadingMore,
      normalizedPageSize,
      onLoadMore,
      search,
      sortBy,
      status,
    ]);

  useEffect(() => {
    if (
      !liveMessage
    ) {
      return undefined;
    }

    const timer =
      window.setTimeout(
        () => {
          setLiveMessage('');
        },
        4000,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [liveMessage]);

  const resultSummary =
    useMemo(() => {
      if (loading) {
        return 'Loading loan conversations.';
      }

      if (
        filteredThreads.length ===
        0
      ) {
        return 'No matching loan conversations.';
      }

      const count =
        filteredThreads.length;

      return `${count} loan conversation${
        count === 1
          ? ''
          : 's'
      } shown${
        unreadCount > 0
          ? `, ${unreadCount} unread message${
              unreadCount === 1
                ? ''
                : 's'
            }`
          : ''
      }.`;
    }, [
      filteredThreads.length,
      loading,
      unreadCount,
    ]);

  return (
    <section
      className={cx(
        'titech-loan-threads',
        compact &&
          'titech-loan-threads--compact',
        className,
      )}
      data-testid={testId}
      data-component={
        COMPONENT_NAME
      }
      data-version={
        COMPONENT_VERSION
      }
      aria-labelledby={`${searchId}-title`}
    >
      {showHeader && (
        <header className="titech-loan-threads__header">
          <div className="titech-loan-threads__heading">
            <div className="titech-loan-threads__title-row">
              <span className="titech-loan-threads__title-icon">
                <MessageIcon
                  size={20}
                />
              </span>

              <div>
                <h2
                  id={`${searchId}-title`}
                  className="titech-loan-threads__title"
                >
                  {title}
                </h2>

                {description && (
                  <p className="titech-loan-threads__description">
                    {description}
                  </p>
                )}
              </div>
            </div>

            {unreadCount >
              0 && (
              <span
                className="titech-loan-threads__unread-summary"
                aria-label={`${unreadCount} unread messages`}
              >
                {unreadCount >
                99
                  ? '99+'
                  : unreadCount}{' '}
                unread
              </span>
            )}
          </div>

          {showRefresh &&
            typeof onRetry ===
              'function' && (
              <button
                type="button"
                className="titech-loan-threads__icon-button"
                onClick={
                  handleRefresh
                }
                disabled={
                  refreshing ||
                  loading
                }
                aria-label="Refresh loan conversations"
                title="Refresh"
              >
                <RefreshIcon
                  size={17}
                />

                <span className="titech-visually-hidden">
                  Refresh
                </span>
              </button>
            )}
        </header>
      )}

      {(showSearch ||
        showFilters ||
        showSort) && (
        <div className="titech-loan-threads__toolbar">
          {showSearch && (
            <div className="titech-loan-threads__search">
              <label
                htmlFor={searchId}
                className="titech-visually-hidden"
              >
                Search loan conversations
              </label>

              <SearchIcon
                size={17}
              />

              <input
                id={searchId}
                type="search"
                value={search}
                onChange={
                  handleSearchChange
                }
                placeholder={
                  searchPlaceholder
                }
                autoComplete="off"
                spellCheck="false"
                aria-label="Search loan conversations"
              />

              {search && (
                <button
                  type="button"
                  className="titech-loan-threads__clear-search"
                  onClick={() => {
                    if (
                      controlledSearch ===
                      undefined
                    ) {
                      setInternalSearch(
                        '',
                      );
                    }

                    if (
                      typeof onSearchChange ===
                      'function'
                    ) {
                      onSearchChange(
                        '',
                      );
                    }
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          )}

          {showFilters && (
            <div className="titech-loan-threads__filter">
              <label
                htmlFor={statusId}
              >
                Status
              </label>

              <select
                id={statusId}
                value={status}
                onChange={
                  handleStatusChange
                }
              >
                {statusOptions.map(
                  (option) => (
                    <option
                      key={option}
                      value={option}
                    >
                      {STATUS_LABELS[
                        option
                      ] ||
                        option}
                    </option>
                  ),
                )}
              </select>
            </div>
          )}

          {showSort && (
            <div className="titech-loan-threads__filter">
              <label
                htmlFor={sortId}
              >
                Sort
              </label>

              <select
                id={sortId}
                value={sortBy}
                onChange={
                  handleSortChange
                }
              >
                <option
                  value={
                    SORT_OPTIONS.RECENT
                  }
                >
                  Most recent
                </option>

                <option
                  value={
                    SORT_OPTIONS.OLDEST
                  }
                >
                  Oldest
                </option>

                <option
                  value={
                    SORT_OPTIONS.UNREAD
                  }
                >
                  Unread first
                </option>

                <option
                  value={
                    SORT_OPTIONS.PRIORITY
                  }
                >
                  Priority
                </option>
              </select>
            </div>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              className="titech-loan-threads__clear-filters"
              onClick={
                handleClearFilters
              }
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div
        className="titech-visually-hidden"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveMessage ||
          resultSummary}
      </div>

      {error && !loading ? (
        <ErrorState
          message={
            safeString(
              error?.message ??
                error,
              errorMessage,
            )
          }
          onRetry={onRetry}
        />
      ) : loading &&
        normalizedThreads.length ===
          0 ? (
        <LoadingState />
      ) : filteredThreads.length ===
        0 ? (
        <EmptyState
          title={
            hasActiveFilters
              ? 'No matching conversations'
              : emptyTitle
          }
          description={
            hasActiveFilters
              ? 'Try changing your search or filters.'
              : emptyDescription
          }
          onReset={
            handleClearFilters
          }
          hasFilters={
            hasActiveFilters
          }
        />
      ) : (
        <>
          <div
            ref={listRef}
            className="titech-loan-threads__list"
            role="list"
            aria-label="Loan conversations"
          >
            {filteredThreads.map(
              (
                thread,
              ) => (
                <div
                  key={
                    thread.id
                  }
                  role="listitem"
                >
                  <ThreadItem
                    thread={
                      thread
                    }
                    isSelected={
                      safeString(
                        selectedThreadId,
                      ) ===
                      thread.id
                    }
                    onSelect={
                      handleSelectThread
                    }
                    onMarkRead={
                      onMarkRead
                    }
                    onTogglePin={
                      onTogglePin
                    }
                    showMember={
                      showMember
                    }
                    showLoanStatus={
                      showLoanStatus
                    }
                    showUnreadCount={
                      showUnreadCount
                    }
                    compact={
                      compact
                    }
                    renderThread={
                      renderThread
                    }
                  />
                </div>
              ),
            )}
          </div>

          {showLoadMore &&
            hasMore &&
            typeof onLoadMore ===
              'function' && (
              <div className="titech-loan-threads__load-more">
                <button
                  type="button"
                  className="titech-loan-threads__button titech-loan-threads__button--secondary"
                  onClick={
                    handleLoadMore
                  }
                  disabled={
                    loadingMore
                  }
                  aria-busy={
                    loadingMore
                  }
                >
                  {loadingMore
                    ? 'Loading…'
                    : 'Load more conversations'}
                </button>
              </div>
            )}
        </>
      )}

      <footer className="titech-loan-threads__footer">
        <span>
          {filteredThreads.length}{' '}
          of{' '}
          {normalizedThreads.length}{' '}
          conversations
        </span>

        <span>
          TITech Community Capital
        </span>
      </footer>
    </section>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

LoanThreads.propTypes = {
  threads:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  selectedThreadId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  hasMore:
    PropTypes.bool,

  loadingMore:
    PropTypes.bool,

  pageSize:
    PropTypes.number,

  title:
    PropTypes.string,

  description:
    PropTypes.string,

  searchPlaceholder:
    PropTypes.string,

  emptyTitle:
    PropTypes.string,

  emptyDescription:
    PropTypes.string,

  errorMessage:
    PropTypes.string,

  statusOptions:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  defaultStatus:
    PropTypes.string,

  defaultSort:
    PropTypes.string,

  controlledSearch:
    PropTypes.string,

  controlledStatus:
    PropTypes.string,

  controlledSort:
    PropTypes.string,

  onSearchChange:
    PropTypes.func,

  onStatusChange:
    PropTypes.func,

  onSortChange:
    PropTypes.func,

  onSelectThread:
    PropTypes.func,

  onOpenThread:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onLoadMore:
    PropTypes.func,

  onMarkRead:
    PropTypes.func,

  onTogglePin:
    PropTypes.func,

  onClearFilters:
    PropTypes.func,

  renderThread:
    PropTypes.func,

  showHeader:
    PropTypes.bool,

  showSearch:
    PropTypes.bool,

  showFilters:
    PropTypes.bool,

  showSort:
    PropTypes.bool,

  showMember:
    PropTypes.bool,

  showLoanStatus:
    PropTypes.bool,

  showUnreadCount:
    PropTypes.bool,

  showRefresh:
    PropTypes.bool,

  showLoadMore:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};