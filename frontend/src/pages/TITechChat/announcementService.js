/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Service
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/announcementService.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Enterprise-grade API/service layer for TITech Community Capital
 *   announcements used throughout TITechChat.
 *
 * Responsibilities:
 *   - Retrieve announcements.
 *   - Retrieve announcement details.
 *   - Create announcements.
 *   - Update announcements.
 *   - Publish/unpublish announcements.
 *   - Archive announcements.
 *   - Delete announcements where permitted.
 *   - Mark announcements as read.
 *   - Track announcement acknowledgement.
 *   - Support pagination and filtering.
 *   - Normalize backend responses.
 *   - Provide consistent error handling.
 *   - Support cancellation via AbortSignal.
 *   - Avoid leaking backend implementation details into UI components.
 *   - Remain compatible with Axios-based TITech API clients.
 *
 * Architecture:
 *   UI Component
 *        ↓
 *   announcementService
 *        ↓
 *   API client
 *        ↓
 *   TITech Community Capital Backend
 *
 * Security:
 *   - Never store access tokens in this module.
 *   - Authentication should be handled by the centralized API client.
 *   - Do not expose raw backend errors to users.
 *   - Never log sensitive announcement payloads in production.
 *
 * Branding:
 *   TITech Community Capital
 *
 * IMPORTANT:
 *   This service intentionally avoids hard-coding authentication logic.
 *   The application's centralized API client/interceptor should remain
 *   responsible for access tokens, refresh tokens, CSRF protection,
 *   credentials and authentication recovery.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * API CLIENT RESOLUTION
 * ========================================================================== */

/**
 * Resolve the application's centralized API client.
 *
 * TITech projects commonly evolve their API client location over time.
 * The preferred integration is the project's shared Axios/API instance.
 *
 * NOTE:
 *   If your project already has a canonical API client import, replace the
 *   import below with that exact client. Do NOT create another Axios instance
 *   here unless the architecture explicitly requires it.
 */
import api from '../../services/api';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

export const ANNOUNCEMENT_SERVICE_VERSION =
  '3.0.0';

export const ANNOUNCEMENT_API_PREFIX =
  '/api/announcements';

export const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  CANCELLED: 'cancelled',
});

export const ANNOUNCEMENT_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});

export const ANNOUNCEMENT_AUDIENCE = Object.freeze({
  ALL: 'all',
  MEMBERS: 'members',
  ADMINS: 'admins',
  STAFF: 'staff',
  MANAGERS: 'managers',
  GROUP: 'group',
  TENANT: 'tenant',
  CUSTOM: 'custom',
});

export const ANNOUNCEMENT_TYPES = Object.freeze({
  GENERAL: 'general',
  SYSTEM: 'system',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  FINANCIAL: 'financial',
  SAVINGS: 'savings',
  LOAN: 'loan',
  COMPLIANCE: 'compliance',
  COMMUNITY: 'community',
  PROMOTIONAL: 'promotional',
});

const DEFAULT_PAGE = 1;

const DEFAULT_LIMIT = 20;

const MAX_LIMIT = 100;

const MAX_TITLE_LENGTH = 500;

const MAX_CONTENT_LENGTH = 100000;

const MAX_SEARCH_LENGTH = 200;

/* ============================================================================
 * ERROR MODEL
 * ========================================================================== */

/**
 * Enterprise service error.
 *
 * UI components can safely inspect:
 *   error.code
 *   error.status
 *   error.message
 *   error.details
 *   error.isNetworkError
 *   error.isCancelled
 */
export class AnnouncementServiceError extends Error {
  constructor({
    message,
    code = 'ANNOUNCEMENT_SERVICE_ERROR',
    status = null,
    details = null,
    cause = null,
    isNetworkError = false,
    isCancelled = false,
  } = {}) {
    super(
      message ||
        'Unable to complete the announcement request.',
    );

    this.name =
      'AnnouncementServiceError';

    this.code =
      code;

    this.status =
      status;

    this.details =
      details;

    this.cause =
      cause;

    this.isNetworkError =
      Boolean(isNetworkError);

    this.isCancelled =
      Boolean(isCancelled);

    if (
      Error.captureStackTrace
    ) {
      Error.captureStackTrace(
        this,
        AnnouncementServiceError,
      );
    }
  }
}

