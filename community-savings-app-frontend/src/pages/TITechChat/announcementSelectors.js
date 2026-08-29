/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Selectors
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/announcementSelectors.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade memoized Redux selectors for the TITech Community
 *   Capital Announcement Center.
 *
 * Responsibilities:
 *   - Provide a stable selector API for announcement consumers.
 *   - Normalize defensive Redux state access.
 *   - Support paginated and non-paginated announcement state.
 *   - Support loading, refreshing, submitting and error states.
 *   - Support unread/read announcement calculations.
 *   - Support filtering, searching and sorting.
 *   - Support tenant-aware announcement selection.
 *   - Expose notification/count selectors.
 *   - Avoid exposing Redux implementation details to UI components.
 *   - Remain pure and side-effect free.
 *
 * Architectural Principles:
 *   - Selectors MUST NOT perform API calls.
 *   - Selectors MUST NOT mutate Redux state.
 *   - Selectors MUST NOT perform authorization decisions.
 *   - Selectors MUST NOT infer financial permissions.
 *   - Tenant isolation is authoritative on the backend.
 *   - UI filtering is presentation-level only.
 *
 * Compatibility:
 *   - Redux Toolkit createSelector.
 *   - Normalized entity state.
 *   - Traditional array-based state.
 *   - Paginated API response state.
 *   - Defensive compatibility with future slice evolution.
 *
 * Branding:
 *   TITech Community Capital
 *
 * IMPORTANT:
 *   ACFOS terminology is intentionally not used.
 *
 * ============================================================================
 */

'use strict';

import {
  createSelector,
} from '@reduxjs/toolkit';

/* ============================================================================
 * METADATA
 * ========================================================================== */

export const ANNOUNCEMENT_SELECTORS_VERSION =
  '3.0.0';

export const ANNOUNCEMENT_STATE_KEY =
  'announcements';

/**
 * Supported announcement statuses.
 *
 * These are deliberately presentation-safe constants. The backend remains
 * authoritative for actual workflow/status validation.
 */
export const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
});

/**
 * Supported announcement priorities.
 */
export const ANNOUNCEMENT_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});

/**
 * Supported announcement audiences.
 */
export const ANNOUNCEMENT_AUDIENCE = Object.freeze({
  ALL: 'all',
  MEMBERS: 'members',
  ADMINS: 'admins',
  TENANT: 'tenant',
  STAFF: 'staff',
});

/* ============================================================================
 * GENERIC HELPERS
 * ========================================================================== */

const EMPTY_ARRAY =
  Object.freeze([]);

const EMPTY_OBJECT =
  Object.freeze({});

const EMPTY_STRING =
  '';

const DEFAULT_PAGE =
  1;

const DEFAULT_PAGE_SIZE =
  20;

const MAX_SAFE_SELECTOR_PAGE_SIZE =
  1000;

const DATE_FALLBACK_TIME =
  0;

/**
 * Safely convert a value to a trimmed string.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeString(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return EMPTY_STRING;
  }

  try {
    return String(value).trim();
  } catch {
    return EMPTY_STRING;
  }
}

/**
 * Safely normalize an ID.
 *
 * Supports:
 *   - string IDs
 *   - Mongo ObjectId-like values
 *   - numeric IDs
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeId(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return EMPTY_STRING;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    '_id' in value
  ) {
    return normalizeString(
      value._id,
    );
  }

  return normalizeString(
    value,
  );
}

/**
 * Safely determine whether a value is a finite number.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isFiniteNumber(
  value,
) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

/**
 * Normalize a positive integer.
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number} maximum
 * @returns {number}
 */
function normalizePositiveInteger(
  value,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    return fallback;
  }

  return Math.min(
    number,
    maximum,
  );
}

/**
 * Normalize an array without mutating the source.
 *
 * @param {*} value
 * @returns {Array}
 */
function normalizeArray(
  value,
) {
  return Array.isArray(value)
    ? value
    : EMPTY_ARRAY;
}

/**
 * Safely convert a date-like value into a timestamp.
 *
 * @param {*} value
 * @returns {number}
 */
