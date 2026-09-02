"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Server Runtime Orchestrator
 * =============================================================================
 *
 * File:
 *   backend/runtime/ServerRuntime.js
 *
 * Purpose:
 *   Central orchestration layer for the TITech application runtime.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ Application startup orchestration
 *   ✓ HTTP/HTTPS server lifecycle
 *   ✓ Request draining
 *   ✓ Graceful shutdown
 *   ✓ Fatal-error shutdown
 *   ✓ Runtime metrics initialization
 *   ✓ Runtime signal integration
 *   ✓ Cluster-awareness
 *   ✓ Runtime health reporting
 *   ✓ Readiness reporting
 *   ✓ Runtime event publication
 *   ✓ Startup/shutdown state management
 *   ✓ Backward compatibility with existing runtime modules
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   - ServerRuntime orchestrates; it does not contain business logic.
 *   - Financial transactions remain owned by the financial transaction layer.
 *   - Request draining remains owned by requestDrain.js.
 *   - HTTP server creation remains owned by httpServer.js.
 *   - Metrics remain owned by metrics.js.
 *   - Cluster lifecycle remains owned by clusterManager.js.
 *   - Signals remain owned by signalManager.js.
 *   - Runtime state remains owned by runtime/context.js and runtime/state.js.
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This implementation intentionally does NOT call process.exit() immediately
 * after every shutdown request. The application is first given an opportunity
 * to close servers, drain requests, and release resources.
 *
 * process.exit() is only used as a final fallback when explicitly configured.
 *
 * =============================================================================
 */

const EventEmitter = require("events");
const os = require("os");

// -----------------------------------------------------------------------------
// Runtime Components
// -----------------------------------------------------------------------------

const httpServerModule =
    require("./httpServer");

const requestDrainModule =
    require("./requestDrain");

const metrics =
    require("./metrics");

const clusterManager =
    require("./clusterManager");

const runtimeContext =
    require("./context");

const runtimeEvents =
    require("./events");

// -----------------------------------------------------------------------------
// Optional Signal Manager
// -----------------------------------------------------------------------------

let SignalManager = null;

try {

    SignalManager =
        require("./signalManager");

} catch (error) {

    /*
     * SignalManager may not exist in every deployment stage.
     *
     * ServerRuntime therefore provides its own safe signal registration
     * fallback below.
     */

    SignalManager = null;

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

    GRACEFUL_SHUTDOWN_TIMEOUT_MS:
        Number(
            process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ||
            30_000
        ),

    FORCE_EXIT_AFTER_MS:
        Number(
            process.env.RUNTIME_FORCE_EXIT_AFTER_MS ||
            10_000
        ),

    AUTO_REGISTER_SIGNALS:
        process.env.RUNTIME_AUTO_REGISTER_SIGNALS !==
        "false",

    AUTO_INITIALIZE_METRICS:
        process.env.RUNTIME_AUTO_INITIALIZE_METRICS !==
        "false",

    FORCE_PROCESS_EXIT:
        process.env.RUNTIME_FORCE_PROCESS_EXIT ===
        "true",

    LOG_PREFIX:
        "TITech.ServerRuntime"

});

// =============================================================================
// Utility Functions
// =============================================================================

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

function normalizeNumber(
    value,
    fallback
) {

    const number =
        Number(value);

    return Number.isFinite(
        number
    )
        ? number
        : fallback;

}

function safeLogger(
    logger,
    level,
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
            `${DEFAULTS.LOG_PREFIX} ${message}`,
            metadata
        );

    } catch {
        // Runtime logging must never stop shutdown.
    }

}

// =============================================================================
// Fallback Signal Manager
// =============================================================================

class LocalSignalManager {

    constructor({
        logger = console
    } = {}) {

        this.logger =
            logger;

        this.shutdownHandlers =
            new Set();

        this.fatalHandlers =
            new Set();

        this.registered =
            false;

        this._boundShutdown =
            this._handleShutdown.bind(
                this
            );

        this._boundFatal =
            this._handleFatal.bind(
                this
            );

        this._boundUnhandledRejection =
            this._handleUnhandledRejection.bind(
                this
            );

        this._boundUncaughtException =
            this._handleUncaughtException.bind(
                this
            );

    }

    registerShutdown(
        handler
    ) {

        if (
            typeof handler !==
            "function"
        ) {

            throw new TypeError(
                "Shutdown handler must be a function."
            );

        }

        this.shutdownHandlers.add(
            handler
        );

        this._ensureRegistered();

    }

