/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat — Announcement Redux Slice
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/announcementSlice.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade Redux Toolkit state management for TITechChat
 *   announcements.
 *
 * Responsibilities:
 *   - Manage announcement collection state.
 *   - Support initial loading and refresh operations.
 *   - Support pagination / incremental loading.
 *   - Normalize API response shapes.
 *   - Track unread announcement state.
 *   - Support announcement selection.
 *   - Handle optimistic/read-state updates safely.
 *   - Prevent stale asynchronous responses from corrupting state.
 *   - Provide predictable loading/error/empty states.
 *   - Preserve backward compatibility with common service response shapes.
 *   - Remain independent from presentation-layer components.
 *
 * Architecture:
 *   UI
 *    ↓
 *   announcementSlice
 *    ↓
 *   announcementService
 *    ↓
 *   TITech Community Capital API
 *
 * Important:
 *   This file must not contain direct Axios/fetch calls.
 *   Network communication belongs in announcementService.js.
 *
 * Branding:
 *   TITech Community Capital
 *   TITechChat
 *
 * ============================================================================
 */

'use strict';

import {
  createAsyncThunk,
  createSelector,
  createSlice,
} from '@reduxjs/toolkit';

import announcementService from './announcementService';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

export const ANNOUNCEMENT_SLICE_NAME =
  'titechChatAnnouncements';

export const ANNOUNCEMENT_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  REFRESHING: 'refreshing',
  LOADING_MORE: 'loadingMore',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
});

export const ANNOUNCEMENT_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});

export const ANNOUNCEMENT_TYPES = Object.freeze({
  GENERAL: 'general',
  SYSTEM: 'system',
  SECURITY: 'security',
  SAVINGS: 'savings',
  LOAN: 'loan',
  PAYMENT: 'payment',
  MAINTENANCE: 'maintenance',
  COMPLIANCE: 'compliance',
});

/* ============================================================================
 * DEFAULT STATE
 * ========================================================================== */

const initialState = Object.freeze({
  items: [],
  byId: {},
  ids: [],

  selectedId: null,

  status: ANNOUNCEMENT_STATUS.IDLE,
  error: null,

  lastFetchedAt: null,
  lastRefreshAt: null,

  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },

  unreadCount: 0,

  filters: {
    type: null,
    priority: null,
    search: '',
    unreadOnly: false,
  },

  request: {
    activeRequestId: null,
    activeOperation: null,
  },

  mutation: {
    markingReadIds: [],
    markingUnreadIds: [],
    dismissingIds: [],
  },
});

/* ============================================================================
 * NORMALIZATION HELPERS
 * ========================================================================== */

/**
 * Safely convert arbitrary values into a usable array.
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Extract an announcement identifier from common backend formats.
 */
function getAnnouncementId(announcement) {
  if (!announcement || typeof announcement !== 'object') {
    return null;
  }

  return (
    announcement.id ??
    announcement._id ??
    announcement.announcementId ??
    announcement.uuid ??
    null
  );
}

/**
 * Normalize one announcement into a stable frontend representation.
 */
function normalizeAnnouncement(rawAnnouncement) {
  if (!rawAnnouncement || typeof rawAnnouncement !== 'object') {
    return null;
  }

  const id = getAnnouncementId(rawAnnouncement);

  if (!id) {
    return null;
  }

  const normalized = {
    ...rawAnnouncement,

    id: String(id),

    title:
      typeof rawAnnouncement.title === 'string'
        ? rawAnnouncement.title.trim()
        : '',

    message:
      typeof rawAnnouncement.message === 'string'
        ? rawAnnouncement.message
        : typeof rawAnnouncement.body === 'string'
          ? rawAnnouncement.body
          : typeof rawAnnouncement.content === 'string'
            ? rawAnnouncement.content
            : '',

    type:
      rawAnnouncement.type ??
      rawAnnouncement.category ??
      ANNOUNCEMENT_TYPES.GENERAL,

    priority:
      rawAnnouncement.priority ??
      ANNOUNCEMENT_PRIORITY.NORMAL,

    isRead:
      Boolean(
        rawAnnouncement.isRead ??
          rawAnnouncement.read ??
          rawAnnouncement.readAt,
      ),

    isDismissed:
      Boolean(
        rawAnnouncement.isDismissed ??
          rawAnnouncement.dismissed,
      ),

    createdAt:
      rawAnnouncement.createdAt ??
      rawAnnouncement.created_at ??
      rawAnnouncement.date ??
      null,

    updatedAt:
      rawAnnouncement.updatedAt ??
      rawAnnouncement.updated_at ??
      null,

    readAt:
      rawAnnouncement.readAt ??
      null,
  };

  return Object.freeze(normalized);
}