function toTimestamp(
  value,
) {
  if (
    value instanceof Date
  ) {
    const timestamp =
      value.getTime();

    return Number.isFinite(
      timestamp,
    )
      ? timestamp
      : DATE_FALLBACK_TIME;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return DATE_FALLBACK_TIME;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(
    timestamp,
  )
    ? timestamp
    : DATE_FALLBACK_TIME;
}

/**
 * Safely resolve a nested property.
 *
 * @param {*} source
 * @param {string[]} path
 * @param {*} fallback
 * @returns {*}
 */
function getPath(
  source,
  path,
  fallback = undefined,
) {
  let current =
    source;

  for (
    const key of path
  ) {
    if (
      current === null ||
      current === undefined
    ) {
      return fallback;
    }

    current =
      current[key];
  }

  return current === undefined
    ? fallback
    : current;
}

/* ============================================================================
 * ROOT STATE
 * ========================================================================== */

/**
 * Select the announcement slice.
 *
 * Primary contract:
 *
 *   state.announcements
 *
 * Compatibility fallbacks are intentionally defensive so that the selector
 * layer can survive minor Redux composition changes without requiring every
 * consuming component to be rewritten.
 *
 * @param {Object} state
 * @returns {Object}
 */
export const selectAnnouncementState =
  (state) => {
    if (
      !state ||
      typeof state !== 'object'
    ) {
      return EMPTY_OBJECT;
    }

    const direct =
      state[
        ANNOUNCEMENT_STATE_KEY
      ];

    if (
      direct &&
      typeof direct === 'object'
    ) {
      return direct;
    }

    const titechChat =
      state.titechChat;

    if (
      titechChat?.announcements &&
      typeof titechChat.announcements ===
        'object'
    ) {
      return titechChat.announcements;
    }

    return EMPTY_OBJECT;
  };

/**
 * Alias retained for simple imports.
 */
export const selectAnnouncementsState =
  selectAnnouncementState;

/* ============================================================================
 * ENTITY / COLLECTION SELECTORS
 * ========================================================================== */

/**
 * Select raw announcements.
 *
 * Supports:
 *
 *   state.announcements.items
 *   state.announcements.announcements
 *   state.announcements.data
 *   state.announcements.entities
 *   state.announcements.ids + entities
 */
export const selectRawAnnouncements =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) => {
      if (
        Array.isArray(
          state.items,
        )
      ) {
        return state.items;
      }

      if (
        Array.isArray(
          state.announcements,
        )
      ) {
        return state.announcements;
      }

      if (
        Array.isArray(
          state.data,
        )
      ) {
        return state.data;
      }

      if (
        Array.isArray(
          state.results,
        )
      ) {
        return state.results;
      }

      if (
        state.entities &&
        typeof state.entities ===
          'object'
      ) {
        const ids =
          Array.isArray(
            state.ids,
          )
            ? state.ids
            : Object.keys(
                state.entities,
              );

        return ids
          .map(
            (id) =>
              state.entities[id],
          )
          .filter(Boolean);
      }

      return EMPTY_ARRAY;
    },
  );

/**
 * Select normalized entity map where available.
 */
export const selectAnnouncementEntities =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) => {
      if (
        state.entities &&
        typeof state.entities ===
          'object'
      ) {
        return state.entities;
      }

      return EMPTY_OBJECT;
    },
  );

/**
 * Select announcement IDs.
 */
export const selectAnnouncementIds =
  createSelector(
    [
      selectAnnouncementState,
      selectRawAnnouncements,
    ],
    (
      state,
      announcements,
    ) => {
      if (
        Array.isArray(
          state.ids,
        )
      ) {
        return state.ids;
      }

      return announcements
        .map(
          (announcement) =>
            normalizeId(
              announcement?.id ??
                announcement?._id,
            ),
        )
        .filter(Boolean);
    },
  );

/**
 * Public primary selector.
 */
export const selectAnnouncements =
  selectRawAnnouncements;

/* ============================================================================
 * NORMALIZED ANNOUNCEMENT SELECTOR
 * ========================================================================== */

/**
 * Normalize announcement records at the selector boundary.
 *
 * This does NOT mutate the Redux state.
 */
