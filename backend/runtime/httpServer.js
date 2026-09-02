"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise HTTP Server Runtime
 * =============================================================================
 *
 * File:
 *   backend/runtime/httpServer.js
 *
 * Purpose:
 *   Production-grade HTTP/HTTPS/HTTP2 server lifecycle manager for TITech
 *   Community Capital services.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ Express / Koa application hosting
 *   ✓ HTTP and optional HTTPS
 *   ✓ Optional HTTP/2 secure transport
 *   ✓ Request ID / trace ID propagation
 *   ✓ Runtime context integration
 *   ✓ Socket tracking
 *   ✓ Graceful shutdown / connection draining
 *   ✓ Startup rollback on partial failure
 *   ✓ Health / readiness endpoints
 *   ✓ Prometheus integration
 *   ✓ Optional security middleware
 *   ✓ Compression
 *   ✓ CORS
 *   ✓ Request metrics hooks
 *   ✓ WebSocket upgrade preservation
 *   ✓ TLS loader / file-based TLS
 *   ✓ Runtime diagnostics
 *   ✓ Signal handling
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   - The HTTP server owns transport lifecycle, not business logic.
 *   - The application factory owns application composition.
 *   - Financial transaction logic remains outside this module.
 *   - Tenant resolution remains outside this module.
 *   - This module must not silently disable mandatory security controls.
 *   - Shutdown is idempotent.
 *   - Partial startup failures are rolled back.
 *
 * Supported appFactory contract:
 *
 *   async function appFactory({ logger, metrics }) {
 *
 *       return {
 *           type: "express",
 *           app,
 *
 *           healthcheck: async () => ({
 *               ok: true
 *           }),
 *
 *           readiness: async () => ({
 *               ready: true
 *           }),
 *
 *           close: async () => {
 *               // application resource cleanup
 *           }
 *       };
 *   }
 *
 * Public API
 * -----------------------------------------------------------------------------
 *
 *   const {
 *       createHttpServer,
 *       startServer,
 *       stopServer
 *   } = require("./runtime/httpServer");
 *
 *   const manager =
 *       await createHttpServer({
 *           appFactory
 *       });
 *
 *   await startServer(manager);
 *
 * =============================================================================
 */

const http = require("http");
const https = require("https");
const http2 = require("http2");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const EventEmitter = require("events");

const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");

const context = require("./context");
const runtimeEvents = require("./events");

// =============================================================================
// Optional Dependencies
// =============================================================================

let onFinished = null;

