'use strict';

/**
 * -----------------------------------------------------------------------------
 * TITech Community Capital LTD
 * -----------------------------------------------------------------------------
 * File: backend/middleware/core/trustProxy.js
 * -----------------------------------------------------------------------------
 * Enterprise Features Summary
 * -----------------------------------------------------------------------------
 * • Configures Express trust proxy from the enterprise configuration provider
 * • Supports:
 *      - Boolean
 *      - Hop count (Number)
 *      - Single IP/Subnet
 *      - Array of IPs/Subnets
 *      - Comma-separated IP list
 *      - Custom trust function
 * • Prevents duplicate configuration
 * • Emits startup diagnostics
 * • Production-ready for:
 *      - Nginx
 *      - HAProxy
 *      - Docker
 *      - Kubernetes
 *      - AWS ALB / ELB
 *      - Azure
 *      - Google Cloud
 * • Safe defaults
 * • Immutable diagnostics
 * -----------------------------------------------------------------------------
 */

const DEFAULT_SETTING = false;

const CONFIGURED_SYMBOL = Symbol.for(
    'titech.middleware.trustProxy.configured'
);

/**
 * Creates a trust proxy middleware installer.
 *
 * This module configures the Express application during bootstrap.
 * It does NOT participate in the request pipeline.
 *
 * @param {Object} options
 * @param {Object} options.config Enterprise Configuration Provider
 * @param {Object} [options.logger]
 * @returns {Function}
 */
function createTrustProxy({
    config,
    logger
} = {}) {

    /**
     * Configure Express trust proxy.
     *
     * @param {import('express').Application} app
     */
    return function configureTrustProxy(app) {

        if (!app || typeof app.set !== 'function') {
            throw new TypeError(
                'A valid Express application instance is required.'
            );
        }

        /*
         * Prevent duplicate initialization.
         */
        if (app[CONFIGURED_SYMBOL]) {

            emitDiagnostic(
                logger,
                'debug',
                'Express trust proxy already configured.',
                {
                    component: 'trust-proxy',
                    duplicate: true
                }
            );

            return app;
        }

        const trustProxy = resolveTrustProxyConfiguration(config);

        app.set('trust proxy', trustProxy);

        Object.defineProperty(
            app,
            CONFIGURED_SYMBOL,
            {
                value: true,
                enumerable: false,
                configurable: false,
                writable: false
            }
        );

        emitDiagnostic(
            logger,
            'info',
            'Express trust proxy configured.',
            {
                component: 'trust-proxy',
                value: describeTrustProxy(trustProxy)
            }
        );

        return app;
    };
}

/**
 * Resolve trust proxy configuration.
 *
 * Supported values:
 *
 * false
 * true
 * 1
 * 2
 * "loopback"
 * "linklocal"
 * "uniquelocal"
 * "10.0.0.0/8"
 * "127.0.0.1"
 * "10.0.0.0/8,192.168.0.0/16"
 * ["10.0.0.0/8","192.168.0.0/16"]
 * function(ip){}
 */
function resolveTrustProxyConfiguration(config) {

    const value = readConfiguration(config);

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return DEFAULT_SETTING;
    }

    /*
     * Boolean
     */
    if (typeof value === 'boolean') {
        return value;
    }

    /*
     * Custom function
     */
    if (typeof value === 'function') {
        return value;
    }

    /*
     * Hop count
     */
    if (
        typeof value === 'number' &&
        Number.isInteger(value)
    ) {
        return Math.max(0, value);
    }

    /*
     * Array of trusted proxies/subnets.
     */
    if (Array.isArray(value)) {

        return value
            .map(String)
            .map(item => item.trim())
            .filter(Boolean);
    }

    /*
     * Strings
     */
    if (typeof value === 'string') {

        const normalized = value.trim();

        const lower = normalized.toLowerCase();

        if (
            lower === 'true'
        ) {
            return true;
        }

        if (
            lower === 'false'
        ) {
            return false;
        }

        if (
            /^\d+$/.test(normalized)
        ) {
            return Number(normalized);
        }

        /*
         * Comma separated list
         */
        if (
            normalized.includes(',')
        ) {

            return normalized
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
        }

        /*
         * Single subnet/IP/name.
         */
        return normalized;
    }

    return DEFAULT_SETTING;
}

/**
 * Reads enterprise configuration.
 */
function readConfiguration(config) {

    if (!config) {
        return DEFAULT_SETTING;
    }

    /*
     * Enterprise provider namespace.
     */
    if (
        typeof config.server === 'function'
    ) {

        const server = config.server();

        if (
            server &&
            Object.prototype.hasOwnProperty.call(
                server,
                'trustProxy'
            )
        ) {
            return server.trustProxy;
        }
    }

    /*
     * Generic getter.
     */
    if (
        typeof config.get === 'function'
    ) {

        const value =
            config.get(
                'server.trustProxy'
            );

        if (
            value !== undefined
        ) {
            return value;
        }
    }

    /*
     * Plain object fallback.
     */
    if (
        config.server &&
        Object.prototype.hasOwnProperty.call(
            config.server,
            'trustProxy'
        )
    ) {
        return config.server.trustProxy;
    }

    return DEFAULT_SETTING;
}

/**
 * Human-readable diagnostics.
 */
function describeTrustProxy(value) {

    if (typeof value === 'function') {
        return 'Custom Function';
    }

    if (Array.isArray(value)) {
        return value.join(', ');
    }

    return value;
}

/**
 * Emit startup diagnostics.
 */
function emitDiagnostic(
    logger,
    level,
    message,
    metadata
) {

    if (
        logger &&
        typeof logger[level] === 'function'
    ) {

        logger[level](message, metadata);
        return;
    }

    if (
        process.env.NODE_ENV !== 'test'
    ) {

        console.info(
            `[TrustProxy] ${message}`,
            metadata
        );
    }
}

module.exports = createTrustProxy;