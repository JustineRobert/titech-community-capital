/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/utils/response.js
 *
 * Purpose:
 *   Canonical API response helpers for the TITech Community Capital backend.
 *
 * Responsibilities:
 *   - Standardize successful API responses
 *   - Standardize error API responses
 *   - Preserve trace/correlation identifiers
 *   - Normalize AppError / operational errors
 *   - Avoid leaking internal implementation details
 *   - Preserve backwards-compatible helper names
 *   - Remain independent from controllers, services and repositories
 *
 * IMPORTANT:
 *   This module formats responses.
 *
 *   It does NOT:
 *     - perform authorization
 *     - perform validation
 *     - mutate financial data
 *     - query MongoDB
 *     - decide business rules
 *     - classify provider callbacks
 *
 * =============================================================================
 */

import errorCodes from './errorCodes.js';

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_SUCCESS_MESSAGE = 'Success';
const DEFAULT_ERROR_CODE = 'ERROR';
const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';
const DEFAULT_ERROR_STATUS = 500;

/**
 * HTTP statuses whose messages are generally safe to expose when generated
 * from controlled application errors.
 */
const CLIENT_ERROR_STATUS_MAX = 499;

/**
 * Internal/sensitive error properties that must never be serialized directly.
 */
const SENSITIVE_FIELDS = new Set([
  'stack',
  'cause',
  'originalError',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'clientSecret',
  'apiKey',
  'authorization',
]);

/**
 * =============================================================================
 * Internal helpers
 * =============================================================================
 */

/**
 * Safely normalize an HTTP status code.
 */
const normalizeStatus = (status) => {
  const numericStatus = Number(status);

  if (
    Number.isInteger(numericStatus) &&
    numericStatus >= 100 &&
    numericStatus <= 599
  ) {
    return numericStatus;
  }

  return DEFAULT_ERROR_STATUS;
};

/**
 * Safely normalize a trace/correlation identifier.
 */
const normalizeTraceId = (traceId) => {
  if (traceId === undefined || traceId === null) {
    return null;
  }

  const normalized = String(traceId).trim();

  return normalized || null;
};

/**
 * Resolve a trace identifier from the request context when possible.
 *
 * Supported conventions:
 *   req.traceId
 *   req.requestId
 *   req.id
 *   req.headers['x-trace-id']
 *   req.headers['x-request-id']
 */
const getTraceId = (req, explicitTraceId = null) => {
  if (explicitTraceId) {
    return normalizeTraceId(explicitTraceId);
  }

  if (!req) {
    return null;
  }

  return normalizeTraceId(
    req.traceId ??
      req.requestId ??
      req.id ??
      req.headers?.['x-trace-id'] ??
      req.headers?.['x-request-id'] ??
      null,
  );
};

/**
 * Remove sensitive properties from arbitrary error metadata.
 */
