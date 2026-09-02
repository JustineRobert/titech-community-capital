'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Cluster Manager
 * ============================================================================
 *
 * File:
 *   backend/runtime/clusterManager.js
 *
 * Purpose:
 *   Production-grade Node.js process/worker lifecycle management for TITech
 *   Community Capital services.
 *
 * Supports:
 *   ✓ Node.js cluster primary/worker execution
 *   ✓ PM2 / Docker / Kubernetes compatibility
 *   ✓ Graceful startup
 *   ✓ Graceful shutdown
 *   ✓ Rolling restart
 *   ✓ Worker supervision
 *   ✓ Restart backoff
 *   ✓ Worker startup timeout
 *   ✓ Worker readiness handshake
 *   ✓ Worker health hooks
 *   ✓ Signal handling
 *   ✓ Metrics hooks
 *   ✓ Structured logging
 *   ✓ Master health server integration
 *   ✓ Optional sticky-session adapter
 *   ✓ Runtime diagnostics
 *
 * Architectural principles:
 *   - The cluster manager owns process lifecycle only.
 *   - Application business logic remains inside the application factory.
 *   - The cluster manager never owns database transactions.
 *   - The cluster manager never silently swallows startup failures.
 *   - The cluster manager never performs destructive process termination unless
 *     graceful shutdown has exceeded its configured deadline.
 *
 * Application factory contract:
 *
 *   async function appFactory(context) {
 *       const server = ...
 *
 *       return {
 *           server,
 *           healthcheck: async () => ({ ok: true }),
 *           close: async () => { ... }
 *       };
 *   }
 *
 * ============================================================================
 */

const cluster = require('cluster');
const os = require('os');
const process = require('process');
const net = require('net');
const EventEmitter = require('events');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SERVICE_NAME = 'TITech.Cluster';

const DEFAULTS = Object.freeze({
    WORKER_COUNT: positiveInt(
        process.env.CLUSTER_WORKERS,
        Math.max(
            1,
            os.cpus().length - 1
        )
    ),

    SHUTDOWN_TIMEOUT_MS: positiveInt(
        process.env.CLUSTER_SHUTDOWN_TIMEOUT_MS,
        30_000
    ),

    STARTUP_TIMEOUT_MS: positiveInt(
        process.env.CLUSTER_STARTUP_TIMEOUT_MS,
        30_000
    ),

    RESTART_BACKOFF_BASE_MS: positiveInt(
        process.env.CLUSTER_RESTART_BACKOFF_BASE_MS,
        500
    ),

    RESTART_BACKOFF_CAP_MS: positiveInt(
        process.env.CLUSTER_RESTART_BACKOFF_CAP_MS,
        30_000
    ),

    RESTART_MAX_ATTEMPTS: positiveInt(
        process.env.CLUSTER_RESTART_MAX_ATTEMPTS,
        0
    ),

    RESTART_STABILITY_MS: positiveInt(
        process.env.CLUSTER_RESTART_STABILITY_MS,
        15_000
    ),

    ROLLING_RESTART_DELAY_MS: positiveInt(
        process.env.CLUSTER_ROLLING_RESTART_DELAY_MS,
        500
    ),

    HEALTHCHECK_INTERVAL_MS: positiveInt(
        process.env.CLUSTER_HEALTHCHECK_INTERVAL_MS,
        10_000
    ),

    HEALTHCHECK_TIMEOUT_MS: positiveInt(
        process.env.CLUSTER_HEALTHCHECK_TIMEOUT_MS,
        5_000
    ),

    HEALTHCHECK_PATH:
        process.env.CLUSTER_HEALTHCHECK_PATH ||
        '/health',

    STICKY_PORT: positiveInt(
        process.env.CLUSTER_STICKY_PORT ||
        process.env.PORT,
        3000
    ),

    ENABLE_STICKY:
        process.env.CLUSTER_ENABLE_STICKY === 'true',

    GRACEFUL_RESTART_ON_SIGHUP:
        process.env.GRACEFUL_RESTART_ON_SIGHUP !== 'false',

    LOG_PREFIX:
        process.env.CLUSTER_LOG_PREFIX ||
        SERVICE_NAME,

    METRICS_PREFIX:
        process.env.METRICS_PREFIX ||
        'titech.cluster',

    EXIT_ON_WORKER_START_FAILURE:
        process.env.CLUSTER_EXIT_ON_START_FAILURE !== 'false',

    SEND_READY_MESSAGE:
        process.env.CLUSTER_SEND_READY_MESSAGE !== 'false',

    SHUTDOWN_EXIT_CODE:
        integer(
            process.env.CLUSTER_SHUTDOWN_EXIT_CODE,
            0
        ),

    FATAL_EXIT_CODE:
        integer(
            process.env.CLUSTER_FATAL_EXIT_CODE,
            1
        )
});

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function positiveInt(value, fallback) {
    const n = Number(value);

    return Number.isInteger(n) && n > 0
        ? n
        : fallback;
}

function integer(value, fallback) {
    const n = Number(value);

    return Number.isInteger(n)
        ? n
        : fallback;
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(
    promise,
    timeoutMs,
    message
) {
    let timer = null;

    return Promise.race([
        Promise.resolve(promise),

        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(
                    message
                );

                error.code =
                    'TITECH_TIMEOUT';

                reject(error);
            }, timeoutMs);

            timer.unref?.();
        })
    ]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function now() {
    return Date.now();
}

function isFunction(value) {
    return typeof value === 'function';
}

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}

/**
 * ============================================================================
 * CLUSTER MANAGER
 * ============================================================================
 */