/**
 * Extract announcements from multiple possible API response envelopes.
 *
 * Supported examples:
 *
 * [
 *   {...}
 * ]
 *
 * {
 *   data: [...]
 * }
 *
 * {
 *   announcements: [...]
 * }
 *
 * {
 *   data: {
 *     announcements: [...]
 *   }
 * }
 *
 * {
 *   results: [...]
 * }
 */
function extractAnnouncements(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (!response || typeof response !== 'object') {
    return [];
  }

  if (Array.isArray(response.announcements)) {
    return response.announcements;
  }

  if (Array.isArray(response.results)) {
    return response.results;
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (
    response.data &&
    typeof response.data === 'object'
  ) {
    if (Array.isArray(response.data.announcements)) {
      return response.data.announcements;
    }

    if (Array.isArray(response.data.results)) {
      return response.data.results;
    }

    if (Array.isArray(response.data.items)) {
      return response.data.items;
    }
  }

  if (Array.isArray(response.items)) {
    return response.items;
  }

  return [];
}

/**
 * Extract pagination metadata from a common API response shape.
 */
function extractPagination(response, fallback = {}) {
  const source =
    response?.pagination ??
    response?.meta?.pagination ??
    response?.data?.pagination ??
    response?.meta ??
    response?.data?.meta ??
    {};

  const page =
    Number(
      source.page ??
        source.currentPage ??
        fallback.page ??
        1,
    ) || 1;

  const limit =
    Number(
      source.limit ??
        source.pageSize ??
        fallback.limit ??
        20,
    ) || 20;

  const total =
    Number(
      source.total ??
        source.totalItems ??
        fallback.total ??
        0,
    ) || 0;

  const totalPages =
    Number(
      source.totalPages ??
        source.pages ??
        (limit > 0
          ? Math.ceil(total / limit)
          : 1),
    ) || 1;

  const hasNextPage =
    typeof source.hasNextPage === 'boolean'
      ? source.hasNextPage
      : page < totalPages;

  const hasPreviousPage =
    typeof source.hasPreviousPage === 'boolean'
      ? source.hasPreviousPage
      : page > 1;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    hasPreviousPage,
  };
}

/**
 * Extract a useful API error message without leaking implementation details.
 */