    registerFatalHandlers(
        handler
    ) {

        if (
            typeof handler !==
            "function"
        ) {

            throw new TypeError(
                "Fatal handler must be a function."
            );

        }

        this.fatalHandlers.add(
            handler
        );

        this._ensureRegistered();

    }

    _ensureRegistered() {

        if (
            this.registered
        ) {

            return;

        }

        this.registered =
            true;

        process.once(
            "SIGTERM",
            this._boundShutdown
        );

        process.once(
            "SIGINT",
            this._boundShutdown
        );

        process.once(
            "uncaughtException",
            this._boundUncaughtException
        );

        process.once(
            "unhandledRejection",
            this._boundUnhandledRejection
        );

    }

    async _handleShutdown(
        signal
    ) {

        for (
            const handler of
            this.shutdownHandlers
        ) {

            try {

                await handler(
                    signal
                );

            } catch (error) {

                safeLogger(
                    this.logger,
                    "error",
                    "Shutdown handler failed",
                    {
                        signal,
                        error:
                            error?.message ||
                            String(error)
                    }
                );

            }

        }

    }

    async _handleFatal(
        error
    ) {

        for (
            const handler of
            this.fatalHandlers
        ) {

            try {

                await handler(
                    error
                );

            } catch (handlerError) {

                safeLogger(
                    this.logger,
                    "error",
                    "Fatal handler failed",
                    {
                        error:
                            handlerError?.message ||
                            String(handlerError)
                    }
                );

            }

        }

    }

    async _handleUncaughtException(
        error
    ) {

        await this._handleFatal(
            error
        );

    }

    async _handleUnhandledRejection(
        reason
    ) {

        const error =
            reason instanceof Error
                ? reason
                : new Error(
                    String(reason)
                );

        await this._handleFatal(
            error
        );

    }

    async dispose() {

        if (
            !this.registered
        ) {

            return;

        }

        process.off(
            "SIGTERM",
            this._boundShutdown
        );

        process.off(
            "SIGINT",
            this._boundShutdown
        );

        process.off(
            "uncaughtException",
            this._boundUncaughtException
        );

        process.off(
            "unhandledRejection",
            this._boundUnhandledRejection
        );

        this.shutdownHandlers.clear();
        this.fatalHandlers.clear();

        this.registered =
            false;

    }

}

// =============================================================================
// ServerRuntime
// =============================================================================

class ServerRuntime extends EventEmitter {

    constructor({

        app = null,

        config = null,

        bootstrap = null,

        logger = null,

        metricsClient = null,

        signalManager = null,

        cluster = null,

        httpServer = null,

        requestDrain = null,

        options = {}

    } = {}) {

        super();

        this.app =
            app;

        this.config =
            config;

        this.bootstrap =
            bootstrap;

        this.logger =
            logger ||
            console;

        this.metrics =
            metricsClient ||
            metrics;

        this.signalManager =
            signalManager;

        this.cluster =
            cluster ||
            clusterManager;

        this.httpServerManager =
            httpServer;

        this.drain =
            requestDrain;

        this.options = Object.assign(
            {},
            DEFAULTS,
            options
        );

        this.server =
            null;

        this.secureServer =
            null;

        this.appContext =
            null;

        this.startedAt =
            null;

        this.shutdownStartedAt =
            null;

        this.shutdownCompletedAt =
            null;

        this.starting =
            false;

        this.started =
            false;

        this.shuttingDown =
            false;

        this.stopped =
            false;

        this.startupError =
            null;

        this.shutdownError =
            null;

        this._signalHandlersRegistered =
            false;

        this._fallbackSignalManager =
            null;

    }

    // =========================================================================
    // Configuration Resolution
    // =========================================================================

    _resolveServerConfig() {

        let serverConfig = {};

        try {

            if (
                this.config &&
                typeof this.config.server ===
                "function"
            ) {

                serverConfig =
                    this.config.server() ||
                    {};

            } else if (
                this.config &&
                this.config.server &&
                typeof this.config.server ===
                "object"
            ) {

                serverConfig =
                    this.config.server;

            }

        } catch (error) {

            safeLogger(
                this.logger,
                "warn",
                "Unable to resolve server configuration",
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );

        }

        const port =
            normalizeNumber(
                serverConfig.port,
                normalizeNumber(
                    this.options.PORT,
                    DEFAULTS.PORT
                )
            );

        const host =
            serverConfig.host ||
            this.options.HOST ||
            DEFAULTS.HOST;

        return {

            host,

            port,

            ...serverConfig

        };

    }