class ClusterManager extends EventEmitter {

    constructor(options = {}) {
        super();

        this.options = Object.freeze({
            ...DEFAULTS,
            ...normalizeOptions(options)
        });

        this._workerCount =
            this.options.WORKER_COUNT;

        this._logger =
            options.logger ||
            console;

        this._metrics =
            options.metrics ||
            null;

        this._workers =
            new Map();

        this._restartTimers =
            new Map();

        this._workerAttempts =
            new Map();

        this._workerStartedAt =
            new Map();

        this._workerReady =
            new Set();

        this._workerHealth =
            new Map();

        this._shutdownPromise =
            null;

        this._rollingRestarting =
            false;

        this._started =
            false;

        this._signalsInstalled =
            false;

        this._clusterListenersInstalled =
            false;

        this._masterHealthClose =
            null;

        this._stickyServer =
            null;

        this._stickyConnections =
            new Map();

        this._appContext =
            null;

        this._appClose =
            null;

        this._appHealthcheck =
            null;

        this._workerReadyResolve =
            null;

        this._workerReadyReject =
            null;

        this._workerStartupPromise =
            null;

        this._workerStartupTimer =
            null;

        this._workerHealthTimer =
            null;

        this._workerRole =
            this.isWorker();

        this._boundShutdownHandler =
            this._handleProcessSignal.bind(
                this
            );

        this._boundSighupHandler =
            this._handleSighup.bind(
                this
            );

        this._boundClusterFork =
            this._handleClusterFork.bind(
                this
            );

        this._boundClusterOnline =
            this._handleClusterOnline.bind(
                this
            );

        this._boundClusterListening =
            this._handleClusterListening.bind(
                this
            );

        this._boundClusterExit =
            this._handleClusterExit.bind(
                this
            );

        this._boundClusterDisconnect =
            this._handleClusterDisconnect.bind(
                this
            );
    }

    /**
     * ------------------------------------------------------------------------
     * ROLE
     * ------------------------------------------------------------------------
     */

    isMaster() {
        return (
            cluster.isPrimary === true ||
            cluster.isMaster === true
        );
    }

    isWorker() {
        return (
            cluster.isWorker === true
        );
    }

    getWorkerCount() {
        return this._workerCount;
    }

    getActiveWorkerCount() {
        return Object.keys(
            cluster.workers || {}
        ).length;
    }

    getReadyWorkerCount() {
        return this._workerReady.size;
    }

    isStarted() {
        return this._started;
    }

    isShuttingDown() {
        return (
            this._shutdownPromise !== null
        );
    }

    /**
     * ------------------------------------------------------------------------
     * START
     * ------------------------------------------------------------------------
     */

    async startCluster(
        appFactory,
        options = {}
    ) {
        if (
            !isFunction(appFactory)
        ) {
            throw createError(
                'appFactory must be a function.',
                'TITECH_CLUSTER_APP_FACTORY_REQUIRED'
            );
        }

        if (
            this._started
        ) {
            return this.getStatus();
        }

        this._started =
            true;

        if (
            options.logger
        ) {
            this._logger =
                options.logger;
        }

        if (
            options.metrics
        ) {
            this._metrics =
                options.metrics;
        }

        if (
            options.workerCount
        ) {
            this._workerCount =
                positiveInt(
                    options.workerCount,
                    this._workerCount
                );
        }

        /*
         * Under PM2, Kubernetes, Docker Compose, systemd or another external
         * supervisor, a single process is often preferable. The caller may
         * explicitly force cluster mode.
         */
        if (
            shouldUseExternalProcessManager(
                options
            )
        ) {
            this._log(
                'info',
                'External process manager detected; starting single-process mode.'
            );

            return this._startSingleProcess(
                appFactory,
                options
            );
        }

        if (
            this.isMaster()
        ) {
            return this._startPrimary(
                appFactory,
                options
            );
        }

        return this._startWorker(
            appFactory,
            options
        );
    }

    /**
     * ------------------------------------------------------------------------
     * SINGLE PROCESS MODE
     * ------------------------------------------------------------------------
     */

