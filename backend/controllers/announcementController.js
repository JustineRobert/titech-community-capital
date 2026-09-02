/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Controller
 * ============================================================================
 *
 * File:
 *   backend/controllers/announcementController.js
 *
 * Purpose:
 *   HTTP/API boundary for the TITech announcement subsystem.
 *
 * Responsibilities:
 *   - Validate and normalize request input at the controller boundary
 *   - Delegate business logic to announcementService
 *   - Preserve tenant/user context established by middleware
 *   - Return consistent API envelopes
 *   - Prevent internal error details from leaking to clients
 *   - Preserve request/correlation context for audit operations
 *
 * Architecture:
 *   Route
 *     -> Authentication
 *     -> Announcement Authorization / Context
 *     -> Controller
 *     -> Announcement Service
 *     -> Models
 *
 * Security:
 *   - Never derive tenant ownership from client-controlled headers.
 *   - Never trust tenantId from the request body for authorization.
 *   - Tenant context must originate from authenticated identity/session
 *     and authorization middleware.
 *   - Internal exceptions are intentionally hidden from API clients.
 *
 * API CONTRACT:
 *
 *   GET  /api/announcements
 *   GET  /api/announcements/unread-count
 *   POST /api/announcements/:announcementId/read
 *   POST /api/announcements/:announcementId/dismiss
 *   POST /api/announcements/:announcementId/acknowledge
 *   POST /api/announcements
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const announcementService =
  require('../services/announcementService');

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ALLOWED_FILTERS = Object.freeze([
  'all',
  'unread',
  'important',
  'security',
  'savings',
  'loan',
  'support',
  'community',
]);

const ALLOWED_SORTS = Object.freeze([
  'newest',
  'oldest',
  'priority',
]);

/* ============================================================================
 * ERROR FACTORY
 * ========================================================================== */

/**
 * Create a controller-level client error.
 *
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function createHttpError(
  statusCode,
  code,
  message,
) {
  const error = new Error(message);

  error.statusCode = statusCode;
  error.code = code;

  return error;
}

/* ============================================================================
 * REQUEST CONTEXT
 * ========================================================================== */

/**
 * Retrieve the trusted announcement context created by middleware.
 *
 * The controller deliberately does not construct tenant context from:
 *   - req.body.tenantId
 *   - req.query.tenantId
 *   - x-tenant-id
 *   - arbitrary client headers
 *
 * @param {object} req
 * @returns {object}
 */
function getContext(req) {
  return req?.announcementContext || null;
}

/**
 * Ensure authenticated announcement context exists.
 *
 * Normally this is guaranteed by attachAnnouncementContext middleware.
 * Keeping the guard here prevents accidental use of a controller without
 * the required middleware.
 *
 * @param {object} req
 * @returns {object}
 */
function requireContext(req) {
  const context =
    getContext(req);

  if (!context?.userId) {
    throw createHttpError(
      401,
      'UNAUTHORIZED',
      'Authentication is required.',
    );
  }

  return context;
}

/* ============================================================================
 * REQUEST HELPERS
 * ========================================================================== */

/**
 * Normalize a positive integer query parameter.
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
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum,
  );
}

/**
 * Normalize search input.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeSearch(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value)
    .trim()
    .slice(0, 200);
}

/**
 * Normalize supported announcement filter.
 *
 * Invalid filters are rejected rather than silently changing the caller's
 * requested query semantics.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeFilter(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return 'all';
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    !ALLOWED_FILTERS.includes(
      normalized,
    )
  ) {
    throw createHttpError(
      400,
      'INVALID_ANNOUNCEMENT_FILTER',
      'Invalid announcement filter.',
    );
  }

  return normalized;
}

/**
 * Normalize supported announcement sort.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeSort(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return 'newest';
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    !ALLOWED_SORTS.includes(
      normalized,
    )
  ) {
    throw createHttpError(
      400,
      'INVALID_ANNOUNCEMENT_SORT',
      'Invalid announcement sort.',
    );
  }

  return normalized;
}

/**
 * Validate an announcement identifier before passing it to the service.
 *
 * @param {*} value
 * @returns {string}
 */
function requireAnnouncementId(value) {
  const announcementId =
    String(value || '').trim();

  if (
    !announcementId ||
    !mongoose.Types.ObjectId.isValid(
      announcementId,
    )
  ) {
    throw createHttpError(
      400,
      'INVALID_ANNOUNCEMENT_ID',
      'A valid announcement ID is required.',
    );
  }

  return announcementId;
}

/**
 * Extract request correlation information.
 *
 * Supports the project's existing request/correlation conventions without
 * changing the service API.
 *
 * @param {object} req
 * @returns {object}
 */
function getRequestContext(req) {
  return {
    id:
      req?.id ||
      req?.requestId ||
      req?.headers?.[
        'x-request-id'
      ] ||
      null,

    correlationId:
      req?.correlationId ||
      req?.headers?.[
        'x-correlation-id'
      ] ||
      null,

    ip:
      req?.ip ||
      req?.socket?.remoteAddress ||
      null,

    get:
      typeof req?.get === 'function'
        ? req.get.bind(req)
        : undefined,
  };
}

/* ============================================================================
 * RESPONSE HELPERS
 * ========================================================================== */

/**
 * Return a successful API response.
 *
 * @param {object} res
 * @param {*} data
 * @param {number} status
 * @returns {object}
 */
