'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/routes/index.js
 *
 * Purpose:
 *   Enterprise production-grade HTTP route registration boundary.
 *
 * Responsibilities:
 *   - Register application API routes.
 *   - Register liveness/readiness/health endpoints.
 *   - Register operational metrics endpoint when available.
 *   - Register controlled internal diagnostics.
 *   - Centralize route prefixes.
 *   - Validate the Express application contract.
 *   - Prevent accidental duplicate route registration.
 *   - Preserve deterministic route ordering.
 *   - Normalize route-not-found errors.
 *   - Integrate with TITech runtime/readiness state.
 *   - Keep routing separate from middleware, controllers and business logic.
 *
 * This module does NOT:
 *   - initialize databases.
 *   - initialize Redis.
 *   - initialize queues.
 *   - initialize Socket.IO.
 *   - execute financial operations.
 *   - implement authentication.
 *   - implement authorization.
 *   - start the HTTP server.
 *   - own global middleware.
 *
 * =============================================================================
 *
 * Route architecture:
 *
 *   backend/bootstrap/app.js
 *            │
 *            ▼
 *      registerRoutes(app)
 *            │
 *      ┌─────┴────────────────────┐
 *      ▼                          ▼
 *   runtime routes             API routes
 *      │                          │
 *      ├── /live                  ├── /api/auth
 *      ├── /ready                 ├── /api/legal
 *      ├── /health                └── /api/email
 *      └── /metrics
 *
 * =============================================================================
 */

const {
    getApplicationState,
    getHealthState,
    isReady,
    isLive
} = require('../runtime/state');

/**
 * =============================================================================
 * Optional configuration
 * =============================================================================
 */

let configuration = null;

try {

    // eslint-disable-next-line global-require
    configuration =
        require('../config/configProvider');

} catch {

    configuration =
        null;

}

/**
 * =============================================================================
 * Optional observability
 * =============================================================================
 */

let observability = null;

try {

    // eslint-disable-next-line global-require
    observability =
        require('../bootstrap/observability');

} catch {

    observability =
        null;

}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'routes';

const DEFAULT_API_PREFIX =
    '/api';

const DEFAULT_HEALTH_PREFIX =
    '';

const DEFAULT_DIAGNOSTICS_PATH =
    '/health/diagnostics';

const DEFAULT_METRICS_PATH =
    '/metrics';

const DEFAULT_LIVE_PATH =
    '/live';

const DEFAULT_READY_PATH =
    '/ready';

const DEFAULT_HEALTH_PATH =
    '/health';

/**
 * =============================================================================
 * Internal runtime state
 * =============================================================================
 */

let routesRegistered =
    false;

let registrationStarted =
    false;

let registrationCompleted =
    false;

let registrationError =
    null;

let registrationTimestamp =
    null;

const registeredRouteGroups =
    new Set();

/**
 * =============================================================================
 * Route groups
 * =============================================================================
 */

const ROUTE_GROUPS =
    Object.freeze({
        API:
            'api',

        HEALTH:
            'health',

        DIAGNOSTICS:
            'diagnostics',

        METRICS:
            'metrics',

        NOT_FOUND:
            'not_found'
    });

/**
 * =============================================================================
 * Logger
 * =============================================================================
 */

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule
        );

    } catch {

        return null;

    }

}

function log(
    level,
    metadata,
    message
) {

    try {

        const logger =
            getLogger();

        if (
            logger &&
            typeof logger[level] ===
                'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    ...metadata
                },
                message
            );

            return;

        }

    } catch {

        // Logging failures must not prevent route registration.

    }

    const text =
        `[${COMPONENT}] ${message}`;

    if (
        level === 'error' ||
        level === 'fatal'
    ) {

        process.stderr.write(
            `${text}\n`
        );

    } else {

        process.stdout.write(
            `${text}\n`
        );

    }

}

/**
 * =============================================================================
 * Configuration helpers
 * =============================================================================
 */

function getConfig(
    path,
    fallback = undefined
) {

    try {

        if (
            typeof configuration?.get ===
                'function'
        ) {

            return configuration.get(
                path,
                fallback
            );

        }

        if (
            typeof configuration?.getObject ===
                'function'
        ) {

            return configuration.getObject(
                path,
                fallback
            );

        }

    } catch {

        // Fall through to fallback.

    }

    return fallback;

}