/* ============================================================================
 * INTERNAL HELPERS
 * ========================================================================== */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isAbortError(error) {
  if (!error) {
    return false;
  }

  return (
    error.name ===
      'AbortError' ||
    error.code ===
      'ERR_CANCELED' ||
    error.code ===
      'ECONNABORTED' ||
    error.__CANCEL__ === true
  );
}

function getErrorStatus(error) {
  return (
    error?.response?.status ??
    error?.status ??
    null
  );
}

function getBackendErrorPayload(error) {
  return (
    error?.response?.data ??
    error?.data ??
    null
  );
}

function extractBackendMessage(error) {
  const payload =
    getBackendErrorPayload(error);

  if (
    typeof payload ===
    'string'
  ) {
    return payload;
  }

  if (
    payload &&
    typeof payload.message ===
      'string'
  ) {
    return payload.message;
  }

  if (
    payload &&
    typeof payload.error ===
      'string'
  ) {
    return payload.error;
  }

  if (
    payload?.errors &&
    Array.isArray(payload.errors) &&
    payload.errors.length > 0
  ) {
    const firstError =
      payload.errors[0];

    if (
      typeof firstError ===
      'string'
    ) {
      return firstError;
    }

    if (
      firstError &&
      typeof firstError.message ===
        'string'
    ) {
      return firstError.message;
    }
  }

  if (
    typeof error?.message ===
    'string'
  ) {
    return error.message;
  }

  return null;
}

function normalizeServiceError(
  error,
  fallbackMessage,
) {
  if (
    error instanceof
    AnnouncementServiceError
  ) {
    return error;
  }

  if (
    isAbortError(error)
  ) {
    return new AnnouncementServiceError({
      message:
        'The announcement request was cancelled.',
      code:
        'ANNOUNCEMENT_REQUEST_CANCELLED',
      status:
        getErrorStatus(error),
      details:
        getBackendErrorPayload(error),
      cause:
        error,
      isCancelled:
        true,
    });
  }

  const status =
    getErrorStatus(error);

  const isNetworkError =
    !error?.response &&
    (
      error?.request ||
      error?.code ===
        'ERR_NETWORK'
    );

  let code =
    'ANNOUNCEMENT_SERVICE_ERROR';

  if (
    status === 401
  ) {
    code =
      'ANNOUNCEMENT_UNAUTHENTICATED';
  } else if (
    status === 403
  ) {
    code =
      'ANNOUNCEMENT_FORBIDDEN';
  } else if (
    status === 404
  ) {
    code =
      'ANNOUNCEMENT_NOT_FOUND';
  } else if (
    status === 409
  ) {
    code =
      'ANNOUNCEMENT_CONFLICT';
  } else if (
    status === 422
  ) {
    code =
      'ANNOUNCEMENT_VALIDATION_ERROR';
  } else if (
    status >= 500
  ) {
    code =
      'ANNOUNCEMENT_SERVER_ERROR';
  } else if (
    isNetworkError
  ) {
    code =
      'ANNOUNCEMENT_NETWORK_ERROR';
  }

  return new AnnouncementServiceError({
    message:
      extractBackendMessage(error) ||
      fallbackMessage ||
      'Unable to complete the announcement request.',
    code,
    status,
    details:
      getBackendErrorPayload(error),
    cause:
      error,
    isNetworkError,
  });
}

function assertApiClient() {
  if (
    !api ||
    typeof api.get !==
      'function' ||
    typeof api.post !==
      'function' ||
    typeof api.put !==
      'function' ||
    typeof api.delete !==
      'function'
  ) {
    throw new AnnouncementServiceError({
      message:
        'The TITech API client is not configured correctly.',
      code:
        'ANNOUNCEMENT_API_CLIENT_UNAVAILABLE',
    });
  }
}

function normalizePositiveInteger(
  value,
  fallback,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 1
  ) {
    return fallback;
  }

  return Math.min(
    Math.floor(number),
    maximum,
  );
}