const sanitizeDetails = (details) => {
  if (
    details === undefined ||
    details === null ||
    typeof details !== 'object'
  ) {
    return undefined;
  }

  if (Array.isArray(details)) {
    return details.map((item) => sanitizeDetails(item));
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_FIELDS.has(key)) {
      continue;
    }

    if (value instanceof Error) {
      sanitized[key] = sanitizeErrorObject(value);
      continue;
    }

    if (value && typeof value === 'object') {
      sanitized[key] = sanitizeDetails(value);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

/**
 * Convert an Error/AppError into a safe serializable representation.
 */
const sanitizeErrorObject = (error) => {
  if (!error || typeof error !== 'object') {
    return {};
  }

  const safe = {};

  if (error.name) {
    safe.name = String(error.name);
  }

  if (error.code) {
    safe.code = String(error.code);
  }

  if (error.errorCode) {
    safe.errorCode = String(error.errorCode);
  }

  if (error.statusCode) {
    safe.statusCode = normalizeStatus(error.statusCode);
  }

  if (error.status) {
    safe.status = normalizeStatus(error.status);
  }

  if (error.details !== undefined) {
    safe.details = sanitizeDetails(error.details);
  }

  return safe;
};

/**
 * Determine whether an error is safe to expose directly.
 *
 * Operational/client errors can expose their controlled message.
 * Unexpected 5xx errors should receive a generic public message.
 */
const isSafePublicError = (error, status) => {
  if (!error) {
    return false;
  }

  if (error.expose === true) {
    return true;
  }

  if (status <= CLIENT_ERROR_STATUS_MAX) {
    return true;
  }

  if (error.isOperational === true) {
    return true;
  }

  return false;
};

/**
 * Resolve application error code.
 */
const resolveErrorCode = (error) => {
  if (!error || typeof error !== 'object') {
    return DEFAULT_ERROR_CODE;
  }

  return (
    error.errorCode ??
    error.code ??
    DEFAULT_ERROR_CODE
  );
};

/**
 * Resolve application error status.
 */
const resolveErrorStatus = (error) => {
  if (!error || typeof error !== 'object') {
    return DEFAULT_ERROR_STATUS;
  }

  return normalizeStatus(
    error.statusCode ??
      error.status ??
      DEFAULT_ERROR_STATUS,
  );
};

/**
 * Resolve a safe public error message.
 */
const resolveErrorMessage = (error, status) => {
  if (isSafePublicError(error, status)) {
    const message =
      typeof error?.message === 'string'
        ? error.message.trim()
        : '';

    if (message) {
      return message;
    }
  }

  return DEFAULT_ERROR_MESSAGE;
};

/**
 * =============================================================================
 * Primary response functions
 * =============================================================================
 */

/**
 * Send a standardized successful response.
 *
 * @param {object} res
 * @param {*} data
 * @param {string} [message="Success"]
 * @param {string|null} [traceId=null]
 * @param {number} [status=200]
 * @returns {object} Express response
 */
export const success = (
  res,
  data = null,
  message = DEFAULT_SUCCESS_MESSAGE,
  traceId = null,
  status = 200,
) => {
  const normalizedStatus = normalizeStatus(status);

  const response = {
    success: true,
    message:
      typeof message === 'string' && message.trim()
        ? message.trim()
        : DEFAULT_SUCCESS_MESSAGE,
    data,
    traceId: normalizeTraceId(traceId),
  };

  return res.status(normalizedStatus).json(response);
};

/**
 * Send a standardized error response.
 *
 * @param {object} res
 * @param {string} [code="ERROR"]
 * @param {string} [message="An error occurred"]
 * @param {number} [status=500]
 * @param {string|null} [traceId=null]
 * @param {object|null} [details=null]
 * @returns {object} Express response
 */
export const error = (
  res,
  code = DEFAULT_ERROR_CODE,
  message = DEFAULT_ERROR_MESSAGE,
  status = DEFAULT_ERROR_STATUS,
  traceId = null,
  details = null,
) => {
  const normalizedStatus = normalizeStatus(status);

  const response = {
    success: false,
    error: {
      code:
        typeof code === 'string' && code.trim()
          ? code.trim()
          : DEFAULT_ERROR_CODE,
      message:
        typeof message === 'string' && message.trim()
          ? message.trim()
          : DEFAULT_ERROR_MESSAGE,
    },
    traceId: normalizeTraceId(traceId),
  };

  const safeDetails = sanitizeDetails(details);

  if (
    safeDetails !== undefined &&
    safeDetails !== null &&
    (
      !Array.isArray(safeDetails)
        ? Object.keys(safeDetails).length > 0
        : safeDetails.length > 0
    )
  ) {
    response.error.details = safeDetails;
  }

  return res.status(normalizedStatus).json(response);
};

/**
 * =============================================================================
 * Request-aware helpers
 * =============================================================================
 */

/**
 * Success response using the request's trace/correlation identifier.
 *
 * Useful in controllers:
 *
 *   return successResponse(res, data, 'Group created', req);
 */
export const successResponse = (
  res,
  data = null,
  message = DEFAULT_SUCCESS_MESSAGE,
  req = null,
  status = 200,
) => {
  const traceId = getTraceId(req);

  return success(
    res,
    data,
    message,
    traceId,
    status,
  );
};

/**
 * Error response using the request's trace/correlation identifier.
 *
 * Supports:
 *   - AppError
 *   - Error
 *   - plain error-like objects
 */
export const errorResponse = (
  res,
  errorObject,
  req = null,
) => {
  const status = resolveErrorStatus(errorObject);
  const code =
    errorObject?.errorCode ??
    errorObject?.code ??
    errorCodes?.INTERNAL_ERROR ??
    DEFAULT_ERROR_CODE;

  const message = resolveErrorMessage(
    errorObject,
    status,
  );

  const traceId = getTraceId(req);

  const details = sanitizeDetails(
    errorObject?.details ??
      errorObject?.errors ??
      undefined,
  );

  return error(
    res,
    code,
    message,
    status,
    traceId,
    details,
  );
};

/**
 * =============================================================================
 * Standard API response factories
 * =============================================================================
 *
 * These are useful when a controller/service needs to return an object before
 * the final Express response is sent elsewhere.
 */

/**
 * Create a success response payload without sending it.
 */
export const successPayload = (
  data = null,
  message = DEFAULT_SUCCESS_MESSAGE,
  traceId = null,
) => ({
  success: true,
  message:
    typeof message === 'string' && message.trim()
      ? message.trim()
      : DEFAULT_SUCCESS_MESSAGE,
  data,
  traceId: normalizeTraceId(traceId),
});

/**
 * Create a safe error response payload without sending it.
 */
export const errorPayload = (
  code = DEFAULT_ERROR_CODE,
  message = DEFAULT_ERROR_MESSAGE,
  traceId = null,
  details = null,
) => {
  const payload = {
    success: false,
    error: {
      code:
        typeof code === 'string' && code.trim()
          ? code.trim()
          : DEFAULT_ERROR_CODE,
      message:
        typeof message === 'string' && message.trim()
          ? message.trim()
          : DEFAULT_ERROR_MESSAGE,
    },
    traceId: normalizeTraceId(traceId),
  };

  const safeDetails = sanitizeDetails(details);

  if (
    safeDetails !== undefined &&
    safeDetails !== null
  ) {
    payload.error.details = safeDetails;
  }

  return payload;
};

/**
 * =============================================================================
 * Pagination helper
 * =============================================================================
 *
 * Keeps pagination metadata consistent across list APIs.
 */
export const buildPagination = ({
  page = 1,
  limit = 20,
  total = 0,
} = {}) => {
  const normalizedPage =
    Number.isInteger(Number(page)) && Number(page) > 0
      ? Number(page)
      : 1;

  const normalizedLimit =
    Number.isInteger(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : 20;

  const normalizedTotal =
    Number.isFinite(Number(total)) && Number(total) >= 0
      ? Number(total)
      : 0;

  const totalPages =
    normalizedLimit > 0
      ? Math.ceil(normalizedTotal / normalizedLimit)
      : 0;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    total: normalizedTotal,
    totalPages,
    hasNextPage:
      normalizedPage < totalPages,
    hasPreviousPage:
      normalizedPage > 1,
  };
};

/**
 =============================================================================
 * Backwards-compatible default export
 * =============================================================================
 */

const responseUtils = {
  success,
  error,
  successResponse,
  errorResponse,
  successPayload,
  errorPayload,
  buildPagination,
};

export default responseUtils;