function getStringConfig(
    path,
    fallback
) {

    try {

        if (
            typeof configuration?.getString ===
                'function'
        ) {

            return configuration.getString(
                path,
                fallback
            );

        }

        if (
            typeof configuration?.get ===
                'function'
        ) {

            const value =
                configuration.get(
                    path,
                    fallback
                );

            return value ===
                    undefined ||
                value ===
                    null
                ? fallback
                : String(
                    value
                );

        }

    } catch {

        // Fall through.

    }

    return fallback;

}

function isProductionEnvironment() {

    try {

        if (
            typeof configuration?.isProduction ===
                'function'
        ) {

            return Boolean(
                configuration.isProduction()
            );

        }

        return (
            process.env.NODE_ENV ===
            'production'
        );

    } catch {

        return (
            process.env.NODE_ENV ===
            'production'
        );

    }

}

/**
 * =============================================================================
 * Route prefix resolution
 * =============================================================================
 */

function getApiPrefix() {

    const configured =
        getStringConfig(
            'api.prefix',
            DEFAULT_API_PREFIX
        );

    const normalized =
        String(
            configured ||
                DEFAULT_API_PREFIX
        )
            .trim()
            .replace(
                /\/+/g,
                '/'
            );

    if (
        normalized === '/'
    ) {

        return '';

    }

    return normalized.startsWith('/')
        ? normalized.replace(
            /\/$/,
            ''
        )
        : `/${normalized.replace(
            /\/$/,
            ''
        )}`;

}

function joinRoutePath(
    prefix,
    path
) {

    const normalizedPrefix =
        String(
            prefix ||
                ''
        )
            .trim()
            .replace(
                /\/$/,
                ''
            );

    const normalizedPath =
        String(
            path ||
                ''
        )
            .trim()
            .replace(
                /^\/+/,
                ''
            );

    if (
        !normalizedPrefix
    ) {

        return (
            normalizedPath
                ? `/${normalizedPath}`
                : '/'
        );

    }

    return normalizedPath
        ? `${normalizedPrefix}/${normalizedPath}`
        : normalizedPrefix;

}

/**
 * =============================================================================
 * Express application contract
 * =============================================================================
 */

function assertExpressApplication(
    app
) {

    if (
        !app ||
        typeof app.use !==
            'function'
    ) {

        throw new TypeError(
            'TITech route registration requires a valid Express application.'
        );

    }

    if (
        typeof app.get !==
            'function'
    ) {

        throw new TypeError(
            'TITech route registration requires Express application.get().'
        );

    }

    if (
        typeof app.set !==
            'function'
    ) {

        log(
            'warn',
            {},
            'Express application.set() is unavailable; route metadata will not be attached.'
        );

    }

    return true;

}

/**
 * =============================================================================
 * Route registration guards
 * =============================================================================
 */

function isGroupRegistered(
    group
) {

    return registeredRouteGroups.has(
        group
    );

}

function markGroupRegistered(
    group
) {

    registeredRouteGroups.add(
        group
    );

}

/**
 * =============================================================================
 * API routes
 * =============================================================================
 *
 * Individual route modules remain authoritative for:
 *   - authentication
 *   - validation
 *   - controllers
 *   - services
 *   - authorization
 *
 * This module only mounts them.
 * =============================================================================
 */

function registerApiRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.API
        )
    ) {

        return app;

    }

    const apiPrefix =
        getApiPrefix();

    /**
     * -------------------------------------------------------------------------
     * Authentication
     * -------------------------------------------------------------------------
     */

    const authRoutes =
        require('./auth');

    if (
        authRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/auth'
            ),
            authRoutes
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Legal
     * -------------------------------------------------------------------------
     */

    const legalRoutes =
        require('./legal.routes');

    if (
        legalRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/legal'
            ),
            legalRoutes
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Email
     * -------------------------------------------------------------------------
     */

    const emailRoutes =
        require('./email');

    if (
        emailRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/email'
            ),
            emailRoutes
        );

    }

    markGroupRegistered(
        ROUTE_GROUPS.API
    );

    return app;

}

/**
 * =============================================================================
 * Liveness
 * =============================================================================
 *
 * Liveness intentionally does not check dependencies.
 *
 * Kubernetes/container orchestrators should not restart a healthy process merely
 * because MongoDB/Redis is temporarily unavailable.
 * =============================================================================
 */

