"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Request Drain Manager
 * =============================================================================
 *
 * File:
 *   backend/runtime/requestDrain.js
 *
 * Purpose:
 *   Production-grade graceful shutdown and request-draining manager for
 *   TITech Community Capital services.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ Track active HTTP requests
 *   ✓ Track TCP/TLS sockets
 *   ✓ Track registered WebSocket connections
 *   ✓ Stop readiness before termination
 *   ✓ Stop accepting new HTTP connections
 *   ✓ Reject requests arriving after drain begins
 *   ✓ Gracefully close keep-alive connections
 *   ✓ Gracefully close WebSocket connections
 *   ✓ Wait for in-flight requests
 *   ✓ Force-destroy remaining connections after timeout
 *   ✓ Support Express and Koa health/readiness endpoints
 *   ✓ Provide drain lifecycle events
 *   ✓ Provide runtime diagnostics
 *   ✓ Integrate with TITech runtime metrics
 *   ✓ Integrate with request IDs / correlation IDs
 *   ✓ Protect against double-start / double-drain races
 *   ✓ Avoid leaking timers and listeners
 *   ✓ Never expose sensitive request headers/body data
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   1. Readiness becomes FALSE before connection draining begins.
 *   2. Existing in-flight requests are allowed to finish during the grace
 *      period.
 *   3. New requests are rejected once draining starts.
 *   4. The manager NEVER starts, commits, or aborts application transactions.
 *   5. The manager does not own application/business state.
 *   6. Request draining is process-local.
 *   7. A drain manager must be safe to invoke repeatedly.
 *
 * Typical usage:
 *
 *   const {
 *       createRequestDrain
 *   } = require("./backend/runtime/requestDrain");
 *
 *   const drain =
 *       createRequestDrain({
 *           server,
 *           secureServer,
 *           logger,
 *           metrics
 *       });
 *
 *   app.use(
 *       drain.requestTrackingMiddleware()
 *   );
 *
 *   await drain.start();
 *
 *   process.on(
 *       "SIGTERM",
 *       () => drain.drain({
 *           reason: "SIGTERM"
 *       })
 *   );
 *
 * =============================================================================
 */

const EventEmitter = require("events");
const crypto = require("crypto");

// =============================================================================
// Configuration Helpers
// =============================================================================

function envNumber(
    name,
    fallback,
    {
        min = Number.NEGATIVE_INFINITY,
        max = Number.POSITIVE_INFINITY,
        integer = false
    } = {}
) {

    const raw =
        process.env[name];

    const value =
        raw === undefined
            ? fallback
            : Number(raw);

    if (
        !Number.isFinite(value)
    ) {

        return fallback;

    }

    if (
        value < min ||
        value > max
    ) {

        return fallback;

    }

    if (
        integer &&
        !Number.isInteger(value)
    ) {

        return fallback;

    }

    return value;

}

function envBoolean(
    name,
    fallback
) {

    const raw =
        process.env[name];

    if (
        raw === undefined
    ) {

        return fallback;

    }

    return [
        "true",
        "1",
        "yes",
        "on"
    ].includes(
        String(raw)
            .trim()
            .toLowerCase()
    );

}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULTS = Object.freeze({

    LOG_PREFIX:
        "TITech.RequestDrain",

    GRACEFUL_TIMEOUT_MS:
        envNumber(
            "GRACEFUL_SHUTDOWN_TIMEOUT_MS",
            30_000,
            {
                min: 1_000,
                max: 300_000,
                integer: true
            }
        ),

    FORCE_KILL_AFTER_MS:
        envNumber(
            "FORCE_KILL_AFTER_MS",
            5_000,
            {
                min: 0,
                max: 120_000,
                integer: true
            }
        ),

    SOCKET_DRAIN_BATCH_MS:
        envNumber(
            "SOCKET_DRAIN_BATCH_MS",
            200,
            {
                min: 25,
                max: 10_000,
                integer: true
            }
        ),

    HEALTH_PATH:
        process.env.HEALTH_PATH ||
        "/health",

    READINESS_PATH:
        process.env.READINESS_PATH ||
        "/ready",

    METRIC_PREFIX:
        process.env.METRICS_PREFIX ||
        "titech",

    REQUEST_ID_HEADER:
        (
            process.env.REQUEST_ID_HEADER ||
            "x-request-id"
        ).toLowerCase(),

    CORRELATION_ID_HEADER:
        (
            process.env.CORRELATION_ID_HEADER ||
            "x-correlation-id"
        ).toLowerCase(),

    WS_CLOSE_CODE:
        envNumber(
            "WS_CLOSE_CODE",
            1001,
            {
                min: 1000,
                max: 4999,
                integer: true
            }
        ),

    ACTIVE_REQUEST_WARNING_MS:
        envNumber(
            "ACTIVE_REQUEST_WARNING_MS",
            10_000,
            {
                min: 1_000,
                max: 300_000,
                integer: true
            }
        ),

    MAX_DIAGNOSTIC_REQUESTS:
        envNumber(
            "MAX_DRAIN_DIAGNOSTIC_REQUESTS",
            100,
            {
                min: 10,
                max: 1_000,
                integer: true
            }
        ),

    FORCE_PROCESS_EXIT:
        envBoolean(
            "DRAIN_FORCE_PROCESS_EXIT",
            false
        )

});