function normalizeString(
  value,
  {
    maxLength = Infinity,
    fallback = '',
    trim = true,
  } = {},
) {
  if (
    typeof value !==
    'string'
  ) {
    return fallback;
  }

  const normalized =
    trim
      ? value.trim()
      : value;

  return normalized.slice(
    0,
    maxLength,
  );
}

function normalizeOptionalString(
  value,
  maxLength = Infinity,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  return normalizeString(
    value,
    {
      maxLength,
      fallback: undefined,
    },
  );
}

function normalizeId(
  value,
) {
  if (
    typeof value ===
    'string'
  ) {
    return value.trim();
  }

  if (
    typeof value ===
    'number' &&
    Number.isFinite(value)
  ) {
    return String(value);
  }

  if (
    isObject(value) &&
    typeof value._id ===
      'string'
  ) {
    return value._id;
  }

  if (
    isObject(value) &&
    typeof value.id ===
      'string'
  ) {
    return value.id;
  }

  return '';
}

function assertRequiredId(
  id,
  fieldName = 'announcementId',
) {
  const normalized =
    normalizeId(id);

  if (!normalized) {
    throw new AnnouncementServiceError({
      message:
        `${fieldName} is required.`,
      code:
        'ANNOUNCEMENT_INVALID_ID',
    });
  }

  return normalized;
}

function unwrapResponse(
  response,
) {
  const data =
    response?.data;

  if (
    data === null ||
    data === undefined
  ) {
    return data;
  }

  if (
    isObject(data) &&
    Object.prototype.hasOwnProperty.call(
      data,
      'data',
    )
  ) {
    return data.data;
  }

  if (
    isObject(data) &&
    Object.prototype.hasOwnProperty.call(
      data,
      'result',
    )
  ) {
    return data.result;
  }

  return data;
}

function getItemsFromPayload(
  payload,
) {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }

  if (
    !isObject(payload)
  ) {
    return [];
  }

  if (
    Array.isArray(payload.items)
  ) {
    return payload.items;
  }

  if (
    Array.isArray(payload.announcements)
  ) {
    return payload.announcements;
  }

  if (
    Array.isArray(payload.results)
  ) {
    return payload.results;
  }

  if (
    Array.isArray(payload.docs)
  ) {
    return payload.docs;
  }

  return [];
}

function normalizeDate(
  value,
) {
  if (
    !value
  ) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date.toISOString();
}

function normalizeAnnouncement(
  announcement,
) {
  if (
    !isObject(announcement)
  ) {
    return null;
  }

  const id =
    normalizeId(
      announcement.id ??
        announcement._id ??
        announcement.announcementId,
    );

  const title =
    normalizeString(
      announcement.title,
      {
        maxLength:
          MAX_TITLE_LENGTH,
      },
    );

  const content =
    normalizeString(
      announcement.content ??
        announcement.body ??
        announcement.message,
      {
        maxLength:
          MAX_CONTENT_LENGTH,
        trim:
          false,
      },
    );

  return Object.freeze({
    ...announcement,

    id,

    _id:
      announcement._id ??
      id,

    title,

    content,

    body:
      announcement.body ??
      content,

    message:
      announcement.message ??
      content,

    status:
      announcement.status ??
      ANNOUNCEMENT_STATUS.PUBLISHED,

    priority:
      announcement.priority ??
      ANNOUNCEMENT_PRIORITY.NORMAL,

    type:
      announcement.type ??
      ANNOUNCEMENT_TYPES.GENERAL,

    audience:
      announcement.audience ??
      ANNOUNCEMENT_AUDIENCE.ALL,

    isRead:
      Boolean(
        announcement.isRead ??
          announcement.read ??
          false,
      ),

    isAcknowledged:
      Boolean(
        announcement.isAcknowledged ??
          announcement.acknowledged ??
          false,
      ),

    createdAt:
      normalizeDate(
        announcement.createdAt,
      ),

    updatedAt:
      normalizeDate(
        announcement.updatedAt,
      ),

    publishedAt:
      normalizeDate(
        announcement.publishedAt,
      ),

    scheduledAt:
      normalizeDate(
        announcement.scheduledAt,
      ),

    expiresAt:
      normalizeDate(
        announcement.expiresAt,
      ),
  });
}

