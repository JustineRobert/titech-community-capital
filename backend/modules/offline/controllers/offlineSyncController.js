'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/controllers/offlineSyncController.js
 *
 * Purpose:
 *   Enterprise HTTP controller for the TITech offline-first synchronization
 *   boundary.
 *
 * Responsibilities:
 *   - Authenticate and validate offline synchronization requests
 *   - Establish tenant / user / device context
 *   - Validate sync payload structure
 *   - Enforce batch and payload limits
 *   - Propagate idempotency and correlation identifiers
 *   - Delegate synchronization to the application/service layer
 *   - Return deterministic synchronization responses
 *   - Preserve financial transaction safety boundaries
 *   - Avoid performing financial mutations directly in the controller
 *   - Provide consistent observability metadata
 *
 * IMPORTANT:
 *   This controller MUST NOT:
 *     - Write directly to the financial ledger
 *     - Modify account balances
 *     - Perform financial database transactions
 *     - Resolve financial conflicts by itself
 *     - Trust client-provided financial state
 *     - Treat a successful HTTP response as proof of ledger commitment
 *
 * Financial mutations belong behind the application/service transaction
 * boundary, where idempotency, database transactions, ledger validation,
 * concurrency control, and reconciliation can be enforced atomically.
 *
 * Expected request:
 *
 *   POST /api/offline/sync
 *
 *   Headers:
 *     Authorization
 *     Idempotency-Key
 *     X-Device-ID
 *     X-Tenant-ID
 *     X-Correlation-ID
 *     X-Request-ID
 *     X-Client-Timestamp
 *     X-Client-Version
 *
 *   Body:
 *     {
 *       "events": [
 *         {
 *           "eventId": "...",
 *           "eventType": "...",
 *           "eventVersion": 1,
 *           "tenantId": "...",
 *           "deviceId": "...",
 *           "sequence": 1,
 *           "idempotencyKey": "...",
 *           "payload": {}
 *         }
 *       ],
 *       "cursor": null
 *     }
 *
 * =============================================================================
 */

const crypto = require('crypto');

const offline = require('../index');

const {
  EVENT_METADATA,
  EVENT_VERSION,
  HEADERS,
  LIMITS,
  SYNC,
  SECURITY,
  OFFLINE_ERROR_CODES,
} = offline;

// =============================================================================
// Constants
// =============================================================================

const CONTROLLER_NAME = 'offlineSyncController';

const DEFAULT_SYNC_PATH = '/api/offline/sync';

const MAX_BODY_EVENTS = SYNC.MAX_BATCH_SIZE;

const MAX_EVENT_PAYLOAD_BYTES = SYNC.MAX_EVENT_PAYLOAD_BYTES;

const MAX_TOTAL_BATCH_BYTES = SYNC.MAX_TOTAL_BATCH_BYTES;

const REQUEST_TIMEOUT_MS = SYNC.DEFAULT_TIMEOUT_MS;

const RESPONSE_VERSION = '1';

const HTTP = Object.freeze({
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

// =============================================================================
// Utility Functions
// =============================================================================

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(value) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }

  return normalizeString(value);
}

function getHeader(req, name) {
  if (!req || !req.headers) {
    return null;
  }

  return firstHeaderValue(req.headers[String(name).toLowerCase()]);
}

function getRequestId(req) {
  return (
    normalizeString(req?.id) ||
    getHeader(req, HEADERS.REQUEST_ID) ||
    crypto.randomUUID()
  );
}

function getCorrelationId(req) {
  return (
    getHeader(req, 'X-Correlation-ID') ||
    normalizeString(req?.correlationId) ||
    getRequestId(req)
  );
}

function getIdempotencyKey(req) {
  return (
    getHeader(req, HEADERS.IDEMPOTENCY_KEY) ||
    normalizeString(req?.idempotencyKey)
  );
}

function getDeviceId(req) {
  return (
    getHeader(req, HEADERS.DEVICE_ID) ||
    normalizeString(req?.deviceId) ||
    normalizeString(req?.device?.id) ||
    normalizeString(req?.user?.deviceId)
  );
}

function getTenantId(req) {
  return (
    getHeader(req, HEADERS.TENANT_ID) ||
    normalizeString(req?.tenantId) ||
    normalizeString(req?.user?.tenantId) ||
    normalizeString(req?.auth?.tenantId)
  );
}

function getAuthenticatedUser(req) {
  return req?.user || req?.auth?.user || null;
}