export const selectNormalizedAnnouncements =
  createSelector(
    [
      selectRawAnnouncements,
    ],
    (
      announcements,
    ) =>
      announcements
        .filter(
          Boolean,
        )
        .map(
          (announcement) => {
            const id =
              normalizeId(
                announcement.id ??
                  announcement._id,
              );

            const title =
              normalizeString(
                announcement.title ??
                  announcement.subject ??
                  announcement.name,
              );

            const body =
              normalizeString(
                announcement.body ??
                  announcement.message ??
                  announcement.content ??
                  announcement.description,
              );

            const status =
              normalizeString(
                announcement.status,
              ).toLowerCase() ||
              ANNOUNCEMENT_STATUS.PUBLISHED;

            const priority =
              normalizeString(
                announcement.priority,
              ).toLowerCase() ||
              ANNOUNCEMENT_PRIORITY.NORMAL;

            const audience =
              normalizeString(
                announcement.audience ??
                  announcement.targetAudience,
              ).toLowerCase() ||
              ANNOUNCEMENT_AUDIENCE.ALL;

            return {
              ...announcement,

              id,

              title,

              body,

              status,

              priority,

              audience,

              read:
                Boolean(
                  announcement.read ??
                    announcement.isRead,
                ),

              unread:
                !Boolean(
                  announcement.read ??
                    announcement.isRead,
                ),
            };
          },
        ),
  );

/* ============================================================================
 * BASIC STATE SELECTORS
 * ========================================================================== */

export const selectAnnouncementsLoading =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      Boolean(
        state.loading ??
          state.isLoading ??
          false,
      ),
  );

export const selectAnnouncementsRefreshing =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      Boolean(
        state.refreshing ??
          state.isRefreshing ??
          false,
      ),
  );

export const selectAnnouncementsSubmitting =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      Boolean(
        state.submitting ??
          state.isSubmitting ??
          false,
      ),
  );

export const selectAnnouncementsDeleting =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      Boolean(
        state.deleting ??
          state.isDeleting ??
          false,
      ),
  );

export const selectAnnouncementsError =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      state.error ??
      state.fetchError ??
      null,
  );

export const selectAnnouncementsHasError =
  createSelector(
    [
      selectAnnouncementsError,
    ],
    (error) =>
      Boolean(
        error,
      ),
  );

export const selectAnnouncementsInitialized =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      Boolean(
        state.initialized ??
          state.hasLoaded ??
          false,
      ),
  );

/* ============================================================================
 * REQUEST / OPERATION METADATA
 * ========================================================================== */

export const selectAnnouncementsRequestId =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      normalizeString(
        state.requestId ??
          state.lastRequestId,
      ) || null,
  );

export const selectAnnouncementsCorrelationId =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      normalizeString(
        state.correlationId ??
          state.lastCorrelationId,
      ) || null,
  );

export const selectLastFetchedAt =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      state.lastFetchedAt ??
      state.fetchedAt ??
      null,
  );

/* ============================================================================
 * PAGINATION SELECTORS
 * ========================================================================== */

export const selectAnnouncementPagination =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) => {
      const pagination =
        state.pagination;

      if (
        pagination &&
        typeof pagination ===
          'object'
      ) {
        return pagination;
      }

      return EMPTY_OBJECT;
    },
  );

export const selectAnnouncementPage =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementState,
    ],
    (
      pagination,
      state,
    ) =>
      normalizePositiveInteger(
        pagination.page ??
          state.page,
        DEFAULT_PAGE,
      ),
  );

export const selectAnnouncementPageSize =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementState,
    ],
    (
      pagination,
      state,
    ) =>
      normalizePositiveInteger(
        pagination.limit ??
          pagination.pageSize ??
          state.limit ??
          state.pageSize,
        DEFAULT_PAGE_SIZE,
        MAX_SAFE_SELECTOR_PAGE_SIZE,
      ),
  );

export const selectAnnouncementTotal =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementState,
      selectRawAnnouncements,
    ],
    (
      pagination,
      state,
      announcements,
    ) => {
      const value =
        pagination.total ??
        state.total;

      if (
        isFiniteNumber(
          value,
        )
      ) {
        return Math.max(
          0,
          value,
        );
      }

      return announcements.length;
    },
  );