    // =========================================================================
    // Logger / Metrics Helpers
    // =========================================================================

    _metricIncrement(
        name,
        value = 1,
        labels = {}
    ) {

        try {

            if (
                this.metrics &&
                typeof this.metrics.inc ===
                "function"
            ) {

                this.metrics.inc(
                    name,
                    value,
                    labels
                );

                return;

            }

            if (
                this.metrics &&
                typeof this.metrics.increment ===
                "function"
            ) {

                this.metrics.increment(
                    name,
                    value,
                    labels
                );

            }

        } catch {
            // Metrics failures must not affect runtime lifecycle.
        }

    }

    _metricGauge(
        name,
        value,
        labels = {}
    ) {

        try {

            if (
                this.metrics &&
                typeof this.metrics.set ===
                "function"
            ) {

                this.metrics.set(
                    name,
                    value,
                    labels
                );

                return;

            }

            if (
                this.metrics &&
                typeof this.metrics.gauge ===
                "function"
            ) {

                this.metrics.gauge(
                    name,
                    value,
                    labels
                );

            }

        } catch {
            // Ignore telemetry failures.
        }

    }

    // =========================================================================
    // Metrics Initialization
    // =========================================================================

    async _initializeMetrics() {

        if (
            !this.options.AUTO_INITIALIZE_METRICS ||
            !this.metrics ||
            typeof this.metrics.init !==
            "function"
        ) {

            return;

        }

        try {

            await this.metrics.init({

                metricsPrefix:
                    process.env.METRICS_PREFIX ||
                    "titech",

                defaultLabels: {

                    service:
                        process.env.SERVICE_NAME ||
                        "TITech.ServerRuntime",

                    instance:
                        os.hostname(),

                    pid:
                        String(
                            process.pid
                        )

                }

            });

            this.emit(
                "metrics:ready"
            );

        } catch (error) {

            safeLogger(
                this.logger,
                "warn",
                "Runtime metrics initialization failed",
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );

            this.emit(
                "metrics:error",
                error
            );

        }

    }

    // =========================================================================
    // HTTP Server Manager Creation
    // =========================================================================

    async _createHttpServerManager() {

        if (
            this.httpServerManager
        ) {

            return this.httpServerManager;

        }

        /*
         * Enhanced httpServer.js exports:
         *
         *   createHttpServer(options)
         *
         * and returns a ServerManager.
         */

        if (
            !httpServerModule ||
            typeof httpServerModule.createHttpServer !==
            "function"
        ) {

            throw new Error(
                "TITech HTTP server factory is unavailable."
            );

        }

        this.httpServerManager =
            await httpServerModule.createHttpServer({

                appFactory:
                    async () => {

                        /*
                         * ServerRuntime receives an already-created app.
                         */
                        return {

                            type:
                                this._detectAppType(),

                            app:
                                this.app,

                            healthcheck:
                                this._healthcheck.bind(
                                    this
                                ),

                            readiness:
                                this._readiness.bind(
                                    this
                                ),

                            close:
                                async () => {

                                    await this._closeApplicationResources();

                                }

                        };

                    },

                logger:
                    this.logger,

                metrics:
                    this.metrics,

                HOST:
                    this._resolveServerConfig().host,

                PORT:
                    this._resolveServerConfig().port,

                ...this.options

            });

        return this.httpServerManager;

    }

    _detectAppType() {

        if (
            this.app &&
            this.app.callback &&
            typeof this.app.callback ===
            "function"
        ) {

            return "koa";

        }

        return "express";

    }

    // =========================================================================
    // Request Drain Creation
    // =========================================================================

    _createRequestDrain(
        server,
        secureServer
    ) {

        if (
            this.drain
        ) {

            return this.drain;

        }

        if (
            !requestDrainModule ||
            typeof requestDrainModule.createRequestDrain !==
            "function"
        ) {

            throw new Error(
                "TITech request drain factory is unavailable."
            );

        }

        this.drain =
            requestDrainModule.createRequestDrain({

                server,

                secureServer,

                logger:
                    this.logger,

                metrics:
                    this.metrics,

                healthApp:
                    this.app,

                gracefulTimeoutMs:
                    this.options
                        .GRACEFUL_SHUTDOWN_TIMEOUT_MS

            });

        this.drain.on(
            "drain:started",
            event => {

                this.emit(
                    "drain:started",
                    event
                );

            }
        );

        this.drain.on(
            "drain:finished",
            event => {

                this.emit(
                    "drain:finished",
                    event
                );

            }
        );

        this.drain.on(
            "readiness:changed",
            event => {

                this.emit(
                    "readiness:changed",
                    event
                );

            }
        );

        return this.drain;

    }