function normalizeAnnouncements(
  payload,
) {
  return getItemsFromPayload(
    payload,
  )
    .map(
      normalizeAnnouncement,
    )
    .filter(Boolean);
}

function normalizePagination(
  payload,
  {
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
  } = {},
) {
  const source =
    isObject(payload)
      ? payload
      : {};

  const pagination =
    isObject(
      source.pagination,
    )
      ? source.pagination
      : source;

  const normalizedPage =
    normalizePositiveInteger(
      pagination.page ??
        pagination.currentPage,
      page,
    );

  const normalizedLimit =
    normalizePositiveInteger(
      pagination.limit ??
        pagination.pageSize,
      limit,
      MAX_LIMIT,
    );

  const total =
    Number.isFinite(
      Number(
        pagination.total,
      ),
    )
      ? Number(
          pagination.total,
        )
      : null;

  const totalPages =
    Number.isFinite(
      Number(
        pagination.totalPages,
      ),
    )
      ? Number(
          pagination.totalPages,
        )
      : total !== null
        ? Math.ceil(
            total /
              normalizedLimit,
          )
        : null;

  return Object.freeze({
    page:
      normalizedPage,

    limit:
      normalizedLimit,

    total,

    totalPages,

    hasNext:
      typeof pagination.hasNext ===
      'boolean'
        ? pagination.hasNext
        : totalPages !== null
          ? normalizedPage <
            totalPages
          : false,

    hasPrevious:
      typeof pagination.hasPrevious ===
      'boolean'
        ? pagination.hasPrevious
        : normalizedPage > 1,
  });
}

function normalizeListResponse(
  response,
  options = {},
) {
  const payload =
    unwrapResponse(response);

  return Object.freeze({
    items:
      normalizeAnnouncements(
        payload,
      ),

    pagination:
      normalizePagination(
        payload,
        options,
      ),

    raw:
      payload,
  });
}

function normalizeAnnouncementResponse(
  response,
) {
  const payload =
    unwrapResponse(response);

  const candidate =
    payload?.announcement ??
    payload?.item ??
    payload;

  return normalizeAnnouncement(
    candidate,
  );
}

function buildParams(
  params = {},
) {
  if (
    !isObject(params)
  ) {
    return {};
  }

  const output = {};

  Object.entries(
    params,
  ).forEach(
    ([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        return;
      }

      if (
        Array.isArray(value)
      ) {
        if (
          value.length > 0
        ) {
          output[key] =
            value.join(',');
        }

        return;
      }

      output[key] =
        value;
    },
  );

  return output;
}

function normalizeListOptions(
  options = {},
) {
  const page =
    normalizePositiveInteger(
      options.page,
      DEFAULT_PAGE,
    );

  const limit =
    normalizePositiveInteger(
      options.limit,
      DEFAULT_LIMIT,
      MAX_LIMIT,
    );

  const search =
    normalizeString(
      options.search,
      {
        maxLength:
          MAX_SEARCH_LENGTH,
      },
    );

  const params =
    buildParams({
      page,
      limit,

      status:
        options.status,

      priority:
        options.priority,

      type:
        options.type,

      audience:
        options.audience,

      search:
        search || undefined,

      tenantId:
        options.tenantId,

      groupId:
        options.groupId,

      unreadOnly:
        options.unreadOnly,

      acknowledged:
        options.acknowledged,

      includeArchived:
        options.includeArchived,

      sortBy:
        options.sortBy,

      sortOrder:
        options.sortOrder,

      from:
        options.from,

      to:
        options.to,
    });

  return {
    page,
    limit,
    params,
  };
}