export const selectAnnouncementTotalPages =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementTotal,
      selectAnnouncementPageSize,
    ],
    (
      pagination,
      total,
      pageSize,
    ) => {
      const explicit =
        pagination.totalPages;

      if (
        isFiniteNumber(
          explicit,
        )
      ) {
        return Math.max(
          0,
          explicit,
        );
      }

      return pageSize > 0
        ? Math.ceil(
            total /
              pageSize,
          )
        : 0;
    },
  );

export const selectAnnouncementHasNextPage =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementPage,
      selectAnnouncementTotalPages,
    ],
    (
      pagination,
      page,
      totalPages,
    ) =>
      Boolean(
        pagination.hasNext ??
          page <
            totalPages,
      ),
  );

export const selectAnnouncementHasPreviousPage =
  createSelector(
    [
      selectAnnouncementPagination,
      selectAnnouncementPage,
    ],
    (
      pagination,
      page,
    ) =>
      Boolean(
        pagination.hasPrevious ??
          page > 1,
      ),
  );

/* ============================================================================
 * FILTER / SEARCH SELECTORS
 * ========================================================================== */

export const selectAnnouncementFilters =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      state.filters &&
      typeof state.filters ===
        'object'
        ? state.filters
        : EMPTY_OBJECT,
  );

export const selectAnnouncementSearchTerm =
  createSelector(
    [
      selectAnnouncementFilters,
      selectAnnouncementState,
    ],
    (
      filters,
      state,
    ) =>
      normalizeString(
        filters.search ??
          filters.searchTerm ??
          state.search ??
          state.searchTerm,
      ),
  );

export const selectAnnouncementStatusFilter =
  createSelector(
    [
      selectAnnouncementFilters,
      selectAnnouncementState,
    ],
    (
      filters,
      state,
    ) =>
      normalizeString(
        filters.status ??
          state.statusFilter,
      ).toLowerCase(),
  );

export const selectAnnouncementPriorityFilter =
  createSelector(
    [
      selectAnnouncementFilters,
      selectAnnouncementState,
    ],
    (
      filters,
      state,
    ) =>
      normalizeString(
        filters.priority ??
          state.priorityFilter,
      ).toLowerCase(),
  );

export const selectAnnouncementAudienceFilter =
  createSelector(
    [
      selectAnnouncementFilters,
      selectAnnouncementState,
    ],
    (
      filters,
      state,
    ) =>
      normalizeString(
        filters.audience ??
          state.audienceFilter,
      ).toLowerCase(),
  );

/**
 * Whether client-side search/filtering is enabled.
 *
 * Backend filtering remains authoritative for large datasets.
 */
export const selectClientFilteringEnabled =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      state.clientFilteringEnabled !==
        false,
  );

/* ============================================================================
 * CURRENT / SELECTED ANNOUNCEMENT
 * ========================================================================== */

export const selectSelectedAnnouncementId =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      normalizeId(
        state.selectedId ??
          state.selectedAnnouncementId ??
          state.currentId,
      ) || null,
  );

export const selectSelectedAnnouncement =
  createSelector(
    [
      selectNormalizedAnnouncements,
      selectSelectedAnnouncementId,
    ],
    (
      announcements,
      selectedId,
    ) => {
      if (!selectedId) {
        return null;
      }

      return (
        announcements.find(
          (announcement) =>
            announcement.id ===
            selectedId,
        ) ||
        null
      );
    },
  );

/* ============================================================================
 * SEARCH / FILTERED ANNOUNCEMENTS
 * ========================================================================== */