    // =========================================================================
    // Signal Manager
    // =========================================================================

    _createSignalManager() {

        if (
            this.signalManager
        ) {

            return this.signalManager;

        }

        if (
            SignalManager
        ) {

            try {

                /*
                 * Supports modules exporting either:
                 *
                 *   class SignalManager
                 *
                 * or:
                 *
                 *   { SignalManager }
                 */

                const Constructor =
                    typeof SignalManager ===
                    "function"
                        ? SignalManager
                        : SignalManager.SignalManager;

                if (
                    typeof Constructor ===
                    "function"
                ) {

                    this.signalManager =
                        new Constructor({
                            logger:
                                this.logger
                        });

                    return this.signalManager;

                }

            } catch (error) {

                safeLogger(
                    this.logger,
                    "warn",
                    "Unable to initialize SignalManager",
                    {
                        error:
                            error?.message ||
                            String(error)
                    }
                );

            }

        }

        this._fallbackSignalManager =
            new LocalSignalManager({
                logger:
                    this.logger
            });

        this.signalManager =
            this._fallbackSignalManager;

        return this.signalManager;

    }

    // =========================================================================
    // Cluster Identity
    // =========================================================================

    _clusterIdentity() {

        try {

            if (
                this.cluster &&
                typeof this.cluster.getWorkerCount ===
                "function"
            ) {

                return {

                    workerCount:
                        this.cluster.getWorkerCount(),

                    role:
                        typeof this.cluster.isWorker ===
                        "function" &&
                        this.cluster.isWorker()
                            ? "worker"
                            : "master",

                    pid:
                        process.pid

                };

            }

            if (
                this.cluster &&
                typeof this.cluster.manager !==
                "undefined"
            ) {

                return {

                    pid:
                        process.pid,

                    role:
                        this.cluster.isWorker?.()
                            ? "worker"
                            : "master",

                    workerCount:
                        this.cluster.getWorkerCount?.() ||
                        0

                };

            }

        } catch {
            // Fall through.
        }

        return {

            pid:
                process.pid,

            role:
                "standalone",

            workerCount:
                1

        };

    }

    // =========================================================================
    // Runtime State Integration
    // =========================================================================

    _markRuntimeStarted() {

        try {

            runtimeContext.markApplicationStarted?.();

            runtimeContext.updateBootstrapPhase?.(
                runtimeContext.BOOTSTRAP_PHASES?.STARTING ||
                "STARTING"
            );

        } catch {
            // Optional runtime state integration.
        }

    }

    _markRuntimeReady() {

        try {

            runtimeContext.markApplicationReady?.();

            runtimeContext.updateBootstrapPhase?.(
                runtimeContext.BOOTSTRAP_PHASES?.READY ||
                "READY"
            );

        } catch {
            // Optional runtime state integration.
        }

    }

    _markRuntimeShutdown() {

        try {

            runtimeContext.markApplicationShutdown?.();

            runtimeContext.updateBootstrapPhase?.(
                runtimeContext.BOOTSTRAP_PHASES?.SHUTTING_DOWN ||
                "SHUTTING_DOWN"
            );

        } catch {
            // Optional runtime state integration.
        }

    }

    _markRuntimeStopped() {

        try {

            runtimeContext.markApplicationStopped?.();

            runtimeContext.updateBootstrapPhase?.(
                runtimeContext.BOOTSTRAP_PHASES?.STOPPED ||
                "STOPPED"
            );

        } catch {
            // Optional runtime state integration.
        }

    }

    // =========================================================================
    // Event Publication
    // =========================================================================

    _emitRuntimeEvent(
        eventName,
        payload = {}
    ) {

        try {

            if (
                runtimeEvents &&
                typeof runtimeEvents.emitEvent ===
                "function"
            ) {

                runtimeEvents.emitEvent(
                    eventName,
                    payload
                );

            }

        } catch {
            // Runtime event publication must never stop startup/shutdown.
        }

    }

    // =========================================================================
    // Application Resource Shutdown
    // =========================================================================

    async _closeApplicationResources() {

        if (
            !this.appContext
        ) {

            return;

        }

        if (
            typeof this.appContext.close ===
            "function"
        ) {

            await this.appContext.close();

        }

    }