function getAuthenticatedUserId(req) {
  const user = getAuthenticatedUser(req);

  return (
    normalizeString(user?.id) ||
    normalizeString(user?._id) ||
    normalizeString(user?.userId) ||
    normalizeString(req?.userId)
  );
}

function getClientTimestamp(req) {
  return (
    getHeader(req, HEADERS.CLIENT_TIMESTAMP) ||
    normalizeString(req?.body?.clientTimestamp)
  );
}

function getClientVersion(req) {
  return (
    getHeader(req, HEADERS.CLIENT_VERSION) ||
    normalizeString(req?.body?.clientVersion)
  );
}

function getRequestPath(req) {
  return (
    normalizeString(req?.originalUrl) ||
    normalizeString(req?.path) ||
    DEFAULT_SYNC_PATH
  );
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name || 'Error',
    code: error.code || 'INTERNAL_ERROR',
    message: error.message || 'An unexpected error occurred.',
    statusCode:
      Number.isInteger(error.statusCode)
        ? error.statusCode
        : undefined,
  };
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// =============================================================================
// Safe Error Classification
// =============================================================================

function getErrorStatus(error) {
  if (!error) {
    return HTTP.INTERNAL_SERVER_ERROR;
  }

  if (Number.isInteger(error.statusCode)) {
    return error.statusCode;
  }

  if (Number.isInteger(error.status)) {
    return error.status;
  }

  switch (error.code) {
    case 'VALIDATION_ERROR':
    case 'OFFLINE_EVENT_INVALID':
      return HTTP.UNPROCESSABLE_ENTITY;

    case 'IDEMPOTENCY_CONFLICT':
    case 'OFFLINE_IDEMPOTENCY_CONFLICT':
    case 'DUPLICATE_TRANSACTION':
    case 'FINANCIAL_CONFLICT':
    case 'OFFLINE_SYNC_CONFLICT':
      return HTTP.CONFLICT;

    case 'UNAUTHORIZED':
    case 'AUTHENTICATION_REQUIRED':
      return HTTP.UNAUTHORIZED;

    case 'FORBIDDEN':
    case 'DEVICE_REVOKED':
    case 'OFFLINE_DEVICE_REVOKED':
      return HTTP.FORBIDDEN;

    case 'SERVICE_UNAVAILABLE':
    case 'DATABASE_UNAVAILABLE':
      return HTTP.SERVICE_UNAVAILABLE;

    case 'TIMEOUT':
    case 'SYNC_TIMEOUT':
      return HTTP.GATEWAY_TIMEOUT;

    default:
      return HTTP.INTERNAL_SERVER_ERROR;
  }
}

function isOperationalError(error) {
  return Boolean(
    error?.isOperational === true ||
    error?.operational === true ||
    Number.isInteger(error?.statusCode) ||
    Number.isInteger(error?.status),
  );
}

// =============================================================================
// Payload Validation
// =============================================================================

