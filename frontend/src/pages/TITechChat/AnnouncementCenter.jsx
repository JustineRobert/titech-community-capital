/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Announcement Center
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/AnnouncementCenter.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade announcement center for TITech Community Capital's
 *   TITechChat experience.
 *
 * Responsibilities:
 *   - Display platform and community announcements.
 *   - Support announcement priority and severity.
 *   - Support pinned, unread and dismissed states.
 *   - Provide search and category filtering.
 *   - Provide accessible announcement navigation.
 *   - Support announcement deep links through URL hashes.
 *   - Provide copy-link functionality.
 *   - Support optional announcement actions.
 *   - Respect reduced-motion accessibility preferences.
 *   - Remain independent from backend implementation details.
 *   - Provide predictable rendering for loading, error and empty states.
 *
 * Architectural principles:
 *   - Presentation-layer responsibility.
 *   - Backend-agnostic.
 *   - Defensive browser API usage.
 *   - Accessible by default.
 *   - No direct API calls from this component.
 *   - No persistence assumptions.
 *
 * Branding:
 *   TITech Community Capital
 *
 * Important:
 *   This component is a presentation and interaction layer.
 *   Persistence, authorization, delivery and audit requirements should be
 *   implemented by the appropriate application services.
 *
 * ============================================================================
 */

'use strict';

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_VERSION = '3.0.0';

const DEFAULT_PAGE_SIZE = 20;

const DEFAULT_CATEGORY = 'all';

const DEFAULT_STATUS_FILTER = 'all';

const DEFAULT_PRIORITY_FILTER = 'all';

const COPY_RESET_DELAY = 2500;

const HASH_PREFIX = 'announcement-';

const ANNOUNCEMENT_CATEGORIES = Object.freeze([
  'all',
  'platform',
  'security',
  'maintenance',
  'community',
  'financial',
  'policy',
  'feature',
  'system',
]);

const ANNOUNCEMENT_PRIORITIES = Object.freeze([
  'all',
  'critical',
  'high',
  'normal',
  'low',
]);

const ANNOUNCEMENT_STATUSES = Object.freeze([
  'all',
  'unread',
  'read',
  'active',
  'dismissed',
]);

const PRIORITY_RANK = Object.freeze({
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
});

const CATEGORY_LABELS = Object.freeze({
  all: 'All',
  platform: 'Platform',
  security: 'Security',
  maintenance: 'Maintenance',
  community: 'Community',
  financial: 'Financial',
  policy: 'Policy',
  feature: 'Features',
  system: 'System',
});

const PRIORITY_LABELS = Object.freeze({
  all: 'All priorities',
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
});

const STATUS_LABELS = Object.freeze({
  all: 'All',
  unread: 'Unread',
  read: 'Read',
  active: 'Active',
  dismissed: 'Dismissed',
});

const SEVERITY_LABELS = Object.freeze({
  critical: 'Critical announcement',
  high: 'High-priority announcement',
  normal: 'Announcement',
  low: 'Low-priority announcement',
});

/* ============================================================================
 * UTILITY HELPERS
 * ========================================================================== */