export const selectFilteredAnnouncements =
  createSelector(
    [
      selectNormalizedAnnouncements,
      selectAnnouncementSearchTerm,
      selectAnnouncementStatusFilter,
      selectAnnouncementPriorityFilter,
      selectAnnouncementAudienceFilter,
      selectClientFilteringEnabled,
    ],
    (
      announcements,
      searchTerm,
      statusFilter,
      priorityFilter,
      audienceFilter,
      filteringEnabled,
    ) => {
      if (
        !filteringEnabled
      ) {
        return announcements;
      }

      const normalizedSearch =
        searchTerm.toLowerCase();

      return announcements.filter(
        (announcement) => {
          if (
            statusFilter &&
            announcement.status !==
              statusFilter
          ) {
            return false;
          }

          if (
            priorityFilter &&
            announcement.priority !==
              priorityFilter
          ) {
            return false;
          }

          if (
            audienceFilter &&
            announcement.audience !==
              audienceFilter
          ) {
            return false;
          }

          if (
            normalizedSearch
          ) {
            const searchableText =
              [
                announcement.title,
                announcement.body,
                announcement.category,
                announcement.authorName,
                announcement.createdByName,
              ]
                .map(
                  normalizeString,
                )
                .join(' ')
                .toLowerCase();

            if (
              !searchableText.includes(
                normalizedSearch,
              )
            ) {
              return false;
            }
          }

          return true;
        },
      );
    },
  );

/**
 * Alias used by UI components.
 */
export const selectVisibleAnnouncements =
  selectFilteredAnnouncements;

/* ============================================================================
 * STATUS-BASED SELECTORS
 * ========================================================================== */

function createStatusSelector(
  status,
) {
  return createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          announcement.status ===
          status,
      ),
  );
}

export const selectPublishedAnnouncements =
  createStatusSelector(
    ANNOUNCEMENT_STATUS.PUBLISHED,
  );

export const selectScheduledAnnouncements =
  createStatusSelector(
    ANNOUNCEMENT_STATUS.SCHEDULED,
  );

export const selectDraftAnnouncements =
  createStatusSelector(
    ANNOUNCEMENT_STATUS.DRAFT,
  );

export const selectArchivedAnnouncements =
  createStatusSelector(
    ANNOUNCEMENT_STATUS.ARCHIVED,
  );

/* ============================================================================
 * PRIORITY-BASED SELECTORS
 * ========================================================================== */

function createPrioritySelector(
  priority,
) {
  return createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          announcement.priority ===
          priority,
      ),
  );
}

export const selectUrgentAnnouncements =
  createPrioritySelector(
    ANNOUNCEMENT_PRIORITY.URGENT,
  );

export const selectHighPriorityAnnouncements =
  createPrioritySelector(
    ANNOUNCEMENT_PRIORITY.HIGH,
  );

/* ============================================================================
 * READ / UNREAD SELECTORS
 * ========================================================================== */

export const selectUnreadAnnouncements =
  createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          announcement.unread,
      ),
  );

export const selectReadAnnouncements =
  createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          announcement.read,
      ),
  );