function calculateByteLength(value) {
  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function validateRequestBody(body) {
  const errors = [];

  if (!isObject(body)) {
    errors.push({
      field: 'body',
      code: 'SYNC_BODY_REQUIRED',
      message: 'A synchronization request body is required.',
    });

    return errors;
  }

  if (!Array.isArray(body.events)) {
    errors.push({
      field: 'events',
      code: 'SYNC_EVENTS_REQUIRED',
      message: 'events must be an array.',
    });

    return errors;
  }

  if (body.events.length === 0) {
    errors.push({
      field: 'events',
      code: 'SYNC_EVENTS_EMPTY',
      message: 'At least one offline event is required.',
    });

    return errors;
  }

  if (body.events.length > MAX_BODY_EVENTS) {
    errors.push({
      field: 'events',
      code: 'SYNC_BATCH_LIMIT_EXCEEDED',
      message: `A maximum of ${MAX_BODY_EVENTS} events may be synchronized per batch.`,
    });
  }

  const totalBytes = calculateByteLength(body.events);

  if (totalBytes > MAX_TOTAL_BATCH_BYTES) {
    errors.push({
      field: 'events',
      code: 'SYNC_BATCH_SIZE_EXCEEDED',
      message: 'The synchronization batch exceeds the maximum payload size.',
    });
  }

  body.events.forEach((event, index) => {
    const eventSize = calculateByteLength(event);

    if (eventSize > MAX_EVENT_PAYLOAD_BYTES) {
      errors.push({
        field: `events[${index}]`,
        code: 'EVENT_PAYLOAD_SIZE_EXCEEDED',
        message: 'The event exceeds the maximum permitted payload size.',
      });
    }

    if (!isObject(event)) {
      errors.push({
        field: `events[${index}]`,
        code: 'EVENT_INVALID',
        message: 'Each synchronization event must be an object.',
      });

      return;
    }

    if (
      !isNonEmptyString(
        event[EVENT_METADATA.EVENT_ID],
      )
    ) {
      errors.push({
        field: `events[${index}].eventId`,
        code: 'EVENT_ID_REQUIRED',
        message: 'eventId is required.',
      });
    }

    if (
      !isNonEmptyString(
        event[EVENT_METADATA.EVENT_TYPE],
      )
    ) {
      errors.push({
        field: `events[${index}].eventType`,
        code: 'EVENT_TYPE_REQUIRED',
        message: 'eventType is required.',
      });
    }

    const eventVersion =
      event[EVENT_METADATA.EVENT_VERSION];

    if (!Number.isInteger(eventVersion)) {
      errors.push({
        field: `events[${index}].eventVersion`,
        code: 'EVENT_VERSION_REQUIRED',
        message: 'eventVersion must be an integer.',
      });
    } else if (
      eventVersion < EVENT_VERSION.MIN_SUPPORTED ||
      eventVersion > EVENT_VERSION.MAX_SUPPORTED
    ) {
      errors.push({
        field: `events[${index}].eventVersion`,
        code: 'EVENT_VERSION_UNSUPPORTED',
        message: 'Unsupported event version.',
      });
    }
  });

  return errors;
}

// =============================================================================
// Context Validation
// =============================================================================

function validateRequestContext(req) {
  const errors = [];

  const tenantId = getTenantId(req);
  const deviceId = getDeviceId(req);
  const userId = getAuthenticatedUserId(req);
  const idempotencyKey = getIdempotencyKey(req);

  if (SECURITY.REQUIRE_TENANT_CONTEXT && !tenantId) {
    errors.push({
      field: HEADERS.TENANT_ID,
      code: 'TENANT_ID_REQUIRED',
      message: 'Tenant context is required.',
    });
  }

  if (SECURITY.REQUIRE_DEVICE_IDENTITY && !deviceId) {
    errors.push({
      field: HEADERS.DEVICE_ID,
      code: 'DEVICE_ID_REQUIRED',
      message: 'Trusted device identity is required.',
    });
  }

  if (!userId) {
    errors.push({
      field: 'authentication',
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authenticated user context is required.',
    });
  }

  if (!idempotencyKey) {
    errors.push({
      field: HEADERS.IDEMPOTENCY_KEY,
      code: OFFLINE_ERROR_CODES.OFFLINE_IDEMPOTENCY_CONFLICT,
      message: 'Idempotency-Key is required for offline synchronization.',
    });
  }

  if (
    idempotencyKey &&
    idempotencyKey.length > LIMITS.MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    errors.push({
      field: HEADERS.IDEMPOTENCY_KEY,
      code: 'IDEMPOTENCY_KEY_TOO_LONG',
      message: 'The Idempotency-Key exceeds the permitted length.',
    });
  }

  return errors;
}

// =============================================================================
// Event Ownership / Tenant Isolation
// =============================================================================

function validateEventContext(events, context) {
  const errors = [];

  events.forEach((event, index) => {
    if (
      isNonEmptyString(event.tenantId) &&
      event.tenantId !== context.tenantId
    ) {
      errors.push({
        field: `events[${index}].tenantId`,
        code: OFFLINE_ERROR_CODES.OFFLINE_TENANT_MISMATCH,
        message: 'Event tenant does not match authenticated tenant context.',
      });
    }

    if (
      isNonEmptyString(event.deviceId) &&
      event.deviceId !== context.deviceId
    ) {
      errors.push({
        field: `events[${index}].deviceId`,
        code: 'DEVICE_CONTEXT_MISMATCH',
        message: 'Event device does not match the trusted device context.',
      });
    }
  });

  return errors;
}

// =============================================================================
// Idempotency Safety
// =============================================================================

function validateBatchIdempotency(events, requestIdempotencyKey) {
  const errors = [];

  const keys = new Set();

  events.forEach((event, index) => {
    const eventType =
      event[EVENT_METADATA.EVENT_TYPE];

    if (!offline.isFinancialEventType(eventType)) {
      return;
    }

    const eventIdempotencyKey =
      normalizeString(
        event[EVENT_METADATA.IDEMPOTENCY_KEY],
      );

    if (!eventIdempotencyKey) {
      errors.push({
        field: `events[${index}].idempotencyKey`,
        code: OFFLINE_ERROR_CODES.OFFLINE_IDEMPOTENCY_CONFLICT,
        message:
          'Financial offline events require an idempotency key.',
      });

      return;
    }

    if (keys.has(eventIdempotencyKey)) {
      errors.push({
        field: `events[${index}].idempotencyKey`,
        code: 'DUPLICATE_BATCH_IDEMPOTENCY_KEY',
        message:
          'The same financial idempotency key appears more than once in the batch.',
      });

      return;
    }

    keys.add(eventIdempotencyKey);
  });

  /*
   * The HTTP request idempotency key identifies the synchronization
   * operation. Individual financial events retain their own business
   * idempotency keys.
   *
   * They intentionally do not have to be identical.
   */
  if (!isNonEmptyString(requestIdempotencyKey)) {
    errors.push({
      field: HEADERS.IDEMPOTENCY_KEY,
      code: OFFLINE_ERROR_CODES.OFFLINE_IDEMPOTENCY_CONFLICT,
      message: 'Synchronization idempotency key is required.',
    });
  }

  return errors;
}

// =============================================================================
// Request Context Construction
// =============================================================================

function buildSyncContext(req) {
  const requestId = getRequestId(req);
  const correlationId = getCorrelationId(req);

  const context = {
    requestId,
    correlationId,

    tenantId: getTenantId(req),
    userId: getAuthenticatedUserId(req),
    deviceId: getDeviceId(req),

    idempotencyKey: getIdempotencyKey(req),

    clientTimestamp: getClientTimestamp(req),
    clientVersion: getClientVersion(req),

    ip:
      req?.ip ||
      req?.socket?.remoteAddress ||
      null,

    userAgent:
      req?.get?.('user-agent') ||
      null,

    method: req?.method || 'POST',

    path: getRequestPath(req),

    receivedAt: new Date().toISOString(),
  };

  return Object.freeze(context);
}

// =============================================================================
// Service Resolution
// =============================================================================

/**
 * Resolve the synchronization service from application locals.
 *
 * Preferred registration:
 *
 *   app.locals.services.offlineSyncService
 *
 * Supported aliases:
 *
 *   app.locals.offlineSyncService
 *   app.locals.services.offline.sync
 *
 * The controller deliberately does not require a concrete persistence
 * implementation. This keeps HTTP orchestration separate from the
 * synchronization domain and allows dependency injection during tests.
 */
function resolveSyncService(req) {
  const services = req?.app?.locals?.services;

  const service =
    services?.offlineSyncService ||
    req?.app?.locals?.offlineSyncService ||
    services?.offline?.sync ||
    services?.offline?.syncService ||
    req?.app?.locals?.offline?.sync;

  if (!service) {
    const error = new Error(
      'Offline synchronization service is not configured.',
    );

    error.code = 'OFFLINE_SYNC_SERVICE_NOT_CONFIGURED';
    error.statusCode = HTTP.SERVICE_UNAVAILABLE;
    error.isOperational = true;

    throw error;
  }

  return service;
}

// =============================================================================
// Service Invocation
// =============================================================================

async function executeSynchronization({
  service,
  events,
  cursor,
  context,
  req,
}) {
  const payload = Object.freeze({
    events,
    cursor: cursor ?? null,
  });

  /*
   * Preferred application-service contract:
   *
   *   service.sync({
   *     events,
   *     cursor,
   *     context,
   *     request
   *   })
   *
   * A small compatibility fallback to synchronize() is retained so that
   * the controller can coexist with an existing TITech service layer while
   * the architecture is being migrated.
   */
  if (typeof service.sync === 'function') {
    return service.sync({
      ...payload,
      context,
      request: req,
    });
  }

  if (typeof service.synchronize === 'function') {
    return service.synchronize({
      ...payload,
      context,
      request: req,
    });
  }

  if (typeof service.processBatch === 'function') {
    return service.processBatch({
      ...payload,
      context,
      request: req,
    });
  }

  const error = new Error(
    'Offline synchronization service does not expose a supported sync method.',
  );

  error.code = 'OFFLINE_SYNC_METHOD_NOT_IMPLEMENTED';
  error.statusCode = HTTP.SERVICE_UNAVAILABLE;
  error.isOperational = true;

  throw error;
}

// =============================================================================
// Response Helpers
// =============================================================================

function buildBaseResponse(context) {
  return {
    success: true,

    responseVersion: RESPONSE_VERSION,

    module: MODULE_NAME,

    requestId: context.requestId,

    correlationId: context.correlationId,

    timestamp: new Date().toISOString(),
  };
}

function normalizeSyncResult(result) {
  if (!isObject(result)) {
    return {
      status: 'COMPLETED',
      accepted: [],
      duplicates: [],
      conflicts: [],
      rejected: [],
      failed: [],
      nextCursor: null,
    };
  }

  return {
    status:
      result.status ||
      result.syncStatus ||
      'COMPLETED',

    accepted:
      Array.isArray(result.accepted)
        ? result.accepted
        : [],

    duplicates:
      Array.isArray(result.duplicates)
        ? result.duplicates
        : [],

    conflicts:
      Array.isArray(result.conflicts)
        ? result.conflicts
        : [],

    rejected:
      Array.isArray(result.rejected)
        ? result.rejected
        : [],

    failed:
      Array.isArray(result.failed)
        ? result.failed
        : [],

    processed:
      Number.isInteger(result.processed)
        ? result.processed
        : undefined,

    nextCursor:
      result.nextCursor ??
      result.cursor ??
      null,

    hasMore:
      typeof result.hasMore === 'boolean'
        ? result.hasMore
        : false,

    reconciliationRequired:
      Boolean(result.reconciliationRequired),

    summary:
      isObject(result.summary)
        ? result.summary
        : undefined,
  };
}

function determineResponseStatus(result) {
  if (!result) {
    return HTTP.OK;
  }

  if (
    result.conflicts.length > 0 ||
    result.reconciliationRequired
  ) {
    return HTTP.CONFLICT;
  }

  if (
    result.rejected.length > 0 &&
    result.accepted.length === 0
  ) {
    return HTTP.UNPROCESSABLE_ENTITY;
  }

  if (
    result.failed.length > 0 &&
    result.accepted.length === 0
  ) {
    return HTTP.SERVICE_UNAVAILABLE;
  }

  if (
    result.accepted.length > 0 &&
    (
      result.duplicates.length > 0 ||
      result.rejected.length > 0 ||
      result.failed.length > 0
    )
  ) {
    return HTTP.MULTI_STATUS || 207;
  }

  return HTTP.OK;
}

// =============================================================================
// Logging / Observability
// =============================================================================

function getLogger(req) {
  return (
    req?.app?.locals?.logger ||
    req?.app?.locals?.observability?.logger ||
    console
  );
}

function logInfo(req, message, metadata = {}) {
  const logger = getLogger(req);

  if (typeof logger.info === 'function') {
    logger.info(message, {
      controller: CONTROLLER_NAME,
      ...metadata,
    });
  }
}

function logWarn(req, message, metadata = {}) {
  const logger = getLogger(req);

  if (typeof logger.warn === 'function') {
    logger.warn(message, {
      controller: CONTROLLER_NAME,
      ...metadata,
    });
  }
}

function logError(req, message, metadata = {}) {
  const logger = getLogger(req);

  if (typeof logger.error === 'function') {
    logger.error(message, {
      controller: CONTROLLER_NAME,
      ...metadata,
    });
  }
}

// =============================================================================
// Main Controller
// =============================================================================

async function sync(req, res, next) {
  const startedAt = Date.now();

  let context;

  try {
    context = buildSyncContext(req);

    const contextErrors =
      validateRequestContext(req);

    if (contextErrors.length > 0) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,

        responseVersion: RESPONSE_VERSION,

        module: MODULE_NAME,

        code: 'OFFLINE_SYNC_CONTEXT_INVALID',

        message:
          'The offline synchronization context is invalid.',

        requestId: context.requestId,

        correlationId: context.correlationId,

        errors: contextErrors,
      });
    }

    const bodyErrors =
      validateRequestBody(req.body);

    if (bodyErrors.length > 0) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,

        responseVersion: RESPONSE_VERSION,

        module: MODULE_NAME,

        code: 'OFFLINE_SYNC_PAYLOAD_INVALID',

        message:
          'The offline synchronization payload is invalid.',

        requestId: context.requestId,

        correlationId: context.correlationId,

        errors: bodyErrors,
      });
    }

    const events = req.body.events;

    const eventContextErrors =
      validateEventContext(events, context);

    if (eventContextErrors.length > 0) {
      return res.status(HTTP.FORBIDDEN).json({
        success: false,

        responseVersion: RESPONSE_VERSION,

        module: MODULE_NAME,

        code: 'OFFLINE_SYNC_CONTEXT_MISMATCH',

        message:
          'One or more events do not belong to the authenticated synchronization context.',

        requestId: context.requestId,

        correlationId: context.correlationId,

        errors: eventContextErrors,
      });
    }

    const idempotencyErrors =
      validateBatchIdempotency(
        events,
        context.idempotencyKey,
      );

    if (idempotencyErrors.length > 0) {
      return res.status(HTTP.CONFLICT).json({
        success: false,

        responseVersion: RESPONSE_VERSION,

        module: MODULE_NAME,

        code: 'OFFLINE_SYNC_IDEMPOTENCY_INVALID',

        message:
          'The synchronization request failed idempotency validation.',

        requestId: context.requestId,

        correlationId: context.correlationId,

        errors: idempotencyErrors,
      });
    }

    /*
     * The service layer owns:
     *
     *   1. Idempotency reservation
     *   2. Event deduplication
     *   3. Device trust verification
     *   4. Signature verification
     *   5. Sequence/hash-chain validation
     *   6. Database transaction boundaries
     *   7. Financial ledger mutation
     *   8. Conflict detection
     *   9. Reconciliation
     *  10. Idempotency completion
     */
    const service = resolveSyncService(req);

    logInfo(req, 'Offline synchronization started.', {
      requestId: context.requestId,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      deviceId: context.deviceId,
      userId: context.userId,
      eventCount: events.length,
    });

    const result = await executeSynchronization({
      service,
      events,
      cursor: req.body.cursor ?? null,
      context,
      req,
    });

    const normalizedResult =
      normalizeSyncResult(result);

    const durationMs = Date.now() - startedAt;

    const response = {
      ...buildBaseResponse(context),

      sync: {
        status: normalizedResult.status,

        processed:
          normalizedResult.processed ??
          events.length,

        accepted:
          normalizedResult.accepted,

        duplicates:
          normalizedResult.duplicates,

        conflicts:
          normalizedResult.conflicts,

        rejected:
          normalizedResult.rejected,

        failed:
          normalizedResult.failed,

        nextCursor:
          normalizedResult.nextCursor,

        hasMore:
          normalizedResult.hasMore,

        reconciliationRequired:
          normalizedResult.reconciliationRequired,

        ...(normalizedResult.summary
          ? { summary: normalizedResult.summary }
          : {}),
      },

      meta: {
        eventCount: events.length,
        durationMs,
        idempotencyKey: context.idempotencyKey,
      },
    };

    const statusCode =
      determineResponseStatus(normalizedResult);

    if (
      normalizedResult.conflicts.length > 0 ||
      normalizedResult.reconciliationRequired
    ) {
      logWarn(
        req,
        'Offline synchronization completed with conflicts.',
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          deviceId: context.deviceId,
          conflictCount:
            normalizedResult.conflicts.length,
          reconciliationRequired:
            normalizedResult.reconciliationRequired,
          durationMs,
        },
      );
    } else {
      logInfo(
        req,
        'Offline synchronization completed.',
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          deviceId: context.deviceId,
          eventCount: events.length,
          acceptedCount:
            normalizedResult.accepted.length,
          duplicateCount:
            normalizedResult.duplicates.length,
          durationMs,
        },
      );
    }

    return res.status(statusCode).json(response);
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    const requestId =
      context?.requestId ||
      getRequestId(req);

    const correlationId =
      context?.correlationId ||
      getCorrelationId(req);

    logError(
      req,
      'Offline synchronization failed.',
      {
        requestId,
        correlationId,

        tenantId:
          context?.tenantId ||
          getTenantId(req),

        deviceId:
          context?.deviceId ||
          getDeviceId(req),

        durationMs,

        errorCode: error?.code,
        errorName: error?.name,

        /*
         * Avoid logging complete request payloads.
         * Offline events may contain financial and personal data.
         */
        eventCount:
          Array.isArray(req?.body?.events)
            ? req.body.events.length
            : 0,

        ...(isProduction()
          ? {}
          : { error: serializeError(error) }),
      },
    );

    /*
     * Delegate to the centralized TITech error middleware whenever
     * possible. This preserves the application's standard error envelope,
     * correlation ID, security policy, and observability behavior.
     */
    if (typeof next === 'function') {
      return next(error);
    }

    const statusCode =
      getErrorStatus(error);

    return res.status(statusCode).json({
      success: false,

      responseVersion: RESPONSE_VERSION,

      module: MODULE_NAME,

      code:
        error?.code ||
        'OFFLINE_SYNC_FAILED',

      message:
        isProduction() && !isOperationalError(error)
          ? 'Offline synchronization failed.'
          : (
              error?.message ||
              'Offline synchronization failed.'
            ),

      requestId,

      correlationId,
    });
  }
}