function buildLivenessResponse() {

    const live =
        Boolean(
            isLive()
        );

    return {
        success:
            live,

        alive:
            live,

        status:
            live
                ? 'live'
                : 'stopped',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        application:
            getStringConfig(
                'app.name',
                process.env.APP_NAME ||
                    'titech-community-capital'
            ),

        version:
            getStringConfig(
                'app.version',
                process.env.APP_VERSION ||
                    '0.0.0'
            ),

        uptimeSeconds:
            process.uptime(),

        timestamp:
            new Date().toISOString()
    };

}

function registerLivenessRoute(
    app
) {

    const path =
        getStringConfig(
            'api.livenessPath',
            DEFAULT_LIVE_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildLivenessResponse();

            return res
                .status(
                    response.success
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

function buildReadinessResponse() {

    const ready =
        Boolean(
            isReady()
        );

    const health =
        getHealthState() ||
        {};

    return {
        success:
            ready,

        ready,

        status:
            ready
                ? 'ready'
                : 'not_ready',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        phase:
            health.phase ||
            null,

        healthy:
            Boolean(
                health.healthy
            ),

        live:
            Boolean(
                health.live
            ),

        started:
            Boolean(
                health.started
            ),

        starting:
            Boolean(
                health.starting
            ),

        shuttingDown:
            Boolean(
                health.shuttingDown
            ),

        stopped:
            Boolean(
                health.stopped
            ),

        failed:
            Boolean(
                health.failed
            ),

        timestamp:
            new Date().toISOString()
    };

}

function registerReadinessRoute(
    app
) {

    const path =
        getStringConfig(
            'api.readinessPath',
            DEFAULT_READY_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildReadinessResponse();

            return res
                .status(
                    response.ready
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * General health
 * =============================================================================
 */

function buildHealthResponse() {

    const health =
        getHealthState() ||
        {};

    const healthy =
        Boolean(
            health.healthy
        ) &&
        !health.failed;

    return {
        success:
            healthy,

        status:
            healthy
                ? 'healthy'
                : 'degraded',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        application:
            getStringConfig(
                'app.name',
                process.env.APP_NAME ||
                    'titech-community-capital'
            ),

        version:
            getStringConfig(
                'app.version',
                process.env.APP_VERSION ||
                    '0.0.0'
            ),

        live:
            Boolean(
                health.live
            ),

        ready:
            Boolean(
                health.ready
            ),

        healthy:
            Boolean(
                health.healthy
            ),

        started:
            Boolean(
                health.started
            ),

        starting:
            Boolean(
                health.starting
            ),

        shuttingDown:
            Boolean(
                health.shuttingDown
            ),

        stopped:
            Boolean(
                health.stopped
            ),

        failed:
            Boolean(
                health.failed
            ),

        phase:
            health.phase ||
            null,

        lastHealthCheck:
            health.lastHealthCheck ||
            null,

        uptimeSeconds:
            process.uptime(),

        timestamp:
            new Date().toISOString()
    };

}

function registerHealthRoute(
    app
) {

    const path =
        getStringConfig(
            'api.healthPath',
            DEFAULT_HEALTH_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildHealthResponse();

            return res
                .status(
                    response.success
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * Metrics
 * =============================================================================
 *
 * Metrics implementation remains owned by observability.
 *
 * This module only exposes the existing metrics handler.
 * =============================================================================
 */

function registerMetricsRoute(
    app
) {

    if (
        isGroupRegistered(
            ROUTE_GROUPS.METRICS
        )
    ) {

        return app;

    }

    const metricsEnabled =
        getConfig(
            'observability.metricsEnabled',
            getConfig(
                'features.metrics',
                true
            )
        );

    if (
        metricsEnabled ===
            false
    ) {

        markGroupRegistered(
            ROUTE_GROUPS.METRICS
        );

        return app;

    }

    const metricsPath =
        getStringConfig(
            'api.metricsPath',
            DEFAULT_METRICS_PATH
        );

    let metricsHandler =
        null;

    try {

        if (
            typeof observability?.metricsHandler ===
                'function'
        ) {

            metricsHandler =
                observability.metricsHandler();

        } else if (
            typeof observability?.observability?.metricsHandler ===
                'function'
        ) {

            metricsHandler =
                observability.observability.metricsHandler();

        }

    } catch (
        error
    ) {

        log(
            'warn',
            {
                error:
                    {
                        name:
                            error?.name,

                        message:
                            error?.message
                    }
            },
            'TITech observability metrics handler could not be initialized.'
        );

    }

    /**
     * Metrics should not be exposed through a broken placeholder endpoint.
     * Only register the endpoint when the canonical observability subsystem
     * provides it.
     */
    if (
        typeof metricsHandler ===
            'function'
    ) {

        app.get(
            metricsPath,
            metricsHandler
        );

        markGroupRegistered(
            ROUTE_GROUPS.METRICS
        );

        return app;

    }

    log(
        'warn',
        {},
        'TITech metrics endpoint was not registered because no metrics handler is available.'
    );

    return app;

}

/**
 * =============================================================================
 * Runtime health routes
 * =============================================================================
 */

function registerHealthRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.HEALTH
        )
    ) {

        return app;

    }

    registerLivenessRoute(
        app
    );

    registerReadinessRoute(
        app
    );

    registerHealthRoute(
        app
    );

    markGroupRegistered(
        ROUTE_GROUPS.HEALTH
    );

    return app;

}

/**
 * =============================================================================
 * Internal diagnostics
 * =============================================================================
 *
 * Diagnostics are intentionally unavailable in production unless explicitly
 * enabled AND authorized by a future security boundary.
 *
 * This route therefore defaults to 404 in production.
 * =============================================================================
 */

function isDiagnosticsEnabled() {

    const explicit =
        getConfig(
            'health.diagnosticsEnabled',
            undefined
        );

    if (
        explicit !==
            undefined
    ) {

        return Boolean(
            explicit
        );

    }

    return (
        !isProductionEnvironment()
    );

}

function buildDiagnosticsResponse(
    app
) {

    const state =
        getApplicationState();

    const health =
        getHealthState();

    let configurationSnapshot =
        null;

    try {

        configurationSnapshot =
            typeof configuration?.snapshot ===
                'function'
                ? configuration.snapshot()
                : null;

    } catch {

        configurationSnapshot =
            null;

    }

    let observabilitySnapshot =
        null;

    try {

        if (
            typeof observability?.snapshot ===
                'function'
        ) {

            observabilitySnapshot =
                observability.snapshot();

        } else if (
            typeof observability?.observability?.snapshot ===
                'function'
        ) {

            observabilitySnapshot =
                observability.observability.snapshot();

        }

    } catch {

        observabilitySnapshot =
            null;

    }

    return {
        success:
            true,

        component:
            COMPONENT,

        timestamp:
            new Date().toISOString(),

        application:
            {
                name:
                    getStringConfig(
                        'app.name',
                        process.env.APP_NAME ||
                            'titech-community-capital'
                    ),

                service:
                    getStringConfig(
                        'app.serviceName',
                        process.env.SERVICE_NAME ||
                            'titech-backend'
                    ),

                version:
                    getStringConfig(
                        'app.version',
                        process.env.APP_VERSION ||
                            '0.0.0'
                    ),

                environment:
                    getStringConfig(
                        'app.environment',
                        process.env.NODE_ENV ||
                            'development'
                    )
            },

        runtime:
            {
                node:
                    process.version,

                pid:
                    process.pid,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                uptimeSeconds:
                    process.uptime()
            },

        routes:
            {
                registered:
                    routesRegistered,

                registrationStarted,

                registrationCompleted,

                registrationTimestamp,

                groups:
                    [
                        ...registeredRouteGroups
                    ]
            },

        state,

        health,

        configuration:
            configurationSnapshot,

        observability:
            observabilitySnapshot
    };

}

function registerDiagnosticRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.DIAGNOSTICS
        )
    ) {

        return app;

    }

    if (
        !isDiagnosticsEnabled()
    ) {

        markGroupRegistered(
            ROUTE_GROUPS.DIAGNOSTICS
        );

        return app;

    }

    app.get(
        DEFAULT_DIAGNOSTICS_PATH,
        (
            req,
            res
        ) => {

            /**
             * Production defense-in-depth.
             */
            if (
                isProductionEnvironment()
            ) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        code:
                            'NOT_FOUND',

                        message:
                            'Not found.'
                    });

            }

            return res
                .status(200)
                .json(
                    buildDiagnosticsResponse(
                        app
                    )
                );

        }
    );

    markGroupRegistered(
        ROUTE_GROUPS.DIAGNOSTICS
    );

    return app;

}