export const selectUnreadAnnouncementCount =
  createSelector(
    [
      selectUnreadAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

export const selectReadAnnouncementCount =
  createSelector(
    [
      selectReadAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

export const selectHasUnreadAnnouncements =
  createSelector(
    [
      selectUnreadAnnouncementCount,
    ],
    (count) =>
      count > 0,
  );

/* ============================================================================
 * IMPORTANT / PRIORITY COUNTS
 * ========================================================================== */

export const selectUrgentAnnouncementCount =
  createSelector(
    [
      selectUrgentAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

export const selectHighPriorityAnnouncementCount =
  createSelector(
    [
      selectHighPriorityAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

export const selectHasUrgentAnnouncements =
  createSelector(
    [
      selectUrgentAnnouncementCount,
    ],
    (count) =>
      count > 0,
  );

/* ============================================================================
 * SORTING
 * ========================================================================== */

/**
 * Select configured sort mode.
 */
export const selectAnnouncementSort =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      normalizeString(
        state.sort ??
          state.sortBy,
      ).toLowerCase() ||
      'newest',
  );

/**
 * Stable client-side sorting.
 *
 * The original Redux collection is never mutated.
 */
export const selectSortedAnnouncements =
  createSelector(
    [
      selectFilteredAnnouncements,
      selectAnnouncementSort,
    ],
    (
      announcements,
      sort,
    ) => {
      const result =
        announcements.slice();

      switch (
        sort
      ) {
        case 'oldest':
          return result.sort(
            (a, b) =>
              toTimestamp(
                a.createdAt ??
                  a.publishedAt,
              ) -
              toTimestamp(
                b.createdAt ??
                  b.publishedAt,
              ),
          );

        case 'priority':
          return result.sort(
            (a, b) => {
              const priorityRank =
                {
                  [ANNOUNCEMENT_PRIORITY.URGENT]: 4,
                  [ANNOUNCEMENT_PRIORITY.HIGH]: 3,
                  [ANNOUNCEMENT_PRIORITY.NORMAL]: 2,
                  [ANNOUNCEMENT_PRIORITY.LOW]: 1,
                };

              return (
                (
                  priorityRank[
                    b.priority
                  ] || 0
                ) -
                (
                  priorityRank[
                    a.priority
                  ] || 0
                )
              );
            },
          );

        case 'title':
          return result.sort(
            (a, b) =>
              a.title.localeCompare(
                b.title,
                undefined,
                {
                  sensitivity:
                    'base',
                },
              ),
          );

        case 'newest':
        default:
          return result.sort(
            (a, b) =>
              toTimestamp(
                b.createdAt ??
                  b.publishedAt ??
                  b.updatedAt,
              ) -
              toTimestamp(
                a.createdAt ??
                  a.publishedAt ??
                  a.updatedAt,
              ),
          );
      }
    },
  );

/* ============================================================================
 * LATEST / FEATURED SELECTORS
 * ========================================================================== */

export const selectLatestAnnouncement =
  createSelector(
    [
      selectSortedAnnouncements,
    ],
    (announcements) =>
      announcements[0] ||
      null,
  );

export const selectFeaturedAnnouncements =
  createSelector(
    [
      selectSortedAnnouncements,
    ],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          Boolean(
            announcement.featured ??
              announcement.isFeatured,
          ),
      ),
  );

/* ============================================================================
 * DATE / SCHEDULING SELECTORS
 * ========================================================================== */

export const selectScheduledAnnouncementCount =
  createSelector(
    [
      selectScheduledAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

export const selectPublishedAnnouncementCount =
  createSelector(
    [
      selectPublishedAnnouncements,
    ],
    (announcements) =>
      announcements.length,
  );

/* ============================================================================
 * TENANT CONTEXT
 * ========================================================================== */

/**
 * Select the tenant identifier represented in Redux.
 *
 * This is informational UI state only.
 *
 * It MUST NOT be treated as an authorization boundary.
 */
export const selectAnnouncementTenantId =
  createSelector(
    [
      selectAnnouncementState,
    ],
    (state) =>
      normalizeId(
        state.tenantId ??
          state.currentTenantId ??
          state.tenant?.id ??
          state.tenant?._id,
      ) || null,
  );

/**
 * Determine whether a record appears associated with the currently selected
 * tenant.
 *
 * This is useful for presentation filtering, but backend tenant enforcement
 * remains authoritative.
 */
export const selectTenantAnnouncements =
  createSelector(
    [
      selectNormalizedAnnouncements,
      selectAnnouncementTenantId,
    ],
    (
      announcements,
      tenantId,
    ) => {
      if (!tenantId) {
        return announcements;
      }

      return announcements.filter(
        (announcement) => {
          const announcementTenantId =
            normalizeId(
              announcement.tenantId ??
                announcement.tenant?.id ??
                announcement.tenant?._id,
            );

          return (
            !announcementTenantId ||
            announcementTenantId ===
              tenantId
          );
        },
      );
    },
  );

/* ============================================================================
 * CATEGORY SELECTORS
 * ========================================================================== */

export const selectAnnouncementCategories =
  createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) => {
      const categories =
        new Set();

      announcements.forEach(
        (announcement) => {
          const category =
            normalizeString(
              announcement.category,
            );

          if (category) {
            categories.add(
              category,
            );
          }
        },
      );

      return Array.from(
        categories,
      ).sort(
        (a, b) =>
          a.localeCompare(
            b,
            undefined,
            {
              sensitivity:
                'base',
            },
          ),
      );
    },
  );

/* ============================================================================
 * AGGREGATE COUNTS
 * ========================================================================== */

export const selectAnnouncementCounts =
  createSelector(
    [
      selectNormalizedAnnouncements,
      selectUnreadAnnouncementCount,
      selectPublishedAnnouncementCount,
      selectScheduledAnnouncementCount,
      selectUrgentAnnouncementCount,
    ],
    (
      announcements,
      unread,
      published,
      scheduled,
      urgent,
    ) => ({
      total:
        announcements.length,

      unread,

      read:
        Math.max(
          announcements.length -
            unread,
          0,
        ),

      published,

      scheduled,

      urgent,
    }),
  );

/* ============================================================================
 * UI STATE
 * ========================================================================== */

export const selectAnnouncementUiState =
  createSelector(
    [
      selectAnnouncementsLoading,
      selectAnnouncementsRefreshing,
      selectAnnouncementsSubmitting,
      selectAnnouncementsDeleting,
      selectAnnouncementsHasError,
      selectAnnouncementSearchTerm,
      selectAnnouncementSort,
      selectSelectedAnnouncementId,
    ],
    (
      loading,
      refreshing,
      submitting,
      deleting,
      hasError,
      searchTerm,
      sort,
      selectedId,
    ) => ({
      loading,

      refreshing,

      submitting,

      deleting,

      hasError,

      searching:
        Boolean(
          searchTerm,
        ),

      searchTerm,

      sort,

      selectedId,
    }),
  );

/* ============================================================================
 * EMPTY / DISPLAY STATE
 * ========================================================================== */

export const selectAnnouncementsEmpty =
  createSelector(
    [
      selectSortedAnnouncements,
      selectAnnouncementsLoading,
    ],
    (
      announcements,
      loading,
    ) =>
      !loading &&
      announcements.length ===
        0,
  );

export const selectAnnouncementsHasData =
  createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) =>
      announcements.length >
      0,
  );

/**
 * Useful when the UI needs to distinguish:
 *
 *   Loading
 *   Empty
 *   Data
 *   Error
 */
export const selectAnnouncementDisplayState =
  createSelector(
    [
      selectAnnouncementsLoading,
      selectAnnouncementsHasError,
      selectAnnouncementsEmpty,
      selectAnnouncementsHasData,
    ],
    (
      loading,
      hasError,
      empty,
      hasData,
    ) => {
      if (loading) {
        return 'loading';
      }

      if (hasError) {
        return 'error';
      }

      if (empty) {
        return 'empty';
      }

      if (hasData) {
        return 'ready';
      }

      return 'idle';
    },
  );

/* ============================================================================
 * ENTITY LOOKUP FACTORY
 * ========================================================================== */

/**
 * Factory selector for selecting a single announcement by ID.
 *
 * Usage:
 *
 *   const selectAnnouncementById =
 *     makeSelectAnnouncementById(id);
 *
 *   const announcement =
 *     useSelector(selectAnnouncementById);
 *
 * @param {string|number} announcementId
 * @returns {Function}
 */
export function makeSelectAnnouncementById(
  announcementId,
) {
  const normalizedId =
    normalizeId(
      announcementId,
    );

  return createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) => {
      if (!normalizedId) {
        return null;
      }

      return (
        announcements.find(
          (announcement) =>
            announcement.id ===
            normalizedId,
        ) ||
        null
      );
    },
  );
}

/**
 * Factory selector for unread state.
 *
 * @param {string|number} announcementId
 * @returns {Function}
 */
export function makeSelectAnnouncementIsUnread(
  announcementId,
) {
  const selectAnnouncement =
    makeSelectAnnouncementById(
      announcementId,
    );

  return createSelector(
    [
      selectAnnouncement,
    ],
    (announcement) =>
      Boolean(
        announcement?.unread,
      ),
  );
}

/* ============================================================================
 * PARAMETRIC SEARCH SELECTOR
 * ========================================================================== */

/**
 * Create a selector for a specific search term.
 *
 * Useful for reusable widgets without modifying global Redux filter state.
 *
 * @param {string} searchTerm
 * @returns {Function}
 */
export function makeSelectAnnouncementsBySearch(
  searchTerm,
) {
  const normalizedSearch =
    normalizeString(
      searchTerm,
    ).toLowerCase();

  return createSelector(
    [
      selectNormalizedAnnouncements,
    ],
    (announcements) => {
      if (!normalizedSearch) {
        return announcements;
      }

      return announcements.filter(
        (announcement) => {
          const searchableText =
            [
              announcement.title,
              announcement.body,
              announcement.category,
              announcement.authorName,
              announcement.createdByName,
            ]
              .map(
                normalizeString,
              )
              .join(' ')
              .toLowerCase();

          return searchableText.includes(
            normalizedSearch,
          );
        },
      );
    },
  );
}

/* ============================================================================
 * NOTIFICATION BADGE
 * ========================================================================== */

export const selectAnnouncementBadgeCount =
  createSelector(
    [
      selectUnreadAnnouncementCount,
    ],
    (count) =>
      count > 99
        ? '99+'
        : count,
  );

/**
 * Whether a notification badge should be displayed.
 */
export const selectShouldShowAnnouncementBadge =
  createSelector(
    [
      selectUnreadAnnouncementCount,
    ],
    (count) =>
      count > 0,
  );

/* ============================================================================
 * REFRESH / RETRY STATE
 * ========================================================================== */

export const selectCanRetryAnnouncements =
  createSelector(
    [
      selectAnnouncementsHasError,
      selectAnnouncementsLoading,
      selectAnnouncementsRefreshing,
    ],
    (
      hasError,
      loading,
      refreshing,
    ) =>
      hasError &&
      !loading &&
      !refreshing,
  );

/* ============================================================================
 * PUBLIC SELECTOR CONTRACT
 * ========================================================================== */

/**
 * Central selector contract.
 *
 * Keeping this export frozen gives consumers a discoverable API and prevents
 * accidental mutation of the selector registry.
 */
export const ANNOUNCEMENT_SELECTORS =
  Object.freeze({
    state:
      selectAnnouncementState,

    announcements:
      selectAnnouncements,

    normalized:
      selectNormalizedAnnouncements,

    entities:
      selectAnnouncementEntities,

    ids:
      selectAnnouncementIds,

    visible:
      selectVisibleAnnouncements,

    filtered:
      selectFilteredAnnouncements,

    sorted:
      selectSortedAnnouncements,

    selected:
      selectSelectedAnnouncement,

    selectedId:
      selectSelectedAnnouncementId,

    latest:
      selectLatestAnnouncement,

    featured:
      selectFeaturedAnnouncements,

    unread:
      selectUnreadAnnouncements,

    read:
      selectReadAnnouncements,

    unreadCount:
      selectUnreadAnnouncementCount,

    counts:
      selectAnnouncementCounts,

    loading:
      selectAnnouncementsLoading,

    refreshing:
      selectAnnouncementsRefreshing,

    submitting:
      selectAnnouncementsSubmitting,

    deleting:
      selectAnnouncementsDeleting,

    error:
      selectAnnouncementsError,

    hasError:
      selectAnnouncementsHasError,

    initialized:
      selectAnnouncementsInitialized,

    displayState:
      selectAnnouncementDisplayState,

    pagination:
      selectAnnouncementPagination,

    page:
      selectAnnouncementPage,

    pageSize:
      selectAnnouncementPageSize,

    total:
      selectAnnouncementTotal,

    totalPages:
      selectAnnouncementTotalPages,

    hasNextPage:
      selectAnnouncementHasNextPage,

    hasPreviousPage:
      selectAnnouncementHasPreviousPage,

    searchTerm:
      selectAnnouncementSearchTerm,

    statusFilter:
      selectAnnouncementStatusFilter,

    priorityFilter:
      selectAnnouncementPriorityFilter,

    audienceFilter:
      selectAnnouncementAudienceFilter,

    sort:
      selectAnnouncementSort,

    tenantId:
      selectAnnouncementTenantId,

    categories:
      selectAnnouncementCategories,

    badgeCount:
      selectAnnouncementBadgeCount,

    showBadge:
      selectShouldShowAnnouncementBadge,

    canRetry:
      selectCanRetryAnnouncements,
  });

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

export default ANNOUNCEMENT_SELECTORS;