    // =========================================================================
    // Start
    // =========================================================================

    async start() {

        if (
            this.started
        ) {

            return this.info();

        }

        if (
            this.starting
        ) {

            throw new Error(
                "TITech ServerRuntime startup is already in progress."
            );

        }

        if (
            this.stopped
        ) {

            throw new Error(
                "TITech ServerRuntime cannot be restarted after shutdown."
            );

        }

        if (
            !this.app
        ) {

            throw new Error(
                "Application instance is required."
            );

        }

        this.starting =
            true;

        this.startupError =
            null;

        const startedAt =
            Date.now();

        this._markRuntimeStarted();

        this._metricIncrement(
            "titech.server_runtime.starting_total"
        );

        this._emitRuntimeEvent(
            "application.starting",
            {
                pid:
                    process.pid
            }
        );

        safeLogger(
            this.logger,
            "info",
            "Server runtime starting",
            {
                pid:
                    process.pid,

                node:
                    process.version,

                platform:
                    process.platform
            }
        );

        try {

            await this._initializeMetrics();

            /*
             * If an externally supplied server manager exists, use it.
             * Otherwise create one from httpServer.js.
             */
            const manager =
                await this._createHttpServerManager();

            /*
             * Start the server manager.
             */
            const result =
                await manager.start();

            this.server =
                result?.server ||
                manager.server ||
                null;

            this.secureServer =
                result?.secureServer ||
                manager.secureServer ||
                manager.http2Server ||
                null;

            this.appContext =
                result?.appContext ||
                manager._appContext ||
                this.appContext ||
                {};

            /*
             * Request drain is attached after the actual HTTP server exists.
             */
            if (
                this.server
            ) {

                this._createRequestDrain(
                    this.server,
                    this.secureServer
                );

                await this.drain.start();

                /*
                 * Tracking middleware must be installed BEFORE routes for
                 * Express applications. Therefore, if ServerRuntime creates
                 * the HTTP server around an already-created app, consumers
                 * should normally attach requestTrackingMiddleware() before
                 * calling start().
                 *
                 * We still expose the middleware through this instance and
                 * attach it when Express permits late registration.
                 */
                this._attachRequestTrackingMiddleware();

            }

            this.startedAt =
                new Date();

            this.started =
                true;

            this.starting =
                false;

            this._markRuntimeReady();

            this._metricIncrement(
                "titech.server_runtime.started_total"
            );

            this._metricGauge(
                "titech.server_runtime.ready",
                1
            );

            const startupDuration =
                Date.now() -
                startedAt;

            this._metricIncrement(
                "titech.server_runtime.startup_duration_ms",
                startupDuration
            );

            this._emitRuntimeEvent(
                "application.ready",
                {
                    pid:
                        process.pid,

                    startupDurationMs:
                        startupDuration,

                    cluster:
                        this._clusterIdentity()
                }
            );

            this.emit(
                "ready",
                this.info()
            );

            safeLogger(
                this.logger,
                "info",
                "HTTP server ready",
                this.info()
            );

            if (
                this.options.AUTO_REGISTER_SIGNALS
            ) {

                this.registerSignals();

            }

            return this.info();

        } catch (error) {

            this.starting =
                false;

            this.startupError =
                error;

            this._metricIncrement(
                "titech.server_runtime.startup_failed_total"
            );

            this._metricGauge(
                "titech.server_runtime.ready",
                0
            );

            this._emitRuntimeEvent(
                "application.start_failed",
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );

            safeLogger(
                this.logger,
                "error",
                "Server runtime startup failed",
                {
                    error:
                        error?.message ||
                        String(error),

                    stack:
                        error?.stack
                }
            );

            /*
             * Best-effort cleanup of resources created during a failed start.
             */
            try {

                await this._closeServerManager();

            } catch {
                // Preserve startup error.
            }

            throw error;

        }

    }

    // =========================================================================
    // Request Tracking Attachment
    // =========================================================================

    _attachRequestTrackingMiddleware() {

        if (
            !this.drain ||
            !this.app
        ) {

            return;

        }

        /*
         * The manager intentionally does not silently reorder an application's
         * middleware chain. Consumers can explicitly call:
         *
         *   app.use(runtime.getRequestTrackingMiddleware())
         *
         * before routes.
         *
         * If the application supports use(), attach automatically only when
         * explicitly enabled.
         */
        if (
            this.options.AUTO_ATTACH_REQUEST_TRACKING &&
            typeof this.app.use ===
            "function" &&
            typeof this.drain.requestTrackingMiddleware ===
            "function"
        ) {

            try {

                this.app.use(
                    this.drain.requestTrackingMiddleware()
                );

            } catch (error) {

                safeLogger(
                    this.logger,
                    "warn",
                    "Unable to attach request tracking middleware automatically",
                    {
                        error:
                            error?.message ||
                            String(error)
                    }
                );

            }

        }

    }

