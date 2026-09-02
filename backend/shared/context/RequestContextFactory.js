'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/shared/context/RequestContextFactory.js
 * =============================================================================
 *
 * Enterprise Request Context Factory
 *
 * Features Summary
 * -----------------------------------------------------------------------------
 * • Responsible for constructing every request context
 * • Creates req.context
 * • Integrates:
 *      - Enterprise Configuration Provider
 *      - Enterprise Service Registry
 *      - Structured Logger
 *      - Request Metadata
 * • Guarantees exactly one immutable RequestContext per request
 * • Dependency Injection friendly
 * • Framework independent
 * • Fully testable
 * • Zero shared mutable state
 *
 * =============================================================================
 */

const RequestContext = require('./RequestContext');

/**
 * Enterprise Request Context Factory.
 */
class RequestContextFactory {

    /**
     * @param {Object} options
     * @param {Object} [options.config]
     * @param {Object} [options.services]
     * @param {Object} [options.loggerFactory]
     */
    constructor({

        config = null,

        services = null,

        loggerFactory = null

    } = {}) {

        this.config = config;

        this.services = services;

        this.loggerFactory = loggerFactory;

        Object.freeze(this);

    }

    /**
     * Creates a new immutable RequestContext.
     *
     * @param {import('express').Request} req
     * @returns {RequestContext}
     */
    create(req) {

        if (!req) {
            throw new TypeError(
                'Request object is required.'
            );
        }

        /*
         * Prevent duplicate construction.
         */
        if (
            req.context instanceof RequestContext
        ) {
            return req.context;
        }

        const logger =
            this.createLogger(req);

        const context =
            new RequestContext({

                requestId:
                    req.id || null,

                correlationId:
                    req.correlationId ||
                    req.context?.correlationId ||
                    null,

                tenant:
                    req.tenant || null,

                user:
                    req.user || null,

                ip:
                    this.resolveIp(req),

                userAgent:
                    req.get('User-Agent') || null,

                method:
                    req.method,

                originalUrl:
                    req.originalUrl,

                protocol:
                    req.protocol,

                hostname:
                    req.hostname,

                startedAt:
                    new Date(),

                logger,

                services:
                    this.services,

                config:
                    this.config

            });

        /*
         * Attach immutable context.
         */
        req.context = context;

        return context;

    }

    /**
     * Creates a request-scoped logger.
     *
     * @private
     */
    createLogger(req) {

        if (
            !this.loggerFactory ||
            typeof this.loggerFactory.create !== 'function'
        ) {
            return null;
        }

        return this.loggerFactory.create({

            requestId:
                req.id,

            correlationId:
                req.correlationId,

            tenantId:
                req.tenant?.id,

            userId:
                req.user?.id,

            method:
                req.method,

            path:
                req.originalUrl,

            ip:
                this.resolveIp(req)

        });

    }

    /**
     * Resolve the most reliable client IP.
     *
     * Works correctly with Express trust proxy.
     *
     * @private
     */
    resolveIp(req) {

        if (req.ip) {
            return req.ip;
        }

        if (
            Array.isArray(req.ips) &&
            req.ips.length
        ) {
            return req.ips[0];
        }

        const forwarded =
            req.get('X-Forwarded-For');

        if (forwarded) {

            return forwarded
                .split(',')
                .map(ip => ip.trim())
                .filter(Boolean)[0];

        }

        return (
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            null
        );

    }

}

/**
 * Convenience helper.
 *
 * @param {Object} options
 * @returns {RequestContextFactory}
 */
function createFactory(options) {

    return new RequestContextFactory(options);

}

module.exports = RequestContextFactory;

module.exports.createFactory = createFactory;

Object.freeze(module.exports);