/**
 * =============================================================================
 * Route-not-found error
 * =============================================================================
 */

function createRouteNotFoundError(
    req
) {

    const error =
        new Error(
            `Route not found: ${req.method} ${req.originalUrl}`
        );

    error.name =
        'RouteNotFoundError';

    error.code =
        'ROUTE_NOT_FOUND';

    error.status =
        404;

    error.statusCode =
        404;

    error.expose =
        true;

    error.method =
        req.method;

    error.path =
        req.path ||
        req.originalUrl;

    return error;

}

function registerNotFoundHandler(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.NOT_FOUND
        )
    ) {

        return app;

    }

    app.use(
        (
            req,
            res,
            next
        ) => {

            return next(
                createRouteNotFoundError(
                    req
                )
            );

        }
    );

    markGroupRegistered(
        ROUTE_GROUPS.NOT_FOUND
    );

    return app;

}

/**
 * =============================================================================
 * Route metadata
 * =============================================================================
 */

function attachRouteMetadata(
    app
) {

    try {

        if (
            typeof app.set ===
                'function'
        ) {

            app.set(
                'titech.routesRegistered',
                true
            );

            app.set(
                'titech.routeRegistrationTimestamp',
                registrationTimestamp
            );

            app.set(
                'titech.routeGroups',
                Object.freeze(
                    [
                        ...registeredRouteGroups
                    ]
                )
            );

        }

    } catch {

        // Metadata is optional.

    }

}

