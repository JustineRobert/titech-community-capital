'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/shared/context/RequestContext.js
 * =============================================================================
 *
 * Enterprise Request Context
 *
 * Features
 * -----------------------------------------------------------------------------
 * • Immutable request-scoped context
 * • Frozen after construction
 * • Holds request metadata only
 * • No business logic
 * • Designed for dependency injection
 * • Supports distributed tracing
 * • Supports multi-tenancy
 * • Supports structured logging
 * • Supports audit logging
 * • Safe serialization
 * • Express independent
 * • Fully testable
 *
 * Context Properties
 * -----------------------------------------------------------------------------
 * {
 *   requestId,
 *   correlationId,
 *   tenant,
 *   user,
 *   ip,
 *   userAgent,
 *   startedAt,
 *   logger,
 *   services,
 *   config
 * }
 *
 * =============================================================================
 */

const os = require('os');

/**
 * Deep freeze helper.
 *
 * Ensures nested configuration objects cannot
 * be mutated after construction.
 *
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {

    if (
        value === null ||
        typeof value !== 'object' ||
        Object.isFrozen(value)
    ) {
        return value;
    }

    Object.freeze(value);

    for (const key of Object.getOwnPropertyNames(value)) {
        deepFreeze(value[key]);
    }

    return value;
}

/**
 * Enterprise Request Context.
 *
 * This class intentionally contains
 * no business logic.
 */
class RequestContext {

    /**
     * @param {Object} options
     */
    constructor({

        requestId = null,

        correlationId = null,

        tenant = null,

        user = null,

        ip = null,

        userAgent = null,

        startedAt = new Date(),

        logger = null,

        services = null,

        config = null,

        method = null,

        originalUrl = null,

        protocol = null,

        hostname = null

    } = {}) {

        /**
         * Distributed tracing
         */
        this.requestId = requestId;

        this.correlationId = correlationId;

        /**
         * Multi-tenancy
         */
        this.tenant = tenant;

        /**
         * Authenticated user
         */
        this.user = user;

        /**
         * Client metadata
         */
        this.ip = ip;

        this.userAgent = userAgent;

        this.method = method;

        this.originalUrl = originalUrl;

        this.protocol = protocol;

        this.hostname = hostname;

        /**
         * Timing
         */
        this.startedAt =
            startedAt instanceof Date
                ? startedAt
                : new Date(startedAt);

        /**
         * Infrastructure
         */
        this.logger = logger;

        this.services = services;

        this.config = config;

        /**
         * Runtime metadata
         */
        this.nodeVersion = process.version;

        this.processId = process.pid;

        this.host = os.hostname();

        /**
         * High-resolution timer.
         *
         * Used by request metrics middleware.
         */
        this.hrtime = process.hrtime.bigint();

        /**
         * Freeze nested objects first.
         */
        deepFreeze(this.logger);

        deepFreeze(this.services);

        deepFreeze(this.config);

        deepFreeze(this.tenant);

        deepFreeze(this.user);

        /**
         * Freeze entire context.
         */
        Object.freeze(this);
    }

    /**
     * JSON-safe representation.
     *
     * Removes heavyweight dependencies that
     * should not be serialized.
     */
    toJSON() {

        return {

            requestId: this.requestId,

            correlationId: this.correlationId,

            tenant: this.tenant,

            user: this.user,

            ip: this.ip,

            userAgent: this.userAgent,

            method: this.method,

            originalUrl: this.originalUrl,

            protocol: this.protocol,

            hostname: this.hostname,

            startedAt: this.startedAt,

            processId: this.processId,

            host: this.host,

            nodeVersion: this.nodeVersion

        };

    }

    /**
     * Human-readable inspection.
     */
    toString() {

        return JSON.stringify(
            this.toJSON(),
            null,
            2
        );

    }

    /**
     * Convenience helper.
     *
     * @returns {number}
     */
    getDurationMilliseconds() {

        const duration =
            process.hrtime.bigint() - this.hrtime;

        return Number(duration) / 1e6;

    }

}

/**
 * Prevent runtime mutation.
 */
Object.freeze(RequestContext.prototype);

module.exports = RequestContext;