// =============================================================================
// Health / Capability Endpoint
// =============================================================================

async function health(req, res, next) {
  try {
    const service =
      resolveSyncService(req);

    let serviceHealth = {
      available: true,
    };

    if (
      typeof service.health === 'function'
    ) {
      serviceHealth =
        await service.health();
    }

    return res.status(HTTP.OK).json({
      success: true,

      responseVersion: RESPONSE_VERSION,

      module: MODULE_NAME,

      status: 'UP',

      service: serviceHealth,

      capabilities: {
        offlineSync: true,
        idempotency:
          SECURITY.REQUIRE_IDEMPOTENCY_FOR_FINANCIAL_EVENTS,
        eventSignatures:
          SECURITY.REQUIRE_EVENT_SIGNATURE,
        deviceIdentity:
          SECURITY.REQUIRE_DEVICE_IDENTITY,
        tenantIsolation:
          SECURITY.REQUIRE_TENANT_CONTEXT,
        financialAtomicCommit:
          FINANCIAL.REQUIRE_ATOMIC_COMMIT,
        clientLedgerAuthority:
          FINANCIAL.CLIENT_MAY_FINALIZE_LEDGER_ENTRY,
      },

      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }

    return res.status(
      getErrorStatus(error),
    ).json({
      success: false,
      module: MODULE_NAME,
      status: 'DOWN',
      code:
        error?.code ||
        'OFFLINE_SYNC_HEALTH_FAILED',
      message:
        isProduction()
          ? 'Offline synchronization service is unavailable.'
          : error?.message,
    });
  }
}

// =============================================================================
// Readiness Endpoint
// =============================================================================

async function readiness(req, res, next) {
  try {
    const service =
      resolveSyncService(req);

    if (
      typeof service.ready === 'function'
    ) {
      const ready =
        await service.ready();

      if (ready === false) {
        return res.status(
          HTTP.SERVICE_UNAVAILABLE,
        ).json({
          success: false,
          module: MODULE_NAME,
          status: 'NOT_READY',
          code: 'OFFLINE_SYNC_NOT_READY',
        });
      }
    }

    return res.status(HTTP.OK).json({
      success: true,
      module: MODULE_NAME,
      status: 'READY',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }

    return res.status(
      HTTP.SERVICE_UNAVAILABLE,
    ).json({
      success: false,
      module: MODULE_NAME,
      status: 'NOT_READY',
      code:
        error?.code ||
        'OFFLINE_SYNC_NOT_READY',
    });
  }
}

// =============================================================================
// Controller Metadata
// =============================================================================

const metadata = Object.freeze({
  name: CONTROLLER_NAME,

  module: MODULE_NAME,

  version: MODULE_VERSION,

  syncPath: DEFAULT_SYNC_PATH,

  responseVersion: RESPONSE_VERSION,

  limits: Object.freeze({
    maxEvents: MAX_BODY_EVENTS,
    maxEventPayloadBytes:
      MAX_EVENT_PAYLOAD_BYTES,
    maxBatchBytes:
      MAX_TOTAL_BATCH_BYTES,
  }),

  timeoutMs: REQUEST_TIMEOUT_MS,
});

// =============================================================================
// Public Controller API
// =============================================================================

module.exports = Object.freeze({
  metadata,

  sync,

  synchronize: sync,

  health,

  readiness,

  // Exposed for isolated unit/integration testing.
  validateRequestBody,

  validateRequestContext,

  validateEventContext,

  validateBatchIdempotency,

  buildSyncContext,

  normalizeSyncResult,

  determineResponseStatus,

  resolveSyncService,
});