try {
    onFinished = require("on-finished");
} catch {
    onFinished = null;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULTS = Object.freeze({

    HOST:
        process.env.HOST ||
        "0.0.0.0",

    PORT:
        Number(
            process.env.PORT ||
            3000
        ),

    ENABLE_HTTP:
        process.env.ENABLE_HTTP !== "false",

    ENABLE_HTTPS:
        process.env.ENABLE_HTTPS === "true",

    ENABLE_HTTP2:
        process.env.ENABLE_HTTP2 === "true",

    HTTPS_PORT:
        Number(
            process.env.HTTPS_PORT ||
            3443
        ),

    TLS_KEY_PATH:
        process.env.TLS_KEY_PATH ||
        null,

    TLS_CERT_PATH:
        process.env.TLS_CERT_PATH ||
        null,

    TLS_CA_PATH:
        process.env.TLS_CA_PATH ||
        null,

    TLS_MIN_VERSION:
        process.env.TLS_MIN_VERSION ||
        "TLSv1.2",

    REQUEST_ID_HEADER:
        process.env.REQUEST_ID_HEADER ||
        "x-request-id",

    TRACE_ID_HEADER:
        process.env.TRACE_ID_HEADER ||
        "x-trace-id",

    CORRELATION_ID_HEADER:
        process.env.CORRELATION_ID_HEADER ||
        "x-correlation-id",

    BODY_LIMIT:
        process.env.BODY_LIMIT ||
        "1mb",

    TRUST_PROXY:
        process.env.TRUST_PROXY === "true",

    KEEP_ALIVE_TIMEOUT_MS:
        Number(
            process.env.KEEP_ALIVE_TIMEOUT_MS ||
            61_000
        ),

    HEADERS_TIMEOUT_MS:
        Number(
            process.env.HEADERS_TIMEOUT_MS ||
            65_000
        ),

    REQUEST_TIMEOUT_MS:
        Number(
            process.env.REQUEST_TIMEOUT_MS ||
            60_000
        ),

    GRACEFUL_SHUTDOWN_TIMEOUT_MS:
        Number(
            process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ||
            30_000
        ),

    SOCKET_DRAIN_INTERVAL_MS:
        Number(
            process.env.SOCKET_DRAIN_INTERVAL_MS ||
            100
        ),

    BODY_PARSER_ENABLED:
        process.env.HTTP_BODY_PARSER_ENABLED !== "false",

    SECURITY_HEADERS_ENABLED:
        process.env.HTTP_SECURITY_HEADERS_ENABLED !== "false",

    COMPRESSION_ENABLED:
        process.env.HTTP_COMPRESSION_ENABLED !== "false",

    CORS_ENABLED:
        process.env.HTTP_CORS_ENABLED !== "false",

    REQUEST_LOGGING_ENABLED:
        process.env.HTTP_REQUEST_LOGGING_ENABLED !== "false",

    RATE_LIMIT_ENABLED:
        process.env.HTTP_RATE_LIMIT_ENABLED !== "false",

    RATE_LIMIT_WINDOW_MS:
        Number(
            process.env.HTTP_RATE_LIMIT_WINDOW_MS ||
            60_000
        ),

    RATE_LIMIT_MAX:
        Number(
            process.env.HTTP_RATE_LIMIT_MAX ||
            1_200
        ),

    HEALTH_PATH:
        process.env.HEALTH_PATH ||
        "/health",

    READINESS_PATH:
        process.env.READINESS_PATH ||
        "/ready",

    METRICS_PATH:
        process.env.METRICS_PATH ||
        "/metrics",

    META_PATH:
        process.env.HTTP_META_PATH ||
        "/_meta",

    LOG_PREFIX:
        "TITech.HttpServer",

    ENABLE_PROMETHEUS:
        process.env.ENABLE_PROMETHEUS === "true",

    PROM_CLIENT:
        null,

    ENABLE_WEBSOCKET:
        process.env.ENABLE_WEBSOCKET === "true",

    SERVER_NAME:
        process.env.SERVER_NAME ||
        "titech-http-server",

    VERSION:
        process.env.APP_VERSION ||
        "1.0.0"

});

// =============================================================================
// Helpers
// =============================================================================

function nowIso() {
    return new Date().toISOString();
}

function randomRequestId() {

    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return `req-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
}

function safeStringify(value) {

    try {
        return JSON.stringify(
            value
        );
    } catch {
        return String(
            value
        );
    }
}

function normalizeHeaderName(
    value
) {

    return String(
        value ||
        ""
    ).trim().toLowerCase();

}

function readHeader(
    req,
    name
) {

    if (
        !req ||
        !req.headers ||
        !name
    ) {
        return null;
    }

    const key =
        normalizeHeaderName(
            name
        );

    const value =
        req.headers[key];

    if (
        Array.isArray(value)
    ) {
        return value[0] || null;
    }

    return value ||
        null;

}

function writeResponseHeader(
    res,
    name,
    value
) {

    if (
        !res ||
        typeof res.setHeader !==
            "function"
    ) {
        return;
    }

    try {

        res.setHeader(
            name,
            value
        );

    } catch {
        // Ignore attempts to modify already-closed responses.
    }

}

function serializeError(
    error
) {

    if (!error) {
        return null;
    }

    return {

        name:
            error.name ||
            "Error",

        message:
            error.message ||
            String(error),

        code:
            error.code ||
            null,

        statusCode:
            error.statusCode ||
            error.status ||
            null,

        stack:
            process.env.NODE_ENV === "production"
                ? undefined
                : error.stack

    };

}

function promisifyClose(
    server
) {

    if (
        !server ||
        typeof server.close !==
            "function"
    ) {
        return Promise.resolve();
    }

    /*
     * Node's close(callback) can return immediately while active sockets
     * continue draining. The callback resolves only once the server closes.
     */
    return new Promise(
        (
            resolve,
            reject
        ) => {

            let settled =
                false;

            const finish = (
                error
            ) => {

                if (settled) {
                    return;
                }

                settled = true;

                if (error) {
                    reject(error);
                    return;
                }

                resolve();

            };

            try {

                server.close(
                    finish
                );

            } catch (error) {

                finish(
                    error
                );

            }

        }
    );

}

// =============================================================================
// ServerManager
// =============================================================================

class ServerManager
    extends EventEmitter {

    constructor(
        options = {}
    ) {

        super();

        this.options = Object.assign(
            {},
            DEFAULTS,
            options
        );

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.appFactory =
            options.appFactory ||
            null;

        this.server =
            null;

        this.secureServer =
            null;

        this.http2Server =
            null;

        this._appContext =
            null;

        this._connections =
            new Map();

        this._nextSocketId =
            1;

        this._started =
            false;

        this._starting =
            false;

        this._shuttingDown =
            false;

        this._shutdownPromise =
            null;

        this._signalsInstalled =
            false;

        this._requestCount =
            0;

        this._activeRequests =
            0;

        this._startedAt =
            null;

        this._tlsOptions =
            null;

        this._socketUpgradeListeners =
            [];

        this._runtimeFingerprint =
            context.RUNTIME_FINGERPRINT?.identifier ||
            null;

        this._healthPath =
            this.options.HEALTH_PATH;

        this._readinessPath =
            this.options.READINESS_PATH;

        this._metricsPath =
            this.options.METRICS_PATH;

        this._metaPath =
            this.options.META_PATH;

    }

    // =========================================================================
    // Public State
    // =========================================================================

    isStarted() {
        return this._started;
    }

    isStarting() {
        return this._starting;
    }

    isShuttingDown() {
        return this._shuttingDown;
    }

    getAppContext() {
        return this._appContext;
    }

    getActiveConnectionCount() {
        return this._connections.size;
    }

    getActiveRequestCount() {
        return this._activeRequests;
    }

    getRuntimeFingerprint() {
        return this._runtimeFingerprint;
    }

    // =========================================================================
    // Logging
    // =========================================================================

    _log(
        level,
        message,
        metadata = {}
    ) {

        try {

            if (
                this.logger &&
                typeof this.logger[level] ===
                    "function"
            ) {

                this.logger[level](
                    `${this.options.LOG_PREFIX} ${message}`,
                    metadata
                );

                return;
            }

            if (
                typeof console[level] ===
                "function"
            ) {

                console[level](
                    `${this.options.LOG_PREFIX} ${message}`,
                    metadata
                );

            }

        } catch {
            // Logging must never break server lifecycle.
        }

    }

    // =========================================================================
    // Metrics
    // =========================================================================

    _incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {

        try {

            if (
                this.metrics &&
                typeof this.metrics.increment ===
                    "function"
            ) {

                this.metrics.increment(
                    `titech.http.${name}`,
                    value,
                    labels
                );

            }

        } catch (error) {

            this._log(
                "warn",
                "metric increment failed",
                {
                    metric:
                        name,

                    error:
                        serializeError(
                            error
                        )
                }
            );

        }

    }

    _timingMetric(
        name,
        value,
        labels = {}
    ) {

        try {

            if (
                this.metrics &&
                typeof this.metrics.timing ===
                    "function"
            ) {

                this.metrics.timing(
                    `titech.http.${name}`,
                    value,
                    labels
                );

            }

        } catch (error) {

            this._log(
                "warn",
                "metric timing failed",
                {
                    metric:
                        name,

                    error:
                        serializeError(
                            error
                        )
                }
            );

        }

    }

    // =========================================================================
    // Request Context
    // =========================================================================

    _requestContextMiddleware() {

        const manager =
            this;

        return function requestContextMiddleware(
            req,
            res,
            next
        ) {

            const requestId =
                readHeader(
                    req,
                    manager.options.REQUEST_ID_HEADER
                ) ||
                randomRequestId();

            const traceId =
                readHeader(
                    req,
                    manager.options.TRACE_ID_HEADER
                ) ||
                null;

            const correlationId =
                readHeader(
                    req,
                    manager.options.CORRELATION_ID_HEADER
                ) ||
                requestId;

            writeResponseHeader(
                res,
                "X-Request-ID",
                requestId
            );

            writeResponseHeader(
                res,
                "X-Correlation-ID",
                correlationId
            );

            if (traceId) {

                writeResponseHeader(
                    res,
                    "X-Trace-ID",
                    traceId
                );

            }

            req.requestId =
                requestId;

            req.traceId =
                traceId;

            req.correlationId =
                correlationId;

            req.serverStartedAt =
                manager._startedAt;

            manager._requestCount +=
                1;

            manager._activeRequests +=
                1;

            manager._incrementMetric(
                "requests_total",
                1,
                {
                    method:
                        req.method
                }
            );

            const startedAt =
                process.hrtime.bigint();

            const finish =
                () => {

                    const endedAt =
                        process.hrtime.bigint();

                    const durationMs =
                        Number(
                            endedAt -
                            startedAt
                        ) /
                        1_000_000;

                    manager._activeRequests =
                        Math.max(
                            0,
                            manager._activeRequests -
                                1
                        );

                    manager._timingMetric(
                        "request_duration_ms",
                        durationMs,
                        {
                            method:
                                req.method,

                            status:
                                String(
                                    res.statusCode
                                )
                        }
                    );

                    manager._incrementMetric(
                        "responses_total",
                        1,
                        {
                            method:
                                req.method,

                            status:
                                String(
                                    res.statusCode
                                )
                        }
                    );

                    try {

                        if (
                            runtimeEvents &&
                            typeof runtimeEvents.emitEvent ===
                                "function"
                        ) {

                            runtimeEvents.emitEvent(
                                runtimeEvents.RUNTIME_EVENTS
                                    ?.REQUEST_COMPLETED ||
                                    "request.completed",
                                {
                                    requestId,
                                    correlationId,
                                    method:
                                        req.method,
                                    path:
                                        req.originalUrl ||
                                        req.url,
                                    statusCode:
                                        res.statusCode,
                                    durationMs
                                }
                            );

                        }

                    } catch {
                        // Event telemetry must not affect response handling.
                    }

                };

            if (
                onFinished
            ) {

                onFinished(
                    res,
                    finish
                );

            } else {

                res.once(
                    "finish",
                    finish
                );

                res.once(
                    "close",
                    finish
                );

            }

            try {

                if (
                    typeof context.enterContext ===
                    "function"
                ) {

                    context.enterContext({
                        requestId,
                        traceId,
                        correlationId,
                        req,
                        res
                    });

                    return next();

                }

                /*
                 * Newer TITech runtime.context implementations may expose a
                 * different context entry API. We therefore fall back to
                 * direct request metadata rather than failing the request.
                 */

                return next();

            } catch (error) {

                manager._log(
                    "error",
                    "request context initialization failed",
                    {
                        error:
                            serializeError(
                                error
                            ),
                        requestId
                    }
                );

                return next(
                    error
                );

            }

        };

    }

    // =========================================================================
    // Application Preparation
    // =========================================================================

    async _prepareApp() {

        if (
            typeof this.appFactory !==
            "function"
        ) {

            throw new TypeError(
                "TITech HTTP server requires appFactory."
            );

        }

        this._log(
            "info",
            "preparing application"
        );

        const appContext =
            await this.appFactory({
                logger:
                    this.logger,

                metrics:
                    this.metrics,

                serverManager:
                    this
            });

        if (
            !appContext ||
            !appContext.app
        ) {

            throw new TypeError(
                "appFactory must return an object containing { app }."
            );

        }

        const type =
            String(
                appContext.type ||
                "express"
            ).toLowerCase();

        if (
            type !== "express" &&
            type !== "koa"
        ) {

            throw new TypeError(
                `Unsupported application type "${type}". Expected "express" or "koa".`
            );

        }

        this._appContext =
            Object.assign(
                {},
                appContext,
                {
                    type
                }
            );

        if (
            type === "express"
        ) {

            this._prepareExpressApp(
                appContext.app
            );

        } else {

            this._prepareKoaApp(
                appContext.app
            );

        }

        return this._appContext;

    }

    // =========================================================================
    // Express Setup
    // =========================================================================

    _prepareExpressApp(
        app
    ) {

        if (
            typeof app.use !==
            "function"
        ) {

            throw new TypeError(
                "Express application must expose use()."
            );

        }

        if (
            this.options.TRUST_PROXY &&
            typeof app.set ===
                "function"
        ) {

            app.set(
                "trust proxy",
                true
            );

        }

        /*
         * IMPORTANT:
         * The application factory may already install security, CORS,
         * compression and parsers. These remain configurable so the runtime
         * layer does not have to force duplicate middleware.
         */
        if (
            this.options.SECURITY_HEADERS_ENABLED
        ) {

            app.use(
                helmet(
                    this.options.helmetOptions ||
                    {}
                )
            );

        }

        if (
            this.options.COMPRESSION_ENABLED
        ) {

            app.use(
                compression(
                    this.options.compressionOptions ||
                    {}
                )
            );

        }

        if (
            this.options.CORS_ENABLED
        ) {

            app.use(
                cors(
                    this.options.corsOptions ||
                    {}
                )
            );

        }

        if (
            this.options.BODY_PARSER_ENABLED
        ) {

            const express =
                require(
                    "express"
                );

            app.use(
                express.json({
                    limit:
                        this.options.BODY_LIMIT,

                    strict:
                        true
                })
            );

            app.use(
                express.urlencoded({
                    extended:
                        true,

                    limit:
                        this.options.BODY_LIMIT
                })
            );

        }

        app.use(
            this._requestContextMiddleware()
        );

        if (
            this.options.REQUEST_LOGGING_ENABLED
        ) {

            app.use(
                morgan(
                    (
                        tokens,
                        req,
                        res
                    ) => {

                        return [
                            req.requestId ||
                                "-",

                            req.correlationId ||
                                "-",

                            tokens.method(
                                req,
                                res
                            ),

                            tokens.url(
                                req,
                                res
                            ),

                            tokens.status(
                                req,
                                res
                            ),

                            tokens["response-time"](
                                req,
                                res
                            ),

                            "ms",

                            tokens.res(
                                req,
                                res,
                                "content-length"
                            ) ||
                                "-"

                        ].join(
                            " "
                        );

                    }
                )
            );

        }

        if (
            this.options.RATE_LIMIT_ENABLED
        ) {

            /*
             * The runtime limiter is intentionally conservative. Specialized
             * authentication/financial endpoints should still use their own
             * route-specific limiters.
             */
            app.use(
                rateLimit({

                    windowMs:
                        this.options
                            .RATE_LIMIT_WINDOW_MS,

                    max:
                        this.options
                            .RATE_LIMIT_MAX,

                    standardHeaders:
                        true,

                    legacyHeaders:
                        false,

                    skip:
                        req =>
                            Boolean(
                                req.path ===
                                this._healthPath ||
                                req.path ===
                                this._readinessPath
                            ),

                    handler:
                        (req, res) => {

                            this._incrementMetric(
                                "rate_limit_exceeded_total",
                                1,
                                {
                                    method:
                                        req.method
                                }
                            );

                            return res
                                .status(
                                    429
                                )
                                .json({
                                    success:
                                        false,

                                    code:
                                        "RATE_LIMITED",

                                    message:
                                        "Too many requests. Please try again later.",

                                    requestId:
                                        req.requestId,

                                    timestamp:
                                        nowIso()
                                });

                        }

                })
            );

        }

        this._attachHealthRoutesExpress(
            app
        );

        this._attachMetaRouteExpress(
            app
        );

        this._attachPrometheusEndpoint(
            app
        );

    }

    // =========================================================================
    // Koa Setup
    // =========================================================================

    _prepareKoaApp(
        app
    ) {

        if (
            typeof app.use !==
            "function"
        ) {

            throw new TypeError(
                "Koa application must expose use()."
            );

        }

        /*
         * Koa security middleware is intentionally not injected here because
         * Helmet is Express middleware. The Koa application should supply its
         * native security middleware.
         */

        const manager =
            this;

        app.use(
            async (
                ctx,
                next
            ) => {

                const requestId =
                    ctx.get(
                        manager.options
                            .REQUEST_ID_HEADER
                    ) ||
                    randomRequestId();

                const traceId =
                    ctx.get(
                        manager.options
                            .TRACE_ID_HEADER
                    ) ||
                    null;

                const correlationId =
                    ctx.get(
                        manager.options
                            .CORRELATION_ID_HEADER
                    ) ||
                    requestId;

                ctx.state =
                    ctx.state ||
                    {};

                ctx.state.requestId =
                    requestId;

                ctx.state.traceId =
                    traceId;

                ctx.state.correlationId =
                    correlationId;

                ctx.set(
                    "X-Request-ID",
                    requestId
                );

                ctx.set(
                    "X-Correlation-ID",
                    correlationId
                );

                if (traceId) {

                    ctx.set(
                        "X-Trace-ID",
                        traceId
                    );

                }

                manager._requestCount +=
                    1;

                manager._activeRequests +=
                    1;

                const startedAt =
                    process.hrtime.bigint();

                try {

                    await next();

                } finally {

                    const durationMs =
                        Number(
                            process.hrtime.bigint() -
                            startedAt
                        ) /
                        1_000_000;

                    manager._activeRequests =
                        Math.max(
                            0,
                            manager._activeRequests -
                                1
                        );

                    manager._timingMetric(
                        "request_duration_ms",
                        durationMs,
                        {
                            method:
                                ctx.method,

                            status:
                                String(
                                    ctx.status
                                )
                        }
                    );

                }

            }
        );

        this._attachHealthRoutesKoa(
            app
        );

        this._attachMetaRouteKoa(
            app
        );

        this._attachPrometheusEndpoint(
            app
        );

    }

    // =========================================================================
    // Health / Readiness
    // =========================================================================

    async _runHealthcheck() {

        if (
            this._appContext &&
            typeof this._appContext.healthcheck ===
                "function"
        ) {

            return this._appContext.healthcheck();

        }

        return {
            ok:
                true
        };

    }

    async _runReadiness() {

        if (
            this._shuttingDown
        ) {

            return {
                ready:
                    false,

                reason:
                    "server_shutting_down"
            };

        }

        if (
            this._appContext &&
            typeof this._appContext.readiness ===
                "function"
        ) {

            return this._appContext.readiness();

        }

        return {
            ready:
                this._started
        };

    }

    _attachHealthRoutesExpress(
        app
    ) {

        app.get(
            this._healthPath,
            async (
                req,
                res
            ) => {

                try {

                    const result =
                        await this._runHealthcheck();

                    const healthy =
                        Boolean(
                            result &&
                            (
                                result.ok !==
                                    false
                            )
                        );

                    return res
                        .status(
                            healthy
                                ? 200
                                : 503
                        )
                        .json({
                            success:
                                healthy,

                            status:
                                healthy
                                    ? "healthy"
                                    : "unhealthy",

                            service:
                                "TITech Community Capital",

                            runtime:
                                this.options
                                    .SERVER_NAME,

                            timestamp:
                                nowIso(),

                            uptime:
                                process.uptime(),

                            ...result
                        });

                } catch (error) {

                    return res
                        .status(
                            503
                        )
                        .json({
                            success:
                                false,

                            status:
                                "unhealthy",

                            code:
                                "HEALTHCHECK_FAILED",

                            message:
                                "Health check failed.",

                            requestId:
                                req.requestId,

                            timestamp:
                                nowIso()
                        });

                }

            }
        );

        app.get(
            this._readinessPath,
            async (
                req,
                res
            ) => {

                try {

                    const result =
                        await this._runReadiness();

                    const ready =
                        Boolean(
                            result &&
                            (
                                result.ready !==
                                    false
                            )
                        );

                    return res
                        .status(
                            ready
                                ? 200
                                : 503
                        )
                        .json({
                            success:
                                ready,

                            status:
                                ready
                                    ? "ready"
                                    : "not_ready",

                            service:
                                "TITech Community Capital",

                            timestamp:
                                nowIso(),

                            ...result
                        });

                } catch (error) {

                    return res
                        .status(
                            503
                        )
                        .json({
                            success:
                                false,

                            status:
                                "not_ready",

                            code:
                                "READINESS_CHECK_FAILED",

                            message:
                                "Readiness check failed.",

                            requestId:
                                req.requestId,

                            timestamp:
                                nowIso()
                        });

                }

            }
        );

    }

    _attachHealthRoutesKoa(
        app
    ) {

        const manager =
            this;

        app.use(
            async (
                ctx,
                next
            ) => {

                if (
                    ctx.path ===
                    manager._healthPath
                ) {

                    try {

                        const result =
                            await manager._runHealthcheck();

                        const healthy =
                            Boolean(
                                result &&
                                result.ok !==
                                    false
                            );

                        ctx.status =
                            healthy
                                ? 200
                                : 503;

                        ctx.body = {
                            success:
                                healthy,

                            status:
                                healthy
                                    ? "healthy"
                                    : "unhealthy",

                            service:
                                "TITech Community Capital",

                            timestamp:
                                nowIso(),

                            uptime:
                                process.uptime(),

                            ...result
                        };

                    } catch {

                        ctx.status =
                            503;

                        ctx.body = {
                            success:
                                false,

                            status:
                                "unhealthy",

                            code:
                                "HEALTHCHECK_FAILED",

                            message:
                                "Health check failed.",

                            timestamp:
                                nowIso()
                        };

                    }

                    return;

                }

                if (
                    ctx.path ===
                    manager._readinessPath
                ) {

                    try {

                        const result =
                            await manager._runReadiness();

                        const ready =
                            Boolean(
                                result &&
                                result.ready !==
                                    false
                            );

                        ctx.status =
                            ready
                                ? 200
                                : 503;

                        ctx.body = {
                            success:
                                ready,

                            status:
                                ready
                                    ? "ready"
                                    : "not_ready",

                            service:
                                "TITech Community Capital",

                            timestamp:
                                nowIso(),

                            ...result
                        };

                    } catch {

                        ctx.status =
                            503;

                        ctx.body = {
                            success:
                                false,

                            status:
                                "not_ready",

                            code:
                                "READINESS_CHECK_FAILED",

                            message:
                                "Readiness check failed.",

                            timestamp:
                                nowIso()
                        };

                    }

                    return;

                }

                await next();

            }
        );

    }

    // =========================================================================
    // Runtime Metadata
    // =========================================================================

    _attachMetaRouteExpress(
        app
    ) {

        app.get(
            this._metaPath,
            (
                req,
                res
            ) => {

                return res.status(
                    200
                ).json({

                    success:
                        true,

                    service:
                        this.options
                            .SERVER_NAME,

                    application:
                        "TITech Community Capital",

                    version:
                        this.options
                            .VERSION,

                    node:
                        process.version,

                    pid:
                        process.pid,

                    hostname:
                        os.hostname(),

                    startedAt:
                        this._startedAt
                            ?.toISOString() ||
                        null,

                    uptime:
                        process.uptime(),

                    activeRequests:
                        this._activeRequests,

                    activeConnections:
                        this._connections.size,

                    runtimeFingerprint:
                        this._runtimeFingerprint,

                    timestamp:
                        nowIso()

                });

            }
        );

    }

    _attachMetaRouteKoa(
        app
    ) {

        const manager =
            this;

        app.use(
            async (
                ctx,
                next
            ) => {

                if (
                    ctx.path !==
                    manager._metaPath
                ) {

                    await next();
                    return;

                }

                ctx.status =
                    200;

                ctx.body = {

                    success:
                        true,

                    service:
                        manager.options
                            .SERVER_NAME,

                    application:
                        "TITech Community Capital",

                    version:
                        manager.options
                            .VERSION,

                    node:
                        process.version,

                    pid:
                        process.pid,

                    hostname:
                        os.hostname(),

                    startedAt:
                        manager._startedAt
                            ?.toISOString() ||
                        null,

                    uptime:
                        process.uptime(),

                    activeRequests:
                        manager._activeRequests,

                    activeConnections:
                        manager._connections.size,

                    runtimeFingerprint:
                        manager._runtimeFingerprint,

                    timestamp:
                        nowIso()

                };

            }
        );

    }

    // =========================================================================
    // Prometheus
    // =========================================================================

    _attachPrometheusEndpoint(
        app
    ) {

        if (
            !this.options.ENABLE_PROMETHEUS ||
            !this.options.PROM_CLIENT
        ) {

            return;

        }

        const prom =
            this.options
                .PROM_CLIENT;

        const registry =
            prom.register;

        if (!registry) {
            return;
        }

        if (
            this._appContext.type ===
            "express"
        ) {

            app.get(
                this._metricsPath,
                async (
                    req,
                    res
                ) => {

                    try {

                        res.set(
                            "Content-Type",
                            registry.contentType ||
                            "text/plain; version=0.0.4; charset=utf-8"
                        );

                        return res.send(
                            await registry.metrics()
                        );

                    } catch {

                        return res
                            .status(
                                500
                            )
                            .send(
                                "Unable to collect metrics."
                            );

                    }

                }
            );

            return;

        }

        /*
         * Koa implementation.
         */
        app.use(
            async (
                ctx,
                next
            ) => {

                if (
                    ctx.path !==
                    this._metricsPath
                ) {

                    await next();
                    return;

                }

                try {

                    ctx.set(
                        "Content-Type",
                        registry.contentType ||
                        "text/plain; version=0.0.4; charset=utf-8"
                    );

                    ctx.body =
                        await registry.metrics();

                } catch {

                    ctx.status =
                        500;

                    ctx.body =
                        "Unable to collect metrics.";

                }

            }
        );

    }

    // =========================================================================
    // Server Creation
    // =========================================================================

    async _createServers() {

        const app =
            this._appContext.app;

        if (
            this.options.ENABLE_HTTP
        ) {

            this.server =
                http.createServer(
                    app
                );

            this._configureServer(
                this.server
            );

            this._attachServerListeners(
                this.server,
                "http"
            );

        }

        if (
            this.options.ENABLE_HTTPS
        ) {

            this._tlsOptions =
                await this._loadTlsOptions();

            if (
                this.options.ENABLE_HTTP2
            ) {

                /*
                 * allowHTTP1 keeps normal HTTP/1.1 clients compatible with the
                 * secure endpoint while enabling HTTP/2.
                 */
                this.http2Server =
                    http2.createSecureServer(
                        Object.assign(
                            {
                                allowHTTP1:
                                    true
                            },
                            this._tlsOptions
                        ),
                        app
                    );

                this._configureServer(
                    this.http2Server
                );

                this._attachServerListeners(
                    this.http2Server,
                    "http2"
                );

            } else {

                this.secureServer =
                    https.createServer(
                        this._tlsOptions,
                        app
                    );

                this._configureServer(
                    this.secureServer
                );

                this._attachServerListeners(
                    this.secureServer,
                    "https"
                );

            }

        }

        if (
            !this.server &&
            !this.secureServer &&
            !this.http2Server
        ) {

            throw new Error(
                "No HTTP transport is enabled."
            );

        }

    }

    _configureServer(
        server
    ) {

        server.keepAliveTimeout =
            this.options
                .KEEP_ALIVE_TIMEOUT_MS;

        server.headersTimeout =
            Math.max(
                this.options
                    .HEADERS_TIMEOUT_MS,
                this.options
                    .KEEP_ALIVE_TIMEOUT_MS +
                    1_000
            );

        if (
            "requestTimeout" in
            server
        ) {

            server.requestTimeout =
                this.options
                    .REQUEST_TIMEOUT_MS;

        }

        if (
            "timeout" in
            server
        ) {

            server.timeout =
                this.options
                    .REQUEST_TIMEOUT_MS;

        }

    }

    _attachServerListeners(
        server,
        protocol
    ) {

        server.on(
            "connection",
            socket => {

                this._trackSocket(
                    socket,
                    protocol
                );

            }
        );

        server.on(
            "error",
            error => {

                this._incrementMetric(
                    "server_errors_total",
                    1,
                    {
                        protocol
                    }
                );

                this._log(
                    "error",
                    "server error",
                    {
                        protocol,

                        error:
                            serializeError(
                                error
                            )
                    }
                );

                this.emit(
                    "error",
                    error
                );

            }
        );

        server.on(
            "listening",
            () => {

                const address =
                    server.address();

                this.emit(
                    "listening",
                    {
                        protocol,

                        address
                    }
                );

            }
        );

    }

    // =========================================================================
    // Socket Tracking
    // =========================================================================

    _trackSocket(
        socket,
        protocol
    ) {

        const socketId =
            this._nextSocketId++;

        this._connections.set(
            socketId,
            {
                socket,
                protocol,
                connectedAt:
                    Date.now()
            }
        );

        socket.once(
            "close",
            () => {

                this._connections.delete(
                    socketId
                );

            }
        );

        socket.once(
            "error",
            error => {

                this._incrementMetric(
                    "socket_errors_total"
                );

                this._log(
                    "debug",
                    "socket error",
                    {
                        socketId,
                        protocol,

                        error:
                            serializeError(
                                error
                            )
                    }
                );

            }
        );

        /*
         * Do not aggressively destroy keep-alive sockets during normal
         * operation. They are drained only during shutdown.
         */
        if (
            typeof socket.setTimeout ===
            "function"
        ) {

            socket.setTimeout(
                this.options
                    .KEEP_ALIVE_TIMEOUT_MS +
                    5_000
            );

        }

    }

    // =========================================================================
    // TLS
    // =========================================================================

    async _loadTlsOptions() {

        if (
            typeof this.options.tlsLoader ===
                "function"
        ) {

            const loaded =
                await this.options
                    .tlsLoader();

            if (
                !loaded ||
                !loaded.key ||
                !loaded.cert
            ) {

                throw new Error(
                    "tlsLoader() must return at least { key, cert }."
                );

            }

            return Object.assign(
                {
                    minVersion:
                        this.options
                            .TLS_MIN_VERSION,

                    honorCipherOrder:
                        true
                },
                loaded
            );

        }

        if (
            !this.options.TLS_KEY_PATH ||
            !this.options.TLS_CERT_PATH
        ) {

            throw new Error(
                "HTTPS is enabled but TLS key/certificate paths are not configured."
            );

        }

        const keyPath =
            path.resolve(
                this.options
                    .TLS_KEY_PATH
            );

        const certPath =
            path.resolve(
                this.options
                    .TLS_CERT_PATH
            );

        if (
            !fs.existsSync(
                keyPath
            )
        ) {

            throw new Error(
                `TLS key file not found: ${keyPath}`
            );

        }

        if (
            !fs.existsSync(
                certPath
            )
        ) {

            throw new Error(
                `TLS certificate file not found: ${certPath}`
            );

        }

        const tlsOptions = {

            key:
                fs.readFileSync(
                    keyPath
                ),

            cert:
                fs.readFileSync(
                    certPath
                ),

            minVersion:
                this.options
                    .TLS_MIN_VERSION,

            honorCipherOrder:
                true

        };

        if (
            this.options.TLS_CA_PATH
        ) {

            const caPath =
                path.resolve(
                    this.options
                        .TLS_CA_PATH
                );

            if (
                !fs.existsSync(
                    caPath
                )
            ) {

                throw new Error(
                    `TLS CA file not found: ${caPath}`
                );

            }

            tlsOptions.ca =
                fs.readFileSync(
                    caPath
                );

        }

        return tlsOptions;

    }

    // =========================================================================
    // WebSocket Upgrade
    // =========================================================================

    onUpgrade(
        listener
    ) {

        if (
            typeof listener !==
            "function"
        ) {

            throw new TypeError(
                "WebSocket upgrade listener must be a function."
            );

        }

        this._socketUpgradeListeners.push(
            listener
        );

        const targets =
            [
                this.server,
                this.secureServer,
                this.http2Server
            ].filter(
                Boolean
            );

        /*
         * HTTP/2 secure servers do not use the ordinary HTTP/1 upgrade event.
         * Register only on HTTP/1-compatible transports.
         */
        for (
            const server of targets
        ) {

            if (
                server ===
                this.http2Server
            ) {
                continue;
            }

            server.on(
                "upgrade",
                listener
            );

        }

        return () => {

            const index =
                this._socketUpgradeListeners
                    .indexOf(
                        listener
                    );

            if (
                index >=
                0
            ) {

                this._socketUpgradeListeners
                    .splice(
                        index,
                        1
                    );

            }

            for (
                const server of [
                    this.server,
                    this.secureServer
                ].filter(Boolean)
            ) {

                server.off(
                    "upgrade",
                    listener
                );

            }

        };

    }

    // =========================================================================
    // Listen
    // =========================================================================

    async _listen(
        server,
        port,
        host,
        protocol
    ) {

        if (
            !server
        ) {

            return null;

        }

        return new Promise(
            (
                resolve,
                reject
            ) => {

                let settled =
                    false;

                const cleanup =
                    () => {

                        server.off(
                            "error",
                            onError
                        );

                    };

                const onError =
                    error => {

                        if (
                            settled
                        ) {
                            return;
                        }

                        settled =
                            true;

                        cleanup();
                        reject(
                            error
                        );

                    };

                server.once(
                    "error",
                    onError
                );

                try {

                    server.listen(
                        {
                            host,
                            port
                        },
                        () => {

                            if (
                                settled
                            ) {
                                return;
                            }

                            settled =
                                true;

                            cleanup();

                            const address =
                                server.address();

                            this._log(
                                "info",
                                `${protocol} server listening`,
                                {
                                    host,
                                    port,
                                    address
                                }
                            );

                            resolve(
                                address
                            );

                        }
                    );

                } catch (error) {

                    onError(
                        error
                    );

                }

            }
        );

    }

    // =========================================================================
    // Startup
    // =========================================================================

    async start() {

        if (
            this._started
        ) {

            return this._buildRuntimeInfo();

        }

        if (
            this._starting
        ) {

            throw new Error(
                "TITech HTTP server startup is already in progress."
            );

        }

        if (
            this._shuttingDown
        ) {

            throw new Error(
                "TITech HTTP server cannot be started after shutdown has begun."
            );

        }

        this._starting =
            true;

        try {

            this._startedAt =
                new Date();

            await this._prepareApp();

            await this._createServers();

            /*
             * Register pre-existing WebSocket listeners supplied through
             * options before listening begins.
             */
            if (
                Array.isArray(
                    this.options.upgradeListeners
                )
            ) {

                for (
                    const listener of
                    this.options.upgradeListeners
                ) {

                    if (
                        typeof listener ===
                        "function"
                    ) {

                        this.onUpgrade(
                            listener
                        );

                    }

                }

            }

            if (
                this.server
            ) {

                await this._listen(
                    this.server,
                    this.options.PORT,
                    this.options.HOST,
                    "HTTP"
                );

            }

            const secureServer =
                this.http2Server ||
                this.secureServer;

            if (
                secureServer
            ) {

                await this._listen(
                    secureServer,
                    this.options.HTTPS_PORT,
                    this.options.HOST,
                    this.http2Server
                        ? "HTTP/2"
                        : "HTTPS"
                );

            }

            this._started =
                true;

            this._incrementMetric(
                "startup_total"
            );

            try {

                if (
                    runtimeEvents &&
                    typeof runtimeEvents.emitEvent ===
                        "function"
                ) {

                    runtimeEvents.emitEvent(
                        runtimeEvents.RUNTIME_EVENTS
                            ?.APPLICATION_READY ||
                            "application.ready",
                        {
                            service:
                                this.options
                                    .SERVER_NAME,

                            pid:
                                process.pid,

                            timestamp:
                                nowIso()
                        }
                    );

                }

            } catch {
                // Lifecycle telemetry is non-fatal.
            }

            this.emit(
                "started",
                this._buildRuntimeInfo()
            );

            this._installSignalHandlers();

            this._log(
                "info",
                "server startup complete",
                this._buildRuntimeInfo()
            );

            return this._buildRuntimeInfo();

        } catch (error) {

            this._log(
                "error",
                "server startup failed; rolling back",
                {
                    error:
                        serializeError(
                            error
                        )
                }
            );

            await this._rollbackStartup();

            throw error;

        } finally {

            this._starting =
                false;

        }

    }

    // =========================================================================
    // Startup Rollback
    // =========================================================================

    async _rollbackStartup() {

        const servers =
            [
                this.server,
                this.secureServer,
                this.http2Server
            ].filter(
                Boolean
            );

        for (
            const server of servers
        ) {

            try {

                await promisifyClose(
                    server
                );

            } catch {

                try {

                    for (
                        const connection
                        of this._connections.values()
                    ) {

                        connection.socket.destroy();

                    }

                } catch {
                    // Ignore rollback cleanup failures.
                }

            }

        }

        this._connections.clear();

        this.server =
            null;

        this.secureServer =
            null;

        this.http2Server =
            null;

        this._started =
            false;

    }

    // =========================================================================
    // Graceful Shutdown
    // =========================================================================

    async shutdown(
        signal = "SIGTERM"
    ) {

        if (
            this._shutdownPromise
        ) {

            return this._shutdownPromise;

        }

        this._shutdownPromise =
            this._performShutdown(
                signal
            );

        return this._shutdownPromise;

    }

    async _performShutdown(
        signal
    ) {

        if (
            this._shuttingDown
        ) {

            return;

        }

        this._shuttingDown =
            true;

        this._log(
            "info",
            "graceful shutdown initiated",
            {
                signal,

                activeConnections:
                    this._connections.size,

                activeRequests:
                    this._activeRequests
            }
        );

        try {

            /*
             * Advertise not-ready status immediately. This gives Kubernetes,
             * load balancers and service discovery layers a chance to stop
             * routing new work.
             */
            this.emit(
                "shutdown:start",
                {
                    signal
                }
            );

            try {

                if (
                    runtimeEvents &&
                    typeof runtimeEvents.emitEvent ===
                        "function"
                ) {

                    runtimeEvents.emitEvent(
                        runtimeEvents.RUNTIME_EVENTS
                            ?.APPLICATION_SHUTDOWN ||
                            "application.shutdown",
                        {
                            signal,

                            pid:
                                process.pid
                        }
                    );

                }

            } catch {
                // Non-fatal.
            }

            /*
             * Stop accepting new network connections first.
             */
            const closePromises = [];

            for (
                const server of [
                    this.server,
                    this.secureServer,
                    this.http2Server
                ].filter(Boolean)
            ) {

                try {

                    closePromises.push(
                        promisifyClose(
                            server
                        )
                    );

                } catch {
                    // Continue closing the remaining transports.
                }

            }

            /*
             * Give application-level resources a chance to stop. The
             * application owns DB/Redis/queue lifecycle.
             */
            if (
                this._appContext &&
                typeof this._appContext.close ===
                    "function"
            ) {

                try {

                    await this._withTimeout(
                        this._appContext.close(),
                        this.options
                            .GRACEFUL_SHUTDOWN_TIMEOUT_MS
                    );

                } catch (error) {

                    this._log(
                        "warn",
                        "application close handler failed",
                        {
                            error:
                                serializeError(
                                    error
                                )
                        }
                    );

                }

            }

            /*
             * Do not force-destroy sockets immediately. Allow existing requests
             * to complete inside the configured grace period.
             */
            const deadline =
                Date.now() +
                this.options
                    .GRACEFUL_SHUTDOWN_TIMEOUT_MS;

            while (
                this._connections.size > 0 &&
                Date.now() <
                    deadline
            ) {

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            this.options
                                .SOCKET_DRAIN_INTERVAL_MS
                        )
                );

            }

            /*
             * Force-close sockets which remain after the grace period.
             */
            if (
                this._connections.size > 0
            ) {

                this._log(
                    "warn",
                    "forcing remaining socket shutdown",
                    {
                        remaining:
                            this._connections.size
                    }
                );

                for (
                    const {
                        socket
                    } of this._connections.values()
                ) {

                    try {

                        socket.destroy();

                    } catch {
                        // Ignore socket destruction errors.
                    }

                }

                this._connections.clear();

            }

            /*
             * Wait briefly for close callbacks after forced socket destruction.
             */
            try {

                await Promise.allSettled(
                    closePromises
                );

            } catch {
                // allSettled should not reject, retained for defensive safety.
            }

            this._started =
                false;

            this.emit(
                "shutdown",
                {
                    signal,

                    activeConnections:
                        this._connections.size,

                    activeRequests:
                        this._activeRequests
                }
            );

            this._log(
                "info",
                "graceful shutdown complete",
                {
                    signal
                }
            );

        } finally {

            this._started =
                false;

            /*
             * Remove only handlers that this manager owns.
             * We intentionally do not use process.removeAllListeners().
             */
            this._removeSignalHandlers();

        }

    }

    async _withTimeout(
        promise,
        timeoutMs
    ) {

        let timer = null;

        const timeout =
            new Promise(
                (
                    _resolve,
                    reject
                ) => {

                    timer =
                        setTimeout(
                            () => {

                                const error =
                                    new Error(
                                        "Operation timed out."
                                    );

                                error.code =
                                    "TITECH_HTTP_OPERATION_TIMEOUT";

                                reject(
                                    error
                                );

                            },
                            timeoutMs
                        );

                }
            );

        try {

            return await Promise.race(
                [
                    Promise.resolve(
                        promise
                    ),
                    timeout
                ]
            );

        } finally {

            if (
                timer
            ) {

                clearTimeout(
                    timer
                );

            }

        }

    }

    // =========================================================================
    // Signal Handling
    // =========================================================================

    _installSignalHandlers() {

        if (
            this._signalsInstalled
        ) {

            return;

        }

        this._signalsInstalled =
            true;

        this._signalHandlers = {

            SIGINT:
                () =>
                    this.shutdown(
                        "SIGINT"
                    ),

            SIGTERM:
                () =>
                    this.shutdown(
                        "SIGTERM"
                    )

        };

        process.on(
            "SIGINT",
            this._signalHandlers.SIGINT
        );

        process.on(
            "SIGTERM",
            this._signalHandlers.SIGTERM
        );

    }

    _removeSignalHandlers() {

        if (
            !this._signalsInstalled ||
            !this._signalHandlers
        ) {

            return;

        }

        process.off(
            "SIGINT",
            this._signalHandlers.SIGINT
        );

        process.off(
            "SIGTERM",
            this._signalHandlers.SIGTERM
        );

        this._signalsInstalled =
            false;

        this._signalHandlers =
            null;

    }

    // =========================================================================
    // Runtime Information
    // =========================================================================

    _buildRuntimeInfo() {

        return {

            success:
                true,

            service:
                this.options
                    .SERVER_NAME,

            application:
                "TITech Community Capital",

            version:
                this.options
                    .VERSION,

            pid:
                process.pid,

            hostname:
                os.hostname(),

            started:
                this._started,

            starting:
                this._starting,

            shuttingDown:
                this._shuttingDown,

            host:
                this.options.HOST,

            http:
                this.server
                    ? {
                        enabled:
                            true,
                        port:
                            this.options.PORT
                    }
                    : {
                        enabled:
                            false
                    },

            https:
                this.secureServer
                    ? {
                        enabled:
                            true,
                        port:
                            this.options
                                .HTTPS_PORT
                    }
                    : {
                        enabled:
                            false
                    },

            http2:
                this.http2Server
                    ? {
                        enabled:
                            true,
                        port:
                            this.options
                                .HTTPS_PORT
                    }
                    : {
                        enabled:
                            false
                    },

            activeConnections:
                this._connections.size,

            activeRequests:
                this._activeRequests,

            requestCount:
                this._requestCount,

            startedAt:
                this._startedAt
                    ?.toISOString() ||
                null,

            uptime:
                process.uptime(),

            runtimeFingerprint:
                this._runtimeFingerprint

        };

    }

}

// =============================================================================
// Factory
// =============================================================================

async function createHttpServer(
    options = {}
) {

    if (
        !options ||
        typeof options !==
            "object"
    ) {

        throw new TypeError(
            "createHttpServer(options) requires an options object."
        );

    }

    return new ServerManager(
        options
    );

}

// =============================================================================
// Start Helper
// =============================================================================

async function startServer(
    manager
) {

    if (
        !manager ||
        typeof manager.start !==
            "function"
    ) {

        throw new TypeError(
            "Invalid TITech ServerManager supplied to startServer()."
        );

    }

    return manager.start();

}

// =============================================================================
// Stop Helper
// =============================================================================

async function stopServer(
    manager,
    signal = "SIGTERM"
) {

    if (
        !manager ||
        typeof manager.shutdown !==
            "function"
    ) {

        throw new TypeError(
            "Invalid TITech ServerManager supplied to stopServer()."
        );

    }

    return manager.shutdown(
        signal
    );

}

// =============================================================================
// Exports
// =============================================================================

module.exports = Object.freeze({

    createHttpServer,

    startServer,

    stopServer,

    ServerManager,

    DEFAULTS

});