"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Signal Manager
 * =============================================================================
 *
 * File:
 *   backend/runtime/signalManager.js
 *
 * Purpose:
 *   Centralized, production-grade operating-system signal and fatal-process
 *   event management for the TITech runtime.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ SIGTERM graceful shutdown registration
 *   ✓ SIGINT graceful shutdown registration
 *   ✓ SIGHUP optional reload/restart registration
 *   ✓ SIGUSR1 / SIGUSR2 application hooks
 *   ✓ uncaughtException handling
 *   ✓ unhandledRejection handling
 *   ✓ beforeExit / exit lifecycle observability
 *   ✓ Duplicate-handler protection
 *   ✓ Idempotent shutdown execution
 *   ✓ Fatal-event normalization
 *   ✓ Handler timeout protection
 *   ✓ Structured logging
 *   ✓ Runtime metrics integration
 *   ✓ Runtime event-bus integration
 *   ✓ Safe cleanup / disposal
 *   ✓ Compatibility with ServerRuntime
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   - SignalManager owns process signal registration.
 *   - ServerRuntime owns application shutdown orchestration.
 *   - SignalManager does not contain business logic.
 *   - SignalManager does not directly terminate healthy processes.
 *   - Fatal errors are escalated to the runtime shutdown coordinator.
 *   - Handlers are executed at most once for a lifecycle event.
 *   - Listener failures are observable and never silently discarded.
 *
 * =============================================================================
 */

const EventEmitter = require("events");
const os = require("os");

// =============================================================================
// Defaults
// =============================================================================

const DEFAULTS = Object.freeze({

    LOG_PREFIX:
        "TITech.SignalManager",

    SHUTDOWN_SIGNALS:
        Object.freeze([
            "SIGTERM",
            "SIGINT"
        ]),

    RELOAD_SIGNALS:
        Object.freeze([
            "SIGHUP"
        ]),

    USER_SIGNALS:
        Object.freeze([
            "SIGUSR1",
            "SIGUSR2"
        ]),

    HANDLER_TIMEOUT_MS:
        Number(
            process.env.RUNTIME_SIGNAL_HANDLER_TIMEOUT_MS ||
            30_000
        ),

    FATAL_HANDLER_TIMEOUT_MS:
        Number(
            process.env.RUNTIME_FATAL_HANDLER_TIMEOUT_MS ||
            15_000
        ),

    EXIT_GRACE_PERIOD_MS:
        Number(
            process.env.RUNTIME_SIGNAL_EXIT_GRACE_PERIOD_MS ||
            1_000
        ),

    FORCE_EXIT_ON_FATAL:
        process.env.RUNTIME_FORCE_EXIT_ON_FATAL ===
        "true",

    ENABLE_SIGHUP:
        process.env.RUNTIME_ENABLE_SIGHUP !==
        "false",

    ENABLE_USER_SIGNALS:
        process.env.RUNTIME_ENABLE_USER_SIGNALS ===
        "true",

    HANDLE_UNCAUGHT_EXCEPTION:
        process.env.RUNTIME_HANDLE_UNCAUGHT_EXCEPTION !==
        "false",

    HANDLE_UNHANDLED_REJECTION:
        process.env.RUNTIME_HANDLE_UNHANDLED_REJECTION !==
        "false",

    ENABLE_BEFORE_EXIT:
        process.env.RUNTIME_ENABLE_BEFORE_EXIT ===
        "true",

    ENABLE_EXIT_EVENT:
        process.env.RUNTIME_ENABLE_EXIT_EVENT !==
        "false",

    MAX_HANDLER_COUNT:
        Number(
            process.env.RUNTIME_MAX_SIGNAL_HANDLERS ||
            25
        )

});

// =============================================================================
// Utility Functions
// =============================================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}