function normalizeString(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function normalizeId(value) {
  return normalizeString(value);
}

function normalizeCategory(value) {
  const category = normalizeString(value).toLowerCase();

  return ANNOUNCEMENT_CATEGORIES.includes(category)
    ? category
    : 'platform';
}

function normalizePriority(value) {
  const priority = normalizeString(value).toLowerCase();

  return ANNOUNCEMENT_PRIORITIES.includes(priority)
    ? priority
    : 'normal';
}

function isBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

function prefersReducedMotion() {
  if (
    !isBrowser() ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
}

function formatAnnouncementDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function isAnnouncementExpired(announcement, now = Date.now()) {
  if (!announcement?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(
    announcement.expiresAt,
  ).getTime();

  return (
    Number.isFinite(expiresAt) &&
    expiresAt <= now
  );
}

function isAnnouncementActive(announcement, now = Date.now()) {
  if (!announcement) {
    return false;
  }

  const publishedAt = announcement.publishedAt
    ? new Date(announcement.publishedAt).getTime()
    : null;

  const startsAt = announcement.startsAt
    ? new Date(announcement.startsAt).getTime()
    : null;

  const effectiveStart =
    Number.isFinite(startsAt)
      ? startsAt
      : Number.isFinite(publishedAt)
        ? publishedAt
        : null;

  if (
    effectiveStart !== null &&
    effectiveStart > now
  ) {
    return false;
  }

  return !isAnnouncementExpired(
    announcement,
    now,
  );
}

function normalizeAnnouncement(
  announcement,
  index = 0,
) {
  const safeAnnouncement =
    announcement && typeof announcement === 'object'
      ? announcement
      : {};

  const fallbackId =
    `announcement-${index + 1}`;

  const id =
    normalizeId(safeAnnouncement.id) ||
    fallbackId;

  const category =
    normalizeCategory(
      safeAnnouncement.category,
    );

  const priority =
    normalizePriority(
      safeAnnouncement.priority,
    );

  const title =
    normalizeString(
      safeAnnouncement.title,
    ) ||
    'TITech Community Capital Announcement';

  const body =
    normalizeString(
      safeAnnouncement.body ||
        safeAnnouncement.message ||
        safeAnnouncement.description,
    );

  return {
    ...safeAnnouncement,

    id,

    title,

    body,

    category,

    priority,

    publishedAt:
      safeAnnouncement.publishedAt ||
      safeAnnouncement.createdAt ||
      null,

    startsAt:
      safeAnnouncement.startsAt ||
      null,

    expiresAt:
      safeAnnouncement.expiresAt ||
      null,

    pinned:
      Boolean(
        safeAnnouncement.pinned,
      ),

    read:
      Boolean(
        safeAnnouncement.read,
      ),

    dismissed:
      Boolean(
        safeAnnouncement.dismissed,
      ),

    author:
      normalizeString(
        safeAnnouncement.author,
      ),

    authorRole:
      normalizeString(
        safeAnnouncement.authorRole,
      ),

    actionLabel:
      normalizeString(
        safeAnnouncement.actionLabel,
      ),

    actionUrl:
      normalizeString(
        safeAnnouncement.actionUrl,
      ),

    tags:
      Array.isArray(
        safeAnnouncement.tags,
      )
        ? safeAnnouncement.tags
            .map(normalizeString)
            .filter(Boolean)
        : [],
  };
}

function announcementMatchesSearch(
  announcement,
  query,
) {
  const normalizedQuery =
    normalizeString(query).toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    announcement.title,
    announcement.body,
    announcement.category,
    announcement.priority,
    announcement.author,
    announcement.authorRole,
    ...(announcement.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchableText.includes(
    normalizedQuery,
  );
}

function buildAnnouncementHash(id) {
  return `#${HASH_PREFIX}${encodeURIComponent(id)}`;
}

function getAnnouncementFromHash(
  hash,
) {
  if (
    typeof hash !== 'string' ||
    !hash.startsWith(
      `#${HASH_PREFIX}`,
    )
  ) {
    return '';
  }

  const encodedId =
    hash.slice(
      HASH_PREFIX.length + 1,
    );

  if (!encodedId) {
    return '';
  }

  try {
    return decodeURIComponent(
      encodedId,
    );
  } catch {
    return encodedId;
  }
}

/* ============================================================================
 * PRESENTATIONAL COMPONENTS
 * ========================================================================== */

function AnnouncementBadge({
  priority,
}) {
  const normalizedPriority =
    normalizePriority(priority);

  return (
    <span
      className={`titech-announcement__badge titech-announcement__badge--${normalizedPriority}`}
      aria-label={
        SEVERITY_LABELS[
          normalizedPriority
        ]
      }
    >
      {PRIORITY_LABELS[
        normalizedPriority
      ]}
    </span>
  );
}

AnnouncementBadge.propTypes = {
  priority:
    PropTypes.string,
};

function AnnouncementMeta({
  announcement,
}) {
  const formattedDate =
    formatAnnouncementDate(
      announcement.publishedAt,
    );

  return (
    <div
      className="titech-announcement__meta"
      aria-label="Announcement metadata"
    >
      <span>
        {CATEGORY_LABELS[
          announcement.category
        ] || 'Platform'}
      </span>

      {formattedDate && (
        <>
          <span
            aria-hidden="true"
          >
            ·
          </span>

          <time
            dateTime={
              announcement.publishedAt
            }
          >
            {formattedDate}
          </time>
        </>
      )}

      {announcement.author && (
        <>
          <span
            aria-hidden="true"
          >
            ·
          </span>

          <span>
            {announcement.author}
          </span>
        </>
      )}
    </div>
  );
}

AnnouncementMeta.propTypes = {
  announcement:
    PropTypes.shape({
      category:
        PropTypes.string,
      publishedAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
      author:
        PropTypes.string,
    }).isRequired,
};

/* ============================================================================
 * ANNOUNCEMENT CARD
 * ========================================================================== */

const AnnouncementCard = memo(
  function AnnouncementCard({
    announcement,
    onMarkRead,
    onDismiss,
    onCopyLink,
    onAction,
    copied,
    reducedMotion,
  }) {
    const {
      id,
      title,
      body,
      category,
      priority,
      pinned,
      read,
      dismissed,
      actionLabel,
      actionUrl,
      tags,
    } = announcement;

    const handleOpen =
      useCallback(() => {
        if (!read) {
          onMarkRead(id);
        }
      }, [
        id,
        onMarkRead,
        read,
      ]);

    const handleAction =
      useCallback(
        (event) => {
          if (!actionUrl) {
            event.preventDefault();
          }

          if (onAction) {
            onAction(
              announcement,
            );
          }

          if (!read) {
            onMarkRead(id);
          }
        },
        [
          actionUrl,
          announcement,
          id,
          onAction,
          onMarkRead,
          read,
        ],
      );

    return (
      <article
        id={id}
        className={[
          'titech-announcement',
          `titech-announcement--${priority}`,
          read
            ? 'is-read'
            : 'is-unread',
          pinned
            ? 'is-pinned'
            : '',
          dismissed
            ? 'is-dismissed'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-labelledby={`${id}-title`}
      >
        <div className="titech-announcement__header">
          <div className="titech-announcement__heading-group">
            <div className="titech-announcement__badges">
              <AnnouncementBadge
                priority={
                  priority
                }
              />

              {pinned && (
                <span className="titech-announcement__pinned">
                  Pinned
                </span>
              )}

              {!read && (
                <span className="titech-announcement__unread">
                  Unread
                </span>
              )}
            </div>

            <h3
              id={`${id}-title`}
              className="titech-announcement__title"
              tabIndex={-1}
            >
              {title}
            </h3>

            <AnnouncementMeta
              announcement={
                announcement
              }
            />
          </div>

          <button
            type="button"
            className="titech-announcement__copy"
            onClick={() =>
              onCopyLink(id)
            }
            aria-label={`Copy link to ${title}`}
          >
            {copied
              ? 'Copied'
              : 'Copy link'}
          </button>
        </div>

        {body && (
          <div className="titech-announcement__body">
            {body
              .split(/\n{2,}/)
              .map(
                (
                  paragraph,
                  index,
                ) => (
                  <p
                    key={`${id}-paragraph-${index}`}
                  >
                    {paragraph}
                  </p>
                ),
              )}
          </div>
        )}

        {tags.length > 0 && (
          <ul
            className="titech-announcement__tags"
            aria-label="Announcement tags"
          >
            {tags.map(
              (tag) => (
                <li
                  key={`${id}-${tag}`}
                >
                  {tag}
                </li>
              ),
            )}
          </ul>
        )}

        <div className="titech-announcement__actions">
          {actionLabel &&
            (actionUrl ? (
              <a
                href={actionUrl}
                className="titech-announcement__action"
                onClick={
                  handleAction
                }
              >
                {actionLabel}
              </a>
            ) : (
              <button
                type="button"
                className="titech-announcement__action"
                onClick={
                  handleAction
                }
              >
                {actionLabel}
              </button>
            ))}

          {!read && (
            <button
              type="button"
              className="titech-announcement__secondary-action"
              onClick={
                handleOpen
              }
              aria-label={`Mark ${title} as read`}
            >
              Mark as read
            </button>
          )}

          {onDismiss && !dismissed && (
            <button
              type="button"
              className="titech-announcement__secondary-action"
              onClick={() =>
                onDismiss(id)
              }
              aria-label={`Dismiss ${title}`}
            >
              Dismiss
            </button>
          )}
        </div>
      </article>
    );
  },
);

AnnouncementCard.displayName =
  'AnnouncementCard';

AnnouncementCard.propTypes = {
  announcement:
    PropTypes.shape({
      id:
        PropTypes.string.isRequired,
      title:
        PropTypes.string.isRequired,
      body:
        PropTypes.string,
      category:
        PropTypes.string.isRequired,
      priority:
        PropTypes.string.isRequired,
      pinned:
        PropTypes.bool,
      read:
        PropTypes.bool,
      dismissed:
        PropTypes.bool,
      publishedAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),
      actionLabel:
        PropTypes.string,
      actionUrl:
        PropTypes.string,
      author:
        PropTypes.string,
      authorRole:
        PropTypes.string,
      tags:
        PropTypes.arrayOf(
          PropTypes.string,
        ),
    }).isRequired,

  onMarkRead:
    PropTypes.func.isRequired,

  onDismiss:
    PropTypes.func,

  onCopyLink:
    PropTypes.func.isRequired,

  onAction:
    PropTypes.func,

  copied:
    PropTypes.bool,

  reducedMotion:
    PropTypes.bool,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

function AnnouncementCenter({
  announcements = [],
  loading = false,
  error = null,

  title =
    'Announcement Center',

  description =
    'Stay informed about important TITech Community Capital updates, security notices, community events and platform changes.',

  showSearch = true,
  showFilters = true,
  showDismiss = true,
  showCopyLink = true,
  showPagination = false,

  pageSize =
    DEFAULT_PAGE_SIZE,

  initialCategory =
    DEFAULT_CATEGORY,

  initialPriority =
    DEFAULT_PRIORITY_FILTER,

  initialStatus =
    DEFAULT_STATUS_FILTER,

  initialSearch = '',

  onMarkRead,
  onDismiss,
  onAction,
  onRetry,
  onSectionChange,

  className = '',
}) {
  const [searchQuery, setSearchQuery] =
    useState(initialSearch);

  const [categoryFilter, setCategoryFilter] =
    useState(
      ANNOUNCEMENT_CATEGORIES.includes(
        initialCategory,
      )
        ? initialCategory
        : DEFAULT_CATEGORY,
    );

  const [priorityFilter, setPriorityFilter] =
    useState(
      ANNOUNCEMENT_PRIORITIES.includes(
        initialPriority,
      )
        ? initialPriority
        : DEFAULT_PRIORITY_FILTER,
    );

  const [statusFilter, setStatusFilter] =
    useState(
      ANNOUNCEMENT_STATUSES.includes(
        initialStatus,
      )
        ? initialStatus
        : DEFAULT_STATUS_FILTER,
    );

  const [localReadIds, setLocalReadIds] =
    useState(() => new Set());

  const [localDismissedIds, setLocalDismissedIds] =
    useState(() => new Set());

  const [copiedAnnouncementId, setCopiedAnnouncementId] =
    useState('');

  const [page, setPage] =
    useState(1);

  const [now, setNow] =
    useState(() => Date.now());

  const announcementRefs =
    useRef(new Map());

  const copyResetTimer =
    useRef(null);

  const normalizedAnnouncements =
    useMemo(
      () =>
        announcements
          .map(
            normalizeAnnouncement,
          )
          .filter(
            (announcement) =>
              Boolean(
                announcement.id,
              ),
          ),
      [announcements],
    );

  const reducedMotion =
    useMemo(
      () =>
        prefersReducedMotion(),
      [],
    );

  /* ==========================================================================
   * CLOCK / EXPIRY REFRESH
   * ======================================================================== */

  useEffect(() => {
    const interval =
      window.setInterval(
        () => {
          setNow(Date.now());
        },
        60 * 1000,
      );

    return () =>
      window.clearInterval(
        interval,
      );
  }, []);

  /* ==========================================================================
   * NORMALIZED ANNOUNCEMENTS WITH LOCAL STATE
   * ======================================================================== */

  const hydratedAnnouncements =
    useMemo(
      () =>
        normalizedAnnouncements.map(
          (announcement) => ({
            ...announcement,

            read:
              announcement.read ||
              localReadIds.has(
                announcement.id,
              ),

            dismissed:
              announcement.dismissed ||
              localDismissedIds.has(
                announcement.id,
              ),
          }),
        ),
      [
        localDismissedIds,
        localReadIds,
        normalizedAnnouncements,
      ],
    );

  /* ==========================================================================
   * FILTERING
   * ======================================================================== */

  const filteredAnnouncements =
    useMemo(() => {
      return hydratedAnnouncements
        .filter(
          (announcement) => {
            const active =
              isAnnouncementActive(
                announcement,
                now,
              );

            if (
              statusFilter ===
              'active' &&
              !active
            ) {
              return false;
            }

            if (
              statusFilter ===
              'dismissed' &&
              !announcement.dismissed
            ) {
              return false;
            }

            if (
              statusFilter ===
              'unread' &&
              announcement.read
            ) {
              return false;
            }

            if (
              statusFilter ===
              'read' &&
              !announcement.read
            ) {
              return false;
            }

            if (
              statusFilter !==
                'dismissed' &&
              announcement.dismissed
            ) {
              return false;
            }

            if (
              categoryFilter !==
                DEFAULT_CATEGORY &&
              announcement.category !==
                categoryFilter
            ) {
              return false;
            }

            if (
              priorityFilter !==
                DEFAULT_PRIORITY_FILTER &&
              announcement.priority !==
                priorityFilter
            ) {
              return false;
            }

            return announcementMatchesSearch(
              announcement,
              searchQuery,
            );
          },
        )
        .sort(
          (a, b) => {
            if (
              a.pinned !==
              b.pinned
            ) {
              return a.pinned
                ? -1
                : 1;
            }

            const priorityDifference =
              (PRIORITY_RANK[
                b.priority
              ] || 0) -
              (PRIORITY_RANK[
                a.priority
              ] || 0);

            if (
              priorityDifference !==
              0
            ) {
              return priorityDifference;
            }

            const bDate =
              new Date(
                b.publishedAt ||
                  0,
              ).getTime();

            const aDate =
              new Date(
                a.publishedAt ||
                  0,
              ).getTime();

            return (
              (Number.isFinite(
                bDate,
              )
                ? bDate
                : 0) -
              (Number.isFinite(
                aDate,
              )
                ? aDate
                : 0)
            );
          },
        );
    }, [
      categoryFilter,
      hydratedAnnouncements,
      now,
      priorityFilter,
      searchQuery,
      statusFilter,
    ]);

  /* ==========================================================================
   * PAGINATION
   * ======================================================================== */

  const totalPages =
    showPagination
      ? Math.max(
          1,
          Math.ceil(
            filteredAnnouncements.length /
              Math.max(
                1,
                pageSize,
              ),
          ),
        )
      : 1;

  useEffect(() => {
    setPage((currentPage) =>
      Math.min(
        currentPage,
        totalPages,
      ),
    );
  }, [totalPages]);

  const visibleAnnouncements =
    useMemo(() => {
      if (!showPagination) {
        return filteredAnnouncements;
      }

      const safePageSize =
        Math.max(
          1,
          Number(pageSize) ||
            DEFAULT_PAGE_SIZE,
        );

      const start =
        (page - 1) *
        safePageSize;

      return filteredAnnouncements.slice(
        start,
        start +
          safePageSize,
      );
    }, [
      filteredAnnouncements,
      page,
      pageSize,
      showPagination,
    ]);

  /* ==========================================================================
   * COUNTS
   * ======================================================================== */

  const counts =
    useMemo(() => {
      const active =
        hydratedAnnouncements.filter(
          (announcement) =>
            isAnnouncementActive(
              announcement,
              now,
            ) &&
            !announcement.dismissed,
        ),
      );

      return {
        total:
          active.length,

        unread:
          active.filter(
            (announcement) =>
              !announcement.read,
          ).length,

        critical:
          active.filter(
            (announcement) =>
              announcement.priority ===
              'critical',
          ).length,

        high:
          active.filter(
            (announcement) =>
              announcement.priority ===
              'high',
          ).length,
      };
    }, [
      hydratedAnnouncements,
      now,
    ]);

  /* ==========================================================================
   * REF REGISTRATION
   * ======================================================================== */

  const registerAnnouncementRef =
    useCallback(
      (id, node) => {
        if (node) {
          announcementRefs.current.set(
            id,
            node,
          );
        } else {
          announcementRefs.current.delete(
            id,
          );
        }
      },
      [],
    );

  /* ==========================================================================
   * MARK READ
   * ======================================================================== */

  const handleMarkRead =
    useCallback(
      (id) => {
        if (!id) {
          return;
        }

        setLocalReadIds(
          (previous) => {
            if (
              previous.has(id)
            ) {
              return previous;
            }

            const next =
              new Set(
                previous,
              );

            next.add(id);

            return next;
          },
        );

        if (
          typeof onMarkRead ===
          'function'
        ) {
          onMarkRead(id);
        }
      },
      [onMarkRead],
    );

  /* ==========================================================================
   * DISMISS
   * ======================================================================== */

  const handleDismiss =
    useCallback(
      (id) => {
        if (!id) {
          return;
        }

        setLocalDismissedIds(
          (previous) => {
            if (
              previous.has(id)
            ) {
              return previous;
            }

            const next =
              new Set(
                previous,
              );

            next.add(id);

            return next;
          },
        );

        if (
          typeof onDismiss ===
          'function'
        ) {
          onDismiss(id);
        }
      },
      [onDismiss],
    );

  /* ==========================================================================
   * COPY LINK
   * ======================================================================== */

  const handleCopyLink =
    useCallback(
      async (id) => {
        if (
          !isBrowser() ||
          !id
        ) {
          return;
        }

        const url =
          `${window.location.origin}` +
          `${window.location.pathname}` +
          `${window.location.search}` +
          `${buildAnnouncementHash(id)}`;

        try {
          if (
            navigator.clipboard &&
            typeof navigator.clipboard
              .writeText ===
              'function'
          ) {
            await navigator.clipboard.writeText(
              url,
            );
          } else {
            const textarea =
              document.createElement(
                'textarea',
              );

            textarea.value = url;

            textarea.setAttribute(
              'readonly',
              '',
            );

            textarea.style.position =
              'fixed';

            textarea.style.opacity =
              '0';

            textarea.style.pointerEvents =
              'none';

            document.body.appendChild(
              textarea,
            );

            textarea.select();

            const copied =
              document.execCommand(
                'copy',
              );

            document.body.removeChild(
              textarea,
            );

            if (!copied) {
              throw new Error(
                'Clipboard copy failed.',
              );
            }
          }

          setCopiedAnnouncementId(
            id,
          );

          if (
            copyResetTimer.current
          ) {
            window.clearTimeout(
              copyResetTimer.current,
            );
          }

          copyResetTimer.current =
            window.setTimeout(
              () => {
                setCopiedAnnouncementId(
                  '',
                );
              },
              COPY_RESET_DELAY,
            );
        } catch {
          setCopiedAnnouncementId(
            '',
          );
        }
      },
      [],
    );

  /* ==========================================================================
   * DEEP LINK NAVIGATION
   * ======================================================================== */

  const focusAnnouncement =
    useCallback(
      (
        id,
        updateUrl = false,
      ) => {
        if (!id) {
          return false;
        }

        const element =
          announcementRefs.current.get(
            id,
          );

        if (!element) {
          return false;
        }

        element.scrollIntoView({
          behavior:
            reducedMotion
              ? 'auto'
              : 'smooth',
          block: 'start',
        });

        const heading =
          element.querySelector(
            '.titech-announcement__title',
          );

        if (
          heading &&
          typeof heading.focus ===
            'function'
        ) {
          window.setTimeout(
            () => {
              heading.focus({
                preventScroll:
                  true,
              });
            },
            reducedMotion
              ? 0
              : 100,
          );
        }

        if (
          updateUrl &&
          isBrowser()
        ) {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}${buildAnnouncementHash(
              id,
            )}`,
          );
        }

        const announcement =
          hydratedAnnouncements.find(
            (item) =>
              item.id === id,
          );

        if (
          announcement &&
          !announcement.read
        ) {
          handleMarkRead(id);
        }

        if (
          typeof onSectionChange ===
          'function'
        ) {
          onSectionChange(
            id,
          );
        }

        return true;
      },
      [
        handleMarkRead,
        hydratedAnnouncements,
        onSectionChange,
        reducedMotion,
      ],
    );

  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    const handleHashChange =
      () => {
        const id =
          getAnnouncementFromHash(
            window.location.hash,
          );

        if (id) {
          window.setTimeout(
            () => {
              focusAnnouncement(
                id,
                false,
              );
            },
            50,
          );
        }
      };

    handleHashChange();

    window.addEventListener(
      'hashchange',
      handleHashChange,
    );

    return () => {
      window.removeEventListener(
        'hashchange',
        handleHashChange,
      );
    };
  }, [
    focusAnnouncement,
  ]);

  /* ==========================================================================
   * FILTER RESET
   * ======================================================================== */

  const handleClearFilters =
    useCallback(() => {
      setSearchQuery('');
      setCategoryFilter(
        DEFAULT_CATEGORY,
      );
      setPriorityFilter(
        DEFAULT_PRIORITY_FILTER,
      );
      setStatusFilter(
        DEFAULT_STATUS_FILTER,
      );
      setPage(1);
    }, []);

  useEffect(() => {
    setPage(1);
  }, [
    categoryFilter,
    priorityFilter,
    searchQuery,
    statusFilter,
  ]);

  /* ==========================================================================
   * CLEANUP
   * ======================================================================== */

  useEffect(
    () => () => {
      if (
        copyResetTimer.current
      ) {
        window.clearTimeout(
          copyResetTimer.current,
        );
      }
    },
    [],
  );

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  const rootClassName = [
    'titech-announcement-center',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={rootClassName}
      aria-labelledby="titech-announcement-center-title"
      data-component="AnnouncementCenter"
      data-version={COMPONENT_VERSION}
    >
      {/* ======================================================================
          HEADER
          ==================================================================== */}

      <header className="titech-announcement-center__header">
        <div>
          <p className="titech-announcement-center__eyebrow">
            TITech Community Capital
          </p>

          <h1
            id="titech-announcement-center-title"
            className="titech-announcement-center__title"
          >
            {title}
          </h1>

          <p className="titech-announcement-center__description">
            {description}
          </p>
        </div>

        <div
          className="titech-announcement-center__summary"
          aria-label="Announcement summary"
        >
          <span>
            {counts.total}{' '}
            active
          </span>

          <span>
            {counts.unread}{' '}
            unread
          </span>

          {counts.critical >
            0 && (
            <span>
              {counts.critical}{' '}
              critical
            </span>
          )}
        </div>
      </header>

      {/* ======================================================================
          FILTERS
          ==================================================================== */}

      {(showSearch ||
        showFilters) && (
        <div
          className="titech-announcement-center__controls"
          aria-label="Announcement filters"
        >
          {showSearch && (
            <div className="titech-announcement-center__search">
              <label
                htmlFor="titech-announcement-search"
                className="titech-announcement-center__label"
              >
                Search announcements
              </label>

              <input
                id="titech-announcement-search"
                type="search"
                value={searchQuery}
                onChange={(event) =>
                  setSearchQuery(
                    event.target.value,
                  )
                }
                placeholder="Search announcements..."
                autoComplete="off"
                className="titech-announcement-center__input"
              />
            </div>
          )}

          {showFilters && (
            <div className="titech-announcement-center__filters">
              <div>
                <label
                  htmlFor="titech-announcement-category"
                  className="titech-announcement-center__label"
                >
                  Category
                </label>

                <select
                  id="titech-announcement-category"
                  value={
                    categoryFilter
                  }
                  onChange={(event) =>
                    setCategoryFilter(
                      event.target.value,
                    )
                  }
                  className="titech-announcement-center__select"
                >
                  {ANNOUNCEMENT_CATEGORIES.map(
                    (category) => (
                      <option
                        key={
                          category
                        }
                        value={
                          category
                        }
                      >
                        {
                          CATEGORY_LABELS[
                            category
                          ]
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="titech-announcement-priority"
                  className="titech-announcement-center__label"
                >
                  Priority
                </label>

                <select
                  id="titech-announcement-priority"
                  value={
                    priorityFilter
                  }
                  onChange={(event) =>
                    setPriorityFilter(
                      event.target.value,
                    )
                  }
                  className="titech-announcement-center__select"
                >
                  {ANNOUNCEMENT_PRIORITIES.map(
                    (priority) => (
                      <option
                        key={
                          priority
                        }
                        value={
                          priority
                        }
                      >
                        {
                          PRIORITY_LABELS[
                            priority
                          ]
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="titech-announcement-status"
                  className="titech-announcement-center__label"
                >
                  Status
                </label>

                <select
                  id="titech-announcement-status"
                  value={
                    statusFilter
                  }
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value,
                    )
                  }
                  className="titech-announcement-center__select"
                >
                  {ANNOUNCEMENT_STATUSES.map(
                    (status) => (
                      <option
                        key={status}
                        value={status}
                      >
                        {
                          STATUS_LABELS[
                            status
                          ]
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <button
                type="button"
                className="titech-announcement-center__clear"
                onClick={
                  handleClearFilters
                }
                disabled={
                  !searchQuery &&
                  categoryFilter ===
                    DEFAULT_CATEGORY &&
                  priorityFilter ===
                    DEFAULT_PRIORITY_FILTER &&
                  statusFilter ===
                    DEFAULT_STATUS_FILTER
                }
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ======================================================================
          CONTENT
          ==================================================================== */}

      <div
        className="titech-announcement-center__content"
        aria-busy={loading}
      >
        {loading && (
          <div
            className="titech-announcement-center__state"
            role="status"
            aria-live="polite"
          >
            <span
              className="titech-announcement-center__spinner"
              aria-hidden="true"
            />

            <p>
              Loading announcements…
            </p>
          </div>
        )}

        {!loading &&
          error && (
            <div
              className="titech-announcement-center__state titech-announcement-center__state--error"
              role="alert"
            >
              <h2>
                Unable to load
                announcements
              </h2>

              <p>
                {typeof error ===
                'string'
                  ? error
                  : 'We could not load the announcement center right now.'}
              </p>

              {onRetry && (
                <button
                  type="button"
                  className="titech-announcement-center__retry"
                  onClick={
                    onRetry
                  }
                >
                  Try again
                </button>
              )}
            </div>
          )}

        {!loading &&
          !error &&
          visibleAnnouncements.length ===
            0 && (
            <div
              className="titech-announcement-center__state"
              role="status"
              aria-live="polite"
            >
              <h2>
                No announcements
              </h2>

              <p>
                {searchQuery ||
                categoryFilter !==
                  DEFAULT_CATEGORY ||
                priorityFilter !==
                  DEFAULT_PRIORITY_FILTER ||
                statusFilter !==
                  DEFAULT_STATUS_FILTER
                  ? 'No announcements match your current filters.'
                  : 'There are no announcements to display right now.'}
              </p>

              {(searchQuery ||
                categoryFilter !==
                  DEFAULT_CATEGORY ||
                priorityFilter !==
                  DEFAULT_PRIORITY_FILTER ||
                statusFilter !==
                  DEFAULT_STATUS_FILTER) && (
                <button
                  type="button"
                  className="titech-announcement-center__clear"
                  onClick={
                    handleClearFilters
                  }
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

        {!loading &&
          !error &&
          visibleAnnouncements.length >
            0 && (
            <div
              className="titech-announcement-center__list"
              aria-live="polite"
            >
              {visibleAnnouncements.map(
                (announcement) => (
                  <div
                    key={
                      announcement.id
                    }
                    ref={(node) =>
                      registerAnnouncementRef(
                        announcement.id,
                        node,
                      )
                    }
                  >
                    <AnnouncementCard
                      announcement={
                        announcement
                      }
                      onMarkRead={
                        handleMarkRead
                      }
                      onDismiss={
                        showDismiss
                          ? handleDismiss
                          : undefined
                      }
                      onCopyLink={
                        showCopyLink
                          ? handleCopyLink
                          : () => {}
                      }
                      onAction={
                        onAction
                      }
                      copied={
                        copiedAnnouncementId ===
                        announcement.id
                      }
                      reducedMotion={
                        reducedMotion
                      }
                    />
                  </div>
                ),
              )}
            </div>
          )}
      </div>

      {/* ======================================================================
          PAGINATION
          ==================================================================== */}

      {showPagination &&
        totalPages > 1 && (
          <nav
            className="titech-announcement-center__pagination"
            aria-label="Announcement pages"
          >
            <button
              type="button"
              onClick={() =>
                setPage(
                  (current) =>
                    Math.max(
                      1,
                      current -
                        1,
                    ),
                )
              }
              disabled={page <= 1}
            >
              Previous
            </button>

            <span
              aria-current="page"
            >
              Page {page} of{' '}
              {totalPages}
            </span>

            <button
              type="button"
              onClick={() =>
                setPage(
                  (current) =>
                    Math.min(
                      totalPages,
                      current +
                        1,
                    ),
                )
              }
              disabled={
                page >= totalPages
              }
            >
              Next
            </button>
          </nav>
        )}

      {/* ======================================================================
          ACCESSIBILITY STATUS
          ==================================================================== */}

      <div
        className="titech-announcement-center__sr-status"
        aria-live="polite"
        aria-atomic="true"
      >
        {copiedAnnouncementId
          ? 'Announcement link copied to clipboard.'
          : `${filteredAnnouncements.length} announcement${
              filteredAnnouncements.length ===
              1
                ? ''
                : 's'
            } displayed.`}
      </div>
    </section>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

AnnouncementCenter.propTypes = {
  announcements:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        title:
          PropTypes.string,

        body:
          PropTypes.string,

        message:
          PropTypes.string,

        description:
          PropTypes.string,

        category:
          PropTypes.string,

        priority:
          PropTypes.string,

        pinned:
          PropTypes.bool,

        read:
          PropTypes.bool,

        dismissed:
          PropTypes.bool,

        publishedAt:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        createdAt:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        startsAt:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        expiresAt:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        author:
          PropTypes.string,

        authorRole:
          PropTypes.string,

        actionLabel:
          PropTypes.string,

        actionUrl:
          PropTypes.string,

        tags:
          PropTypes.arrayOf(
            PropTypes.string,
          ),
      }),
    ),

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  title:
    PropTypes.string,

  description:
    PropTypes.string,

  showSearch:
    PropTypes.bool,

  showFilters:
    PropTypes.bool,

  showDismiss:
    PropTypes.bool,

  showCopyLink:
    PropTypes.bool,

  showPagination:
    PropTypes.bool,

  pageSize:
    PropTypes.number,

  initialCategory:
    PropTypes.string,

  initialPriority:
    PropTypes.string,

  initialStatus:
    PropTypes.string,

  initialSearch:
    PropTypes.string,

  onMarkRead:
    PropTypes.func,

  onDismiss:
    PropTypes.func,

  onAction:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onSectionChange:
    PropTypes.func,

  className:
    PropTypes.string,
};

export default memo(
  AnnouncementCenter,
);