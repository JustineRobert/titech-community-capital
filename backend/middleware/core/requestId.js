'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/middleware/core/requestId.js
 *
 * Enterprise Request ID Middleware
 * =============================================================================
 *
 * Features
 * --------
 * • Generates RFC4122 UUID v4 Request IDs using crypto.randomUUID()
 * • Respects existing inbound X-Request-ID header
 * • Validates inbound Request IDs
 * • Prevents oversized/spoofed headers
 * • Stores request ID on req.id
 * • Stores request ID on req.context.requestId
 * • Adds X-Request-ID to every response
 * • Zero shared mutable state
 * • Production-grade
 * • Fully testable
 * • Express 4.x / 5.x compatible
 *
 * Request Flow
 * ------------
 *
 * Incoming Request
 *        │
 *        ▼
 * Has X-Request-ID?
 *      │      │
 *     Yes     No
 *      │      │
 * Validate  Generate UUID
 *      │      │
 *      └──► req.id
 *              │
 *              ▼
 *     Response Header
 *
 * =============================================================================
 */

const crypto = require('crypto');

const HEADER_NAME = 'X-Request-ID';

const MAX_HEADER_LENGTH = 128;

/**
 * RFC4122 UUID validation.
 *
 * Accepts UUID versions 1–8.
 */
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a new request identifier.
 *
 * @returns {string}
 */
function generateRequestId() {
    return crypto.randomUUID();
}

/**
 * Validates an inbound request identifier.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidRequestId(value) {
    if (typeof value !== 'string') {
        return false;
    }

    const candidate = value.trim();

    if (candidate.length === 0) {
        return false;
    }

    if (candidate.length > MAX_HEADER_LENGTH) {
        return false;
    }

    return UUID_REGEX.test(candidate);
}

/**
 * Resolve request ID.
 *
 * Priority:
 *
 * 1. Valid inbound header
 * 2. Newly generated UUID
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveRequestId(req) {
    const inbound = req.get(HEADER_NAME);

    if (isValidRequestId(inbound)) {
        return inbound.trim();
    }

    return generateRequestId();
}

/**
 * Enterprise Request ID middleware.
 *
 * @returns {import('express').RequestHandler}
 */
function requestId() {
    return function requestIdMiddleware(req, res, next) {
        const id = resolveRequestId(req);

        /*
         * Standard Express property.
         */
        req.id = id;

        /*
         * Ensure request context exists.
         */
        if (!req.context) {
            req.context = {};
        }

        /*
         * Store request ID in enterprise context.
         */
        req.context.requestId = id;

        /*
         * Response header for downstream services.
         */
        res.setHeader(HEADER_NAME, id);

        /*
         * Convenience access for templates/logging.
         */
        res.locals.requestId = id;

        return next();
    };
}

/**
 * Public API
 */
module.exports = requestId;

/**
 * Test helpers
 */
module.exports.generateRequestId = generateRequestId;
module.exports.isValidRequestId = isValidRequestId;
module.exports.resolveRequestId = resolveRequestId;

Object.freeze(module.exports);