function extractErrorMessage(error) {
  if (!error) {
    return 'An unexpected announcement error occurred.';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  if (error.response?.data?.message) {
    return error.response.data.message;
  }

  if (error.response?.data?.error) {
    return error.response.data.error;
  }

  if (error.data?.message) {
    return error.data.message;
  }

  return 'Unable to load announcements. Please try again.';
}

/**
 * Create a serializable error object for Redux state.
 */
function serializeError(error) {
  return {
    message: extractErrorMessage(error),
    code:
      error?.code ??
      error?.response?.data?.code ??
      null,
    status:
      error?.status ??
      error?.response?.status ??
      null,
    timestamp: new Date().toISOString(),
  };
}

/* ============================================================================
 * SERVICE ADAPTER
 * ========================================================================== */

/**
 * Resolve a service method without coupling this slice to one exact
 * implementation name.
 *
 * The preferred production method is:
 *
 *   announcementService.list()
 *
 * Compatible fallbacks are retained to reduce integration friction.
 */
function resolveListMethod() {
  if (typeof announcementService?.list === 'function') {
    return announcementService.list.bind(announcementService);
  }

  if (typeof announcementService?.getAnnouncements === 'function') {
    return announcementService.getAnnouncements.bind(
      announcementService,
    );
  }

  if (
    typeof announcementService?.fetchAnnouncements ===
    'function'
  ) {
    return announcementService.fetchAnnouncements.bind(
      announcementService,
    );
  }

  throw new Error(
    'announcementService.list() is not available.',
  );
}

/**
 * Resolve a mark-read service method.
 */
function resolveMarkReadMethod() {
  if (
    typeof announcementService?.markAsRead ===
    'function'
  ) {
    return announcementService.markAsRead.bind(
      announcementService,
    );
  }

  if (
    typeof announcementService?.markRead ===
    'function'
  ) {
    return announcementService.markRead.bind(
      announcementService,
    );
  }

  throw new Error(
    'announcementService.markAsRead() is not available.',
  );
}

/**
 * Resolve a mark-unread service method.
 */
function resolveMarkUnreadMethod() {
  if (
    typeof announcementService?.markAsUnread ===
    'function'
  ) {
    return announcementService.markAsUnread.bind(
      announcementService,
    );
  }

  if (
    typeof announcementService?.markUnread ===
    'function'
  ) {
    return announcementService.markUnread.bind(
      announcementService,
    );
  }

  throw new Error(
    'announcementService.markAsUnread() is not available.',
  );
}

/**
 * Resolve a dismiss service method.
 */
function resolveDismissMethod() {
  if (
    typeof announcementService?.dismiss ===
    'function'
  ) {
    return announcementService.dismiss.bind(
      announcementService,
    );
  }

  if (
    typeof announcementService?.dismissAnnouncement ===
    'function'
  ) {
    return announcementService.dismissAnnouncement.bind(
      announcementService,
    );
  }

  throw new Error(
    'announcementService.dismiss() is not available.',
  );
}

/* ============================================================================
 * ASYNC THUNKS
 * ========================================================================== */

/**
 * Fetch the first page of announcements.
 */
export const fetchAnnouncements = createAsyncThunk(
  `${ANNOUNCEMENT_SLICE_NAME}/fetchAnnouncements`,
  async (
    options = {},
    { rejectWithValue, signal },
  ) => {
    try {
      const {
        page = 1,
        limit = 20,
        type = null,
        priority = null,
        search = '',
        unreadOnly = false,
        force = false,
      } = options;

      const service = resolveListMethod();

      const response = await service({
        page,
        limit,
        type,
        priority,
        search,
        unreadOnly,
        force,
        signal,
      });

      return {
        response,
        requestedPage: page,
        requestedLimit: limit,
      };
    } catch (error) {
      return rejectWithValue(
        serializeError(error),
      );
    }
  },
);

/**
 * Refresh announcements from the first page.
 */
export const refreshAnnouncements = createAsyncThunk(
  `${ANNOUNCEMENT_SLICE_NAME}/refreshAnnouncements`,
  async (
    options = {},
    { rejectWithValue, signal },
  ) => {
    try {
      const {
        limit = 20,
        type = null,
        priority = null,
        search = '',
        unreadOnly = false,
      } = options;

      const service = resolveListMethod();

      const response = await service({
        page: 1,
        limit,
        type,
        priority,
        search,
        unreadOnly,
        force: true,
        signal,
      });

      return {
        response,
        requestedPage: 1,
        requestedLimit: limit,
      };
    } catch (error) {
      return rejectWithValue(
        serializeError(error),
      );
    }
  },
);

/**
 * Load the next page.
 */
export const loadMoreAnnouncements = createAsyncThunk(
  `${ANNOUNCEMENT_SLICE_NAME}/loadMoreAnnouncements`,
  async (
    options = {},
    { getState, rejectWithValue, signal },
  ) => {
    try {
      const slice =
        getState()?.[ANNOUNCEMENT_SLICE_NAME] ??
        initialState;

      const nextPage =
        Number(
          options.page ??
            slice.pagination.page + 1,
        ) || 1;

      const limit =
        Number(
          options.limit ??
            slice.pagination.limit ??
            20,
        ) || 20;

      if (
        !options.force &&
        !slice.pagination.hasNextPage
      ) {
        return {
          response: null,
          requestedPage: nextPage,
          requestedLimit: limit,
          skipped: true,
        };
      }

      const service = resolveListMethod();

      const response = await service({
        page: nextPage,
        limit,
        type:
          options.type ??
          slice.filters.type,
        priority:
          options.priority ??
          slice.filters.priority,
        search:
          options.search ??
          slice.filters.search,
        unreadOnly:
          options.unreadOnly ??
          slice.filters.unreadOnly,
        force: options.force ?? false,
        signal,
      });

      return {
        response,
        requestedPage: nextPage,
        requestedLimit: limit,
        skipped: false,
      };
    } catch (error) {
      return rejectWithValue(
        serializeError(error),
      );
    }
  },
);

/**
 * Mark one announcement as read.
 */
export const markAnnouncementAsRead = createAsyncThunk(
  `${ANNOUNCEMENT_SLICE_NAME}/markAnnouncementAsRead`,
  async (
    announcementId,
    { rejectWithValue },
  ) => {
    try {
      const id = String(announcementId);

      const service =
        resolveMarkReadMethod();

      const response = await service(id);

      return {
        id,
        response,
      };
    } catch (error) {
      return rejectWithValue({
        ...serializeError(error),
        id:
          announcementId != null
            ? String(announcementId)
            : null,
      });
    }
  },
);

/**
 * Mark one announcement as unread.
 */
export const markAnnouncementAsUnread =
  createAsyncThunk(
    `${ANNOUNCEMENT_SLICE_NAME}/markAnnouncementAsUnread`,
    async (
      announcementId,
      { rejectWithValue },
    ) => {
      try {
        const id = String(announcementId);

        const service =
          resolveMarkUnreadMethod();

        const response = await service(id);

        return {
          id,
          response,
        };
      } catch (error) {
        return rejectWithValue({
          ...serializeError(error),
          id:
            announcementId != null
              ? String(announcementId)
              : null,
        });
      }
    },
  );

/**
 * Dismiss one announcement.
 */
export const dismissAnnouncement =
  createAsyncThunk(
    `${ANNOUNCEMENT_SLICE_NAME}/dismissAnnouncement`,
    async (
      announcementId,
      { rejectWithValue },
    ) => {
      try {
        const id = String(announcementId);

        const service =
          resolveDismissMethod();

        const response = await service(id);

        return {
          id,
          response,
        };
      } catch (error) {
        return rejectWithValue({
          ...serializeError(error),
          id:
            announcementId != null
              ? String(announcementId)
              : null,
        });
      }
    },
  );

/* ============================================================================
 * STATE MUTATION HELPERS
 * ========================================================================== */

/**
 * Replace or append normalized announcements while preserving stable ordering.
 */
function upsertAnnouncements(
  state,
  announcements,
  {
    append = false,
  } = {},
) {
  const normalizedItems = asArray(
    announcements,
  )
    .map(normalizeAnnouncement)
    .filter(Boolean);

  if (!append) {
    state.items = [];
    state.byId = {};
    state.ids = [];
  }

  normalizedItems.forEach((announcement) => {
    const id = announcement.id;

    if (!state.byId[id]) {
      state.ids.push(id);
    }

    state.byId[id] = announcement;
  });

  state.items = state.ids
    .map((id) => state.byId[id])
    .filter(Boolean);

  state.unreadCount = state.items.filter(
    (announcement) =>
      !announcement.isRead &&
      !announcement.isDismissed,
  ).length;
}

/**
 * Update a single announcement without changing collection order.
 */
function updateAnnouncement(
  state,
  id,
  updater,
) {
  const normalizedId = String(id);

  const current =
    state.byId[normalizedId];

  if (!current) {
    return;
  }

  const updated =
    typeof updater === 'function'
      ? updater(current)
      : {
          ...current,
          ...updater,
        };

  state.byId[normalizedId] =
    normalizeAnnouncement(updated) ??
    current;

  state.items = state.ids
    .map((announcementId) =>
      state.byId[announcementId],
    )
    .filter(Boolean);

  state.unreadCount = state.items.filter(
    (announcement) =>
      !announcement.isRead &&
      !announcement.isDismissed,
  ).length;
}

/**
 * Recalculate unread count from canonical collection state.
 */
function recalculateUnreadCount(state) {
  state.unreadCount = state.items.filter(
    (announcement) =>
      !announcement.isRead &&
      !announcement.isDismissed,
  ).length;
}

/* ============================================================================
 * SLICE
 * ========================================================================== */

const announcementSlice = createSlice({
  name: ANNOUNCEMENT_SLICE_NAME,

  initialState,

  reducers: {
    /**
     * Clear the current error.
     */
    clearAnnouncementError(state) {
      state.error = null;
    },

    /**
     * Clear the complete announcement collection.
     */
    clearAnnouncements(state) {
      state.items = [];
      state.byId = {};
      state.ids = [];

      state.selectedId = null;

      state.pagination = {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      };

      state.unreadCount = 0;

      state.status =
        ANNOUNCEMENT_STATUS.IDLE;

      state.error = null;
    },

    /**
     * Select an announcement.
     */
    setSelectedAnnouncement(
      state,
      action,
    ) {
      const id =
        action.payload == null
          ? null
          : String(action.payload);

      if (
        id !== null &&
        !state.byId[id]
      ) {
        state.selectedId = null;
        return;
      }

      state.selectedId = id;
    },

    /**
     * Clear the selected announcement.
     */
    clearSelectedAnnouncement(state) {
      state.selectedId = null;
    },

    /**
     * Update filters without performing a request.
     */
    setAnnouncementFilters(
      state,
      action,
    ) {
      const payload =
        action.payload ?? {};

      state.filters = {
        ...state.filters,
        ...(payload.type !== undefined && {
          type: payload.type,
        }),
        ...(payload.priority !== undefined && {
          priority: payload.priority,
        }),
        ...(payload.search !== undefined && {
          search:
            typeof payload.search === 'string'
              ? payload.search
              : '',
        }),
        ...(payload.unreadOnly !== undefined && {
          unreadOnly:
            Boolean(payload.unreadOnly),
        }),
      };
    },

    /**
     * Reset all filters.
     */
    resetAnnouncementFilters(state) {
      state.filters = {
        type: null,
        priority: null,
        search: '',
        unreadOnly: false,
      };
    },

    /**
     * Apply a local read state immediately.
     *
     * Useful for responsive UI while the server mutation is pending.
     */
    markAnnouncementReadOptimistic(
      state,
      action,
    ) {
      const id = String(
        action.payload,
      );

      updateAnnouncement(
        state,
        id,
        (announcement) => ({
          ...announcement,
          isRead: true,
          readAt:
            announcement.readAt ??
            new Date().toISOString(),
        }),
      );
    },

    /**
     * Apply a local unread state immediately.
     */
    markAnnouncementUnreadOptimistic(
      state,
      action,
    ) {
      const id = String(
        action.payload,
      );

      updateAnnouncement(
        state,
        id,
        (announcement) => ({
          ...announcement,
          isRead: false,
          readAt: null,
        }),
      );
    },

    /**
     * Replace an announcement locally.
     */
    updateAnnouncementLocal(
      state,
      action,
    ) {
      const incoming =
        normalizeAnnouncement(
          action.payload,
        );

      if (!incoming) {
        return;
      }

      updateAnnouncement(
        state,
        incoming.id,
        incoming,
      );
    },

    /**
     * Recalculate derived unread state.
     */
    recalculateUnreadCount(state) {
      recalculateUnreadCount(state);
    },

    /**
     * Reset the slice to its initial state.
     */
    resetAnnouncementState() {
      return {
        ...initialState,

        items: [],
        byId: {},
        ids: [],

        pagination: {
          ...initialState.pagination,
        },

        filters: {
          ...initialState.filters,
        },

        request: {
          ...initialState.request,
        },

        mutation: {
          markingReadIds: [],
          markingUnreadIds: [],
          dismissingIds: [],
        },
      };
    },
  },

  extraReducers: (builder) => {
    /* ========================================================================
     * FETCH
     * ====================================================================== */

    builder
      .addCase(
        fetchAnnouncements.pending,
        (state, action) => {
          state.status =
            ANNOUNCEMENT_STATUS.LOADING;

          state.error = null;

          state.request.activeRequestId =
            action.meta.requestId;

          state.request.activeOperation =
            'fetch';
        },
      )

      .addCase(
        fetchAnnouncements.fulfilled,
        (state, action) => {
          /*
           * Ignore stale responses when another request has already
           * replaced the active request.
           */
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          const {
            response,
            requestedPage,
            requestedLimit,
          } = action.payload;

          const announcements =
            extractAnnouncements(
              response,
            );

          upsertAnnouncements(
            state,
            announcements,
            {
              append:
                requestedPage > 1,
            },
          );

          state.pagination =
            extractPagination(
              response,
              {
                page:
                  requestedPage,
                limit:
                  requestedLimit,
                total:
                  state.items.length,
              },
            );

          state.status =
            ANNOUNCEMENT_STATUS.SUCCEEDED;

          state.error = null;

          state.lastFetchedAt =
            new Date().toISOString();

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      )

      .addCase(
        fetchAnnouncements.rejected,
        (state, action) => {
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          state.status =
            ANNOUNCEMENT_STATUS.FAILED;

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      );

    /* ========================================================================
     * REFRESH
     * ====================================================================== */

    builder
      .addCase(
        refreshAnnouncements.pending,
        (state, action) => {
          state.status =
            ANNOUNCEMENT_STATUS.REFRESHING;

          state.error = null;

          state.request.activeRequestId =
            action.meta.requestId;

          state.request.activeOperation =
            'refresh';
        },
      )

      .addCase(
        refreshAnnouncements.fulfilled,
        (state, action) => {
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          const {
            response,
            requestedLimit,
          } = action.payload;

          upsertAnnouncements(
            state,
            extractAnnouncements(
              response,
            ),
            {
              append: false,
            },
          );

          state.pagination =
            extractPagination(
              response,
              {
                page: 1,
                limit:
                  requestedLimit,
                total:
                  state.items.length,
              },
            );

          state.status =
            ANNOUNCEMENT_STATUS.SUCCEEDED;

          state.error = null;

          state.lastFetchedAt =
            new Date().toISOString();

          state.lastRefreshAt =
            new Date().toISOString();

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      )

      .addCase(
        refreshAnnouncements.rejected,
        (state, action) => {
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          state.status =
            ANNOUNCEMENT_STATUS.FAILED;

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      );

    /* ========================================================================
     * LOAD MORE
     * ====================================================================== */

    builder
      .addCase(
        loadMoreAnnouncements.pending,
        (state, action) => {
          state.status =
            ANNOUNCEMENT_STATUS.LOADING_MORE;

          state.error = null;

          state.request.activeRequestId =
            action.meta.requestId;

          state.request.activeOperation =
            'loadMore';
        },
      )

      .addCase(
        loadMoreAnnouncements.fulfilled,
        (state, action) => {
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          if (action.payload.skipped) {
            state.status =
              ANNOUNCEMENT_STATUS.SUCCEEDED;

            state.request.activeRequestId =
              null;

            state.request.activeOperation =
              null;

            return;
          }

          const {
            response,
            requestedPage,
            requestedLimit,
          } = action.payload;

          upsertAnnouncements(
            state,
            extractAnnouncements(
              response,
            ),
            {
              append: true,
            },
          );

          state.pagination =
            extractPagination(
              response,
              {
                page:
                  requestedPage,
                limit:
                  requestedLimit,
                total:
                  state.items.length,
              },
            );

          state.status =
            ANNOUNCEMENT_STATUS.SUCCEEDED;

          state.error = null;

          state.lastFetchedAt =
            new Date().toISOString();

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      )

      .addCase(
        loadMoreAnnouncements.rejected,
        (state, action) => {
          if (
            state.request.activeRequestId &&
            state.request.activeRequestId !==
              action.meta.requestId
          ) {
            return;
          }

          state.status =
            ANNOUNCEMENT_STATUS.FAILED;

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );

          state.request.activeRequestId =
            null;

          state.request.activeOperation =
            null;
        },
      );

    /* ========================================================================
     * MARK READ
     * ====================================================================== */

    builder
      .addCase(
        markAnnouncementAsRead.pending,
        (state, action) => {
          const id =
            String(action.meta.arg);

          if (
            !state.mutation.markingReadIds.includes(
              id,
            )
          ) {
            state.mutation.markingReadIds.push(
              id,
            );
          }
        },
      )

      .addCase(
        markAnnouncementAsRead.fulfilled,
        (state, action) => {
          const id =
            String(action.payload.id);

          state.mutation.markingReadIds =
            state.mutation.markingReadIds.filter(
              (item) =>
                item !== id,
            );

          updateAnnouncement(
            state,
            id,
            (announcement) => ({
              ...announcement,
              isRead: true,
              readAt:
                announcement.readAt ??
                new Date().toISOString(),
            }),
          );
        },
      )

      .addCase(
        markAnnouncementAsRead.rejected,
        (state, action) => {
          const id =
            String(
              action.payload?.id ??
                action.meta.arg,
            );

          state.mutation.markingReadIds =
            state.mutation.markingReadIds.filter(
              (item) =>
                item !== id,
            );

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );
        },
      );

    /* ========================================================================
     * MARK UNREAD
     * ====================================================================== */

    builder
      .addCase(
        markAnnouncementAsUnread.pending,
        (state, action) => {
          const id =
            String(action.meta.arg);

          if (
            !state.mutation.markingUnreadIds.includes(
              id,
            )
          ) {
            state.mutation.markingUnreadIds.push(
              id,
            );
          }
        },
      )

      .addCase(
        markAnnouncementAsUnread.fulfilled,
        (state, action) => {
          const id =
            String(action.payload.id);

          state.mutation.markingUnreadIds =
            state.mutation.markingUnreadIds.filter(
              (item) =>
                item !== id,
            );

          updateAnnouncement(
            state,
            id,
            (announcement) => ({
              ...announcement,
              isRead: false,
              readAt: null,
            }),
          );
        },
      )

      .addCase(
        markAnnouncementAsUnread.rejected,
        (state, action) => {
          const id =
            String(
              action.payload?.id ??
                action.meta.arg,
            );

          state.mutation.markingUnreadIds =
            state.mutation.markingUnreadIds.filter(
              (item) =>
                item !== id,
            );

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );
        },
      );

    /* ========================================================================
     * DISMISS
     * ====================================================================== */

    builder
      .addCase(
        dismissAnnouncement.pending,
        (state, action) => {
          const id =
            String(action.meta.arg);

          if (
            !state.mutation.dismissingIds.includes(
              id,
            )
          ) {
            state.mutation.dismissingIds.push(
              id,
            );
          }
        },
      )

      .addCase(
        dismissAnnouncement.fulfilled,
        (state, action) => {
          const id =
            String(action.payload.id);

          state.mutation.dismissingIds =
            state.mutation.dismissingIds.filter(
              (item) =>
                item !== id,
            );

          updateAnnouncement(
            state,
            id,
            (announcement) => ({
              ...announcement,
              isDismissed: true,
            }),
          );
        },
      )

      .addCase(
        dismissAnnouncement.rejected,
        (state, action) => {
          const id =
            String(
              action.payload?.id ??
                action.meta.arg,
            );

          state.mutation.dismissingIds =
            state.mutation.dismissingIds.filter(
              (item) =>
                item !== id,
            );

          state.error =
            action.payload ??
            serializeError(
              action.error,
            );
        },
      );
  },
});

/* ============================================================================
 * ACTION EXPORTS
 * ========================================================================== */

export const {
  clearAnnouncementError,
  clearAnnouncements,
  setSelectedAnnouncement,
  clearSelectedAnnouncement,
  setAnnouncementFilters,
  resetAnnouncementFilters,
  markAnnouncementReadOptimistic,
  markAnnouncementUnreadOptimistic,
  updateAnnouncementLocal,
  recalculateUnreadCount,
  resetAnnouncementState,
} = announcementSlice.actions;

/* ============================================================================
 * BASE SELECTOR
 * ========================================================================== */

export const selectAnnouncementState =
  (state) =>
    state?.[ANNOUNCEMENT_SLICE_NAME] ??
    initialState;

/* ============================================================================
 * MEMOIZED SELECTORS
 * ========================================================================== */

export const selectAnnouncements =
  createSelector(
    [selectAnnouncementState],
    (state) => state.items,
  );

export const selectAnnouncementIds =
  createSelector(
    [selectAnnouncementState],
    (state) => state.ids,
  );

export const selectAnnouncementsById =
  createSelector(
    [selectAnnouncementState],
    (state) => state.byId,
  );

export const selectSelectedAnnouncementId =
  createSelector(
    [selectAnnouncementState],
    (state) => state.selectedId,
  );

export const selectSelectedAnnouncement =
  createSelector(
    [
      selectAnnouncementState,
      selectSelectedAnnouncementId,
    ],
    (state, selectedId) =>
      selectedId
        ? state.byId[selectedId] ??
          null
        : null,
  );

export const selectAnnouncementStatus =
  createSelector(
    [selectAnnouncementState],
    (state) => state.status,
  );

export const selectAnnouncementError =
  createSelector(
    [selectAnnouncementState],
    (state) => state.error,
  );

export const selectAnnouncementPagination =
  createSelector(
    [selectAnnouncementState],
    (state) => state.pagination,
  );

export const selectAnnouncementFilters =
  createSelector(
    [selectAnnouncementState],
    (state) => state.filters,
  );

export const selectUnreadAnnouncementCount =
  createSelector(
    [selectAnnouncementState],
    (state) => state.unreadCount,
  );

export const selectUnreadAnnouncements =
  createSelector(
    [selectAnnouncements],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          !announcement.isRead &&
          !announcement.isDismissed,
      ),
  );

export const selectReadAnnouncements =
  createSelector(
    [selectAnnouncements],
    (announcements) =>
      announcements.filter(
        (announcement) =>
          announcement.isRead &&
          !announcement.isDismissed,
      ),
  );

export const selectVisibleAnnouncements =
  createSelector(
    [
      selectAnnouncements,
      selectAnnouncementFilters,
    ],
    (
      announcements,
      filters,
    ) =>
      announcements.filter(
        (announcement) => {
          if (
            announcement.isDismissed
          ) {
            return false;
          }

          if (
            filters.type &&
            announcement.type !==
              filters.type
          ) {
            return false;
          }

          if (
            filters.priority &&
            announcement.priority !==
              filters.priority
          ) {
            return false;
          }

          if (
            filters.unreadOnly &&
            announcement.isRead
          ) {
            return false;
          }

          if (
            filters.search
          ) {
            const search =
              filters.search
                .trim()
                .toLowerCase();

            if (!search) {
              return true;
            }

            const haystack =
              [
                announcement.title,
                announcement.message,
                announcement.type,
                announcement.priority,
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (
              !haystack.includes(
                search,
              )
            ) {
              return false;
            }
          }

          return true;
        },
      ),
  );

export const selectHasMoreAnnouncements =
  createSelector(
    [selectAnnouncementPagination],
    (pagination) =>
      Boolean(
        pagination.hasNextPage,
      ),
  );

export const selectIsAnnouncementsLoading =
  createSelector(
    [selectAnnouncementStatus],
    (status) =>
      status ===
      ANNOUNCEMENT_STATUS.LOADING,
  );

export const selectIsAnnouncementsRefreshing =
  createSelector(
    [selectAnnouncementStatus],
    (status) =>
      status ===
      ANNOUNCEMENT_STATUS.REFRESHING,
  );

export const selectIsAnnouncementsLoadingMore =
  createSelector(
    [selectAnnouncementStatus],
    (status) =>
      status ===
      ANNOUNCEMENT_STATUS.LOADING_MORE,
  );

export const selectIsAnnouncementsFailed =
  createSelector(
    [selectAnnouncementStatus],
    (status) =>
      status ===
      ANNOUNCEMENT_STATUS.FAILED,
  );

/**
 * Factory selector for one announcement.
 *
 * Usage:
 *
 * const announcement = useSelector(
 *   (state) =>
 *     selectAnnouncementById(
 *       state,
 *       announcementId,
 *     ),
 * );
 */
export const selectAnnouncementById = (
  state,
  announcementId,
) => {
  if (
    announcementId == null
  ) {
    return null;
  }

  return (
    selectAnnouncementsById(
      state,
    )[String(announcementId)] ??
    null
  );
};

/**
 * Factory selector for mutation state.
 */
export const selectIsAnnouncementBeingMarkedRead =
  (
    state,
    announcementId,
  ) => {
    if (
      announcementId == null
    ) {
      return false;
    }

    return selectAnnouncementState(
      state,
    ).mutation.markingReadIds.includes(
      String(announcementId),
    );
  };

export const selectIsAnnouncementBeingMarkedUnread =
  (
    state,
    announcementId,
  ) => {
    if (
      announcementId == null
    ) {
      return false;
    }

    return selectAnnouncementState(
      state,
    ).mutation.markingUnreadIds.includes(
      String(announcementId),
    );
  };

export const selectIsAnnouncementBeingDismissed =
  (
    state,
    announcementId,
  ) => {
    if (
      announcementId == null
    ) {
      return false;
    }

    return selectAnnouncementState(
      state,
    ).mutation.dismissingIds.includes(
      String(announcementId),
    );
  };

/* ============================================================================
 * REDUCER
 * ========================================================================== */

export default announcementSlice.reducer;