function normalizeMutationPayload(
  payload = {},
) {
  if (
    !isObject(payload)
  ) {
    throw new AnnouncementServiceError({
      message:
        'Announcement payload must be an object.',
      code:
        'ANNOUNCEMENT_INVALID_PAYLOAD',
    });
  }

  const normalized = {
    ...payload,
  };

  if (
    normalized.title !==
    undefined
  ) {
    normalized.title =
      normalizeString(
        normalized.title,
        {
          maxLength:
            MAX_TITLE_LENGTH,
        },
      );

    if (
      !normalized.title
    ) {
      throw new AnnouncementServiceError({
        message:
          'Announcement title is required.',
        code:
          'ANNOUNCEMENT_INVALID_TITLE',
      });
    }
  }

  if (
    normalized.content !==
    undefined
  ) {
    normalized.content =
      normalizeString(
        normalized.content,
        {
          maxLength:
            MAX_CONTENT_LENGTH,
          trim:
            false,
        },
      );
  }

  if (
    normalized.body !==
      undefined &&
    normalized.content ===
      undefined
  ) {
    normalized.body =
      normalizeString(
        normalized.body,
        {
          maxLength:
            MAX_CONTENT_LENGTH,
          trim:
            false,
        },
      );
  }

  if (
    normalized.message !==
      undefined &&
    normalized.content ===
      undefined &&
    normalized.body ===
      undefined
  ) {
    normalized.message =
      normalizeString(
        normalized.message,
        {
          maxLength:
            MAX_CONTENT_LENGTH,
          trim:
            false,
        },
      );
  }

  return normalized;
}

/* ============================================================================
 * READ OPERATIONS
 * ========================================================================== */

/**
 * Fetch announcements with filtering and pagination.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getAnnouncements(
  options = {},
) {
  assertApiClient();

  const normalized =
    normalizeListOptions(
      options,
    );

  try {
    const response =
      await api.get(
        ANNOUNCEMENT_API_PREFIX,
        {
          params:
            normalized.params,

          signal:
            options.signal,
        },
      );

    return normalizeListResponse(
      response,
      normalized,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to load TITech announcements.',
    );
  }
}

/**
 * Alias useful for components that use "list" terminology.
 */
export const listAnnouncements =
  getAnnouncements;

/**
 * Fetch currently published announcements.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getPublishedAnnouncements(
  options = {},
) {
  return getAnnouncements({
    ...options,

    status:
      ANNOUNCEMENT_STATUS.PUBLISHED,
  });
}

/**
 * Fetch unread announcements.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getUnreadAnnouncements(
  options = {},
) {
  return getAnnouncements({
    ...options,

    unreadOnly:
      true,
  });
}

/**
 * Fetch a single announcement.
 *
 * @param {string|number|Object} announcementId
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
export async function getAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.get(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}`,
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to load the TITech announcement.',
    );
  }
}

/**
 * Alias for detail retrieval.
 */
export const getAnnouncementById =
  getAnnouncement;

/* ============================================================================
 * CREATE OPERATIONS
 * ========================================================================== */

/**
 * Create a new announcement.
 *
 * @param {Object} payload
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
export async function createAnnouncement(
  payload,
  options = {},
) {
  assertApiClient();

  const normalizedPayload =
    normalizeMutationPayload(
      payload,
    );

  try {
    const response =
      await api.post(
        ANNOUNCEMENT_API_PREFIX,
        normalizedPayload,
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to create the TITech announcement.',
    );
  }
}

/* ============================================================================
 * UPDATE OPERATIONS
 * ========================================================================== */

/**
 * Update an existing announcement.
 *
 * @param {string|number|Object} announcementId
 * @param {Object} payload
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
export async function updateAnnouncement(
  announcementId,
  payload,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  const normalizedPayload =
    normalizeMutationPayload(
      payload,
    );

  try {
    const response =
      await api.put(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}`,
        normalizedPayload,
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to update the TITech announcement.',
    );
  }
}

/* ============================================================================
 * PUBLISHING OPERATIONS
 * ========================================================================== */

/**
 * Publish an announcement.
 *
 * The dedicated endpoint allows the backend to enforce publishing rules,
 * authorization and audit requirements centrally.
 *
 * @param {string|number|Object} announcementId
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
export async function publishAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/publish`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to publish the TITech announcement.',
    );
  }
}

/**
 * Unpublish a previously published announcement.
 */
export async function unpublishAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/unpublish`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to unpublish the TITech announcement.',
    );
  }
}

/**
 * Archive an announcement.
 */
export async function archiveAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/archive`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to archive the TITech announcement.',
    );
  }
}