/**
 * =============================================================================
 * Main registration boundary
 * =============================================================================
 */

function registerRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    /**
     * Duplicate invocation protection.
     */
    if (
        routesRegistered
    ) {

        return app;

    }

    registrationStarted =
        true;

    registrationError =
        null;

    try {

        /**
         * ---------------------------------------------------------------------
         * API routes
         * ---------------------------------------------------------------------
         */

        registerApiRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Health / runtime routes
         * ---------------------------------------------------------------------
         */

        registerHealthRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        registerMetricsRoute(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        registerDiagnosticRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * NOT FOUND
         * ---------------------------------------------------------------------
         *
         * This MUST be last among normal route definitions.
         */

        registerNotFoundHandler(
            app
        );

        registrationCompleted =
            true;

        routesRegistered =
            true;

        registrationTimestamp =
            new Date();

        attachRouteMetadata(
            app
        );

        log(
            'info',
            {
                routeGroups:
                    [
                        ...registeredRouteGroups
                    ],

                apiPrefix:
                    getApiPrefix()
            },
            'TITech HTTP routes registered successfully.'
        );

        return app;

    } catch (
        error
    ) {

        registrationError =
            error;

        registrationCompleted =
            false;

        routesRegistered =
            false;

        log(
            'error',
            {
                error:
                    {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message,

                        stack:
                            error?.stack
                    }
            },
            'TITech HTTP route registration failed.'
        );

        throw error;

    }

}

/**
 * =============================================================================
 * Route registration state
 * =============================================================================
 */

function getRouteState() {

    return Object.freeze({
        component:
            COMPONENT,

        registered:
            routesRegistered,

        registrationStarted,

        registrationCompleted,

        registrationTimestamp,

        error:
            registrationError
                ? {
                    name:
                        registrationError.name,

                    code:
                        registrationError.code,

                    message:
                        registrationError.message
                }
                : null,

        groups:
            Object.freeze(
                [
                    ...registeredRouteGroups
                ]
            )
    });

}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Test/process isolation only.
 *
 * Express route stacks cannot safely be removed from a running production
 * application, so reset is limited to module bookkeeping. A new Express app
 * should be created for tests.
 * =============================================================================
 */

function resetRouteState() {

    routesRegistered =
        false;

    registrationStarted =
        false;

    registrationCompleted =
        false;

    registrationError =
        null;

    registrationTimestamp =
        null;

    registeredRouteGroups.clear();

    return true;

}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Main registration.
         */
        registerRoutes,

        /**
         * API.
         */
        registerApiRoutes,

        /**
         * Runtime health.
         */
        registerHealthRoutes,

        registerLivenessRoute,

        registerReadinessRoute,

        registerHealthRoute,

        /**
         * Metrics.
         */
        registerMetricsRoute,

        /**
         * Diagnostics.
         */
        registerDiagnosticRoutes,

        /**
         * 404.
         */
        registerNotFoundHandler,

        /**
         * Helpers.
         */
        buildLivenessResponse,

        buildReadinessResponse,

        buildHealthResponse,

        buildDiagnosticsResponse,

        createRouteNotFoundError,

        getApiPrefix,

        joinRoutePath,

        /**
         * State.
         */
        getRouteState,

        resetRouteState,

        /**
         * Constants.
         */
        COMPONENT,

        ROUTE_GROUPS

    });