    getRequestTrackingMiddleware() {

        if (
            !this.drain ||
            typeof this.drain.requestTrackingMiddleware !==
            "function"
        ) {

            return null;

        }

        return this.drain
            .requestTrackingMiddleware();

    }

    // =========================================================================
    // Signal Registration
    // =========================================================================

    registerSignals() {

        if (
            this._signalHandlersRegistered
        ) {

            return this.signalManager;

        }

        const signals =
            this._createSignalManager();

        if (
            signals &&
            typeof signals.registerShutdown ===
            "function"
        ) {

            signals.registerShutdown(
                async signal => {

                    await this.shutdown(
                        signal ||
                        "SIGTERM"
                    );

                }
            );

        } else {

            throw new Error(
                "Signal manager does not support registerShutdown()."
            );

        }

        if (
            signals &&
            typeof signals.registerFatalHandlers ===
            "function"
        ) {

            signals.registerFatalHandlers(
                async error => {

                    await this.fatalShutdown(
                        error
                    );

                }
            );

        }

        this._signalHandlersRegistered =
            true;

        this._emitRuntimeEvent(
            "runtime.signals.registered",
            {
                pid:
                    process.pid
            }
        );

        return signals;

    }

    // =========================================================================
    // Shutdown
    // =========================================================================

    async shutdown(
        signal = "SIGTERM",
        {
            exit = this.options.FORCE_PROCESS_EXIT,
            exitCode = 0
        } = {}
    ) {

        if (
            this.shutdownPromise
        ) {

            return this.shutdownPromise;

        }

        this.shutdownPromise =
            this._shutdown(
                signal,
                {
                    exit,
                    exitCode
                }
            );

        return this.shutdownPromise;

    }

    async _shutdown(
        signal,
        {
            exit = false,
            exitCode = 0
        } = {}
    ) {

        if (
            this.shuttingDown
        ) {

            return this.info();

        }

        this.shuttingDown =
            true;

        this.shutdownStartedAt =
            new Date();

        this._markRuntimeShutdown();

        this._metricGauge(
            "titech.server_runtime.ready",
            0
        );

        this._metricIncrement(
            "titech.server_runtime.shutdown_started_total",
            1,
            {
                signal:
                    String(
                        signal
                    )
            }
        );

        this._emitRuntimeEvent(
            "application.shutdown",
            {
                signal:
                    String(
                        signal
                    )
            }
        );

        safeLogger(
            this.logger,
            "info",
            "Graceful shutdown initiated",
            {
                signal,
                activeRequests:
                    this.drain?.status?.()
                        ?.activeRequests ||
                    0
            }
        );

        try {

            /*
             * 1. Mark readiness false and drain HTTP requests.
             */
            if (
                this.drain &&
                typeof this.drain.drain ===
                "function"
            ) {

                await this.drain.drain({

                    reason:
                        signal,

                    gracefulTimeoutMs:
                        normalizeNumber(
                            this.options
                                .GRACEFUL_SHUTDOWN_TIMEOUT_MS,
                            DEFAULTS
                                .GRACEFUL_SHUTDOWN_TIMEOUT_MS
                        ),

                    forceKill:
                        false

                });

            }

            /*
             * 2. Close the HTTP server manager.
             *
             * The request drain normally closes the listener itself, so
             * httpServer.shutdown() becomes a second safe cleanup boundary.
             */
            await this._closeServerManager();

            /*
             * 3. Stop metrics if supported.
             */
            try {

                if (
                    this.metrics &&
                    typeof this.metrics.shutdown ===
                    "function"
                ) {

                    await this.metrics.shutdown({
                        push:
                            false,

                        clear:
                            false
                    });

                }

            } catch (error) {

                safeLogger(
                    this.logger,
                    "warn",
                    "Metrics shutdown failed",
                    {
                        error:
                            error?.message ||
                            String(error)
                    }
                );

            }

            this.shutdownCompletedAt =
                new Date();

            this.stopped =
                true;

            this.started =
                false;

            this._markRuntimeStopped();

            this._metricIncrement(
                "titech.server_runtime.shutdown_completed_total"
            );

            this._metricGauge(
                "titech.server_runtime.ready",
                0
            );

            this._emitRuntimeEvent(
                "application.stopped",
                {
                    signal:
                        String(
                            signal
                        )
                }
            );

            this.emit(
                "shutdown",
                this.info()
            );

            safeLogger(
                this.logger,
                "info",
                "Graceful shutdown completed",
                {
                    signal,

                    durationMs:
                        this.shutdownCompletedAt.getTime() -
                        this.shutdownStartedAt.getTime()
                }
            );

            if (
                exit
            ) {

                await this._exitAfterShutdown(
                    exitCode
                );

            }

            return this.info();

        } catch (error) {

            this.shutdownError =
                error;

            this._metricIncrement(
                "titech.server_runtime.shutdown_failed_total"
            );

            this._emitRuntimeEvent(
                "application.shutdown_failed",
                {
                    signal:
                        String(
                            signal
                        ),

                    error:
                        error?.message ||
                        String(error)
                }
            );

            safeLogger(
                this.logger,
                "error",
                "Graceful shutdown failed",
                {
                    signal,

                    error:
                        error?.message ||
                        String(error),

                    stack:
                        error?.stack
                }
            );

            if (
                exit
            ) {

                await this._exitAfterShutdown(
                    exitCode
                );

            }

            throw error;

        }

    }

