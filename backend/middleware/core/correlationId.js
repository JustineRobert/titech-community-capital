'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/middleware/core/correlationId.js
 *
 * Enterprise Correlation ID Middleware
 * =============================================================================
 *
 * Features Summary
 * -----------------------------------------------------------------------------
 * • Reads X-Correlation-ID from inbound requests
 * • Generates RFC4122 UUID v4 Correlation IDs when absent
 * • Supports distributed tracing across services
 * • Preserves correlation IDs across internal service calls
 * • Stores correlation ID in req.context.correlationId
 * • Stores correlation ID in req.correlationId
 * • Adds X-Correlation-ID to every response
 * • Validates inbound identifiers
 * • Prevents oversized/spoofed headers
 * • Stateless
 * • Zero shared mutable state
 * • Fully testable
 * • Express 4.x / Express 5.x compatible
 *
 * Distributed Trace Flow
 * -----------------------------------------------------------------------------
 *
 *            Gateway
 *               │
 *               ▼
 *     X-Correlation-ID
 *               │
 *               ▼
 *           Express API
 *               │
 *               ▼
 *            Services
 *               │
 *               ▼
 *            Workers
 *               │
 *               ▼
 *          Audit Logging
 *
 * The same Correlation ID follows the request through every component.
 * =============================================================================
 */

const crypto = require('crypto');

const HEADER_NAME = 'X-Correlation-ID';

const MAX_HEADER_LENGTH = 128;

/**
 * RFC4122 UUID validation.
 *
 * Accepts UUID versions 1-8.
 */
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a Correlation ID.
 *
 * @returns {string}
 */
function generateCorrelationId() {
    return crypto.randomUUID();
}

/**
 * Validate inbound Correlation ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidCorrelationId(value) {

    if (typeof value !== 'string') {
        return false;
    }

    const candidate = value.trim();

    if (!candidate.length) {
        return false;
    }

    if (candidate.length > MAX_HEADER_LENGTH) {
        return false;
    }

    return UUID_REGEX.test(candidate);
}

/**
 * Resolve the Correlation ID.
 *
 * Priority:
 *
 * 1. Valid inbound X-Correlation-ID
 * 2. Existing Request ID
 * 3. Newly generated UUID
 *
 * Using Request ID as a fallback allows
 * correlation and request identifiers to
 * remain aligned when upstream systems do
 * not provide distributed tracing.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveCorrelationId(req) {

    const inbound = req.get(HEADER_NAME);

    if (isValidCorrelationId(inbound)) {
        return inbound.trim();
    }

    if (
        typeof req.id === 'string' &&
        UUID_REGEX.test(req.id)
    ) {
        return req.id;
    }

    return generateCorrelationId();
}

/**
 * Enterprise Correlation ID middleware.
 *
 * @returns {import('express').RequestHandler}
 */
function correlationId() {

    return function correlationIdMiddleware(req, res, next) {

        const correlationId = resolveCorrelationId(req);

        /*
         * Enterprise request context.
         */
        if (!req.context) {
            req.context = {};
        }

        req.context.correlationId = correlationId;

        /*
         * Convenience property.
         */
        req.correlationId = correlationId;

        /*
         * Response header.
         */
        res.setHeader(
            HEADER_NAME,
            correlationId
        );

        /*
         * Response locals.
         */
        res.locals.correlationId = correlationId;

        /*
         * Useful for downstream middleware,
         * logging and outbound HTTP clients.
         */
        req.trace = Object.freeze({

            requestId: req.id || null,

            correlationId

        });

        return next();
    };

}

/**
 * Public API
 */
module.exports = correlationId;

/*
 * Test helpers.
 */
module.exports.generateCorrelationId =
    generateCorrelationId;

module.exports.isValidCorrelationId =
    isValidCorrelationId;

module.exports.resolveCorrelationId =
    resolveCorrelationId;

Object.freeze(module.exports);