// =============================================================================
// Utility Functions
// =============================================================================

function generateRequestId() {

    try {

        return crypto.randomUUID();

    } catch {

        return [
            "rid",
            Date.now().toString(36),
            Math.random()
                .toString(36)
                .slice(2, 10)
        ].join("-");

    }

}

function safeInteger(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(
        number
    )
        ? number
        : fallback;

}

function sleep(
    ms
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}

function createError(
    message,
    code,
    status = 500
) {

    const error =
        new Error(
            message
        );

    error.code =
        code;

    error.status =
        status;

    return error;

}

// =============================================================================
// Metrics Adapter
// =============================================================================
//
// Supports both:
//
//   metrics.inc()
//   metrics.set()
//
// used by TITech runtime metrics, and legacy:
//
//   metrics.increment()
//   metrics.gauge()
//
// This keeps the drain subsystem compatible with existing platform modules.
//

function metricIncrement(
    metrics,
    name,
    value = 1,
    labels = {}
) {

    if (
        !metrics
    ) {

        return;

    }

    try {

        if (
            typeof metrics.inc ===
            "function"
        ) {

            metrics.inc(
                name,
                value,
                labels
            );

            return;

        }

        if (
            typeof metrics.increment ===
            "function"
        ) {

            metrics.increment(
                name,
                value,
                labels
            );

        }

    } catch {
        // Metrics must never break shutdown.
    }

}

function metricGauge(
    metrics,
    name,
    value,
    labels = {}
) {

    if (
        !metrics
    ) {

        return;

    }

    try {

        if (
            typeof metrics.set ===
            "function"
        ) {

            metrics.set(
                name,
                value,
                labels
            );

            return;

        }

        if (
            typeof metrics.gauge ===
            "function"
        ) {

            metrics.gauge(
                name,
                value,
                labels
            );

        }

    } catch {
        // Metrics must never break shutdown.
    }

}

// =============================================================================
// Logger Adapter
// =============================================================================

function log(
    logger,
    level,
    prefix,
    message,
    metadata = {}
) {

    try {

        const target =
            logger &&
            typeof logger[level] ===
            "function"
                ? logger
                : console;

        target[level](
            `${prefix} ${message}`,
            metadata
        );

    } catch {
        // Logging must never interrupt shutdown.
    }

}

// =============================================================================
// Request Drain Factory
// =============================================================================