function normalizeError(
    value
) {

    if (
        value instanceof Error
    ) {

        return value;

    }

    if (
        value &&
        typeof value === "object"
    ) {

        const error =
            new Error(
                value.message ||
                "Unknown runtime error"
            );

        if (
            value.name
        ) {
            error.name =
                value.name;
        }

        if (
            value.code
        ) {
            error.code =
                value.code;
        }

        if (
            value.stack
        ) {
            error.stack =
                value.stack;
        }

        return error;

    }

    return new Error(
        String(
            value ||
            "Unknown runtime error"
        )
    );

}

function normalizeSignal(
    signal
) {

    if (
        typeof signal !==
        "string"
    ) {

        throw new TypeError(
            "Signal must be a string."
        );

    }

    const normalized =
        signal
            .trim()
            .toUpperCase();

    if (
        !normalized
    ) {

        throw new TypeError(
            "Signal must be a non-empty string."
        );

    }

    return normalized;

}

// =============================================================================
// SignalManager
// =============================================================================

class SignalManager extends EventEmitter {

    constructor({
        logger = console,
        metrics = null,
        runtimeEvents = null,
        options = {}
    } = {}) {

        super();

        this.logger =
            logger ||
            console;

        this.metrics =
            metrics ||
            null;

        this.runtimeEvents =
            runtimeEvents ||
            null;

        this.options = Object.assign(
            {},
            DEFAULTS,
            options
        );

        this.handlers =
            new Map();

        this.shutdownHandlers =
            new Set();

        this.fatalHandlers =
            new Set();

        this.reloadHandlers =
            new Set();

        this.userSignalHandlers =
            new Map();

        this.registeredSignals =
            new Set();

        this._registrations =
            new Map();

        this._shutdownPromise =
            null;

        this._fatalPromise =
            null;

        this._disposed =
            false;

        this._started =
            false;

        this._state = {

            shutdownRequested:
                false,

            fatalErrorReceived:
                false,

            shutdownSignal:
                null,

            fatalError:
                null,

            shutdownStartedAt:
                null,

            shutdownCompletedAt:
                null

        };

        this._boundShutdownSignal =
            this._handleShutdownSignal.bind(
                this
            );

        this._boundSighup =
            this._handleSighup.bind(
                this
            );

        this._boundSigusr1 =
            signal =>
                this._handleUserSignal(
                    signal
                );

        this._boundSigusr2 =
            signal =>
                this._handleUserSignal(
                    signal
                );

        this._boundUncaughtException =
            this._handleUncaughtException.bind(
                this
            );

        this._boundUnhandledRejection =
            this._handleUnhandledRejection.bind(
                this
            );

        this._boundBeforeExit =
            this._handleBeforeExit.bind(
                this
            );

        this._boundExit =
            this._handleExit.bind(
                this
            );

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

            const target =
                this.logger &&
                typeof this.logger[level] ===
                "function"
                    ? this.logger
                    : console;

            target[level](
                `${this.options.LOG_PREFIX} ${message}`,
                metadata
            );

        } catch {
            // Never allow logging failures to break runtime lifecycle.
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
            // Metrics are observational only.
        }

    }

    // =========================================================================
    // Runtime Event Publication
    // =========================================================================

    _emitRuntimeEvent(
        eventName,
        payload = {}
    ) {

        try {

            if (
                this.runtimeEvents &&
                typeof this.runtimeEvents.emitEvent ===
                "function"
            ) {

                this.runtimeEvents.emitEvent(
                    eventName,
                    payload
                );

            }

        } catch {
            // Runtime events must never prevent shutdown.
        }

    }

    // =========================================================================
    // Handler Validation
    // =========================================================================

    _validateHandler(
        callback
    ) {

        if (
            typeof callback !==
            "function"
        ) {

            throw new TypeError(
                "Signal handler must be a function."
            );

        }

        return callback;

    }

    _registerHandler(
        collection,
        callback,
        type
    ) {

        this._validateHandler(
            callback
        );

        if (
            collection.size >=
            this.options.MAX_HANDLER_COUNT
        ) {

            throw new Error(
                `Maximum ${this.options.MAX_HANDLER_COUNT} ${type} handlers allowed.`
            );

        }

        collection.add(
            callback
        );

        return () => {

            collection.delete(
                callback
            );

        };

    }

    // =========================================================================
    // Generic Signal Registration
    // =========================================================================

    register(
        signal,
        callback,
        options = {}
    ) {

        if (
            this._disposed
        ) {

            throw new Error(
                "SignalManager has been disposed."
            );

        }

        const normalizedSignal =
            normalizeSignal(
                signal
            );

        this._validateHandler(
            callback
        );

        const once =
            options.once !==
            false;

        const key =
            `${normalizedSignal}:${callback}`;

        if (
            this._registrations.has(
                key
            )
        ) {

            return this._registrations.get(
                key
            ).dispose;

        }

        const listener =
            (...args) =>
                this._invokeSafeHandler(
                    callback,
                    args,
                    {
                        signal:
                            normalizedSignal
                    }
                );

        if (
            once
        ) {

            process.once(
                normalizedSignal,
                listener
            );

        } else {

            process.on(
                normalizedSignal,
                listener
            );

        }

        const dispose =
            () => {

                process.off(
                    normalizedSignal,
                    listener
                );

                this._registrations.delete(
                    key
                );

                this.registeredSignals.delete(
                    normalizedSignal
                );

            };

        this._registrations.set(
            key,
            {
                signal:
                    normalizedSignal,
                callback,
                listener,
                dispose
            }
        );

        this.registeredSignals.add(
            normalizedSignal
        );

        return dispose;

    }

    // =========================================================================
    // Safe Handler Invocation
    // =========================================================================

    async _invokeSafeHandler(
        callback,
        args = [],
        metadata = {}
    ) {

        try {

            return await this._withTimeout(
                Promise.resolve(
                    callback(
                        ...args
                    )
                ),
                this.options
                    .HANDLER_TIMEOUT_MS,
                `Signal handler timeout for ${metadata.signal || "unknown"}`
            );

        } catch (error) {

            const normalized =
                normalizeError(
                    error
                );

            this._incrementMetric(
                "titech.signal.handler_failure_total",
                1,
                {
                    signal:
                        metadata.signal ||
                        "unknown"
                }
            );

            this._log(
                "error",
                "Signal handler failed",
                {
                    signal:
                        metadata.signal ||
                        null,
                    error:
                        normalized.message,
                    stack:
                        normalized.stack
                }
            );

            this.emit(
                "handler:error",
                {
                    error:
                        normalized,
                    ...metadata
                }
            );

            return undefined;

        }

    }

    async _withTimeout(
        promise,
        timeoutMs,
        message
    ) {

        const timeout =
            Math.max(
                0,
                Number(
                    timeoutMs
                ) ||
                0
            );

        if (
            timeout ===
            0
        ) {

            return promise;

        }

        let timer;

        try {

            return await Promise.race([

                promise,

                new Promise(
                    (
                        _,
                        reject
                    ) => {

                        timer =
                            setTimeout(
                                () => {

                                    const error =
                                        new Error(
                                            message
                                        );

                                    error.code =
                                        "RUNTIME_HANDLER_TIMEOUT";

                                    reject(
                                        error
                                    );

                                },
                                timeout
                            );

                        if (
                            timer.unref
                        ) {
                            timer.unref();
                        }

                    }
                )

            ]);

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
    // Shutdown Registration
    // =========================================================================

    registerShutdown(
        callback
    ) {

        this._registerHandler(
            this.shutdownHandlers,
            callback,
            "shutdown"
        );

        this._ensureShutdownSignals();

        return () =>
            this.shutdownHandlers.delete(
                callback
            );

    }

    _ensureShutdownSignals() {

        for (
            const signal of
            this.options
                .SHUTDOWN_SIGNALS
        ) {

            if (
                this._shutdownSignalRegistered(
                    signal
                )
            ) {

                continue;

            }

            this._registerInternalSignal(
                signal,
                this._boundShutdownSignal
            );

        }

    }

    // =========================================================================
    // Fatal Error Registration
    // =========================================================================

    registerFatalHandlers(
        callback
    ) {

        this._registerHandler(
            this.fatalHandlers,
            callback,
            "fatal"
        );

        if (
            this.options
                .HANDLE_UNCAUGHT_EXCEPTION
        ) {

            this._registerInternalProcessEvent(
                "uncaughtException",
                this._boundUncaughtException
            );

        }

        if (
            this.options
                .HANDLE_UNHANDLED_REJECTION
        ) {

            this._registerInternalProcessEvent(
                "unhandledRejection",
                this._boundUnhandledRejection
            );

        }

        return () =>
            this.fatalHandlers.delete(
                callback
            );

    }

    // =========================================================================
    // Optional Reload Registration
    // =========================================================================

    registerReload(
        callback
    ) {

        this._registerHandler(
            this.reloadHandlers,
            callback,
            "reload"
        );

        if (
            this.options.ENABLE_SIGHUP
        ) {

            this._registerInternalSignal(
                "SIGHUP",
                this._boundSighup
            );

        }

        return () =>
            this.reloadHandlers.delete(
                callback
            );

    }

    // =========================================================================
    // User Signals
    // =========================================================================

    registerUserSignal(
        signal,
        callback
    ) {

        if (
            !this.options
                .ENABLE_USER_SIGNALS
        ) {

            this._log(
                "debug",
                "User signal registration disabled",
                {
                    signal
                }
            );

            return () => {};

        }

        const normalized =
            normalizeSignal(
                signal
            );

        if (
            ![
                "SIGUSR1",
                "SIGUSR2"
            ].includes(
                normalized
            )
        ) {

            throw new Error(
                "Only SIGUSR1 and SIGUSR2 are supported as user signals."
            );

        }

        this._validateHandler(
            callback
        );

        if (
            !this.userSignalHandlers.has(
                normalized
            )
        ) {

            this.userSignalHandlers.set(
                normalized,
                new Set()
            );

        }

        const handlers =
            this.userSignalHandlers.get(
                normalized
            );

        handlers.add(
            callback
        );

        if (
            normalized ===
            "SIGUSR1"
        ) {

            this._registerInternalSignal(
                "SIGUSR1",
                this._boundSigusr1
            );

        } else {

            this._registerInternalSignal(
                "SIGUSR2",
                this._boundSigusr2
            );

        }

        return () => {

            handlers.delete(
                callback
            );

        };

    }

    // =========================================================================
    // Internal Registration
    // =========================================================================

    _registerInternalSignal(
        signal,
        listener
    ) {

        if (
            this._registrations.has(
                `internal:${signal}`
            )
        ) {

            return;

        }

        process.on(
            signal,
            listener
        );

        this._registrations.set(
            `internal:${signal}`,
            {
                signal,
                callback:
                    listener,
                listener,
                internal:
                    true,
                dispose:
                    () => {

                        process.off(
                            signal,
                            listener
                        );

                        this._registrations.delete(
                            `internal:${signal}`
                        );

                        this.registeredSignals.delete(
                            signal
                        );

                    }
            }
        );

        this.registeredSignals.add(
            signal
        );

    }

    _registerInternalProcessEvent(
        eventName,
        listener
    ) {

        const key =
            `process:${eventName}`;

        if (
            this._registrations.has(
                key
            )
        ) {

            return;

        }

        process.on(
            eventName,
            listener
        );

        this._registrations.set(
            key,
            {
                signal:
                    eventName,
                callback:
                    listener,
                listener,
                internal:
                    true,
                dispose:
                    () => {

                        process.off(
                            eventName,
                            listener
                        );

                        this._registrations.delete(
                            key
                        );

                    }
            }
        );

    }

    _shutdownSignalRegistered(
        signal
    ) {

        return this._registrations.has(
            `internal:${signal}`
        );

    }

    // =========================================================================
    // Signal Handlers
    // =========================================================================

    async _handleShutdownSignal(
        signal
    ) {

        if (
            this._shutdownPromise
        ) {

            this._log(
                "warn",
                "Shutdown signal received while shutdown is already in progress",
                {
                    signal
                }
            );

            return this._shutdownPromise;

        }

        this._state.shutdownRequested =
            true;

        this._state.shutdownSignal =
            signal;

        this._state.shutdownStartedAt =
            new Date();

        this._incrementMetric(
            "titech.signal.shutdown_requested_total",
            1,
            {
                signal
            }
        );

        this._emitRuntimeEvent(
            "application.shutdown_requested",
            {
                signal
            }
        );

        this._log(
            "info",
            "Shutdown signal received",
            {
                signal,
                pid:
                    process.pid,
                hostname:
                    os.hostname()
            }
        );

        this._shutdownPromise =
            this._executeShutdown(
                signal
            );

        return this._shutdownPromise;

    }

    async _executeShutdown(
        signal
    ) {

        const errors = [];

        for (
            const handler of
            this.shutdownHandlers
        ) {

            try {

                await this._withTimeout(
                    Promise.resolve(
                        handler(
                            signal
                        )
                    ),
                    this.options
                        .HANDLER_TIMEOUT_MS,
                    `Shutdown handler timeout for ${signal}`
                );

            } catch (error) {

                const normalized =
                    normalizeError(
                        error
                    );

                errors.push(
                    normalized
                );

                this._log(
                    "error",
                    "Shutdown handler failed",
                    {
                        signal,
                        error:
                            normalized.message,
                        stack:
                            normalized.stack
                    }
                );

                this._incrementMetric(
                    "titech.signal.shutdown_handler_failure_total",
                    1,
                    {
                        signal
                    }
                );

            }

        }

        this._state.shutdownCompletedAt =
            new Date();

        this._emitRuntimeEvent(
            "application.shutdown_handlers_completed",
            {
                signal,

                errorCount:
                    errors.length
            }
        );

        this.emit(
            "shutdown:complete",
            {
                signal,
                errors
            }
        );

        return {
            signal,

            success:
                errors.length ===
                0,

            errors

        };

    }

    // =========================================================================
    // SIGHUP
    // =========================================================================

    async _handleSighup(
        signal = "SIGHUP"
    ) {

        this._incrementMetric(
            "titech.signal.reload_requested_total"
        );

        this._emitRuntimeEvent(
            "application.reload_requested",
            {
                signal
            }
        );

        this._log(
            "info",
            "Reload signal received",
            {
                signal
            }
        );

        for (
            const handler of
            this.reloadHandlers
        ) {

            await this._invokeSafeHandler(
                handler,
                [signal],
                {
                    signal,
                    type:
                        "reload"
                }
            );

        }

        this.emit(
            "reload",
            {
                signal
            }
        );

    }

    // =========================================================================
    // SIGUSR1 / SIGUSR2
    // =========================================================================

    async _handleUserSignal(
        signal
    ) {

        const normalized =
            normalizeSignal(
                signal
            );

        const handlers =
            this.userSignalHandlers.get(
                normalized
            );

        this._incrementMetric(
            "titech.signal.user_signal_total",
            1,
            {
                signal:
                    normalized
            }
        );

        this._emitRuntimeEvent(
            "runtime.user_signal",
            {
                signal:
                    normalized
            }
        );

        this._log(
            "info",
            "User signal received",
            {
                signal:
                    normalized
            }
        );

        if (
            !handlers
        ) {

            return;

        }

        for (
            const handler of
            handlers
        ) {

            await this._invokeSafeHandler(
                handler,
                [
                    normalized
                ],
                {
                    signal:
                        normalized,
                    type:
                        "user"
                }
            );

        }

    }

    // =========================================================================
    // Fatal Errors
    // =========================================================================

    async _handleUncaughtException(
        error
    ) {

        const normalized =
            normalizeError(
                error
            );

        return this._handleFatal(
            normalized,
            "uncaughtException"
        );

    }

    async _handleUnhandledRejection(
        reason
    ) {

        const error =
            normalizeError(
                reason
            );

        return this._handleFatal(
            error,
            "unhandledRejection"
        );

    }

    async _handleFatal(
        error,
        source
    ) {

        if (
            this._fatalPromise
        ) {

            return this._fatalPromise;

        }

        const normalized =
            normalizeError(
                error
            );

        this._state.fatalErrorReceived =
            true;

        this._state.fatalError =
            normalized;

        this._fatalPromise =
            this._executeFatalHandlers(
                normalized,
                source
            );

        return this._fatalPromise;

    }

    async _executeFatalHandlers(
        error,
        source
    ) {

        this._incrementMetric(
            "titech.signal.fatal_error_total",
            1,
            {
                source
            }
        );

        this._emitRuntimeEvent(
            "runtime.fatal_error",
            {
                source,

                error:
                    error.message,

                code:
                    error.code ||
                    null
            }
        );

        this._log(
            "error",
            "Fatal process error received",
            {
                source,

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                stack:
                    error.stack
            }
        );

        const errors = [];

        for (
            const handler of
            this.fatalHandlers
        ) {

            try {

                await this._withTimeout(
                    Promise.resolve(
                        handler(
                            error,
                            source
                        )
                    ),
                    this.options
                        .FATAL_HANDLER_TIMEOUT_MS,
                    `Fatal handler timeout for ${source}`
                );

            } catch (handlerError) {

                const normalized =
                    normalizeError(
                        handlerError
                    );

                errors.push(
                    normalized
                );

                this._log(
                    "error",
                    "Fatal handler failed",
                    {
                        source,
                        error:
                            normalized.message,
                        stack:
                            normalized.stack
                    }
                );

            }

        }

        this.emit(
            "fatal:handled",
            {
                error,
                source,
                errors
            }
        );

        /*
         * Normally ServerRuntime's registered fatal handler performs the
         * coordinated shutdown and process termination.
         *
         * This fallback exists only when no fatal handler is registered.
         */
        if (
            this.fatalHandlers.size ===
            0 &&
            this.options
                .FORCE_EXIT_ON_FATAL
        ) {

            await sleep(
                this.options
                    .EXIT_GRACE_PERIOD_MS
            );

            process.exit(
                1
            );

        }

        return {
            success:
                errors.length ===
                0,

            source,

            error,

            handlerErrors:
                errors

        };

    }

    // =========================================================================
    // beforeExit / exit
    // =========================================================================

    _handleBeforeExit(
        code
    ) {

        this._incrementMetric(
            "titech.signal.before_exit_total"
        );

        this._emitRuntimeEvent(
            "runtime.before_exit",
            {
                code
            }
        );

        this._log(
            "debug",
            "Node beforeExit event",
            {
                code
            }
        );

    }

    _handleExit(
        code
    ) {

        this._incrementMetric(
            "titech.signal.exit_total",
            1,
            {
                code:
                    String(code)
            }
        );

        this._emitRuntimeEvent(
            "runtime.exit",
            {
                code
            }
        );

    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    start() {

        if (
            this._disposed
        ) {

            throw new Error(
                "SignalManager has been disposed."
            );

        }

        if (
            this._started
        ) {

            return this;

        }

        this._started =
            true;

        this._ensureShutdownSignals();

        if (
            this.options
                .ENABLE_SIGHUP &&
            this.reloadHandlers.size >
            0
        ) {

            this._registerInternalSignal(
                "SIGHUP",
                this._boundSighup
            );

        }

        if (
            this.options
                .HANDLE_UNCAUGHT_EXCEPTION &&
            this.fatalHandlers.size >
            0
        ) {

            this._registerInternalProcessEvent(
                "uncaughtException",
                this._boundUncaughtException
            );

        }

        if (
            this.options
                .HANDLE_UNHANDLED_REJECTION &&
            this.fatalHandlers.size >
            0
        ) {

            this._registerInternalProcessEvent(
                "unhandledRejection",
                this._boundUnhandledRejection
            );

        }

        if (
            this.options
                .ENABLE_BEFORE_EXIT
        ) {

            this._registerInternalProcessEvent(
                "beforeExit",
                this._boundBeforeExit
            );

        }

        if (
            this.options
                .ENABLE_EXIT_EVENT
        ) {

            this._registerInternalProcessEvent(
                "exit",
                this._boundExit
            );

        }

        this._emitRuntimeEvent(
            "runtime.signals.started",
            {
                pid:
                    process.pid,
                hostname:
                    os.hostname()
            }
        );

        this.emit(
            "started"
        );

        this._log(
            "info",
            "Signal manager started",
            {
                pid:
                    process.pid
            }
        );

        return this;

    }

    // =========================================================================
    // Stop / Dispose
    // =========================================================================

    stop() {

        if (
            this._disposed
        ) {

            return;

        }

        for (
            const registration of
            this._registrations.values()
        ) {

            try {

                registration.dispose?.();

            } catch {
                // Ignore disposal failures.
            }

        }

        this._registrations.clear();

        this.registeredSignals.clear();

        this._started =
            false;

        this.emit(
            "stopped"
        );

        this._emitRuntimeEvent(
            "runtime.signals.stopped",
            {
                pid:
                    process.pid
            }
        );

    }

    dispose() {

        if (
            this._disposed
        ) {

            return;

        }

        this.stop();

        this.shutdownHandlers.clear();

        this.fatalHandlers.clear();

        this.reloadHandlers.clear();

        this.userSignalHandlers.clear();

        this.removeAllListeners();

        this._disposed =
            true;

    }

    // =========================================================================
    // State / Diagnostics
    // =========================================================================

    isShutdownRequested() {

        return this._state
            .shutdownRequested;

    }

    isFatalErrorReceived() {

        return this._state
            .fatalErrorReceived;

    }

    isDisposed() {

        return this._disposed;

    }

    getState() {

        return {

            started:
                this._started,

            disposed:
                this._disposed,

            shutdownRequested:
                this._state
                    .shutdownRequested,

            fatalErrorReceived:
                this._state
                    .fatalErrorReceived,

            shutdownSignal:
                this._state
                    .shutdownSignal,

            shutdownStartedAt:
                this._state
                    .shutdownStartedAt
                    ?.toISOString() ||
                null,

            shutdownCompletedAt:
                this._state
                    .shutdownCompletedAt
                    ?.toISOString() ||
                null,

            fatalError:
                this._state
                    .fatalError
                    ? {
                        name:
                            this._state
                                .fatalError
                                .name,
                        message:
                            this._state
                                .fatalError
                                .message,
                        code:
                            this._state
                                .fatalError
                                .code ||
                            null
                    }
                    : null,

            registeredSignals:
                Array.from(
                    this.registeredSignals
                ),

            shutdownHandlers:
                this.shutdownHandlers.size,

            fatalHandlers:
                this.fatalHandlers.size,

            reloadHandlers:
                this.reloadHandlers.size,

            userSignalHandlers:
                Array.from(
                    this.userSignalHandlers
                ).reduce(
                    (
                        acc,
                        [
                            signal,
                            handlers
                        ]
                    ) => {

                        acc[signal] =
                            handlers.size;

                        return acc;

                    },
                    {}
                ),

            processListeners: {

                SIGTERM:
                    process.listenerCount(
                        "SIGTERM"
                    ),

                SIGINT:
                    process.listenerCount(
                        "SIGINT"
                    ),

                SIGHUP:
                    process.listenerCount(
                        "SIGHUP"
                    ),

                uncaughtException:
                    process.listenerCount(
                        "uncaughtException"
                    ),

                unhandledRejection:
                    process.listenerCount(
                        "unhandledRejection"
                    )

            }

        };

    }

}

// =============================================================================
// Factory
// =============================================================================

function createSignalManager(
    options = {}
) {

    return new SignalManager(
        options
    );

}

// =============================================================================
// Default Singleton
// =============================================================================
//
// The singleton is intentionally not automatically started. ServerRuntime
// controls when signal registration occurs.
//
// =============================================================================

const signalManager =
    createSignalManager();

// =============================================================================
// Public API
// =============================================================================

module.exports = Object.freeze({

    SignalManager,

    createSignalManager,

    signalManager,

    DEFAULTS

});