    // =========================================================================
    // Fatal Shutdown
    // =========================================================================

    async fatalShutdown(
        error
    ) {

        safeLogger(
            this.logger,
            "error",
            "Fatal runtime error received",
            {
                error:
                    error?.message ||
                    String(error),

                stack:
                    error?.stack
            }
        );

        this._metricIncrement(
            "titech.server_runtime.fatal_errors_total"
        );

        this._emitRuntimeEvent(
            "runtime.fatal_error",
            {
                error:
                    error?.message ||
                    String(error)
            }
        );

        try {

            await this.shutdown(
                "FATAL",
                {
                    exit:
                        true,

                    exitCode:
                        1
                }
            );

        } catch (shutdownError) {

            safeLogger(
                this.logger,
                "error",
                "Fatal shutdown encountered an additional error",
                {
                    error:
                        shutdownError?.message ||
                        String(shutdownError)
                }
            );

            /*
             * Last-resort exit. This path should be rare.
             */
            try {

                process.exit(
                    1
                );

            } catch {
                // No-op.
            }

        }

    }

    // =========================================================================
    // HTTP Server Closure
    // =========================================================================

    async _closeServerManager() {

        if (
            !this.httpServerManager
        ) {

            return;

        }

        if (
            typeof this.httpServerManager.shutdown ===
            "function"
        ) {

            try {

                await this.httpServerManager.shutdown(
                    "SERVER_RUNTIME"
                );

            } catch (error) {

                /*
                 * Node may report ERR_SERVER_NOT_RUNNING when the request
                 * drain already closed the listener. Treat that as harmless.
                 */
                if (
                    error?.code ===
                    "ERR_SERVER_NOT_RUNNING"
                ) {

                    return;

                }

                throw error;

            }

        }

    }

    // =========================================================================
    // Final Process Exit
    // =========================================================================

    async _exitAfterShutdown(
        exitCode
    ) {

        const delay =
            Math.max(
                0,
                normalizeNumber(
                    this.options
                        .FORCE_EXIT_AFTER_MS,
                    DEFAULTS
                        .FORCE_EXIT_AFTER_MS
                )
            );

        if (
            delay ===
            0
        ) {

            process.exit(
                exitCode
            );

            return;

        }

        /*
         * Give Node a short final window for stdout/stderr flushing and any
         * event-loop cleanup before forcing process termination.
         */
        await sleep(
            delay
        );

        process.exit(
            exitCode
        );

    }

    // =========================================================================
    // Health
    // =========================================================================

    async _healthcheck() {

        const drainStatus =
            this.drain &&
            typeof this.drain.status ===
            "function"
                ? this.drain.status()
                : null;

        return {

            ok:
                !this.shutdownError,

            service:
                "TITech.ServerRuntime",

            status:
                this.shuttingDown
                    ? "shutting_down"
                    : this.started
                        ? "running"
                        : "stopped",

            uptime:
                process.uptime(),

            timestamp:
                new Date().toISOString(),

            pid:
                process.pid,

            memory:
                process.memoryUsage(),

            drain:
                drainStatus

        };

    }