function createRequestDrain(
    options = {}
) {

    if (
        !options ||
        !options.server
    ) {

        throw new TypeError(
            "server is required to create TITech request drain manager."
        );

    }

    const server =
        options.server;

    const secureServer =
        options.secureServer ||
        null;

    const healthApp =
        options.healthApp ||
        null;

    const logger =
        options.logger ||
        console;

    const metrics =
        options.metrics ||
        null;

    const onDrainStart =
        typeof options.onDrainStart ===
        "function"
            ? options.onDrainStart
            : null;

    const onDrainComplete =
        typeof options.onDrainComplete ===
        "function"
            ? options.onDrainComplete
            : null;

    const cfg =
        Object.freeze(
            Object.assign(
                {},
                DEFAULTS,
                options
            )
        );

    const emitter =
        new EventEmitter();

    emitter.setMaxListeners(
        250
    );

    const state = {

        started:
            false,

        stopped:
            false,

        draining:
            false,

        drainPromise:
            null,

        readiness:
            options.initialReadiness !== false,

        drainStartedAt:
            null,

        drainCompletedAt:
            null,

        drainReason:
            null,

        activeRequests:
            new Map(),

        sockets:
            new Map(),

        webSockets:
            new Set(),

        nextSocketId:
            1,

        nextRequestSequence:
            1,

        serverListeners:
            [],

        timers:
            new Set(),

        stats: {

            requestsAccepted:
                0,

            requestsRejected:
                0,

            requestsCompleted:
                0,

            socketsOpened:
                0,

            socketsClosed:
                0,

            websocketOpened:
                0,

            websocketClosed:
                0,

            drainCount:
                0,

            forcedSockets:
                0,

            forcedWebSockets:
                0

        }

    };

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    function addTimer(
        callback,
        delay,
        {
            interval = false
        } = {}
    ) {

        const timer =
            interval
                ? setInterval(
                    callback,
                    delay
                )
                : setTimeout(
                    callback,
                    delay
                );

        state.timers.add(
            timer
        );

        return timer;

    }

    function removeTimer(
        timer
    ) {

        if (
            !timer
        ) {

            return;

        }

        clearTimeout(
            timer
        );

        clearInterval(
            timer
        );

        state.timers.delete(
            timer
        );

    }

    function clearTimers() {

        for (
            const timer of
            state.timers
        ) {

            clearTimeout(
                timer
            );

            clearInterval(
                timer
            );

        }

        state.timers.clear();

    }

    function getRequestId(
        req
    ) {

        const configured =
            req?.headers?.[
                cfg.REQUEST_ID_HEADER
            ];

        if (
            configured &&
            String(
                configured
            ).trim()
        ) {

            return String(
                configured
            ).trim();

        }

        return generateRequestId();

    }

    function getCorrelationId(
        req
    ) {

        const configured =
            req?.headers?.[
                cfg.CORRELATION_ID_HEADER
            ];

        if (
            configured &&
            String(
                configured
            ).trim()
        ) {

            return String(
                configured
            ).trim();

        }

        return null;

    }

    function emit(
        eventName,
        payload = {}
    ) {

        try {

            emitter.emit(
                eventName,
                Object.assign(
                    {
                        timestamp:
                            new Date()
                                .toISOString()
                    },
                    payload
                )
            );

        } catch (error) {

            log(
                logger,
                "warn",
                cfg.LOG_PREFIX,
                "event listener failed",
                {
                    event:
                        eventName,

                    error:
                        error?.message ||
                        String(error)
                }
            );

        }

    }

    function setReadinessInternal(
        value,
        reason = null
    ) {

        const next =
            Boolean(
                value
            );

        const changed =
            state.readiness !==
            next;

        state.readiness =
            next;

        /*
         * Only emit on a state transition.
         */
        if (
            changed
        ) {

            metricGauge(
                metrics,
                `${cfg.METRIC_PREFIX}.request_drain.readiness`,
                next
                    ? 1
                    : 0
            );

            emit(
                "readiness:changed",
                {
                    ready:
                        next,

                    draining:
                        state.draining,

                    reason
                }
            );

        }

    }

    function attachHeader(
        res,
        name,
        value
    ) {

        try {

            if (
                res &&
                typeof res.setHeader ===
                "function"
            ) {

                res.setHeader(
                    name,
                    value
                );

            }

        } catch {
            // Response may already be committed.
        }

    }

    function rejectNewRequest(
        req,
        res
    ) {

        state.stats.requestsRejected +=
            1;

        metricIncrement(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.requests_rejected_total`,
            1,
            {
                reason:
                    "draining",

                method:
                    String(
                        req?.method ||
                        "UNKNOWN"
                    )
            }
        );

        attachHeader(
            res,
            "Connection",
            "close"
        );

        attachHeader(
            res,
            "Retry-After",
            "5"
        );

        /*
         * Prefer an HTTP 503 response. Never leak internal shutdown state.
         */
        try {

            if (
                !res.headersSent
            ) {

                res.statusCode =
                    503;

            }

            if (
                !res.writableEnded
            ) {

                res.end(
                    "Service temporarily unavailable. Please retry."
                );

            }

        } catch {
            try {

                res.destroy?.();

            } catch {
                // Ignore.
            }
        }

    }

    function removeRequest(
        requestId
    ) {

        if (
            state.activeRequests.has(
                requestId
            )
        ) {

            state.activeRequests.delete(
                requestId
            );

            state.stats.requestsCompleted +=
                1;

            metricGauge(
                metrics,
                `${cfg.METRIC_PREFIX}.request_drain.active_requests`,
                state.activeRequests.size
            );

        }

    }

    function trackRequest(
        req,
        res
    ) {

        const requestId =
            getRequestId(
                req
            );

        /*
         * Request IDs should be unique within the process even if an upstream
         * proxy accidentally sends the same value twice.
         */
        let effectiveRequestId =
            requestId;

        if (
            state.activeRequests.has(
                effectiveRequestId
            )
        ) {

            effectiveRequestId =
                `${requestId}:${state.nextRequestSequence++}`;

        }

        const socketId =
            req?.socket?.__titechDrainSocketId ||
            null;

        const record = {

            id:
                effectiveRequestId,

            upstreamRequestId:
                requestId,

            correlationId:
                getCorrelationId(
                    req
                ),

            method:
                String(
                    req?.method ||
                    "UNKNOWN"
                ),

            url:
                String(
                    req?.originalUrl ||
                    req?.url ||
                    ""
                ).slice(
                    0,
                    2048
                ),

            start:
                Date.now(),

            startedAt:
                new Date(),

            socketId,

            req,

            res

        };

        state.activeRequests.set(
            effectiveRequestId,
            record
        );

        state.stats.requestsAccepted +=
            1;

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.active_requests`,
            state.activeRequests.size
        );

        /*
         * Warning timer for unusually long requests. This is deliberately a
         * diagnostic only; it does not interrupt the request.
         */
        const warningTimer =
            addTimer(
                () => {

                    if (
                        state.activeRequests.has(
                            effectiveRequestId
                        )
                    ) {

                        log(
                            logger,
                            "warn",
                            cfg.LOG_PREFIX,
                            "long-running request detected",
                            {
                                requestId:
                                    effectiveRequestId,

                                method:
                                    record.method,

                                url:
                                    record.url,

                                durationMs:
                                    Date.now() -
                                    record.start,

                                draining:
                                    state.draining
                            }
                        );

                        metricIncrement(
                            metrics,
                            `${cfg.METRIC_PREFIX}.request_drain.long_running_request_total`,
                            1
                        );

                    }

                },

                cfg.ACTIVE_REQUEST_WARNING_MS
            );

        const cleanup =
            () => {

                removeTimer(
                    warningTimer
                );

                removeRequest(
                    effectiveRequestId
                );

            };

        if (
            res &&
            typeof res.once ===
            "function"
        ) {

            res.once(
                "finish",
                cleanup
            );

            res.once(
                "close",
                cleanup
            );

            res.once(
                "error",
                cleanup
            );

        }

        attachHeader(
            res,
            "X-Request-ID",
            effectiveRequestId
        );

        if (
            record.correlationId
        ) {

            attachHeader(
                res,
                "X-Correlation-ID",
                record.correlationId
            );

        }

        return record;

    }

    // =========================================================================
    // Socket Tracking
    // =========================================================================

    function attachSocketTracking(
        srv
    ) {

        if (
            !srv ||
            typeof srv.on !==
            "function"
        ) {

            return;

        }

        const connectionHandler =
            socket => {

                const socketId =
                    state.nextSocketId++;

                try {

                    socket.__titechDrainSocketId =
                        socketId;

                } catch {
                    // Some custom socket implementations may be immutable.
                }

                state.sockets.set(
                    socketId,
                    {
                        id:
                            socketId,

                        socket,

                        connectedAt:
                            Date.now(),

                        activeRequests:
                            0
                    }
                );

                state.stats.socketsOpened +=
                    1;

                metricGauge(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.sockets`,
                    state.sockets.size
                );

                const closeHandler =
                    () => {

                        state.sockets.delete(
                            socketId
                        );

                        state.stats.socketsClosed +=
                            1;

                        metricGauge(
                            metrics,
                            `${cfg.METRIC_PREFIX}.request_drain.sockets`,
                            state.sockets.size
                        );

                    };

                socket.once?.(
                    "close",
                    closeHandler
                );

                /*
                 * Do NOT set an aggressive socket timeout here by default.
                 * The HTTP server owns keep-alive semantics and requestDrain
                 * should not unexpectedly terminate legitimate slow clients.
                 */

            };

        srv.on(
            "connection",
            connectionHandler
        );

        state.serverListeners.push(
            {
                target:
                    srv,

                event:
                    "connection",

                listener:
                    connectionHandler
            }
        );

    }

    // =========================================================================
    // WebSocket Management
    // =========================================================================

    function registerWebSocket(
        socket,
        metadata = {}
    ) {

        if (
            !socket
        ) {

            throw new TypeError(
                "WebSocket connection is required."
            );

        }

        state.webSockets.add(
            socket
        );

        state.stats.websocketOpened +=
            1;

        try {

            socket.__titechDrainMetadata =
                Object.assign(
                    {},
                    metadata
                );

        } catch {
            // Ignore.
        }

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.websockets`,
            state.webSockets.size
        );

        const onClose =
            () => {

                unregisterWebSocket(
                    socket
                );

            };

        if (
            typeof socket.once ===
            "function"
        ) {

            socket.once(
                "close",
                onClose
            );

        }

        emit(
            "websocket:registered",
            {
                active:
                    state.webSockets.size
            }
        );

        return socket;

    }

    function unregisterWebSocket(
        socket
    ) {

        if (
            !socket
        ) {

            return;

        }

        const existed =
            state.webSockets.delete(
                socket
            );

        if (
            existed
        ) {

            state.stats.websocketClosed +=
                1;

            metricGauge(
                metrics,
                `${cfg.METRIC_PREFIX}.request_drain.websockets`,
                state.webSockets.size
            );

        }

    }

    async function closeWebSockets(
        {
            graceful = true
        } = {}
    ) {

        const sockets =
            Array.from(
                state.webSockets
            );

        for (
            const socket of
            sockets
        ) {

            try {

                if (
                    graceful &&
                    typeof socket.close ===
                    "function"
                ) {

                    let closed =
                        false;

                    try {

                        socket.close(
                            cfg.WS_CLOSE_CODE,
                            "Server draining"
                        );

                        closed =
                            true;

                    } catch {
                        // Some libraries accept only a code or no args.
                    }

                    if (
                        !closed
                    ) {

                        try {

                            socket.close();

                            closed =
                                true;

                        } catch {
                            // Fall through.
                        }

                    }

                } else if (
                    typeof socket.terminate ===
                    "function"
                ) {

                    socket.terminate();

                    state.stats.forcedWebSockets +=
                        1;

                } else if (
                    typeof socket.destroy ===
                    "function"
                ) {

                    socket.destroy();

                    state.stats.forcedWebSockets +=
                        1;

                }

            } catch {
                // Ignore individual WebSocket failures.
            }

        }

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.websockets`,
            state.webSockets.size
        );

    }

    // =========================================================================
    // Server Close
    // =========================================================================

    async function closeServer(
        srv,
        label
    ) {

        if (
            !srv ||
            typeof srv.close !==
            "function"
        ) {

            return true;

        }

        /*
         * Node's server.close() stops accepting new connections while allowing
         * existing connections to continue. Existing sockets are dealt with
         * later if the grace period expires.
         */
        try {

            await new Promise(
                resolve => {

                    let settled =
                        false;

                    const complete =
                        () => {

                            if (
                                settled
                            ) {

                                return;

                            }

                            settled =
                                true;

                            resolve(
                                true
                            );

                        };

                    try {

                        srv.close(
                            complete
                        );

                    } catch (error) {

                        log(
                            logger,
                            "warn",
                            cfg.LOG_PREFIX,
                            `error closing ${label} server`,
                            {
                                error:
                                    error?.message ||
                                    String(error)
                            }
                        );

                        complete();

                    }

                }
            );

            return true;

        } catch (error) {

            log(
                logger,
                "warn",
                cfg.LOG_PREFIX,
                `failed to close ${label} server`,
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );

            return false;

        }

    }

    // =========================================================================
    // Socket Drain
    // =========================================================================

    async function destroyRemainingSockets() {

        const sockets =
            Array.from(
                state.sockets.values()
            );

        for (
            const record of
            sockets
        ) {

            const socket =
                record.socket;

            try {

                if (
                    !socket ||
                    socket.destroyed
                ) {

                    continue;

                }

                /*
                 * For HTTP/1.x keep-alive connections, FIN first so clients
                 * receive a clean close where possible.
                 */
                if (
                    typeof socket.end ===
                    "function"
                ) {

                    try {

                        socket.end();

                    } catch {
                        // Continue to force destroy.
                    }

                }

                addTimer(
                    () => {

                        try {

                            if (
                                !socket.destroyed &&
                                typeof socket.destroy ===
                                "function"
                            ) {

                                socket.destroy();

                            }

                        } catch {
                            // Ignore.
                        }

                    },

                    cfg.SOCKET_DRAIN_BATCH_MS
                );

                state.stats.forcedSockets +=
                    1;

            } catch {
                // Ignore individual socket errors.
            }

        }

    }

    async function forceDestroyAllSockets() {

        const sockets =
            Array.from(
                state.sockets.values()
            );

        for (
            const record of
            sockets
        ) {

            try {

                record.socket?.destroy?.();

            } catch {
                // Ignore.
            }

            state.sockets.delete(
                record.id
            );

        }

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.sockets`,
            state.sockets.size
        );

    }

    // =========================================================================
    // Health Endpoints
    // =========================================================================

    function attachHealthEndpoints(
        app
    ) {

        if (
            !app
        ) {

            return false;

        }

        /*
         * Express.
         */
        if (
            typeof app.get ===
            "function"
        ) {

            app.get(
                cfg.HEALTH_PATH,
                (req, res) => {

                    const body = {

                        ok:
                            true,

                        service:
                            "TITech.RequestDrain",

                        draining:
                            state.draining,

                        timestamp:
                            new Date()
                                .toISOString()

                    };

                    return res
                        .status(
                            200
                        )
                        .json(
                            body
                        );

                }
            );

            app.get(
                cfg.READINESS_PATH,
                (req, res) => {

                    const ready =
                        state.readiness &&
                        !state.draining;

                    const body = {

                        ready,

                        draining:
                            state.draining,

                        activeRequests:
                            state.activeRequests.size,

                        timestamp:
                            new Date()
                                .toISOString()

                    };

                    return res
                        .status(
                            ready
                                ? 200
                                : 503
                        )
                        .json(
                            body
                        );

                }
            );

            return true;

        }

        /*
         * Koa-style application.
         */
        if (
            typeof app.use ===
            "function"
        ) {

            app.use(
                async (
                    ctx,
                    next
                ) => {

                    if (
                        ctx.path ===
                        cfg.HEALTH_PATH
                    ) {

                        ctx.status =
                            200;

                        ctx.body = {

                            ok:
                                true,

                            service:
                                "TITech.RequestDrain",

                            draining:
                                state.draining,

                            timestamp:
                                new Date()
                                    .toISOString()

                        };

                        return;

                    }

                    if (
                        ctx.path ===
                        cfg.READINESS_PATH
                    ) {

                        const ready =
                            state.readiness &&
                            !state.draining;

                        ctx.status =
                            ready
                                ? 200
                                : 503;

                        ctx.body = {

                            ready,

                            draining:
                                state.draining,

                            activeRequests:
                                state.activeRequests.size,

                            timestamp:
                                new Date()
                                    .toISOString()

                        };

                        return;

                    }

                    await next();

                }
            );

            return true;

        }

        return false;

    }

    // =========================================================================
    // Express Request Tracking Middleware
    // =========================================================================

    function requestTrackingMiddleware() {

        return function titechRequestDrainTracker(
            req,
            res,
            next
        ) {

            /*
             * Reject before adding the request to the active set. A rejected
             * request is not an in-flight application request.
             */
            if (
                state.draining
            ) {

                rejectNewRequest(
                    req,
                    res
                );

                return;

            }

            const record =
                trackRequest(
                    req,
                    res
                );

            req.titechDrainRequestId =
                record.id;

            req.titechDrain =
                state;

            /*
             * Correlation can be read by other TITech middleware.
             */
            req.requestId =
                record.id;

            req.correlationId =
                record.correlationId;

            next();

        };

    }

    // =========================================================================
    // Koa Request Tracking Middleware
    // =========================================================================

    function koaRequestTrackingMiddleware() {

        return async function titechKoaRequestDrainTracker(
            ctx,
            next
        ) {

            if (
                state.draining
            ) {

                ctx.status =
                    503;

                ctx.set(
                    "Connection",
                    "close"
                );

                ctx.set(
                    "Retry-After",
                    "5"
                );

                ctx.body =
                    "Service temporarily unavailable. Please retry.";

                state.stats.requestsRejected +=
                    1;

                metricIncrement(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.requests_rejected_total`,
                    1,
                    {
                        reason:
                            "draining",

                        method:
                            String(
                                ctx.method ||
                                "UNKNOWN"
                            )
                    }
                );

                return;

            }

            const fakeReq = {

                headers:
                    ctx.request.headers,

                method:
                    ctx.method,

                originalUrl:
                    ctx.originalUrl,

                url:
                    ctx.request.url,

                socket:
                    ctx.req?.socket

            };

            const fakeRes = {

                setHeader(
                    name,
                    value
                ) {

                    ctx.set(
                        name,
                        String(value)
                    );

                },

                get headersSent() {

                    return false;

                }

            };

            const record =
                trackRequest(
                    fakeReq,
                    fakeRes
                );

            ctx.state =
                ctx.state ||
                {};

            ctx.state.titechDrainRequestId =
                record.id;

            ctx.state.titechDrain =
                state;

            ctx.state.requestId =
                record.id;

            ctx.state.correlationId =
                record.correlationId;

            /*
             * For Koa, track completion around the middleware stack.
             */
            try {

                await next();

            } finally {

                removeRequest(
                    record.id
                );

            }

        };

    }

    // =========================================================================
    // Drain
    // =========================================================================

    async function drain(
        {
            gracefulTimeoutMs =
                cfg.GRACEFUL_TIMEOUT_MS,

            forceKillAfterMs =
                cfg.FORCE_KILL_AFTER_MS,

            forceKill =
                cfg.FORCE_PROCESS_EXIT,

            reason =
                "shutdown",

            closeWebSocketsFirst =
                true
        } = {}
    ) {

        /*
         * Make drain idempotent.
         */
        if (
            state.drainPromise
        ) {

            return state.drainPromise;

        }

        state.drainPromise =
            (async () => {

                if (
                    state.draining
                ) {

                    return status();

                }

                state.draining =
                    true;

                state.drainStartedAt =
                    new Date();

                state.drainReason =
                    String(
                        reason ||
                        "shutdown"
                    );

                state.stats.drainCount +=
                    1;

                /*
                 * IMPORTANT:
                 * Readiness must be disabled before connection draining.
                 * This gives orchestrators/load balancers an opportunity to
                 * stop sending new traffic.
                 */
                setReadinessInternal(
                    false,
                    state.drainReason
                );

                metricIncrement(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.started_total`,
                    1,
                    {
                        reason:
                            state.drainReason
                    }
                );

                emit(
                    "drain:started",
                    {
                        reason:
                            state.drainReason,

                        gracefulTimeoutMs,

                        activeRequests:
                            state.activeRequests.size,

                        sockets:
                            state.sockets.size,

                        webSockets:
                            state.webSockets.size

                    }
                );

                log(
                    logger,
                    "info",
                    cfg.LOG_PREFIX,
                    "drain started",
                    {
                        reason:
                            state.drainReason,

                        gracefulTimeoutMs,

                        forceKillAfterMs,

                        activeRequests:
                            state.activeRequests.size,

                        sockets:
                            state.sockets.size,

                        webSockets:
                            state.webSockets.size

                    }
                );

                if (
                    onDrainStart
                ) {

                    try {

                        await onDrainStart({
                            reason:
                                state.drainReason,

                            state:
                                status()
                        });

                    } catch (error) {

                        log(
                            logger,
                            "warn",
                            cfg.LOG_PREFIX,
                            "onDrainStart hook failed",
                            {
                                error:
                                    error?.message ||
                                    String(error)
                            }
                        );

                        emit(
                            "drain:hook-error",
                            {
                                hook:
                                    "onDrainStart",

                                error:
                                    error?.message ||
                                    String(error)
                            }
                        );

                    }

                }

                /*
                 * Stop accepting new traffic.
                 */
                const closePromises = [

                    closeServer(
                        server,
                        "HTTP"
                    )

                ];

                if (
                    secureServer
                ) {

                    closePromises.push(
                        closeServer(
                            secureServer,
                            "secure"
                        )
                    );

                }

                /*
                 * Optional WebSocket close occurs after readiness is disabled
                 * but before waiting on HTTP requests when configured.
                 */
                if (
                    closeWebSocketsFirst
                ) {

                    await closeWebSockets({
                        graceful:
                            true
                    });

                }

                await Promise.all(
                    closePromises
                );

                const startedAt =
                    Date.now();

                const deadline =
                    startedAt +
                    Math.max(
                        0,
                        safeInteger(
                            gracefulTimeoutMs,
                            cfg.GRACEFUL_TIMEOUT_MS
                        )
                    );

                /*
                 * Wait for active requests.
                 */
                while (
                    state.activeRequests.size >
                        0 &&
                    Date.now() <
                        deadline
                ) {

                    metricGauge(
                        metrics,
                        `${cfg.METRIC_PREFIX}.request_drain.active_requests`,
                        state.activeRequests.size
                    );

                    emit(
                        "drain:waiting",
                        {
                            activeRequests:
                                state.activeRequests.size,

                            sockets:
                                state.sockets.size,

                            webSockets:
                                state.webSockets.size
                        }
                    );

                    await sleep(
                        Math.min(
                            250,
                            Math.max(
                                25,
                                deadline -
                                Date.now()
                            )
                        )
                    );

                }

                /*
                 * Any remaining requests have exceeded the normal graceful
                 * period. Begin forced connection draining.
                 */
                const remainingRequests =
                    state.activeRequests.size;

                if (
                    remainingRequests >
                    0
                ) {

                    log(
                        logger,
                        "warn",
                        cfg.LOG_PREFIX,
                        "graceful request timeout reached",
                        {
                            remaining:
                                remainingRequests
                        }
                    );

                    metricIncrement(
                        metrics,
                        `${cfg.METRIC_PREFIX}.request_drain.graceful_timeout_total`,
                        1
                    );

                    emit(
                        "drain:graceful-timeout",
                        {
                            remainingRequests
                        }
                    );

                    await destroyRemainingSockets();

                }

                /*
                 * Close WebSockets if they were not handled earlier.
                 */
                if (
                    !closeWebSocketsFirst
                ) {

                    await closeWebSockets({
                        graceful:
                            true
                    });

                }

                /*
                 * Give sockets a short grace period to complete FIN/close.
                 */
                await sleep(
                    cfg.SOCKET_DRAIN_BATCH_MS
                );

                /*
                 * Force-close remaining WebSockets.
                 */
                const remainingWebSockets =
                    Array.from(
                        state.webSockets
                    );

                for (
                    const socket of
                    remainingWebSockets
                ) {

                    try {

                        if (
                            typeof socket.terminate ===
                            "function"
                        ) {

                            socket.terminate();

                        } else if (
                            typeof socket.destroy ===
                            "function"
                        ) {

                            socket.destroy();

                        }

                        state.stats.forcedWebSockets +=
                            1;

                    } catch {
                        // Ignore.
                    }

                    unregisterWebSocket(
                        socket
                    );

                }

                /*
                 * Force-close any remaining TCP sockets.
                 */
                await forceDestroyAllSockets();

                const finishedAt =
                    new Date();

                state.drainCompletedAt =
                    finishedAt;

                const finalRemainingRequests =
                    state.activeRequests.size;

                metricGauge(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.active_requests`,
                    finalRemainingRequests
                );

                metricGauge(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.sockets`,
                    state.sockets.size
                );

                metricGauge(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.websockets`,
                    state.webSockets.size
                );

                metricIncrement(
                    metrics,
                    `${cfg.METRIC_PREFIX}.request_drain.completed_total`,
                    1,
                    {
                        remaining:
                            String(
                                finalRemainingRequests
                            )
                    }
                );

                emit(
                    "drain:finished",
                    {
                        reason:
                            state.drainReason,

                        durationMs:
                            finishedAt.getTime() -
                            startedAt,

                        remainingRequests:
                            finalRemainingRequests,

                        sockets:
                            state.sockets.size,

                        webSockets:
                            state.webSockets.size
                    }
                );

                log(
                    logger,
                    "info",
                    cfg.LOG_PREFIX,
                    "drain finished",
                    {
                        reason:
                            state.drainReason,

                        remainingRequests:
                            finalRemainingRequests,

                        sockets:
                            state.sockets.size,

                        webSockets:
                            state.webSockets.size
                    }
                );

                if (
                    onDrainComplete
                ) {

                    try {

                        await onDrainComplete({
                            reason:
                                state.drainReason,

                            state:
                                status()
                        });

                    } catch (error) {

                        log(
                            logger,
                            "warn",
                            cfg.LOG_PREFIX,
                            "onDrainComplete hook failed",
                            {
                                error:
                                    error?.message ||
                                    String(error)
                            }
                        );

                        emit(
                            "drain:hook-error",
                            {
                                hook:
                                    "onDrainComplete",

                                error:
                                    error?.message ||
                                    String(error)
                            }
                        );

                    }

                }

                /*
                 * Optional hard process exit.
                 *
                 * The default is false. In production, Kubernetes/systemd/PM2
                 * should usually own the final process lifecycle.
                 */
                if (
                    forceKill
                ) {

                    const exitDelay =
                        Math.max(
                            0,
                            safeInteger(
                                forceKillAfterMs,
                                cfg.FORCE_KILL_AFTER_MS
                            )
                        );

                    if (
                        exitDelay ===
                        0
                    ) {

                        process.exit(
                            0
                        );

                    } else {

                        addTimer(
                            () => {

                                log(
                                    logger,
                                    "warn",
                                    cfg.LOG_PREFIX,
                                    "forcing process exit after drain",
                                    {
                                        exitCode:
                                            0
                                    }
                                );

                                process.exit(
                                    0
                                );

                            },
                            exitDelay
                        );

                    }

                }

                return status();

            })();

        try {

            return await state.drainPromise;

        } finally {

            /*
             * Keep completed promise available so repeated drain calls receive
             * the same result without re-running shutdown work.
             */

        }

    }

    // =========================================================================
    // Start
    // =========================================================================

    async function start() {

        if (
            state.started
        ) {

            return status();

        }

        if (
            state.stopped
        ) {

            throw createError(
                "Request drain manager cannot be restarted after stop().",
                "REQUEST_DRAIN_STOPPED",
                500
            );

        }

        state.started =
            true;

        state.draining =
            false;

        state.drainStartedAt =
            null;

        state.drainCompletedAt =
            null;

        state.drainReason =
            null;

        setReadinessInternal(
            true,
            "manager_started"
        );

        attachSocketTracking(
            server
        );

        if (
            secureServer
        ) {

            attachSocketTracking(
                secureServer
            );

        }

        if (
            healthApp &&
            options.attachHealthEndpoints !==
            false
        ) {

            attachHealthEndpoints(
                healthApp
            );

        }

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.readiness`,
            1
        );

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.active_requests`,
            0
        );

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.sockets`,
            state.sockets.size
        );

        metricGauge(
            metrics,
            `${cfg.METRIC_PREFIX}.request_drain.websockets`,
            state.webSockets.size
        );

        emit(
            "started",
            {
                readiness:
                    state.readiness
            }
        );

        log(
            logger,
            "info",
            cfg.LOG_PREFIX,
            "request drain manager started"
        );

        return status();

    }

    // =========================================================================
    // Stop
    // =========================================================================

    async function stop(
        {
            drainFirst = false,
            reason = "stop"
        } = {}
    ) {

        if (
            state.stopped
        ) {

            return status();

        }

        if (
            drainFirst &&
            !state.draining
        ) {

            await drain({
                reason
            });

        }

        /*
         * Remove listeners installed by this manager.
         */
        for (
            const item of
            state.serverListeners
        ) {

            try {

                item.target.off?.(
                    item.event,
                    item.listener
                );

            } catch {
                // Ignore.
            }

        }

        state.serverListeners =
            [];

        clearTimers();

        state.stopped =
            true;

        emit(
            "stopped"
        );

        log(
            logger,
            "info",
            cfg.LOG_PREFIX,
            "request drain manager stopped"
        );

        return status();

    }

    // =========================================================================
    // Readiness
    // =========================================================================

    function setReadiness(
        value,
        reason = "manual"
    ) {

        /*
         * Never allow an externally requested readiness=true while draining.
         * This protects the fundamental shutdown invariant.
         */
        if (
            state.draining &&
            Boolean(value)
        ) {

            return false;

        }

        setReadinessInternal(
            Boolean(value),
            reason
        );

        return true;

    }

    // =========================================================================
    // Status
    // =========================================================================

    function status() {

        const now =
            Date.now();

        const activeRequestSnapshot =
            Array.from(
                state.activeRequests.values()
            )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        a.start -
                        b.start
                )
                .slice(
                    0,
                    cfg.MAX_DIAGNOSTIC_REQUESTS
                )
                .map(
                    request => ({
                        id:
                            request.id,

                        correlationId:
                            request.correlationId,

                        method:
                            request.method,

                        url:
                            request.url,

                        startedAt:
                            request.startedAt
                                .toISOString(),

                        ageMs:
                            now -
                            request.start,

                        socketId:
                            request.socketId
                    })
                );

        return {

            started:
                state.started,

            stopped:
                state.stopped,

            draining:
                state.draining,

            readiness:
                state.readiness,

            drainReason:
                state.drainReason,

            drainStartedAt:
                state.drainStartedAt
                    ?.toISOString() ||
                null,

            drainCompletedAt:
                state.drainCompletedAt
                    ?.toISOString() ||
                null,

            activeRequests:
                state.activeRequests.size,

            sockets:
                state.sockets.size,

            webSockets:
                state.webSockets.size,

            stats:
                Object.assign(
                    {},
                    state.stats
                ),

            requests:
                activeRequestSnapshot

        };

    }

    // =========================================================================
    // Active Request Diagnostics
    // =========================================================================

    function listActiveRequests() {

        return Array.from(
            state.activeRequests.values()
        )
            .sort(
                (
                    a,
                    b
                ) =>
                    a.start -
                    b.start
            )
            .slice(
                0,
                cfg.MAX_DIAGNOSTIC_REQUESTS
            )
            .map(
                request => ({
                    id:
                        request.id,

                    correlationId:
                        request.correlationId,

                    method:
                        request.method,

                    url:
                        request.url,

                    startedAt:
                        request.startedAt
                            .toISOString(),

                    ageMs:
                        Date.now() -
                        request.start,

                    socketId:
                        request.socketId
                })
            );

    }

    // =========================================================================
    // Event API
    // =========================================================================

    function on(
        eventName,
        listener
    ) {

        if (
            typeof eventName !==
            "string" ||
            !eventName.trim()
        ) {

            throw new TypeError(
                "eventName must be a non-empty string."
            );

        }

        if (
            typeof listener !==
            "function"
        ) {

            throw new TypeError(
                "listener must be a function."
            );

        }

        emitter.on(
            eventName,
            listener
        );

        return () => {

            emitter.off(
                eventName,
                listener
            );

        };

    }

    function once(
        eventName,
        listener
    ) {

        if (
            typeof eventName !==
            "string" ||
            !eventName.trim()
        ) {

            throw new TypeError(
                "eventName must be a non-empty string."
            );

        }

        if (
            typeof listener !==
            "function"
        ) {

            throw new TypeError(
                "listener must be a function."
            );

        }

        emitter.once(
            eventName,
            listener
        );

        return () => {

            emitter.off(
                eventName,
                listener
            );

        };

    }

    // =========================================================================
    // Public Manager
    // =========================================================================

    return Object.freeze({

        start,

        stop,

        drain,

        status,

        setReadiness,

        requestTrackingMiddleware,

        koaRequestTrackingMiddleware,

        attachHealthEndpoints,

        registerWebSocket,

        unregisterWebSocket,

        closeWebSockets,

        listActiveRequests,

        on,

        once,

        /*
         * Exposed for advanced integrations and tests.
         * Consumers should prefer the public methods above.
         */
        _internal: {

            state,

            config:
                cfg,

            emitter

        }

    });

}

// =============================================================================
// Exports
// =============================================================================

module.exports = Object.freeze({

    createRequestDrain,

    DEFAULTS

});