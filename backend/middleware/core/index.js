'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/core/index.js
 *
 * Enterprise Core Middleware Registry
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Central export point for all core middleware
 * • Middleware discovery
 * • Ordered pipeline construction
 * • Startup diagnostics
 * • Health verification
 * • Middleware metadata
 * • Lazy loading
 * • Future plugin support
 *
 * Core Middleware
 * -----------------------------------------------------------------------------
 * ✓ Trust Proxy
 * ✓ Request ID
 * ✓ Correlation ID
 * ✓ Request Context
 * ✓ Request Logger
 * ✓ Request Metrics
 *
 * Pipeline Order
 * -----------------------------------------------------------------------------
 *
 * 1. Trust Proxy
 * 2. Request ID
 * 3. Correlation ID
 * 4. Request Context
 * 5. Request Logger
 * 6. Request Metrics
 *
 * =============================================================================
 */

const VERSION = '1.0.0';

/**
 * Lazy middleware loaders.
 *
 * Prevents circular dependencies and reduces startup cost.
 */
const middlewareLoaders = Object.freeze({

    trustProxy: () =>
        require('./trustProxy'),

    requestId: () =>
        require('./requestId'),

    correlationId: () =>
        require('./correlationId'),

    requestContext: () =>
        require('./requestContext'),

    requestLogger: () =>
        require('./requestLogger'),

    requestMetrics: () =>
        require('./requestMetrics')

});

/**
 * Enterprise pipeline order.
 */
const PIPELINE_ORDER = Object.freeze([

    'trustProxy',

    'requestId',

    'correlationId',

    'requestContext',

    'requestLogger',

    'requestMetrics'

]);

/**
 * Load middleware.
 *
 * @param {string} name
 * @returns {*}
 */
function load(name) {

    const loader =
        middlewareLoaders[name];

    if (!loader) {

        throw new Error(
            `Unknown middleware: ${name}`
        );

    }

    return loader();

}

/**
 * Return middleware in execution order.
 *
 * @returns {Array}
 */
function pipeline() {

    return PIPELINE_ORDER.map(load);

}

/**
 * Discover available middleware.
 *
 * @returns {Array<string>}
 */
function list() {

    return Object.keys(
        middlewareLoaders
    );

}

/**
 * Check registry health.
 *
 * @returns {Object}
 */
function health() {

    const results = {};

    let healthy = true;

    for (const name of PIPELINE_ORDER) {

        try {

            load(name);

            results[name] = {

                loaded: true,

                healthy: true

            };

        }

        catch (error) {

            healthy = false;

            results[name] = {

                loaded: false,

                healthy: false,

                error: error.message

            };

        }

    }

    return Object.freeze({

        healthy,

        middleware: results

    });

}

/**
 * Startup diagnostics.
 *
 * @returns {Object}
 */
function diagnostics() {

    return Object.freeze({

        version: VERSION,

        middlewareCount:
            PIPELINE_ORDER.length,

        pipeline:
            [...PIPELINE_ORDER],

        available:
            list()

    });

}

/**
 * Retrieve middleware by name.
 *
 * @param {string} name
 * @returns {*}
 */
function get(name) {

    return load(name);

}

/**
 * Determine whether middleware exists.
 *
 * @param {string} name
 * @returns {boolean}
 */
function has(name) {

    return Object.prototype.hasOwnProperty.call(
        middlewareLoaders,
        name
    );

}

/**
 * Freeze public API.
 */
module.exports = Object.freeze({

    /**
     * Individual middleware exports.
     */
    trustProxy:
        load('trustProxy'),

    requestId:
        load('requestId'),

    correlationId:
        load('correlationId'),

    requestContext:
        load('requestContext'),

    requestLogger:
        load('requestLogger'),

    requestMetrics:
        load('requestMetrics'),

    /**
     * Registry API.
     */
    VERSION,

    PIPELINE_ORDER,

    get,

    has,

    list,

    pipeline,

    health,

    diagnostics

});