    async _startSingleProcess(
        appFactory,
        options = {}
    ) {
        this._installSignalHandlers();

        try {
            const context =
                await this._createApplication(
                    appFactory,
                    {
                        cluster: false,
                        primary: this.isMaster(),
                        worker: this.isWorker(),
                        workerId:
                            cluster.worker?.id ||
                            null
                    }
                );

            this._appContext =
                context;

            this._appClose =
                isFunction(
                    context?.close
                )
                    ? context.close
                    : null;

            this._appHealthcheck =
                isFunction(
                    context?.healthcheck
                )
                    ? context.healthcheck
                    : null;

            this.emit(
                'ready',
                {
                    role:
                        'single',
                    pid:
                        process.pid
                }
            );

            this._log(
                'info',
                'Single-process application ready.',
                {
                    pid:
                        process.pid
                }
            );

            return {
                singleProcess:
                    true,
                pid:
                    process.pid,
                ...this.getStatus()
            };
        } catch (error) {
            this.emit(
                'error',
                error
            );

            this._log(
                'error',
                'Single-process application startup failed.',
                {
                    error:
                        error.message,
                    stack:
                        error.stack
                }
            );

            throw error;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * PRIMARY
     * ------------------------------------------------------------------------
     */

    async _startPrimary(
        appFactory,
        options = {}
    ) {
        this._installClusterListeners();
        this._installSignalHandlers();

        this._log(
            'info',
            'TITech cluster primary starting.',
            {
                pid:
                    process.pid,
                workers:
                    this._workerCount,
                node:
                    process.version
            }
        );

        if (
            isFunction(
                options.masterHealthServer
            )
        ) {
            await this._startMasterHealthServer(
                options.masterHealthServer
            );
        }

        for (
            let i = 0;
            i < this._workerCount;
            i += 1
        ) {
            this._forkWorker();
        }

        if (
            this._workerCount ===
            0
        ) {
            throw createError(
                'Cluster worker count must be greater than zero.',
                'TITECH_CLUSTER_NO_WORKERS'
            );
        }

        this.emit(
            'primary:started',
            {
                pid:
                    process.pid,
                workers:
                    this._workerCount
            }
        );

        return {
            primary:
                true,
            pid:
                process.pid,
            workers:
                this._workerCount,
            ...this.getStatus()
        };
    }

    /**
     * ------------------------------------------------------------------------
     * WORKER
     * ------------------------------------------------------------------------
     */

    async _startWorker(
        appFactory,
        options = {}
    ) {
        this._installSignalHandlers();
        this._installWorkerMessageHandler();

        const workerId =
            cluster.worker?.id ||
            null;

        this._log(
            'info',
            'TITech cluster worker starting.',
            {
                pid:
                    process.pid,
                workerId
            }
        );

        this._workerStartupPromise =
            this._createWorkerReadyPromise();

        try {
            const context =
                await withTimeout(
                    this._createApplication(
                        appFactory,
                        {
                            cluster: true,
                            primary: false,
                            worker: true,
                            workerId
                        }
                    ),
                    this.options
                        .STARTUP_TIMEOUT_MS,
                    'TITech worker application startup timed out.'
                );

            this._appContext =
                context;

            this._appClose =
                isFunction(
                    context?.close
                )
                    ? context.close.bind(
                        context
                    )
                    : null;

            this._appHealthcheck =
                isFunction(
                    context?.healthcheck
                )
                    ? context.healthcheck.bind(
                        context
                    )
                    : null;

            await this._validateWorkerServer(
                context
            );

            this._workerStartedAt.set(
                workerId,
                now()
            );

            this._startWorkerStabilityTimer(
                workerId
            );

            this._startWorkerHealthMonitoring();

            if (
                this.options.SEND_READY_MESSAGE &&
                isFunction(
                    process.send
                )
            ) {
                this._sendToPrimary(
                    {
                        cmd:
                            'ready',

                        workerId,

                        pid:
                            process.pid,

                        timestamp:
                            new Date()
                                .toISOString()
                    }
                );
            }

            this._workerReady.add(
                workerId
            );

            this.emit(
                'worker:ready',
                {
                    workerId,
                    pid:
                        process.pid
                }
            );

            this._log(
                'info',
                'TITech worker ready.',
                {
                    workerId,
                    pid:
                        process.pid
                }
            );

            return {
                worker:
                    true,
                workerId,
                pid:
                    process.pid,
                ...this.getStatus()
            };
        } catch (
            error
        ) {
            this.emit(
                'worker:start-error',
                {
                    error,
                    workerId
                }
            );

            this._log(
                'error',
                'TITech worker startup failed.',
                {
                    workerId,
                    error:
                        error.message,
                    stack:
                        error.stack
                }
            );

            /*
             * The primary process is intentionally the supervisor. A worker
             * with failed initialization must exit so the supervisor can
             * replace it.
             */
            if (
                this.options
                    .EXIT_ON_WORKER_START_FAILURE
            ) {
                setImmediate(
                    () => {
                        process.exit(
                            this.options
                                .FATAL_EXIT_CODE
                        );
                    }
                );
            }

            throw error;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * APPLICATION FACTORY
     * ------------------------------------------------------------------------
     */

    async _createApplication(
        appFactory,
        context
    ) {
        const result =
            await appFactory(
                {
                    ...context,

                    service:
                        SERVICE_NAME,

                    manager:
                        this,

                    pid:
                        process.pid,

                    environment:
                        process.env.NODE_ENV ||
                        'development'
                }
            );

        if (
            result === null ||
            result === undefined
        ) {
            return {};
        }

        if (
            !isObject(result)
        ) {
            throw createError(
                'appFactory must return an object.',
                'TITECH_CLUSTER_APP_CONTEXT_INVALID'
            );
        }

        return result;
    }

    async _validateWorkerServer(
        context
    ) {
        if (
            !context ||
            !context.server
        ) {
            return;
        }

        const server =
            context.server;

        if (
            !isFunction(
                server.on
            )
        ) {
            throw createError(
                'Application server must expose EventEmitter-compatible methods.',
                'TITECH_CLUSTER_SERVER_INVALID'
            );
        }

        if (
            isFunction(
                server.listening
            )
        ) {
            return;
        }

        /*
         * Server may still be starting. We do not force a listen operation.
         * Application ownership remains with appFactory.
         */
    }

    /**
     * ------------------------------------------------------------------------
     * CLUSTER EVENTS
     * ------------------------------------------------------------------------
     */

    _installClusterListeners() {
        if (
            this._clusterListenersInstalled
        ) {
            return;
        }

        this._clusterListenersInstalled =
            true;

        cluster.on(
            'fork',
            this._boundClusterFork
        );

        cluster.on(
            'online',
            this._boundClusterOnline
        );

        cluster.on(
            'listening',
            this._boundClusterListening
        );

        cluster.on(
            'disconnect',
            this._boundClusterDisconnect
        );

        cluster.on(
            'exit',
            this._boundClusterExit
        );
    }

    _handleClusterFork(
        worker
    ) {
        if (
            !worker
        ) {
            return;
        }

        this._workers.set(
            worker.id,
            worker
        );

        this._workerAttempts.set(
            worker.id,
            (
                this._workerAttempts.get(
                    worker.id
                ) ||
                0
            )
        );

        this._metric(
            'worker_fork_total',
            1,
            {
                worker_id:
                    String(
                        worker.id
                    )
            }
        );

        this.emit(
            'worker:fork',
            worker
        );

        this._log(
            'debug',
            'Worker forked.',
            {
                workerId:
                    worker.id,
                pid:
                    worker.process?.pid
            }
        );
    }

    _handleClusterOnline(
        worker
    ) {
        if (
            !worker
        ) {
            return;
        }

        this.emit(
            'worker:online',
            worker
        );

        this._log(
            'info',
            'Worker online.',
            {
                workerId:
                    worker.id,
                pid:
                    worker.process?.pid
            }
        );

        this._metric(
            'worker_online_total',
            1,
            {
                worker_id:
                    String(
                        worker.id
                    )
            }
        );
    }

    _handleClusterListening(
        worker,
        address
    ) {
        this.emit(
            'worker:listening',
            {
                worker,
                address
            }
        );

        this._log(
            'info',
            'Worker listening.',
            {
                workerId:
                    worker?.id,
                address
            }
        );
    }

    _handleClusterDisconnect(
        worker
    ) {
        this.emit(
            'worker:disconnect',
            worker
        );

        this._log(
            'warn',
            'Worker disconnected.',
            {
                workerId:
                    worker?.id,
                pid:
                    worker?.process?.pid
            }
        );
    }

    _handleClusterExit(
        worker,
        code,
        signal
    ) {
        if (
            !worker
        ) {
            return;
        }

        const workerId =
            worker.id;

        this._workers.delete(
            workerId
        );

        this._workerReady.delete(
            workerId
        );

        this._workerStartedAt.delete(
            workerId
        );

        this._workerHealth.delete(
            workerId
        );

        this._metric(
            'worker_exit_total',
            1,
            {
                worker_id:
                    String(
                        workerId
                    ),
                code:
                    String(
                        code ?? ''
                    ),
                signal:
                    String(
                        signal ?? ''
                    )
            }
        );

        this.emit(
            'worker:exit',
            {
                worker,
                code,
                signal
            }
        );

        this._log(
            'warn',
            'Worker exited.',
            {
                workerId,
                pid:
                    worker.process?.pid,
                code,
                signal
            }
        );

        if (
            this._shutdownPromise ||
            this._rollingRestarting
        ) {
            return;
        }

        void this._scheduleWorkerRestart(
            workerId
        );
    }

    /**
     * ------------------------------------------------------------------------
     * FORK / RESTART
     * ------------------------------------------------------------------------
     */

    _forkWorker() {
        if (
            this._shutdownPromise
        ) {
            return null;
        }

        const worker =
            cluster.fork({
                ...process.env,

                TITech_CLUSTER:
                    'true',

                TITech_CLUSTER_ROLE:
                    'worker'
            });

        this._workers.set(
            worker.id,
            worker
        );

        this._startWorkerReadinessTimeout(
            worker
        );

        return worker;
    }

    _startWorkerReadinessTimeout(
        worker
    ) {
        if (
            !worker
        ) {
            return;
        }

        const timer =
            setTimeout(() => {
                if (
                    this._shutdownPromise
                ) {
                    return;
                }

                if (
                    this._workerReady.has(
                        worker.id
                    )
                ) {
                    return;
                }

                this._log(
                    'error',
                    'Worker startup/readiness timeout.',
                    {
                        workerId:
                            worker.id,
                        pid:
                            worker.process?.pid
                    }
                );

                this._metric(
                    'worker_startup_timeout_total',
                    1
                );

                try {
                    worker.process.kill(
                        'SIGTERM'
                    );
                } catch {}

            }, this.options.STARTUP_TIMEOUT_MS);

        timer.unref?.();

        worker.once(
            'exit',
            () => clearTimeout(timer)
        );
    }

    async _scheduleWorkerRestart(
        previousWorkerId
    ) {
        const attempt =
            (
                this._workerAttempts.get(
                    previousWorkerId
                ) ||
                0
            ) + 1;

        this._workerAttempts.set(
            previousWorkerId,
            attempt
        );

        if (
            this.options
                .RESTART_MAX_ATTEMPTS >
                0 &&
            attempt >
                this.options
                    .RESTART_MAX_ATTEMPTS
        ) {
            this._log(
                'error',
                'Worker restart limit reached.',
                {
                    previousWorkerId,
                    attempts:
                        attempt
                }
            );

            this._metric(
                'worker_restart_limit_total'
            );

            return;
        }

        const exponential =
            this.options
                .RESTART_BACKOFF_BASE_MS *
            Math.pow(
                2,
                Math.max(
                    0,
                    attempt - 1
                )
            );

        const capped =
            Math.min(
                exponential,
                this.options
                    .RESTART_BACKOFF_CAP_MS
            );

        const jitter =
            Math.floor(
                Math.random() *
                Math.max(
                    50,
                    capped * 0.25
                )
            );

        const delay =
            Math.min(
                this.options
                    .RESTART_BACKOFF_CAP_MS,
                capped + jitter
            );

        this._log(
            'warn',
            'Scheduling worker restart.',
            {
                previousWorkerId,
                attempt,
                delay
            }
        );

        await sleep(delay);

        if (
            this._shutdownPromise ||
            this._rollingRestarting
        ) {
            return;
        }

        const worker =
            this._forkWorker();

        this.emit(
            'worker:restart',
            {
                previousWorkerId,
                workerId:
                    worker?.id,
                attempt,
                delay
            }
        );

        this._metric(
            'worker_restart_total',
            1,
            {
                attempt:
                    String(
                        attempt
                    )
            }
        );
    }

    _startWorkerStabilityTimer(
        workerId
    ) {
        setTimeout(
            () => {
                if (
                    this._workers.has(
                        workerId
                    )
                ) {
                    this._workerAttempts.set(
                        workerId,
                        0
                    );

                    this._metric(
                        'worker_stabilized_total',
                        1,
                        {
                            worker_id:
                                String(
                                    workerId
                                )
                        }
                    );
                }
            },
            this.options
                .RESTART_STABILITY_MS
        ).unref?.();
    }

    /**
     * ------------------------------------------------------------------------
     * MESSAGE HANDLING
     * ------------------------------------------------------------------------
     */

    _installWorkerMessageHandler() {
        if (
            !this.isWorker()
        ) {
            return;
        }

        process.on(
            'message',
            message => {
                if (
                    !message ||
                    typeof message !==
                    'object'
                ) {
                    return;
                }

                if (
                    message.cmd ===
                    'shutdown'
                ) {
                    void this.shutdown(
                        message.reason ||
                        'master-shutdown'
                    );
                }
            }
        );
    }

    _sendToPrimary(
        message
    ) {
        if (
            !isFunction(
                process.send
            )
        ) {
            return false;
        }

        try {
            process.send(
                message
            );

            return true;
        } catch (
            error
        ) {
            this._log(
                'warn',
                'Failed to send worker message to primary.',
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * SIGNAL HANDLERS
     * ------------------------------------------------------------------------
     */

    _installSignalHandlers() {
        if (
            this._signalsInstalled
        ) {
            return;
        }

        this._signalsInstalled =
            true;

        process.once(
            'SIGTERM',
            this._boundShutdownHandler
        );

        process.once(
            'SIGINT',
            this._boundShutdownHandler
        );

        if (
            this.options
                .GRACEFUL_RESTART_ON_SIGHUP
        ) {
            process.once(
                'SIGHUP',
                this._boundSighupHandler
            );
        }
    }

    async _handleProcessSignal(
        signal
    ) {
        await this.shutdown(
            signal
        );
    }

    async _handleSighup() {
        if (
            this.isMaster()
        ) {
            await this.rollingRestart(
                'SIGHUP'
            );
        } else {
            await this.shutdown(
                'SIGHUP'
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * GRACEFUL SHUTDOWN
     * ------------------------------------------------------------------------
     */

    async shutdown(
        signal = 'SIGTERM'
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
        this._log(
            'info',
            'TITech graceful shutdown initiated.',
            {
                signal,
                role:
                    this.isMaster()
                        ? 'primary'
                        : 'worker'
            }
        );

        this.emit(
            'shutdown:start',
            {
                signal
            }
        );

        this._stopRestartTimers();
        this._stopWorkerHealthMonitoring();

        if (
            this.isMaster()
        ) {
            await this._shutdownPrimary(
                signal
            );
        } else {
            await this._shutdownWorker(
                signal
            );
        }

        this.emit(
            'shutdown',
            {
                signal,
                role:
                    this.isMaster()
                        ? 'primary'
                        : 'worker'
            }
        );

        this._log(
            'info',
            'TITech graceful shutdown completed.',
            {
                signal
            }
        );

        return {
            shutdown:
                true,

            signal,

            pid:
                process.pid
        };
    }

    async _shutdownPrimary(
        signal
    ) {
        const workers =
            Object.values(
                cluster.workers ||
                {}
            );

        for (
            const worker
            of workers
        ) {
            await this._requestWorkerShutdown(
                worker,
                signal
            );
        }

        const deadline =
            now() +
            this.options
                .SHUTDOWN_TIMEOUT_MS;

        while (
            this.getActiveWorkerCount() >
                0 &&
            now() <
                deadline
        ) {
            await sleep(
                100
            );
        }

        const remainingWorkers =
            Object.values(
                cluster.workers ||
                {}
            );

        for (
            const worker
            of remainingWorkers
        ) {
            try {
                worker.process.kill(
                    'SIGKILL'
                );
            } catch {}
        }

        await this._closeMasterHealthServer();
        await this._closeStickyServer();
    }

    async _shutdownWorker(
        signal
    ) {
        try {
            if (
                isFunction(
                    this._appClose
                )
            ) {
                await withTimeout(
                    this._appClose(
                        {
                            signal
                        }
                    ),
                    this.options
                        .SHUTDOWN_TIMEOUT_MS,
                    'TITech worker application close timed out.'
                );
            }
        } catch (
            error
        ) {
            this._log(
                'warn',
                'Worker application close failed.',
                {
                    error:
                        error.message
                }
            );
        }

        /*
         * A library should not normally call process.exit() from application
         * code. A worker is different: its lifecycle is owned by the cluster
         * supervisor, therefore exit is intentional here.
         */
        setImmediate(
            () => {
                process.exit(
                    this.options
                        .SHUTDOWN_EXIT_CODE
                );
            }
        );
    }

    async _requestWorkerShutdown(
        worker,
        signal
    ) {
        if (
            !worker ||
            !worker.process
        ) {
            return;
        }

        try {
            worker.send?.({
                cmd:
                    'shutdown',

                reason:
                    signal
            });
        } catch {}

        try {
            worker.process.kill(
                'SIGTERM'
            );
        } catch {}
    }

    _stopRestartTimers() {
        for (
            const timer
            of this._restartTimers.values()
        ) {
            clearTimeout(
                timer
            );
        }

        this._restartTimers.clear();
    }

    /**
     * ------------------------------------------------------------------------
     * ROLLING RESTART
     * ------------------------------------------------------------------------
     */

    async rollingRestart(
        reason = 'manual'
    ) {
        if (
            !this.isMaster()
        ) {
            throw createError(
                'Rolling restart is only available in the primary process.',
                'TITECH_CLUSTER_ROLLING_RESTART_PRIMARY_ONLY',
                409
            );
        }

        if (
            this._rollingRestarting
        ) {
            return {
                restarted:
                    false,
                reason:
                    'already-running'
            };
        }

        this._rollingRestarting =
            true;

        this.emit(
            'rolling-restart:start',
            {
                reason
            }
        );

        try {
            const workers =
                Object.values(
                    cluster.workers ||
                    {}
                );

            for (
                const worker
                of workers
            ) {
                if (
                    this._shutdownPromise
                ) {
                    break;
                }

                await this._requestWorkerShutdown(
                    worker,
                    'rolling-restart'
                );

                await this._waitForWorkerExit(
                    worker,
                    this.options
                        .SHUTDOWN_TIMEOUT_MS
                );

                if (
                    !this._shutdownPromise
                ) {
                    this._forkWorker();

                    await sleep(
                        this.options
                            .ROLLING_RESTART_DELAY_MS
                    );
                }
            }

            this.emit(
                'rolling-restart:complete',
                {
                    reason
                }
            );

            this._metric(
                'rolling_restart_total'
            );

            return {
                restarted:
                    true,
                reason
            };
        } finally {
            this._rollingRestarting =
                false;
        }
    }

    async _waitForWorkerExit(
        worker,
        timeoutMs
    ) {
        if (
            !worker
        ) {
            return;
        }

        if (
            worker.isDead?.()
        ) {
            return;
        }

        await new Promise(
            resolve => {
                let timer = null;

                const cleanup =
                    () => {
                        if (timer) {
                            clearTimeout(
                                timer
                            );
                        }

                        worker.removeListener(
                            'exit',
                            onExit
                        );
                    };

                const onExit =
                    () => {
                        cleanup();
                        resolve();
                    };

                worker.once(
                    'exit',
                    onExit
                );

                timer =
                    setTimeout(() => {
                        cleanup();

                        try {
                            worker.process.kill(
                                'SIGKILL'
                            );
                        } catch {}

                        resolve();
                    }, timeoutMs);

                timer.unref?.();
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * MASTER HEALTH SERVER
     * ------------------------------------------------------------------------
     */

    async _startMasterHealthServer(
        factory
    ) {
        try {
            const context =
                await factory();

            this._masterHealthClose =
                isFunction(
                    context?.close
                )
                    ? context.close
                    : null;

            this.emit(
                'master-health:started'
            );
        } catch (
            error
        ) {
            this._log(
                'error',
                'Master health server startup failed.',
                {
                    error:
                        error.message
                }
            );

            throw error;
        }
    }

    async _closeMasterHealthServer() {
        if (
            !isFunction(
                this._masterHealthClose
            )
        ) {
            return;
        }

        try {
            await withTimeout(
                this._masterHealthClose(),
                this.options
                    .SHUTDOWN_TIMEOUT_MS,
                'Master health server close timed out.'
            );
        } catch (
            error
        ) {
            this._log(
                'warn',
                'Master health server close failed.',
                {
                    error:
                        error.message
                }
            );
        } finally {
            this._masterHealthClose =
                null;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * WORKER HEALTH
     * ------------------------------------------------------------------------
     */

    _startWorkerHealthMonitoring() {
        if (
            !this._appHealthcheck ||
            this._workerHealthTimer
        ) {
            return;
        }

        const runHealthcheck =
            async () => {
                if (
                    this._shutdownPromise ||
                    !this._appHealthcheck
                ) {
                    return;
                }

                try {
                    const result =
                        await withTimeout(
                            this._appHealthcheck(),
                            this.options
                                .HEALTHCHECK_TIMEOUT_MS,
                            'TITech worker healthcheck timed out.'
                        );

                    const healthy =
                        result?.ok !==
                            false;

                    this._workerHealth.set(
                        cluster.worker?.id,
                        {
                            healthy,
                            timestamp:
                                new Date()
                                    .toISOString(),
                            result:
                                result || null
                        }
                    );

                    this._metric(
                        healthy
                            ? 'worker_healthcheck_success_total'
                            : 'worker_healthcheck_failure_total'
                    );

                    if (
                        !healthy
                    ) {
                        this.emit(
                            'worker:unhealthy',
                            result
                        );
                    }
                } catch (
                    error
                ) {
                    this._workerHealth.set(
                        cluster.worker?.id,
                        {
                            healthy:
                                false,
                            timestamp:
                                new Date()
                                    .toISOString(),
                            error:
                                error.message
                        }
                    );

                    this._metric(
                        'worker_healthcheck_error_total'
                    );

                    this._log(
                        'warn',
                        'Worker healthcheck failed.',
                        {
                            error:
                                error.message
                        }
                    );
                }
            };

        void runHealthcheck();

        this._workerHealthTimer =
            setInterval(
                runHealthcheck,
                this.options
                    .HEALTHCHECK_INTERVAL_MS
            );

        this._workerHealthTimer.unref?.();
    }

    _stopWorkerHealthMonitoring() {
        if (
            this._workerHealthTimer
        ) {
            clearInterval(
                this._workerHealthTimer
            );

            this._workerHealthTimer =
                null;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * STICKY SESSION SUPPORT
     * ------------------------------------------------------------------------
     *
     * Prefer a dedicated ingress/load balancer or a mature sticky-session
     * library in production. This implementation provides only a controlled
     * TCP dispatch hook.
     * ------------------------------------------------------------------------
     */

    setupStickyMaster(
        netServer,
        options = {}
    ) {
        if (
            !this.isMaster()
        ) {
            throw createError(
                'setupStickyMaster must be called from the primary process.',
                'TITECH_CLUSTER_STICKY_PRIMARY_ONLY',
                409
            );
        }

        if (
            !netServer ||
            !isFunction(
                netServer.on
            )
        ) {
            throw createError(
                'A valid net.Server is required.',
                'TITECH_CLUSTER_STICKY_SERVER_REQUIRED',
                400
            );
        }

        const port =
            positiveInt(
                options.port,
                this.options.STICKY_PORT
            );

        netServer.on(
            'connection',
            socket => {
                this._dispatchStickyConnection(
                    socket
                );
            }
        );

        netServer.listen(
            port,
            options.host
        );

        this._stickyServer =
            netServer;

        this.emit(
            'sticky:started',
            {
                port
            }
        );

        this._log(
            'info',
            'Sticky TCP dispatcher started.',
            {
                port
            }
        );

        return netServer;
    }

    _dispatchStickyConnection(
        socket
    ) {
        const workers =
            Object.values(
                cluster.workers ||
                {}
            ).filter(
                worker =>
                    worker &&
                    !worker.isDead()
            );

        if (
            workers.length ===
            0
        ) {
            socket.destroy();
            return;
        }

        const remote =
            socket.remoteAddress ||
            'unknown';

        const index =
            Math.abs(
                this._hashString(
                    remote
                )
            ) %
            workers.length;

        const worker =
            workers[index];

        try {
            worker.send(
                {
                    cmd:
                        'sticky:connection'
                },
                socket,
                {
                    keepOpen:
                        true
                }
            );
        } catch (
            error
        ) {
            this._log(
                'warn',
                'Failed to dispatch sticky connection.',
                {
                    workerId:
                        worker.id,
                    error:
                        error.message
                }
            );

            socket.destroy();
        }
    }

    _hashString(
        value
    ) {
        let hash =
            0;

        for (
            let i = 0;
            i < value.length;
            i += 1
        ) {
            hash =
                (
                    (
                        hash <<
                        5
                    ) -
                    hash +
                    value.charCodeAt(
                        i
                    )
                ) |
                0;
        }

        return hash;
    }

    async _closeStickyServer() {
        if (
            !this._stickyServer
        ) {
            return;
        }

        try {
            if (
                isFunction(
                    this._stickyServer.close
                )
            ) {
                await new Promise(
                    resolve => {
                        this._stickyServer.close(
                            () => resolve()
                        );
                    }
                );
            }
        } catch (
            error
        ) {
            this._log(
                'warn',
                'Sticky server close failed.',
                {
                    error:
                        error.message
                }
            );
        } finally {
            this._stickyServer =
                null;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * READINESS PROMISE
     * ------------------------------------------------------------------------
     */

    _createWorkerReadyPromise() {
        return new Promise(
            (
                resolve,
                reject
            ) => {
                this._workerReadyResolve =
                    resolve;

                this._workerReadyReject =
                    reject;

                this._workerStartupTimer =
                    setTimeout(
                        () => {
                            reject(
                                createError(
                                    'Worker readiness timed out.',
                                    'TITECH_CLUSTER_WORKER_READY_TIMEOUT'
                                )
                            );
                        },
                        this.options
                            .STARTUP_TIMEOUT_MS
                    );

                this._workerStartupTimer.unref?.();
            }
        ).finally(
            () => {
                if (
                    this._workerStartupTimer
                ) {
                    clearTimeout(
                        this._workerStartupTimer
                    );

                    this._workerStartupTimer =
                        null;
                }
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * STATUS / DIAGNOSTICS
     * ------------------------------------------------------------------------
     */

    getStatus() {
        const workers =
            Object.values(
                cluster.workers ||
                {}
            ).map(
                worker => ({
                    id:
                        worker.id,

                    pid:
                        worker.process?.pid ||
                        null,

                    state:
                        worker.state ||
                        null,

                    isDead:
                        worker.isDead?.() ||
                        false,

                    ready:
                        this._workerReady.has(
                            worker.id
                        ),

                    health:
                        this._workerHealth.get(
                            worker.id
                        ) ||
                        null
                })
            );

        return {
            service:
                SERVICE_NAME,

            pid:
                process.pid,

            role:
                this.isMaster()
                    ? 'primary'
                    : 'worker',

            node:
                process.version,

            environment:
                process.env.NODE_ENV ||
                'development',

            started:
                this._started,

            shuttingDown:
                Boolean(
                    this._shutdownPromise
                ),

            configuredWorkers:
                this._workerCount,

            activeWorkers:
                workers.length,

            readyWorkers:
                this._workerReady.size,

            workers,

            stickyEnabled:
                Boolean(
                    this._stickyServer
                ),

            uptime:
                process.uptime(),

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    getDiagnostics() {
        return {
            ...this.getStatus(),

            configuration: {
                workerCount:
                    this._workerCount,

                startupTimeoutMs:
                    this.options
                        .STARTUP_TIMEOUT_MS,

                shutdownTimeoutMs:
                    this.options
                        .SHUTDOWN_TIMEOUT_MS,

                restartBackoffBaseMs:
                    this.options
                        .RESTART_BACKOFF_BASE_MS,

                restartBackoffCapMs:
                    this.options
                        .RESTART_BACKOFF_CAP_MS,

                restartMaxAttempts:
                    this.options
                        .RESTART_MAX_ATTEMPTS,

                restartStabilityMs:
                    this.options
                        .RESTART_STABILITY_MS,

                healthcheckIntervalMs:
                    this.options
                        .HEALTHCHECK_INTERVAL_MS,

                healthcheckTimeoutMs:
                    this.options
                        .HEALTHCHECK_TIMEOUT_MS
            },

            workerAttempts:
                Object.fromEntries(
                    this._workerAttempts
                )
        };
    }

    /**
     * ------------------------------------------------------------------------
     * LOGGING / METRICS
     * ------------------------------------------------------------------------
     */

    _log(
        level,
        message,
        meta = {}
    ) {
        const logger =
            this._logger ||
            console;

        const method =
            isFunction(
                logger[level]
            )
                ? logger[level].bind(
                    logger
                )
                : isFunction(
                    logger.log
                )
                    ? logger.log.bind(
                        logger
                    )
                    : console.log.bind(
                        console
                    );

        method(
            `[${this.options.LOG_PREFIX}] ${message}`,
            {
                service:
                    SERVICE_NAME,

                pid:
                    process.pid,

                role:
                    this.isMaster()
                        ? 'primary'
                        : 'worker',

                ...meta
            }
        );
    }

    _metric(
        name,
        value = 1,
        labels = {}
    ) {
        try {
            if (
                this._metrics &&
                isFunction(
                    this._metrics.increment
                )
            ) {
                this._metrics.increment(
                    `${this.options.METRICS_PREFIX}.${name}`,
                    value,
                    labels
                );
            }
        } catch {}
    }
}

/**
 * ============================================================================
 * OPTION NORMALIZATION
 * ============================================================================
 */

function normalizeOptions(
    options
) {
    const normalized = {
        ...options
    };

    if (
        options.workerCount
    ) {
        normalized.WORKER_COUNT =
            positiveInt(
                options.workerCount,
                DEFAULTS.WORKER_COUNT
            );
    }

    return normalized;
}

/**
 * ============================================================================
 * EXTERNAL PROCESS MANAGER DETECTION
 * ============================================================================
 */

function shouldUseExternalProcessManager(
    options = {}
) {
    if (
        options.forceCluster ===
        true
    ) {
        return false;
    }

    if (
        options.forceSingleProcess ===
        true
    ) {
        return true;
    }

    if (
        process.env.CLUSTER_FORCE ===
        'true'
    ) {
        return false;
    }

    if (
        process.env.CLUSTER_FORCE_SINGLE ===
        'true'
    ) {
        return true;
    }

    /*
     * PM2 generally exposes pm_id.
     */
    if (
        process.env.pm_id !==
        undefined &&
        process.env.PM2_HOME
    ) {
        return true;
    }

    /*
     * Kubernetes / Docker are intentionally not forced into single process
     * mode because multiple pods/containers may themselves be the desired
     * scaling mechanism. They remain cluster-capable by default.
     */
    return false;
}

/**
 * ============================================================================
 * ERROR FACTORY
 * ============================================================================
 */

function createError(
    message,
    code,
    statusCode = 500
) {
    const error =
        new Error(
            message
        );

    error.code =
        code;

    error.statusCode =
        statusCode;

    error.service =
        SERVICE_NAME;

    return error;
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const manager =
    new ClusterManager();

/**
 * ============================================================================
 * PUBLIC START FUNCTION
 * ============================================================================
 */

async function startCluster(
    appFactory,
    options = {}
) {
    /*
     * Configure the singleton before startup.
     */
    if (
        options.logger
    ) {
        manager._logger =
            options.logger;
    }

    if (
        options.metrics
    ) {
        manager._metrics =
            options.metrics;
    }

    if (
        options.workerCount
    ) {
        manager._workerCount =
            positiveInt(
                options.workerCount,
                manager._workerCount
            );
    }

    return manager.startCluster(
        appFactory,
        options
    );
}

/**
 * ============================================================================
 * PUBLIC API
 * ============================================================================
 */

module.exports =
    Object.freeze({
        startCluster,

        isMaster:
            () =>
                manager.isMaster(),

        isWorker:
            () =>
                manager.isWorker(),

        getWorkerCount:
            () =>
                manager.getWorkerCount(),

        getActiveWorkerCount:
            () =>
                manager.getActiveWorkerCount(),

        getReadyWorkerCount:
            () =>
                manager.getReadyWorkerCount(),

        shutdown:
            signal =>
                manager.shutdown(
                    signal
                ),

        rollingRestart:
            reason =>
                manager.rollingRestart(
                    reason
                ),

        getStatus:
            () =>
                manager.getStatus(),

        getDiagnostics:
            () =>
                manager.getDiagnostics(),

        setupStickyMaster:
            (
                server,
                options
            ) =>
                manager.setupStickyMaster(
                    server,
                    options
                ),

        on:
            (
                event,
                handler
            ) => {
                manager.on(
                    event,
                    handler
                );

                return manager;
            },

        once:
            (
                event,
                handler
            ) => {
                manager.once(
                    event,
                    handler
                );

                return manager;
            },

        manager,

        ClusterManager,

        DEFAULTS
    });