function success(
  res,
  data,
  status = 200,
) {
  return res
    .status(status)
    .json({
      success: true,
      data,
    });
}

/**
 * Convert known Mongoose errors into stable HTTP errors.
 *
 * @param {Error} error
 * @returns {Error}
 */
function normalizeServiceError(error) {
  if (!error) {
    return createHttpError(
      500,
      'ANNOUNCEMENT_ERROR',
      'Unable to process the announcement request.',
    );
  }

  if (
    error.statusCode
  ) {
    return error;
  }

  if (
    error.name ===
    'ValidationError'
  ) {
    return createHttpError(
      400,
      'VALIDATION_ERROR',
      'The announcement data is invalid.',
    );
  }

  if (
    error.name ===
    'CastError'
  ) {
    return createHttpError(
      400,
      'INVALID_REQUEST',
      'One or more request values are invalid.',
    );
  }

  if (
    error.code === 11000
  ) {
    return createHttpError(
      409,
      'DUPLICATE_RESOURCE',
      'The announcement operation conflicts with an existing resource.',
    );
  }

  return error;
}

/**
 * Return a safe API error.
 *
 * Internal server errors must never expose:
 *   - stack traces
 *   - database details
 *   - MongoDB query information
 *   - filesystem paths
 *   - implementation details
 *   - secrets
 *
 * @param {object} res
 * @param {Error} originalError
 * @returns {object}
 */
function failure(
  res,
  originalError,
) {
  const error =
    normalizeServiceError(
      originalError,
    );

  const status =
    Number(error?.statusCode) >= 400 &&
    Number(error?.statusCode) < 600
      ? Number(error.statusCode)
      : 500;

  const isServerError =
    status >= 500;

  return res
    .status(status)
    .json({
      success: false,

      code:
        error?.code ||
        'ANNOUNCEMENT_ERROR',

      message:
        isServerError
          ? 'Unable to process the announcement request.'
          : (
              error?.message ||
              'The announcement request could not be completed.'
            ),
    });
}

/* ============================================================================
 * LIST
 * ========================================================================== */

/**
 * GET /api/announcements
 */
async function list(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    const result =
      await announcementService
        .listAnnouncements({
          context,

          page:
            normalizePositiveInteger(
              req.query?.page,
              DEFAULT_PAGE,
            ),

          limit:
            normalizePositiveInteger(
              req.query?.limit,
              DEFAULT_LIMIT,
              MAX_LIMIT,
            ),

          search:
            normalizeSearch(
              req.query?.search,
            ),

          filter:
            normalizeFilter(
              req.query?.filter,
            ),

          sort:
            normalizeSort(
              req.query?.sort,
            ),
        });

    return success(
      res,
      result,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * UNREAD COUNT
 * ========================================================================== */

/**
 * GET /api/announcements/unread-count
 */
async function unreadCount(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    const result =
      await announcementService
        .getUnreadCount(
          context,
        );

    return success(
      res,
      result,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * MARK READ
 * ========================================================================== */

/**
 * POST /api/announcements/:announcementId/read
 */
async function markRead(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    const announcementId =
      requireAnnouncementId(
        req.params?.announcementId,
      );

    const result =
      await announcementService
        .markAnnouncementRead({
          announcementId,

          context,

          request:
            getRequestContext(req),
        });

    return success(
      res,
      result,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * DISMISS
 * ========================================================================== */

/**
 * POST /api/announcements/:announcementId/dismiss
 */
async function dismiss(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    const announcementId =
      requireAnnouncementId(
        req.params?.announcementId,
      );

    const result =
      await announcementService
        .dismissAnnouncement({
          announcementId,

          context,

          request:
            getRequestContext(req),
        });

    return success(
      res,
      result,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * ACKNOWLEDGE
 * ========================================================================== */

/**
 * POST /api/announcements/:announcementId/acknowledge
 */
async function acknowledge(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    const announcementId =
      requireAnnouncementId(
        req.params?.announcementId,
      );

    const result =
      await announcementService
        .acknowledgeAnnouncement({
          announcementId,

          context,

          request:
            getRequestContext(req),
        });

    return success(
      res,
      result,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * CREATE
 * ========================================================================== */

/**
 * POST /api/announcements
 *
 * IMPORTANT:
 * tenantId supplied by a client must not be treated as authoritative.
 *
 * The current service accepts payload.tenantId for platform/admin workflows.
 * Authorization for cross-tenant/platform creation therefore remains a
 * service/authorization concern and must not be inferred merely because the
 * field exists in req.body.
 */
async function create(
  req,
  res,
) {
  try {
    const context =
      requireContext(req);

    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body)
    ) {
      throw createHttpError(
        400,
        'INVALID_ANNOUNCEMENT_PAYLOAD',
        'A valid announcement payload is required.',
      );
    }

    const payload = {
      ...req.body,
    };

    const result =
      await announcementService
        .createAnnouncement({
          payload,

          context,

          request:
            getRequestContext(req),
        });

    return success(
      res,
      typeof result?.toPublicJSON ===
        'function'
        ? result.toPublicJSON()
        : result,
      201,
    );
  } catch (error) {
    return failure(
      res,
      error,
    );
  }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

module.exports = Object.freeze({
  list,

  unreadCount,

  markRead,

  dismiss,

  acknowledge,

  create,
});