    async _readiness() {

        const ready =
            this.started &&
            !this.starting &&
            !this.shuttingDown &&
            !this.stopped;

        return {

            ready,

            service:
                "TITech.ServerRuntime",

            timestamp:
                new Date().toISOString(),

            reason:
                !this.started
                    ? "not_started"
                    : this.starting
                        ? "starting"
                        : this.shuttingDown
                            ? "shutting_down"
                            : this.stopped
                                ? "stopped"
                                : "ready"

        };

    }

    async health() {

        return this._healthcheck();

    }

    async readiness() {

        return this._readiness();

    }

    // =========================================================================
    // Runtime Information
    // =========================================================================

    info() {

        const config =
            this._resolveServerConfig();

        const drainStatus =
            this.drain &&
            typeof this.drain.status ===
            "function"
                ? this.drain.status()
                : null;

        return {

            service:
                "TITech.ServerRuntime",

            application:
                runtimeContext?.APPLICATION
                    ?.company ||
                "TITech Community Capital LTD",

            platform:
                runtimeContext?.APPLICATION
                    ?.platform ||
                "TITech",

            status:
                this.shuttingDown
                    ? "shutting_down"
                    : this.starting
                        ? "starting"
                        : this.started
                            ? "running"
                            : this.stopped
                                ? "stopped"
                                : "initialized",

            host:
                config.host,

            port:
                config.port,

            startedAt:
                this.startedAt?.toISOString() ||
                null,

            shutdownStartedAt:
                this.shutdownStartedAt?.toISOString() ||
                null,

            shutdownCompletedAt:
                this.shutdownCompletedAt?.toISOString() ||
                null,

            uptime:
                process.uptime(),

            process: {

                pid:
                    process.pid,

                parentPid:
                    process.ppid,

                nodeVersion:
                    process.version,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                hostname:
                    os.hostname()

            },

            cluster:
                this._clusterIdentity(),

            server: {

                http:
                    Boolean(
                        this.server
                    ),

                secure:
                    Boolean(
                        this.secureServer
                    )

            },

            drain:
                drainStatus

        };

    }

    // =========================================================================
    // Runtime Snapshot
    // =========================================================================

    snapshot() {

        let runtimeSnapshot =
            null;

        try {

            if (
                typeof runtimeContext
                    ?.buildRuntimeSnapshot ===
                "function"
            ) {

                runtimeSnapshot =
                    runtimeContext
                        .buildRuntimeSnapshot();

            }

        } catch {
            runtimeSnapshot =
                null;
        }

        return {

            runtime:
                runtimeSnapshot,

            server:
                this.info(),

            health:
                {
                    started:
                        this.started,

                    starting:
                        this.starting,

                    shuttingDown:
                        this.shuttingDown,

                    stopped:
                        this.stopped
                }

        };

    }

    // =========================================================================
    // Stop
    // =========================================================================

    async stop(
        options = {}
    ) {

        return this.shutdown(
            options.signal ||
            "STOP",
            options
        );

    }

}

// =============================================================================
// Factory
// =============================================================================

function createServerRuntime(
    options = {}
) {

    return new ServerRuntime(
        options
    );

}

// =============================================================================
// Default Singleton
// =============================================================================
//
// A singleton is provided for applications using the runtime as a process-level
// service. Tests and advanced deployments may instantiate ServerRuntime directly.
//
// =============================================================================

const serverRuntime =
    createServerRuntime();

// =============================================================================
// Backward-Compatible Convenience API
// =============================================================================

async function start(
    options = {}
) {

    /*
     * Allow one-off construction while preserving the singleton API.
     */
    if (
        Object.keys(
            options
        ).length > 0 &&
        !serverRuntime.started
    ) {

        Object.assign(
            serverRuntime,
            options
        );

    }

    return serverRuntime.start();

}

async function shutdown(
    signal = "SIGTERM",
    options = {}
) {

    return serverRuntime.shutdown(
        signal,
        options
    );

}

async function health() {

    return serverRuntime.health();

}

async function readiness() {

    return serverRuntime.readiness();

}

function info() {

    return serverRuntime.info();

}

function snapshot() {

    return serverRuntime.snapshot();

}

// =============================================================================
// Exports
// =============================================================================

module.exports = Object.freeze({

    ServerRuntime,

    createServerRuntime,

    serverRuntime,

    start,

    shutdown,

    health,

    readiness,

    info,

    snapshot,

    DEFAULTS

});