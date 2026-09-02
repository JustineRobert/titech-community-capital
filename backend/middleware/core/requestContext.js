'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/middleware/core/requestContext.js
 * =============================================================================
 *
 * Enterprise Request Context Middleware
 *
 * Features Summary
 * -----------------------------------------------------------------------------
 * • Creates req.context before any business middleware
 * • Builds immutable RequestContext
 * • Attaches:
 *      - Enterprise Configuration Provider
 *      - Enterprise Service Registry
 *      - Request Logger
 *      - Tenant Placeholder
 *      - Authentication Placeholder
 * • Registers request context in AsyncLocalStorage
 * • Future-proof for distributed tracing
 * • Zero shared mutable state
 * • Express 4.x / Express 5.x compatible
 * • Fully testable
 *
 * Pipeline
 * -----------------------------------------------------------------------------
 *
 * Request
 *    │
 * Request ID
 *    │
 * Correlation ID
 *    │
 * Request Context
 *    │
 * Authentication
 *    │
 * Business Logic
 *
 * =============================================================================
 */

const { AsyncLocalStorage } = require('async_hooks');
const RequestContextFactory = require('../../shared/context/RequestContextFactory');

const asyncContext = new AsyncLocalStorage();

/**
 * Enterprise Request Context Middleware
 *
 * @param {Object} options
 * @param {Object} options.config
 * @param {Object} options.services
 * @param {Object} options.loggerFactory
 * @returns {import('express').RequestHandler}
 */
function requestContext({
    config = null,
    services = null,
    loggerFactory = null
} = {}) {

    const factory = new RequestContextFactory({
        config,
        services,
        loggerFactory
    });

    return function requestContextMiddleware(req, res, next) {

        try {

            /*
             * Create immutable request context.
             */
            const context = factory.create(req);

            /*
             * Ensure placeholders exist.
             * Authentication and tenant middleware
             * will replace these objects later.
             */
            if (context.tenant === null) {

                Object.defineProperty(
                    req,
                    'tenant',
                    {
                        value: null,
                        writable: true,
                        configurable: true,
                        enumerable: true
                    }
                );

            }

            if (context.user === null) {

                Object.defineProperty(
                    req,
                    'user',
                    {
                        value: null,
                        writable: true,
                        configurable: true,
                        enumerable: true
                    }
                );

            }

            /*
             * Convenience aliases.
             */
            req.logger = context.logger;

            req.services = context.services;

            req.config = context.config;

            /*
             * Expose context to views if required.
             */
            res.locals.context = context;

            /*
             * Register context for async propagation.
             *
             * Every asynchronous continuation
             * can retrieve the same RequestContext.
             */
            asyncContext.run(context, () => {

                return next();

            });

        }
        catch (error) {

            return next(error);

        }

    };

}

/**
 * Returns the active request context.
 *
 * Can be safely called from:
 *
 * • Services
 * • Repositories
 * • Audit Logging
 * • Event Publishers
 * • BullMQ Workers
 * • Notification Services
 *
 * @returns {Object|null}
 */
function getRequestContext() {

    return asyncContext.getStore() || null;

}

/**
 * Returns the current request ID.
 *
 * @returns {string|null}
 */
function getRequestId() {

    const context = getRequestContext();

    return context
        ? context.requestId
        : null;

}

/**
 * Returns the current correlation ID.
 *
 * @returns {string|null}
 */
function getCorrelationId() {

    const context = getRequestContext();

    return context
        ? context.correlationId
        : null;

}

/**
 * Returns the authenticated user.
 *
 * @returns {*}
 */
function getCurrentUser() {

    const context = getRequestContext();

    return context
        ? context.user
        : null;

}

/**
 * Returns the active tenant.
 *
 * @returns {*}
 */
function getCurrentTenant() {

    const context = getRequestContext();

    return context
        ? context.tenant
        : null;

}

/**
 * Returns the request logger.
 *
 * @returns {*}
 */
function getLogger() {

    const context = getRequestContext();

    return context
        ? context.logger
        : null;

}

/**
 * Returns enterprise configuration.
 *
 * @returns {*}
 */
function getConfiguration() {

    const context = getRequestContext();

    return context
        ? context.config
        : null;

}

/**
 * Returns enterprise services.
 *
 * @returns {*}
 */
function getServices() {

    const context = getRequestContext();

    return context
        ? context.services
        : null;

}

module.exports = requestContext;

module.exports.asyncContext = asyncContext;

module.exports.getRequestContext = getRequestContext;

module.exports.getRequestId = getRequestId;

module.exports.getCorrelationId = getCorrelationId;

module.exports.getCurrentUser = getCurrentUser;

module.exports.getCurrentTenant = getCurrentTenant;

module.exports.getLogger = getLogger;

module.exports.getConfiguration = getConfiguration;

module.exports.getServices = getServices;

Object.freeze(module.exports);