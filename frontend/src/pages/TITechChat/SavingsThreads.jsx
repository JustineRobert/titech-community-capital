/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat — Savings Threads
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/SavingsThreads.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade savings discussion/thread center for TITechChat.
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is responsible for:
 *   - Presenting savings-related discussion threads.
 *   - Searching and filtering thread data.
 *   - Rendering loading, empty, error and unauthorized states.
 *   - Supporting accessible keyboard navigation.
 *   - Supporting refresh and retry operations.
 *   - Supporting thread selection through parent callbacks.
 *   - Providing pagination-ready navigation.
 *   - Defensively normalizing externally supplied thread data.
 *
 * This component MUST NOT:
 *   - Authorize users.
 *   - Enforce tenant isolation.
 *   - Modify authoritative financial records.
 *   - Calculate official savings balances.
 *   - Approve or reject financial transactions.
 *   - Perform loan/savings eligibility decisions.
 *   - Treat user-entered thread content as authoritative financial data.
 *
 * Financial integrity
 * ----------------------------------------------------------------------------
 * Savings figures displayed by this component are informational UI data only.
 * Official balances, contribution records, ledger entries and transaction
 * states MUST originate from the authoritative TITech financial services.
 *
 * Integration
 * ----------------------------------------------------------------------------
 * The component deliberately supports several common parent integration
 * patterns without depending on a specific API/Redux implementation.
 *
 * Recommended usage:
 *
 * <SavingsThreads
 *   threads={threads}
 *   loading={loading}
 *   error={error}
 *   onRefresh={loadThreads}
 *   onThreadSelect={handleThreadSelect}
 * />
 *
 * ============================================================================
 */

'use strict';

