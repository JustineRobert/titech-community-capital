/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/constants/httpStatus.js
 * Canonical HTTP Status Constants — Native ESM
 * ============================================================================
 *
 * Responsibilities:
 * - Provide one immutable source of canonical HTTP status constants.
 * - Support named and default ESM imports.
 * - Preserve compatible CommonJS require() behavior on supported Node.js
 *   runtimes.
 * - Keep existing status values stable for controllers, middleware, services,
 *   and standardized API errors.
 *
 * Module strategy:
 * - Backend package uses "type": "module".
 * - Native ESM is the primary interface.
 * - A single "module.exports" interoperability export preserves the legacy
 *   object interface on compatible Node.js runtimes.
 * ============================================================================
 */

/**
 * Canonical HTTP status map.
 *
 * Existing values are preserved. PAYMENT_REQUIRED (402) is included because
 * the TITech ApiError payment-failure factory references it.
 */
const HttpStatus = Object.freeze({
  CONTINUE: 100,

  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

/* ============================================================================
 * Named ESM Exports
 * ========================================================================== */

export const {
  CONTINUE,

  OK,
  CREATED,
  ACCEPTED,
  NO_CONTENT,

  BAD_REQUEST,
  UNAUTHORIZED,
  PAYMENT_REQUIRED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  UNPROCESSABLE_ENTITY,
  TOO_MANY_REQUESTS,

  INTERNAL_SERVER_ERROR,
  NOT_IMPLEMENTED,
  BAD_GATEWAY,
  SERVICE_UNAVAILABLE,
  GATEWAY_TIMEOUT,
} = HttpStatus;

/* ============================================================================
 * Default and Named Object Exports
 * ========================================================================== */

/**
 * Default import:
 *   import HttpStatus from '../constants/httpStatus.js';
 *
 * Named object import:
 *   import { HttpStatus } from '../constants/httpStatus.js';
 */
export { HttpStatus };

export default HttpStatus;

/* ============================================================================
 * CommonJS Interoperability
 * ========================================================================== */

/**
 * Preserve the legacy CommonJS object interface for compatible Node.js
 * runtimes:
 *
 *   const HttpStatus = require('../constants/httpStatus.js');
 *
 * Requires Node.js support for the special "module.exports" ESM export name.
 * Jest compatibility must be verified separately.
 */
export { HttpStatus as 'module.exports' };