/**
 * Restore an archived announcement.
 */
export async function restoreAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/restore`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to restore the TITech announcement.',
    );
  }
}

/* ============================================================================
 * USER INTERACTION OPERATIONS
 * ========================================================================== */

/**
 * Mark an announcement as read.
 *
 * @param {string|number|Object} announcementId
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
export async function markAnnouncementAsRead(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/read`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to mark the announcement as read.',
    );
  }
  }

/**
 * Alias for read-state operations.
 */
export const markAsRead =
  markAnnouncementAsRead;

/**
 * Mark an announcement as unread.
 */
export async function markAnnouncementAsUnread(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/unread`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to mark the announcement as unread.',
    );
  }
}

/**
 * Acknowledge an announcement.
 *
 * Useful for mandatory notices, compliance notices, policy changes,
 * operational notices and other announcements requiring confirmation.
 */
export async function acknowledgeAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/acknowledge`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to acknowledge the announcement.',
    );
  }
}

/**
 * Remove the current user's acknowledgement.
 */
export async function unacknowledgeAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.post(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}/unacknowledge`,
        {},
        {
          signal:
            options.signal,
        },
      );

    return normalizeAnnouncementResponse(
      response,
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to remove the announcement acknowledgement.',
    );
  }
}

/* ============================================================================
 * DELETE
 * ========================================================================== */

/**
 * Delete an announcement.
 *
 * IMPORTANT:
 *   The backend must enforce authorization, ownership and audit requirements.
 *   This client method does not attempt to bypass those controls.
 *
 * @param {string|number|Object} announcementId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function deleteAnnouncement(
  announcementId,
  options = {},
) {
  assertApiClient();

  const id =
    assertRequiredId(
      announcementId,
    );

  try {
    const response =
      await api.delete(
        `${ANNOUNCEMENT_API_PREFIX}/${encodeURIComponent(
          id,
        )}`,
        {
          signal:
            options.signal,
        },
      );

    return (
      unwrapResponse(
        response,
      ) ?? {
        success:
          true,

        id,
      }
    );
  } catch (error) {
    throw normalizeServiceError(
      error,
      'Unable to delete the TITech announcement.',
    );
  }
}

/* ============================================================================
 * BULK OPERATIONS
 * ========================================================================== */

/**
 * Mark multiple announcements as read.
 *
 * Falls back to sequential requests when a dedicated backend bulk endpoint
 * is not available. The operation is intentionally conservative so that
 * authorization and audit rules remain enforced by the backend.
 */
export async function markAnnouncementsAsRead(
  announcementIds,
  options = {},
) {
  if (
    !Array.isArray(
      announcementIds,
    )
  ) {
    throw new AnnouncementServiceError({
      message:
        'announcementIds must be an array.',
      code:
        'ANNOUNCEMENT_INVALID_IDS',
    });
  }

  const ids =
    announcementIds
      .map(
        normalizeId,
      )
      .filter(Boolean);

  if (
    ids.length === 0
  ) {
    return [];
  }

  const results = [];

  for (
    const id of ids
  ) {
    results.push(
      await markAnnouncementAsRead(
        id,
        options,
      ),
    );
  }

  return results;
}

/**
 * Mark multiple announcements as unread.
 */
export async function markAnnouncementsAsUnread(
  announcementIds,
  options = {},
) {
  if (
    !Array.isArray(
      announcementIds,
    )
  ) {
    throw new AnnouncementServiceError({
      message:
        'announcementIds must be an array.',
      code:
        'ANNOUNCEMENT_INVALID_IDS',
    });
  }

  const ids =
    announcementIds
      .map(
        normalizeId,
      )
      .filter(Boolean);

  if (
    ids.length === 0
  ) {
    return [];
  }

  const results = [];

  for (
    const id of ids
  ) {
    results.push(
      await markAnnouncementAsUnread(
        id,
        options,
      ),
    );
  }

  return results;
}

/* ============================================================================
 * SUMMARY / COUNT OPERATIONS
 * ========================================================================== */

/**
 * Retrieve the unread announcement count.
 *
 * If the backend exposes a dedicated endpoint, it is preferable to use it.
 * The fallback derives the count from the first page of unread announcements.
 */
export async function getUnreadAnnouncementCount(
  options = {},
) {
  assertApiClient();

  try {
    const response =
      await api.get(
        `${ANNOUNCEMENT_API_PREFIX}/unread/count`,
        {
          params:
            buildParams({
              tenantId:
                options.tenantId,

              groupId:
                options.groupId,
            }),

          signal:
            options.signal,
        },
      );

    const payload =
      unwrapResponse(
        response,
      );

    if (
      typeof payload ===
      'number'
    ) {
      return payload;
    }

    if (
      typeof payload?.count ===
      'number'
    ) {
      return payload.count;
    }

    if (
      typeof payload?.unreadCount ===
      'number'
    ) {
      return payload.unreadCount;
    }

    return 0;
  } catch (error) {
    if (
      getErrorStatus(error) ===
      404
    ) {
      const fallback =
        await getUnreadAnnouncements({
          ...options,

          page:
            1,

          limit:
            1,
        });

      return (
        fallback.pagination.total ??
        fallback.items.length
      );
    }

    throw normalizeServiceError(
      error,
      'Unable to retrieve unread announcement count.',
    );
  }
}

/* ============================================================================
 * SEARCH
 * ========================================================================== */

/**
 * Search announcements.
 *
 * @param {string} query
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function searchAnnouncements(
  query,
  options = {},
) {
  const search =
    normalizeString(
      query,
      {
        maxLength:
          MAX_SEARCH_LENGTH,
      },
    );

  if (!search) {
    return Object.freeze({
      items: [],
      pagination:
        normalizePagination(
          {},
          {
            page:
              1,
            limit:
              options.limit ??
              DEFAULT_LIMIT,
          },
        ),
      raw: null,
    });
  }

  return getAnnouncements({
    ...options,

    search,
  });
}

/* ============================================================================
 * SERVICE OBJECT
 * ========================================================================== */

/**
 * Default service facade.
 *
 * This provides a convenient single import:
 *
 *   import announcementService from './announcementService';
 *
 * while retaining named exports for tree-shaking and direct usage.
 */
const announcementService =
  Object.freeze({
    version:
      ANNOUNCEMENT_SERVICE_VERSION,

    endpoints:
      Object.freeze({
        base:
          ANNOUNCEMENT_API_PREFIX,
      }),

    status:
      ANNOUNCEMENT_STATUS,

    priority:
      ANNOUNCEMENT_PRIORITY,

    audience:
      ANNOUNCEMENT_AUDIENCE,

    types:
      ANNOUNCEMENT_TYPES,

    getAnnouncements,

    listAnnouncements,

    getPublishedAnnouncements,

    getUnreadAnnouncements,

    getAnnouncement,

    getAnnouncementById,

    createAnnouncement,

    updateAnnouncement,

    publishAnnouncement,

    unpublishAnnouncement,

    archiveAnnouncement,

    restoreAnnouncement,

    markAnnouncementAsRead,

    markAsRead,

    markAnnouncementAsUnread,

    acknowledgeAnnouncement,

    unacknowledgeAnnouncement,

    deleteAnnouncement,

    markAnnouncementsAsRead,

    markAnnouncementsAsUnread,

    getUnreadAnnouncementCount,

    searchAnnouncements,
  });

export default announcementService;

/* ============================================================================
 * LEGACY-COMPATIBILITY ALIASES
 * ============================================================================
 *
 * These aliases reduce migration risk when older TITechChat components use
 * slightly different naming conventions.
 * ========================================================================== */

export const fetchAnnouncements =
  getAnnouncements;

export const fetchAnnouncement =
  getAnnouncement;

export const fetchPublishedAnnouncements =
  getPublishedAnnouncements;

export const fetchUnreadAnnouncements =
  getUnreadAnnouncements;

export const createAnnouncementRecord =
  createAnnouncement;

export const updateAnnouncementRecord =
  updateAnnouncement;

export const removeAnnouncement =
  deleteAnnouncement;

/* ============================================================================
 * END OF FILE
 * ============================================================================
 */