import React, {
  memo,
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

const COMPONENT_NAME =
  'TITechChat.SavingsThreads';

const DEFAULT_PAGE_SIZE = 12;

const MAX_SEARCH_LENGTH = 120;

const MAX_VISIBLE_PAGES = 7;

const DEFAULT_TITLE =
  'Savings Discussions';

const DEFAULT_DESCRIPTION =
  'Discuss savings, contributions, group goals and community finance topics with your TITech community.';

const DEFAULT_EMPTY_TITLE =
  'No savings discussions found';

const DEFAULT_EMPTY_DESCRIPTION =
  'There are currently no savings discussions matching your search or filters.';

const DEFAULT_ERROR_MESSAGE =
  'We could not load savings discussions. Please try again.';

const DEFAULT_UNAUTHORIZED_MESSAGE =
  'You do not currently have access to savings discussions.';

const DEFAULT_NEW_THREAD_LABEL =
  'Start Discussion';

const DEFAULT_RETRY_LABEL =
  'Try Again';

const DEFAULT_REFRESH_LABEL =
  'Refresh';

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search savings discussions...';

const DEFAULT_SORT =
  'recent';

const SORT_OPTIONS = Object.freeze([
  {
    value: 'recent',
    label: 'Most recent',
  },
  {
    value: 'active',
    label: 'Recently active',
  },
  {
    value: 'popular',
    label: 'Most discussed',
  },
  {
    value: 'oldest',
    label: 'Oldest',
  },
]);

const CATEGORY_OPTIONS = Object.freeze([
  {
    value: 'all',
    label: 'All topics',
  },
  {
    value: 'savings',
    label: 'Savings',
  },
  {
    value: 'contributions',
    label: 'Contributions',
  },
  {
    value: 'goals',
    label: 'Savings goals',
  },
  {
    value: 'groups',
    label: 'Savings groups',
  },
  {
    value: 'general',
    label: 'General',
  },
]);

const STATUS_OPTIONS = Object.freeze([
  {
    value: 'all',
    label: 'All status',
  },
  {
    value: 'open',
    label: 'Open',
  },
  {
    value: 'resolved',
    label: 'Resolved',
  },
  {
    value: 'locked',
    label: 'Locked',
  },
]);

const PRIORITY_OPTIONS = Object.freeze([
  {
    value: 'all',
    label: 'All priority',
  },
  {
    value: 'normal',
    label: 'Normal',
  },
  {
    value: 'important',
    label: 'Important',
  },
  {
    value: 'urgent',
    label: 'Urgent',
  },
]);

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

/**
 * Safely normalize arbitrary external values into strings.
 */
function safeString(
  value,
  fallback = '',
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    const normalized =
      String(value).trim();

    return normalized || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Safely normalize numeric values.
 */
function safeNumber(
  value,
  fallback = 0,
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Clamp a number between two boundaries.
 */
function clamp(
  value,
  minimum,
  maximum,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

/**
 * Normalize a thread identifier.
 */
function getThreadId(
  thread,
  fallback = '',
) {
  if (!thread) {
    return fallback;
  }

  return safeString(
    thread.id ??
      thread._id ??
      thread.threadId ??
      thread.thread_id,
    fallback,
  );
}

/**
 * Resolve a display title defensively.
 */
function getThreadTitle(
  thread,
) {
  return (
    safeString(
      thread?.title,
    ) ||
    safeString(
      thread?.subject,
    ) ||
    'Untitled discussion'
  );
}

/**
 * Resolve thread body/preview text.
 */
function getThreadPreview(
  thread,
) {
  return (
    safeString(
      thread?.preview,
    ) ||
    safeString(
      thread?.excerpt,
    ) ||
    safeString(
      thread?.lastMessage?.content,
    ) ||
    safeString(
      thread?.lastMessage?.text,
    ) ||
    safeString(
      thread?.content,
    ) ||
    'No message preview available.'
  );
}

/**
 * Resolve author name.
 */
function getAuthorName(
  thread,
) {
  const author =
    thread?.author ||
    thread?.createdBy ||
    thread?.user ||
    thread?.creator;

  if (
    typeof author ===
    'string'
  ) {
    return safeString(
      author,
      'TITech member',
    );
  }

  return (
    safeString(
      author?.displayName,
    ) ||
    safeString(
      author?.name,
    ) ||
    safeString(
      author?.fullName,
    ) ||
    safeString(
      author?.username,
    ) ||
    'TITech member'
  );
}

/**
 * Resolve author initials for avatar fallback.
 */
function getInitials(
  name,
) {
  const normalized =
    safeString(
      name,
      'TITech',
    );

  const parts =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (!parts.length) {
    return 'TI';
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    parts[0][0] +
    parts[parts.length - 1][0]
  ).toUpperCase();
}

/**
 * Resolve category.
 */
function getCategory(
  thread,
) {
  const category =
    safeString(
      thread?.category,
    ).toLowerCase();

  if (
    CATEGORY_OPTIONS.some(
      (item) =>
        item.value ===
        category,
    )
  ) {
    return category;
  }

  return 'general';
}

/**
 * Resolve status.
 */
function getStatus(
  thread,
) {
  const status =
    safeString(
      thread?.status,
    ).toLowerCase();

  if (
    STATUS_OPTIONS.some(
      (item) =>
        item.value ===
        status,
    )
  ) {
    return status;
  }

  return 'open';
}

/**
 * Resolve priority.
 */
function getPriority(
  thread,
) {
  const priority =
    safeString(
      thread?.priority,
    ).toLowerCase();

  if (
    PRIORITY_OPTIONS.some(
      (item) =>
        item.value ===
        priority,
    )
  ) {
    return priority;
  }

  return 'normal';
}

/**
 * Resolve date from common backend representations.
 */
function getDateValue(
  thread,
  fields,
) {
  for (
    const field of fields
  ) {
    const value =
      thread?.[field];

    if (
      value !== null &&
      value !== undefined &&
      value !== ''
    ) {
      const date =
        new Date(value);

      if (
        !Number.isNaN(
          date.getTime(),
        )
      ) {
        return date;
      }
    }
  }

  return null;
}

/**
 * Format a date for the current browser locale.
 */
function formatDate(
  value,
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return 'Date unavailable';
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * Relative timestamp.
 */
function formatRelativeTime(
  value,
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return 'Recently';
  }

  const difference =
    Date.now() -
    date.getTime();

  const seconds =
    Math.floor(
      Math.abs(
        difference,
      ) / 1000,
    );

  if (
    seconds < 60
  ) {
    return 'Just now';
  }

  const minutes =
    Math.floor(
      seconds / 60,
    );

  if (
    minutes < 60
  ) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (
    hours < 24
  ) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  if (
    days < 7
  ) {
    return `${days}d ago`;
  }

  return formatDate(
    date,
  );
}

/**
 * Normalize API-style error values into safe UI text.
 */
function getErrorMessage(
  error,
) {
  if (!error) {
    return DEFAULT_ERROR_MESSAGE;
  }

  if (
    typeof error ===
    'string'
  ) {
    return (
      safeString(
        error,
      ) ||
      DEFAULT_ERROR_MESSAGE
    );
  }

  return (
    safeString(
      error?.response?.data?.message,
    ) ||
    safeString(
      error?.data?.message,
    ) ||
    safeString(
      error?.message,
    ) ||
    DEFAULT_ERROR_MESSAGE
  );
}

/**
 * Case-insensitive search across relevant thread fields.
 */
function buildSearchText(
  thread,
) {
  return [
    getThreadTitle(thread),
    getThreadPreview(thread),
    getAuthorName(thread),
    getCategory(thread),
    safeString(thread?.groupName),
    safeString(thread?.tenantName),
    ...(Array.isArray(thread?.tags)
      ? thread.tags.map(
          (tag) =>
            safeString(
              typeof tag ===
                'object'
                ? tag?.name
                : tag,
            ),
        )
      : []),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Normalize a supplied thread.
 *
 * No financial interpretation is performed here.
 */
function normalizeThread(
  thread,
  index,
) {
  const id =
    getThreadId(
      thread,
      `savings-thread-${index}`,
    );

  const createdAt =
    getDateValue(
      thread,
      [
        'createdAt',
        'created_at',
        'created',
      ],
    );

  const updatedAt =
    getDateValue(
      thread,
      [
        'updatedAt',
        'updated_at',
        'lastActivityAt',
        'last_activity_at',
        'createdAt',
        'created_at',
      ],
    ) ||
    createdAt;

  return {
    raw: thread,
    id,
    title:
      getThreadTitle(thread),
    preview:
      getThreadPreview(thread),
    author:
      getAuthorName(thread),
    initials:
      getInitials(
        getAuthorName(thread),
      ),
    category:
      getCategory(thread),
    status:
      getStatus(thread),
    priority:
      getPriority(thread),
    replies: Math.max(
      0,
      Math.floor(
        safeNumber(
          thread?.replyCount ??
            thread?.replies ??
            thread?.messageCount,
          0,
        ),
      ),
    ),
    views: Math.max(
      0,
      Math.floor(
        safeNumber(
          thread?.viewCount ??
            thread?.views,
          0,
        ),
      ),
    ),
    pinned:
      Boolean(
        thread?.pinned ??
          thread?.isPinned,
      ),
    unread:
      Boolean(
        thread?.unread ??
          thread?.hasUnread,
      ),
    createdAt,
    updatedAt,
    groupName:
      safeString(
        thread?.groupName,
      ),
    tags:
      Array.isArray(
        thread?.tags,
      )
        ? thread.tags
            .map((tag) =>
              safeString(
                typeof tag ===
                  'object'
                  ? tag?.name
                  : tag,
              ),
            )
            .filter(Boolean)
        : [],
    searchText:
      buildSearchText(thread),
  };
}

/**
 * Sort normalized threads.
 */
function sortThreads(
  threads,
  sort,
) {
  const result =
    [...threads];

  result.sort(
    (a, b) => {
      if (
        a.pinned !==
        b.pinned
      ) {
        return a.pinned
          ? -1
          : 1;
      }

      if (
        sort ===
        'popular'
      ) {
        return (
          b.replies +
          b.views -
          (a.replies +
            a.views)
        );
      }

      if (
        sort ===
        'oldest'
      ) {
        return (
          (a.createdAt?.getTime() ||
            0) -
          (b.createdAt?.getTime() ||
            0)
        );
      }

      if (
        sort ===
        'active'
      ) {
        return (
          (b.updatedAt?.getTime() ||
            0) -
          (a.updatedAt?.getTime() ||
            0)
        );
      }

      return (
        (b.createdAt?.getTime() ||
          0) -
        (a.createdAt?.getTime() ||
          0)
      );
    },
  );

  return result;
}

/**
 * Build a compact pagination model.
 */
function buildPageItems(
  currentPage,
  totalPages,
) {
  if (
    totalPages <=
    MAX_VISIBLE_PAGES
  ) {
    return Array.from(
      {
        length: totalPages,
      },
      (_, index) =>
        index + 1,
    );
  }

  const items = [];

  items.push(1);

  const start =
    Math.max(
      2,
      currentPage - 2,
    );

  const end =
    Math.min(
      totalPages - 1,
      currentPage + 2,
    );

  if (
    start > 2
  ) {
    items.push(
      'ellipsis-start',
    );
  }

  for (
    let page = start;
    page <= end;
    page += 1
  ) {
    items.push(page);
  }

  if (
    end <
    totalPages - 1
  ) {
    items.push(
      'ellipsis-end',
    );
  }

  items.push(
    totalPages,
  );

  return items;
}

/* ============================================================================
 * PRESENTATIONAL ICONS
 * ========================================================================== */

function Icon({
  name,
  size = 18,
}) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };

  switch (name) {
    case 'search':
      return (
        <svg {...commonProps}>
          <circle
            cx="11"
            cy="11"
            r="7"
          />
          <path d="m20 20-4-4" />
        </svg>
      );

    case 'refresh':
      return (
        <svg {...commonProps}>
          <path d="M20 11a8.1 8.1 0 0 0-14.8-4.5L3 9" />
          <path d="M3 4v5h5" />
          <path d="M4 13a8.1 8.1 0 0 0 14.8 4.5L21 15" />
          <path d="M21 20v-5h-5" />
        </svg>
      );

    case 'plus':
      return (
        <svg {...commonProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );

    case 'message':
      return (
        <svg {...commonProps}>
          <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-4-.9L4 20l1.2-3.4A7.2 7.2 0 0 1 4 12a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 8 7Z" />
        </svg>
      );

    case 'eye':
      return (
        <svg {...commonProps}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
          <circle
            cx="12"
            cy="12"
            r="2.5"
          />
        </svg>
      );

    case 'chevron-left':
      return (
        <svg {...commonProps}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );

    case 'chevron-right':
      return (
        <svg {...commonProps}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );

    case 'lock':
      return (
        <svg {...commonProps}>
          <rect
            x="5"
            y="10"
            width="14"
            height="10"
            rx="2"
          />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );

    case 'pin':
      return (
        <svg {...commonProps}>
          <path d="m14 4 6 6-3 1-3 3 1 5-2 2-2-5-3-3-4 1-1-2 4-4 1-3-1-3 2-1 3 1 2-1Z" />
        </svg>
      );

    case 'filter':
      return (
        <svg {...commonProps}>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </svg>
      );

    case 'x':
      return (
        <svg {...commonProps}>
          <path d="m6 6 12 12" />
          <path d="m18 6-12 12" />
        </svg>
      );

    default:
      return null;
  }
}

Icon.propTypes = {
  name:
    PropTypes.string.isRequired,

  size:
    PropTypes.number,
};

/* ============================================================================
 * STATUS BADGE
 * ========================================================================== */

function StatusBadge({
  status,
}) {
  const label =
    status === 'resolved'
      ? 'Resolved'
      : status === 'locked'
        ? 'Locked'
        : 'Open';

  return (
    <span
      className={`titech-savings-thread__status titech-savings-thread__status--${status}`}
    >
      {label}
    </span>
  );
}

StatusBadge.propTypes = {
  status:
    PropTypes.oneOf([
      'open',
      'resolved',
      'locked',
    ]).isRequired,
};

/* ============================================================================
 * THREAD CARD
 * ========================================================================== */

const SavingsThreadCard =
  memo(function SavingsThreadCard({
    thread,
    onSelect,
    disabled,
  }) {
    const handleClick =
      useCallback(() => {
        if (
          disabled ||
          typeof onSelect !==
            'function'
        ) {
          return;
        }

        onSelect(
          thread.raw,
        );
      }, [
        disabled,
        onSelect,
        thread.raw,
      ]);

    const handleKeyDown =
      useCallback(
        (event) => {
          if (
            event.key ===
              'Enter' ||
            event.key ===
              ' '
          ) {
            event.preventDefault();
            handleClick();
          }
        },
        [handleClick],
      );

    return (
      <article
        className={[
          'titech-savings-thread',
          thread.unread
            ? 'titech-savings-thread--unread'
            : '',
          thread.pinned
            ? 'titech-savings-thread--pinned'
            : '',
          disabled
            ? 'titech-savings-thread--disabled'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={`titech-savings-thread-${thread.id}`}
      >
        <button
          type="button"
          className="titech-savings-thread__surface"
          onClick={handleClick}
          onKeyDown={
            handleKeyDown
          }
          disabled={disabled}
          aria-label={`Open savings discussion: ${thread.title}`}
        >
          <div className="titech-savings-thread__avatar">
            {thread.initials}
          </div>

          <div className="titech-savings-thread__content">
            <div className="titech-savings-thread__topline">
              <div className="titech-savings-thread__title-row">
                {thread.pinned && (
                  <span
                    className="titech-savings-thread__pin"
                    title="Pinned discussion"
                    aria-label="Pinned discussion"
                  >
                    <Icon
                      name="pin"
                      size={15}
                    />
                  </span>
                )}

                <h3 className="titech-savings-thread__title">
                  {thread.title}
                </h3>

                {thread.unread && (
                  <span
                    className="titech-savings-thread__unread"
                    aria-label="Unread"
                  />
                )}
              </div>

              <time
                className="titech-savings-thread__time"
                dateTime={
                  thread.updatedAt
                    ? thread.updatedAt.toISOString()
                    : undefined
                }
                title={
                  thread.updatedAt
                    ? formatDate(
                        thread.updatedAt,
                      )
                    : undefined
                }
              >
                {formatRelativeTime(
                  thread.updatedAt,
                )}
              </time>
            </div>

            <p className="titech-savings-thread__preview">
              {thread.preview}
            </p>

            <div className="titech-savings-thread__meta">
              <span>
                {thread.author}
              </span>

              {thread.groupName && (
                <>
                  <span aria-hidden="true">
                    ·
                  </span>
                  <span>
                    {thread.groupName}
                  </span>
                </>
              )}

              <span aria-hidden="true">
                ·
              </span>

              <span className="titech-savings-thread__category">
                {CATEGORY_OPTIONS.find(
                  (item) =>
                    item.value ===
                    thread.category,
                )?.label ||
                  'General'}
              </span>
            </div>

            <div className="titech-savings-thread__footer">
              <StatusBadge
                status={
                  thread.status
                }
              />

              {thread.priority !==
                'normal' && (
                <span
                  className={`titech-savings-thread__priority titech-savings-thread__priority--${thread.priority}`}
                >
                  {thread.priority}
                </span>
              )}

              <span className="titech-savings-thread__metric">
                <Icon
                  name="message"
                  size={15}
                />
                <span>
                  {thread.replies}
                </span>
              </span>

              {thread.views >
                0 && (
                <span className="titech-savings-thread__metric">
                  <Icon
                    name="eye"
                    size={15}
                  />
                  <span>
                    {thread.views}
                  </span>
                </span>
              )}

              {thread.tags
                .slice(
                  0,
                  3,
                )
                .map(
                  (tag) => (
                    <span
                      key={`${thread.id}-${tag}`}
                      className="titech-savings-thread__tag"
                    >
                      {tag}
                    </span>
                  ),
                )}

              {thread.status ===
                'locked' && (
                <span
                  className="titech-savings-thread__locked"
                  aria-label="Discussion locked"
                  title="Discussion locked"
                >
                  <Icon
                    name="lock"
                    size={14}
                  />
                </span>
              )}
            </div>
          </div>
        </button>
      </article>
    );
  });

SavingsThreadCard.displayName =
  'SavingsThreadCard';

SavingsThreadCard.propTypes = {
  thread:
    PropTypes.shape({
      id:
        PropTypes.string.isRequired,
      title:
        PropTypes.string.isRequired,
      preview:
        PropTypes.string.isRequired,
      author:
        PropTypes.string.isRequired,
      initials:
        PropTypes.string.isRequired,
      category:
        PropTypes.string.isRequired,
      status:
        PropTypes.string.isRequired,
      priority:
        PropTypes.string.isRequired,
      replies:
        PropTypes.number.isRequired,
      views:
        PropTypes.number.isRequired,
      pinned:
        PropTypes.bool.isRequired,
      unread:
        PropTypes.bool.isRequired,
      groupName:
        PropTypes.string.isRequired,
      tags:
        PropTypes.arrayOf(
          PropTypes.string,
        ).isRequired,
      raw:
        PropTypes.object.isRequired,
    }).isRequired,

  onSelect:
    PropTypes.func,

  disabled:
    PropTypes.bool,
};

/* ============================================================================
 * SKELETON
 * ========================================================================== */

function ThreadSkeleton() {
  return (
    <div
      className="titech-savings-thread-skeleton"
      aria-hidden="true"
    >
      <div className="titech-savings-thread-skeleton__avatar" />

      <div className="titech-savings-thread-skeleton__body">
        <div className="titech-savings-thread-skeleton__line titech-savings-thread-skeleton__line--title" />
        <div className="titech-savings-thread-skeleton__line" />
        <div className="titech-savings-thread-skeleton__line titech-savings-thread-skeleton__line--short" />
      </div>
    </div>
  );
}

/* ============================================================================
 * EMPTY STATE
 * ========================================================================== */

function EmptyState({
  title,
  description,
  onClearFilters,
  onCreateThread,
  canCreate,
}) {
  return (
    <section
      className="titech-savings-threads__empty"
      aria-live="polite"
    >
      <div
        className="titech-savings-threads__empty-icon"
        aria-hidden="true"
      >
        <Icon
          name="message"
          size={32}
        />
      </div>

      <h2>
        {title}
      </h2>

      <p>
        {description}
      </p>

      <div className="titech-savings-threads__empty-actions">
        {onClearFilters && (
          <button
            type="button"
            className="titech-savings-threads__button titech-savings-threads__button--secondary"
            onClick={
              onClearFilters
            }
          >
            Clear filters
          </button>
        )}

        {canCreate &&
          onCreateThread && (
            <button
              type="button"
              className="titech-savings-threads__button titech-savings-threads__button--primary"
              onClick={
                onCreateThread
              }
            >
              <Icon
                name="plus"
                size={17}
              />
              {DEFAULT_NEW_THREAD_LABEL}
            </button>
          )}
      </div>
    </section>
  );
}

EmptyState.propTypes = {
  title:
    PropTypes.string.isRequired,

  description:
    PropTypes.string.isRequired,

  onClearFilters:
    PropTypes.func,

  onCreateThread:
    PropTypes.func,

  canCreate:
    PropTypes.bool,
};

/* ============================================================================
 * ERROR STATE
 * ========================================================================== */

function ErrorState({
  error,
  onRetry,
}) {
  return (
    <section
      className="titech-savings-threads__error"
      role="alert"
    >
      <h2>
        Unable to load discussions
      </h2>

      <p>
        {getErrorMessage(
          error,
        )}
      </p>

      {onRetry && (
        <button
          type="button"
          className="titech-savings-threads__button titech-savings-threads__button--primary"
          onClick={onRetry}
        >
          {DEFAULT_RETRY_LABEL}
        </button>
      )}
    </section>
  );
}

ErrorState.propTypes = {
  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  onRetry:
    PropTypes.func,
};

/* ============================================================================
 * UNAUTHORIZED STATE
 * ========================================================================== */

function UnauthorizedState() {
  return (
    <section
      className="titech-savings-threads__unauthorized"
      role="status"
    >
      <h2>
        Access unavailable
      </h2>

      <p>
        {DEFAULT_UNAUTHORIZED_MESSAGE}
      </p>
    </section>
  );
}

/* ============================================================================
 * PAGINATION
 * ========================================================================== */

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  disabled,
}) {
  const pageItems =
    useMemo(
      () =>
        buildPageItems(
          currentPage,
          totalPages,
        ),
      [
        currentPage,
        totalPages,
      ],
    );

  if (
    totalPages <= 1
  ) {
    return null;
  }

  return (
    <nav
      className="titech-savings-threads__pagination"
      aria-label="Savings discussion pages"
    >
      <button
        type="button"
        className="titech-savings-threads__pagination-button"
        onClick={() =>
          onPageChange(
            currentPage - 1,
          )
        }
        disabled={
          disabled ||
          currentPage <= 1
        }
        aria-label="Previous page"
      >
        <Icon
          name="chevron-left"
          size={17}
        />
      </button>

      {pageItems.map(
        (item) => {
          if (
            typeof item ===
            'string'
          ) {
            return (
              <span
                key={item}
                className="titech-savings-threads__pagination-ellipsis"
                aria-hidden="true"
              >
                …
              </span>
            );
          }

          return (
            <button
              key={item}
              type="button"
              className={[
                'titech-savings-threads__pagination-button',
                item ===
                currentPage
                  ? 'is-active'
                  : '',
              ]
                .filter(
                  Boolean,
                )
                .join(' ')}
              onClick={() =>
                onPageChange(
                  item,
                )
              }
              disabled={
                disabled
              }
              aria-current={
                item ===
                currentPage
                  ? 'page'
                  : undefined
              }
            >
              {item}
            </button>
          );
        },
      )}

      <button
        type="button"
        className="titech-savings-threads__pagination-button"
        onClick={() =>
          onPageChange(
            currentPage + 1,
          )
        }
        disabled={
          disabled ||
          currentPage >=
            totalPages
        }
        aria-label="Next page"
      >
        <Icon
          name="chevron-right"
          size={17}
        />
      </button>
    </nav>
  );
}

Pagination.propTypes = {
  currentPage:
    PropTypes.number.isRequired,

  totalPages:
    PropTypes.number.isRequired,

  onPageChange:
    PropTypes.func.isRequired,

  disabled:
    PropTypes.bool,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

function SavingsThreads({
  threads = [],
  loading = false,
  error = null,
  unauthorized = false,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  searchPlaceholder =
    DEFAULT_SEARCH_PLACEHOLDER,
  pageSize = DEFAULT_PAGE_SIZE,
  initialSearch = '',
  initialCategory = 'all',
  initialStatus = 'all',
  initialPriority = 'all',
  initialSort = DEFAULT_SORT,
  canCreate = true,
  canRefresh = true,
  onThreadSelect,
  onCreateThread,
  onRefresh,
  onSearchChange,
  onFilterChange,
  onPageChange,
  currentPage: controlledPage,
  totalPages: controlledTotalPages,
  totalCount,
  className = '',
  testId = 'titech-savings-threads',
}) {
  const componentId =
    useId();

  const searchInputId =
    `${componentId}-search`;

  const categoryId =
    `${componentId}-category`;

  const statusId =
    `${componentId}-status`;

  const priorityId =
    `${componentId}-priority`;

  const sortId =
    `${componentId}-sort`;

  const liveRegionId =
    `${componentId}-status`;

  const [search, setSearch] =
    useState(
      safeString(
        initialSearch,
      ).slice(
        0,
        MAX_SEARCH_LENGTH,
      ),
    );

  const [category, setCategory] =
    useState(
      initialCategory,
    );

  const [status, setStatus] =
    useState(
      initialStatus,
    );

  const [priority, setPriority] =
    useState(
      initialPriority,
    );

  const [sort, setSort] =
    useState(
      SORT_OPTIONS.some(
        (option) =>
          option.value ===
          initialSort,
      )
        ? initialSort
        : DEFAULT_SORT,
    );

  const [internalPage, setInternalPage] =
    useState(1);

  const [refreshing, setRefreshing] =
    useState(false);

  const [announcement, setAnnouncement] =
    useState('');

  const mountedRef =
    useRef(true);

  const searchInputRef =
    useRef(null);

  /* ==========================================================================
   * LIFECYCLE
   * ======================================================================== */

  useEffect(
    () => {
      mountedRef.current =
        true;

      return () => {
        mountedRef.current =
          false;
      };
    },
    [],
  );

  /* ==========================================================================
   * NORMALIZED DATA
   * ======================================================================== */

  const normalizedThreads =
    useMemo(
      () =>
        Array.isArray(
          threads,
        )
          ? threads.map(
              normalizeThread,
            )
          : [],
      [threads],
    );

  /* ==========================================================================
   * FILTERING / SEARCH
   * ======================================================================== */

  const filteredThreads =
    useMemo(() => {
      const normalizedSearch =
        safeString(
          search,
        )
          .toLowerCase()
          .trim();

      const filtered =
        normalizedThreads.filter(
          (thread) => {
            const matchesSearch =
              !normalizedSearch ||
              thread.searchText.includes(
                normalizedSearch,
              );

            const matchesCategory =
              category ===
                'all' ||
              thread.category ===
                category;

            const matchesStatus =
              status ===
                'all' ||
              thread.status ===
                status;

            const matchesPriority =
              priority ===
                'all' ||
              thread.priority ===
                priority;

            return (
              matchesSearch &&
              matchesCategory &&
              matchesStatus &&
              matchesPriority
            );
          },
        );

      return sortThreads(
        filtered,
        sort,
      );
    }, [
      normalizedThreads,
      search,
      category,
      status,
      priority,
      sort,
    ]);

  /* ==========================================================================
   * PAGINATION
   * ======================================================================== */

  const effectivePageSize =
    clamp(
      Math.floor(
        safeNumber(
          pageSize,
          DEFAULT_PAGE_SIZE,
        ),
      ),
      1,
      100,
    );

  const isControlledPage =
    Number.isInteger(
      controlledPage,
    ) &&
    controlledPage >= 1;

  const currentPage =
    isControlledPage
      ? controlledPage
      : internalPage;

  const calculatedTotalPages =
    Math.max(
      1,
      Math.ceil(
        filteredThreads.length /
          effectivePageSize,
      ),
    );

  const totalPages =
    Number.isInteger(
      controlledTotalPages,
    ) &&
    controlledTotalPages >= 1
      ? controlledTotalPages
      : calculatedTotalPages;

  const visibleThreads =
    useMemo(() => {
      /*
       * When the parent owns pagination, the supplied `threads` are assumed
       * to represent the current server page.
       */
      if (
        Number.isInteger(
          controlledTotalPages,
        ) &&
        controlledTotalPages >
          1
      ) {
        return filteredThreads;
      }

      const start =
        (currentPage - 1) *
        effectivePageSize;

      return filteredThreads.slice(
        start,
        start +
          effectivePageSize,
      );
    }, [
      controlledTotalPages,
      filteredThreads,
      currentPage,
      effectivePageSize,
    ]);

  /* ==========================================================================
   * FILTER / SEARCH HELPERS
   * ======================================================================== */

  const hasActiveFilters =
    Boolean(
      search.trim() ||
        category !== 'all' ||
        status !== 'all' ||
        priority !== 'all' ||
        sort !== DEFAULT_SORT,
    );

  const announce =
    useCallback(
      (message) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setAnnouncement(
          safeString(
            message,
          ),
        );
      },
      [],
    );

  const resetPage =
    useCallback(() => {
      if (
        !isControlledPage
      ) {
        setInternalPage(
          1,
        );
      }

      if (
        typeof onPageChange ===
        'function'
      ) {
        onPageChange(
          1,
        );
      }
    }, [
      isControlledPage,
      onPageChange,
    ]);

  const handleSearchChange =
    useCallback(
      (event) => {
        const nextValue =
          safeString(
            event?.target?.value,
          ).slice(
            0,
            MAX_SEARCH_LENGTH,
          );

        setSearch(
          nextValue,
        );

        resetPage();

        if (
          typeof onSearchChange ===
          'function'
        ) {
          onSearchChange(
            nextValue,
          );
        }
      },
      [
        onSearchChange,
        resetPage,
      ],
    );

  const handleCategoryChange =
    useCallback(
      (event) => {
        const nextValue =
          safeString(
            event?.target?.value,
            'all',
          );

        setCategory(
          nextValue,
        );

        resetPage();

        if (
          typeof onFilterChange ===
          'function'
        ) {
          onFilterChange({
            search,
            category:
              nextValue,
            status,
            priority,
            sort,
          });
        }
      },
      [
        onFilterChange,
        priority,
        resetPage,
        search,
        sort,
        status,
      ],
    );

  const handleStatusChange =
    useCallback(
      (event) => {
        const nextValue =
          safeString(
            event?.target?.value,
            'all',
          );

        setStatus(
          nextValue,
        );

        resetPage();

        if (
          typeof onFilterChange ===
          'function'
        ) {
          onFilterChange({
            search,
            category,
            status:
              nextValue,
            priority,
            sort,
          });
        }
      },
      [
        onFilterChange,
        category,
        priority,
        resetPage,
        search,
        sort,
      ],
    );

  const handlePriorityChange =
    useCallback(
      (event) => {
        const nextValue =
          safeString(
            event?.target?.value,
            'all',
          );

        setPriority(
          nextValue,
        );

        resetPage();

        if (
          typeof onFilterChange ===
          'function'
        ) {
          onFilterChange({
            search,
            category,
            status,
            priority:
              nextValue,
            sort,
          });
        }
      },
      [
        onFilterChange,
        category,
        resetPage,
        search,
        sort,
        status,
      ],
    );

  const handleSortChange =
    useCallback(
      (event) => {
        const nextValue =
          safeString(
            event?.target?.value,
            DEFAULT_SORT,
          );

        setSort(
          nextValue,
        );

        resetPage();

        if (
          typeof onFilterChange ===
          'function'
        ) {
          onFilterChange({
            search,
            category,
            status,
            priority,
            sort:
              nextValue,
          });
        }
      },
      [
        onFilterChange,
        category,
        priority,
        resetPage,
        search,
        status,
      ],
    );

  const clearFilters =
    useCallback(() => {
      setSearch('');
      setCategory('all');
      setStatus('all');
      setPriority('all');
      setSort(
        DEFAULT_SORT,
      );

      if (
        !isControlledPage
      ) {
        setInternalPage(
          1,
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

      if (
        typeof onFilterChange ===
        'function'
      ) {
        onFilterChange({
          search: '',
          category: 'all',
          status: 'all',
          priority: 'all',
          sort:
            DEFAULT_SORT,
        });
      }

      if (
        typeof onPageChange ===
        'function'
      ) {
        onPageChange(
          1,
        );
      }

      announce(
        'Savings discussion filters cleared.',
      );

      searchInputRef.current?.focus();
    }, [
      announce,
      isControlledPage,
      onFilterChange,
      onPageChange,
      onSearchChange,
    ]);

  /* ==========================================================================
   * PAGE HANDLING
   * ======================================================================== */

  const handlePageChange =
    useCallback(
      (page) => {
        const nextPage =
          clamp(
            Math.floor(
              safeNumber(
                page,
                1,
              ),
            ),
            1,
            Math.max(
              1,
              totalPages,
            ),
          );

        if (
          !isControlledPage
        ) {
          setInternalPage(
            nextPage,
          );
        }

        if (
          typeof onPageChange ===
          'function'
        ) {
          onPageChange(
            nextPage,
          );
        }

        announce(
          `Savings discussions page ${nextPage} of ${totalPages}.`,
        );
      },
      [
        announce,
        isControlledPage,
        onPageChange,
        totalPages,
      ],
    );

  /* ==========================================================================
   * REFRESH
   * ======================================================================== */

  const handleRefresh =
    useCallback(async () => {
      if (
        typeof onRefresh !==
        'function' ||
        refreshing
      ) {
        return;
      }

      try {
        setRefreshing(
          true,
        );

        await Promise.resolve(
          onRefresh(),
        );

        announce(
          'Savings discussions refreshed.',
        );
      } catch (refreshError) {
        announce(
          getErrorMessage(
            refreshError,
          ),
        );
      } finally {
        if (
          mountedRef.current
        ) {
          setRefreshing(
            false,
          );
        }
      }
    }, [
      announce,
      onRefresh,
      refreshing,
    ]);

  /* ==========================================================================
   * KEYBOARD SHORTCUTS
   * ======================================================================== */

  useEffect(() => {
    const handleKeyDown =
      (event) => {
        /*
         * "/" focuses search unless the user is already typing somewhere.
         */
        if (
          event.key !==
          '/' ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }

        const target =
          event.target;

        const tagName =
          safeString(
            target?.tagName,
          ).toLowerCase();

        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target?.isContentEditable
        ) {
          return;
        }

        event.preventDefault();

        searchInputRef.current?.focus();
      };

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
  }, []);

  /* ==========================================================================
   * RESULTS ANNOUNCEMENT
   * ======================================================================== */

  useEffect(() => {
    if (
      loading ||
      unauthorized
    ) {
      return;
    }

    const count =
      totalCount ??
      filteredThreads.length;

    announce(
      `${count} savings discussion${count === 1 ? '' : 's'} available.`,
    );
  }, [
    announce,
    filteredThreads.length,
    loading,
    totalCount,
    unauthorized,
  ]);

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  const rootClassName =
    [
      'titech-savings-threads',
      className,
    ]
      .filter(Boolean)
      .join(' ');

  if (
    unauthorized
  ) {
    return (
      <main
        className={rootClassName}
        data-testid={testId}
      >
        <UnauthorizedState />
      </main>
    );
  }

  return (
    <main
      className={rootClassName}
      data-testid={testId}
      aria-labelledby={`${componentId}-title`}
    >
      {/* ======================================================================
          HEADER
          ==================================================================== */}

      <header className="titech-savings-threads__header">
        <div className="titech-savings-threads__heading">
          <div className="titech-savings-threads__eyebrow">
            TITechChat
          </div>

          <h1
            id={`${componentId}-title`}
            className="titech-savings-threads__title"
          >
            {title}
          </h1>

          <p className="titech-savings-threads__description">
            {description}
          </p>
        </div>

        <div className="titech-savings-threads__header-actions">
          {canRefresh &&
            onRefresh && (
              <button
                type="button"
                className="titech-savings-threads__button titech-savings-threads__button--secondary"
                onClick={
                  handleRefresh
                }
                disabled={
                  loading ||
                  refreshing
                }
                aria-label={
                  refreshing
                    ? 'Refreshing savings discussions'
                    : DEFAULT_REFRESH_LABEL
                }
              >
                <Icon
                  name="refresh"
                  size={17}
                />
                {refreshing
                  ? 'Refreshing…'
                  : DEFAULT_REFRESH_LABEL}
              </button>
            )}

          {canCreate &&
            onCreateThread && (
              <button
                type="button"
                className="titech-savings-threads__button titech-savings-threads__button--primary"
                onClick={
                  onCreateThread
                }
              >
                <Icon
                  name="plus"
                  size={17}
                />
                {DEFAULT_NEW_THREAD_LABEL}
              </button>
            )}
        </div>
      </header>

      {/* ======================================================================
          TOOLBAR
          ==================================================================== */}

      <section
        className="titech-savings-threads__toolbar"
        aria-label="Savings discussion filters"
      >
        <div className="titech-savings-threads__search">
          <label
            htmlFor={
              searchInputId
            }
            className="titech-savings-threads__sr-only"
          >
            Search savings discussions
          </label>

          <span
            className="titech-savings-threads__search-icon"
            aria-hidden="true"
          >
            <Icon
              name="search"
              size={18}
            />
          </span>

          <input
            ref={
              searchInputRef
            }
            id={
              searchInputId
            }
            type="search"
            value={search}
            onChange={
              handleSearchChange
            }
            placeholder={
              searchPlaceholder
            }
            maxLength={
              MAX_SEARCH_LENGTH
            }
            autoComplete="off"
            spellCheck="false"
            aria-describedby={`${searchInputId}-hint`}
          />

          {search && (
            <button
              type="button"
              className="titech-savings-threads__search-clear"
              onClick={() =>
                handleSearchChange({
                  target: {
                    value: '',
                  },
                })
              }
              aria-label="Clear search"
            >
              <Icon
                name="x"
                size={16}
              />
            </button>
          )}

          <span
            id={`${searchInputId}-hint`}
            className="titech-savings-threads__search-hint"
          >
            Press /
            {' '}
            to focus
          </span>
        </div>

        <div className="titech-savings-threads__filters">
          <div className="titech-savings-threads__filter">
            <label
              htmlFor={
                categoryId
              }
            >
              Topic
            </label>

            <select
              id={
                categoryId
              }
              value={category}
              onChange={
                handleCategoryChange
              }
            >
              {CATEGORY_OPTIONS.map(
                (option) => (
                  <option
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="titech-savings-threads__filter">
            <label
              htmlFor={
                statusId
              }
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
              {STATUS_OPTIONS.map(
                (option) => (
                  <option
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="titech-savings-threads__filter">
            <label
              htmlFor={
                priorityId
              }
            >
              Priority
            </label>

            <select
              id={
                priorityId
              }
              value={
                priority
              }
              onChange={
                handlePriorityChange
              }
            >
              {PRIORITY_OPTIONS.map(
                (option) => (
                  <option
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="titech-savings-threads__filter">
            <label
              htmlFor={
                sortId
              }
            >
              Sort
            </label>

            <select
              id={sortId}
              value={sort}
              onChange={
                handleSortChange
              }
            >
              {SORT_OPTIONS.map(
                (option) => (
                  <option
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </option>
                ),
              )}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="titech-savings-threads__clear-filters"
              onClick={
                clearFilters
              }
            >
              <Icon
                name="filter"
                size={15}
              />
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* ======================================================================
          RESULT SUMMARY
          ==================================================================== */}

      <div className="titech-savings-threads__summary">
        <div>
          <strong>
            {totalCount ??
              filteredThreads.length}
          </strong>{' '}
          discussion
          {(totalCount ??
            filteredThreads.length) ===
          1
            ? ''
            : 's'}
        </div>

        {hasActiveFilters && (
          <div className="titech-savings-threads__summary-filtered">
            Filtered results
          </div>
        )}
      </div>

      {/* ======================================================================
          ERROR
          ==================================================================== */}

      {error && !loading ? (
        <ErrorState
          error={error}
          onRetry={
            onRefresh
              ? handleRefresh
              : undefined
          }
        />
      ) : (
        <>
          {/* ================================================================
              THREAD LIST
              ================================================================ */}

          <section
            className="titech-savings-threads__list"
            aria-label="Savings discussions"
            aria-busy={
              loading ||
              refreshing
            }
          >
            {loading ? (
              <>
                <ThreadSkeleton />
                <ThreadSkeleton />
                <ThreadSkeleton />
                <ThreadSkeleton />
                <ThreadSkeleton />
              </>
            ) : visibleThreads.length >
              0 ? (
              visibleThreads.map(
                (thread) => (
                  <SavingsThreadCard
                    key={
                      thread.id
                    }
                    thread={
                      thread
                    }
                    onSelect={
                      onThreadSelect
                    }
                    disabled={
                      refreshing
                    }
                  />
                ),
              )
            ) : (
              <EmptyState
                title={
                  hasActiveFilters
                    ? 'No matching discussions'
                    : DEFAULT_EMPTY_TITLE
                }
                description={
                  hasActiveFilters
                    ? 'Try changing your search or filters to find other savings discussions.'
                    : DEFAULT_EMPTY_DESCRIPTION
                }
                onClearFilters={
                  hasActiveFilters
                    ? clearFilters
                    : undefined
                }
                onCreateThread={
                  onCreateThread
                }
                canCreate={
                  canCreate
                }
              />
            )}
          </section>

          {/* ================================================================
              PAGINATION
              ================================================================ */}

          {!loading &&
            visibleThreads.length >
              0 && (
              <Pagination
                currentPage={
                  currentPage
                }
                totalPages={
                  totalPages
                }
                onPageChange={
                  handlePageChange
                }
                disabled={
                  refreshing
                }
              />
            )}
        </>
      )}

      {/* ======================================================================
          ACCESSIBILITY LIVE REGION
          ==================================================================== */}

      <div
        id={liveRegionId}
        className="titech-savings-threads__sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
    </main>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

SavingsThreads.propTypes = {
  /**
   * Thread records supplied by the parent/API/Redux layer.
   */
  threads:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  /**
   * Whether the parent is currently loading data.
   */
  loading:
    PropTypes.bool,

  /**
   * Optional API/application error.
   */
  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  /**
   * Whether access to this resource is unavailable.
   */
  unauthorized:
    PropTypes.bool,

  /**
   * Presentation metadata.
   */
  title:
    PropTypes.string,

  description:
    PropTypes.string,

  searchPlaceholder:
    PropTypes.string,

  /**
   * Client-side page size.
   */
  pageSize:
    PropTypes.number,

  /**
   * Initial filter values.
   */
  initialSearch:
    PropTypes.string,

  initialCategory:
    PropTypes.string,

  initialStatus:
    PropTypes.string,

  initialPriority:
    PropTypes.string,

  initialSort:
    PropTypes.string,

  /**
   * Capabilities.
   */
  canCreate:
    PropTypes.bool,

  canRefresh:
    PropTypes.bool,

  /**
   * Parent/application callbacks.
   */
  onThreadSelect:
    PropTypes.func,

  onCreateThread:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onSearchChange:
    PropTypes.func,

  onFilterChange:
    PropTypes.func,

  onPageChange:
    PropTypes.func,

  /**
   * Controlled pagination support.
   */
  currentPage:
    PropTypes.number,

  totalPages:
    PropTypes.number,

  totalCount:
    PropTypes.number,

  /**
   * Presentation/test integration.
   */
  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};

/* ============================================================================
 * EXPORT
 * ========================================================================== */

export default memo(
  SavingsThreads,
);