'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Circuit Breaker
 * =============================================================================
 *
 * File:
 * backend/modules/transactions/reliability/TransactionCircuitBreaker.js
 *
 * Version:
 * 3.0.0
 *
 * Purpose
 * -------
 * Protects critical transaction infrastructure from cascading failures by
 * preventing repeated calls to unhealthy downstream dependencies.
 *
 * Designed for:
 *
 *   • Financial transaction orchestration
 *   • Ledger services
 *   • Payment providers
 *   • Settlement services
 *   • Distributed transaction managers
 *   • Event publishers
 *   • External compliance providers
 *   • Database-backed transaction services
 *
 * Features
 * --------
 *   • CLOSED / OPEN / HALF_OPEN state machine
 *   • Failure threshold
 *   • Rolling failure window
 *   • Open-state recovery timeout
 *   • Single half-open probe
 *   • Concurrent execution protection
 *   • Optional execution timeout
 *   • Success/failure accounting
 *   • State transition events
 *   • Structured observability hooks
 *   • Metrics hooks
 *   • Logger integration
 *   • Manual reset
 *   • Manual open
 *   • Health snapshot
 *   • Runtime configuration
 *   • Error classification hooks
 *   • Safe failure propagation
 *   • No business logic
 *
 * Compatibility
 * -------------
 * Existing usage remains valid:
 *
 *   const breaker = new TransactionCircuitBreaker({
 *       failureThreshold: 5,
 *       resetTimeout: 30000
 *   });
 *
 *   await breaker.execute(() => serviceCall());
 *
 * =============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const STATES = Object.freeze({
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
});

const DEFAULTS = Object.freeze({
    failureThreshold: 5,

    resetTimeout: 30000,

    failureWindow: 60000,

    executionTimeout: 30000,

    halfOpenMaxProbes: 1,

    successThreshold: 1,

    volumeThreshold: 1,

    enabled: true,

    name: 'transaction-circuit-breaker',

    serviceName:
        process.env.SERVICE_NAME ||
        'transaction-service'
});

const EVENTS = Object.freeze({
    STATE_CHANGED: 'stateChanged',

    OPENED: 'opened',

    HALF_OPENED: 'halfOpened',

    CLOSED: 'closed',

    SUCCESS: 'success',

    FAILURE: 'failure',

    REJECTED: 'rejected',

    TIMEOUT: 'timeout',

    RESET: 'reset'
});

/**
 * =============================================================================
 * ERROR FACTORIES
 * =============================================================================
 */

class CircuitBreakerError extends Error {

    constructor(
        message,
        code,
        metadata = {}
    ) {

        super(message);

        this.name = 'CircuitBreakerError';

        this.code = code;

        Object.assign(
            this,
            metadata
        );

        Error.captureStackTrace?.(
            this,
            CircuitBreakerError
        );
    }
}

/**
 * =============================================================================
 * TRANSACTION CIRCUIT BREAKER
 * =============================================================================
 */

class TransactionCircuitBreaker
    extends EventEmitter {

    constructor(options = {}) {

        super();

        /**
         * ---------------------------------------------------------------------
         * Configuration
         * ---------------------------------------------------------------------
         */

        this.config = Object.freeze({

            ...DEFAULTS,

            ...options
        });

        this.validateConfiguration();

        /**
         * ---------------------------------------------------------------------
         * Runtime Identity
         * ---------------------------------------------------------------------
         */

        this.identity = Object.freeze({

            breakerId:
                options.breakerId ||
                `breaker-${crypto.randomUUID()}`,

            name:
                this.config.name,

            serviceName:
                this.config.serviceName,

            processId:
                process.pid,

            hostname:
                process.env.HOSTNAME ||
                'localhost',

            environment:
                process.env.NODE_ENV ||
                'development',

            createdAt:
                new Date()
        });

        /**
         * ---------------------------------------------------------------------
         * State
         * ---------------------------------------------------------------------
         */

        this.state = STATES.CLOSED;

        this.openedAt = null;

        this.halfOpenedAt = null;

        this.lastStateChangeAt =
            new Date();

        this.lastFailureAt = null;

        this.lastSuccessAt = null;

        this.lastError = null;

        /**
         * ---------------------------------------------------------------------
         * Counters
         * ---------------------------------------------------------------------
         */

        this.failures = 0;

        this.successes = 0;

        this.rejectedExecutions = 0;

        this.timeoutCount = 0;

        this.totalExecutions = 0;

        this.totalFailures = 0;

        this.totalSuccesses = 0;

        this.totalTrips = 0;

        /**
         * ---------------------------------------------------------------------
         * Rolling Failure Window
         * ---------------------------------------------------------------------
         */

        this.failureEvents = [];

        /**
         * ---------------------------------------------------------------------
         * HALF_OPEN Probe Protection
         * ---------------------------------------------------------------------
         */

        this.halfOpenProbes = 0;

        this.halfOpenSuccesses = 0;

        this.halfOpenFailures = 0;

        /**
         * ---------------------------------------------------------------------
         * Active Executions
         * ---------------------------------------------------------------------
         */

        this.activeExecutions = new Map();

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.onStateChange =
            typeof options.onStateChange === 'function'
                ? options.onStateChange
                : null;

        this.failureClassifier =
            typeof options.failureClassifier === 'function'
                ? options.failureClassifier
                : null;

        /**
         * ---------------------------------------------------------------------
         * Lifecycle
         * ---------------------------------------------------------------------
         */

        this.destroyed = false;

        this.createdAt =
            new Date();

        this.logger.debug?.(
            {
                breakerId:
                    this.identity.breakerId,

                state:
                    this.state
            },
            'Transaction circuit breaker initialized'
        );
    }

    /**
     * =========================================================================
     * CONFIGURATION VALIDATION
     * =========================================================================
     */

    validateConfiguration() {

        const numericFields = [

            'failureThreshold',

            'resetTimeout',

            'failureWindow',

            'executionTimeout',

            'halfOpenMaxProbes',

            'successThreshold',

            'volumeThreshold'
        ];

        for (
            const field of numericFields
        ) {

            const value =
                this.config[field];

            if (
                !Number.isFinite(value) ||
                value < 0
            ) {

                throw new TypeError(
                    `Invalid circuit breaker configuration: ${field}`
                );
            }
        }

        if (
            this.config.failureThreshold < 1
        ) {

            throw new TypeError(
                'failureThreshold must be at least 1'
            );
        }

        if (
            this.config.halfOpenMaxProbes < 1
        ) {

            throw new TypeError(
                'halfOpenMaxProbes must be at least 1'
            );
        }

        if (
            this.config.successThreshold < 1
        ) {

            throw new TypeError(
                'successThreshold must be at least 1'
            );
        }
    }

    /**
     * =========================================================================
     * MAIN EXECUTION API
     * =========================================================================
     *
     * Backward-compatible with:
     *
     *     breaker.execute(() => action());
     *
     * Supports optional execution metadata:
     *
     *     breaker.execute(action, {
     *         transactionId,
     *         correlationId
     *     });
     */

    async execute(
        action,
        metadata = {}
    ) {

        this.assertOperational();

        if (
            typeof action !== 'function'
        ) {

            throw new TypeError(
                'Circuit breaker action must be a function'
            );
        }

        const executionId =
            crypto.randomUUID();

        const startedAt =
            Date.now();

        /**
         * ---------------------------------------------------------------------
         * Circuit Admission
         * ---------------------------------------------------------------------
         */

        const admission =
            this.admitExecution(
                executionId
            );

        if (
            !admission.allowed
        ) {

            this.rejectedExecutions++;

            this.emitEvent(
                EVENTS.REJECTED,
                {
                    executionId,
                    state: this.state,
                    ...metadata
                }
            );

            throw this.createOpenCircuitError(
                executionId,
                metadata
            );
        }

        this.totalExecutions++;

        this.activeExecutions.set(
            executionId,
            {
                executionId,
                state:
                    this.state,
                startedAt,
                metadata
            }
        );

        this.emitMetric(
            'circuit_breaker.execution.started',
            1,
            {
                state:
                    this.state
            }
        );

        try {

            /**
             * -------------------------------------------------------------
             * Execute with optional timeout
             * -------------------------------------------------------------
             */

            const result =
                await this.executeWithTimeout(
                    action,
                    executionId,
                    metadata
                );

            this.handleSuccess(
                executionId,
                startedAt,
                metadata
            );

            return result;

        }
        catch (error) {

            this.handleFailure(
                error,
                executionId,
                startedAt,
                metadata
            );

            throw error;

        }
        finally {

            this.activeExecutions.delete(
                executionId
            );

            this.emitMetric(
                'circuit_breaker.execution.completed',
                1,
                {
                    state:
                        this.state
                }
            );
        }
    }

    /**
     * =========================================================================
     * EXECUTION ADMISSION
     * =========================================================================
     */

    admitExecution(
        executionId
    ) {

        if (
            !this.config.enabled
        ) {

            return {
                allowed: true,
                state: this.state
            };
        }

        this.refreshState();

        if (
            this.state === STATES.CLOSED
        ) {

            return {
                allowed: true,
                state: STATES.CLOSED
            };
        }

        if (
            this.state === STATES.OPEN
        ) {

            return {
                allowed: false,
                state: STATES.OPEN
            };
        }

        /**
         * ---------------------------------------------------------------------
         * HALF_OPEN
         *
         * Only a controlled number of probes may execute.
         * ---------------------------------------------------------------------
         */

        if (
            this.state === STATES.HALF_OPEN
        ) {

            if (
                this.halfOpenProbes >=
                this.config.halfOpenMaxProbes
            ) {

                return {
                    allowed: false,
                    state: STATES.HALF_OPEN
                };
            }

            this.halfOpenProbes++;

            this.emitMetric(
                'circuit_breaker.half_open.probe',
                1
            );

            return {
                allowed: true,
                state: STATES.HALF_OPEN,
                probe: true,
                executionId
            };
        }

        return {
            allowed: false,
            state: this.state
        };
    }

    /**
     * =========================================================================
     * TIMEOUT WRAPPER
     * =========================================================================
     */

    async executeWithTimeout(
        action,
        executionId,
        metadata
    ) {

        const timeout =
            Number(
                this.config.executionTimeout
            );

        if (
            timeout <= 0
        ) {

            return action();
        }

        let timer;

        const timeoutPromise =
            new Promise(
                (_, reject) => {

                    timer =
                        setTimeout(
                            () => {

                                this.timeoutCount++;

                                this.emitEvent(
                                    EVENTS.TIMEOUT,
                                    {
                                        executionId,
                                        timeoutMs:
                                            timeout,
                                        ...metadata
                                    }
                                );

                                const error =
                                    new CircuitBreakerError(
                                        `Circuit breaker execution timed out after ${timeout}ms`,
                                        'TRANSACTION_CIRCUIT_BREAKER_TIMEOUT',
                                        {
                                            executionId,
                                            timeoutMs:
                                                timeout
                                        }
                                    );

                                reject(error);

                            },
                            timeout
                        );

                    timer.unref?.();
                }
            );

        try {

            return await Promise.race([
                Promise.resolve().then(
                    () => action()
                ),
                timeoutPromise
            ]);

        }
        finally {

            clearTimeout(
                timer
            );
        }
    }

    /**
     * =========================================================================
     * SUCCESS HANDLING
     * =========================================================================
     */

    handleSuccess(
        executionId,
        startedAt,
        metadata
    ) {

        const durationMs =
            Date.now() -
            startedAt;

        this.totalSuccesses++;

        this.successes++;

        this.lastSuccessAt =
            new Date();

        /**
         * ---------------------------------------------------------------------
         * HALF_OPEN recovery
         * ---------------------------------------------------------------------
         */

        if (
            this.state === STATES.HALF_OPEN
        ) {

            this.halfOpenSuccesses++;

            this.halfOpenProbes =
                Math.max(
                    0,
                    this.halfOpenProbes - 1
                );

            if (
                this.halfOpenSuccesses >=
                this.config.successThreshold
            ) {

                this.transitionTo(
                    STATES.CLOSED,
                    {
                        reason:
                            'half-open recovery successful'
                    }
                );
            }
        }

        else {

            this.halfOpenProbes = 0;
        }

        this.emitEvent(
            EVENTS.SUCCESS,
            {
                executionId,
                durationMs,
                state:
                    this.state,
                ...metadata
            }
        );

        this.emitMetric(
            'circuit_breaker.success',
            1
        );
    }

    /**
     * =========================================================================
     * FAILURE HANDLING
     * =========================================================================
     */

    handleFailure(
        error,
        executionId,
        startedAt,
        metadata
    ) {

        const durationMs =
            Date.now() -
            startedAt;

        this.totalFailures++;

        this.failures++;

        this.lastFailureAt =
            new Date();

        this.lastError =
            this.serializeError(
                error
            );

        /**
         * ---------------------------------------------------------------------
         * HALF_OPEN failure immediately reopens circuit.
         * ---------------------------------------------------------------------
         */

        if (
            this.state === STATES.HALF_OPEN
        ) {

            this.halfOpenFailures++;

            this.halfOpenProbes =
                Math.max(
                    0,
                    this.halfOpenProbes - 1
                );

            this.transitionTo(
                STATES.OPEN,
                {
                    reason:
                        'half-open probe failed'
                }
            );
        }

        else {

            this.recordFailure();

            this.pruneFailureWindow();

            if (
                this.shouldOpenCircuit()
            ) {

                this.open(
                    'failure-threshold-exceeded'
                );
            }
        }

        this.emitEvent(
            EVENTS.FAILURE,
            {
                executionId,
                durationMs,
                state:
                    this.state,
                error:
                    this.lastError,
                ...metadata
            }
        );

        this.emitMetric(
            'circuit_breaker.failure',
            1
        );
    }

    /**
     * =========================================================================
     * FAILURE CLASSIFICATION
     * =========================================================================
     *
     * Optional hook allows callers to exclude non-system failures from
     * circuit-breaking.
     *
     * Return:
     *
     *   true  -> count as failure
     *   false -> ignore for circuit statistics
     */

    shouldCountFailure(
        error
    ) {

        if (
            !this.failureClassifier
        ) {

            return true;
        }

        try {

            return Boolean(
                this.failureClassifier(
                    error
                )
            );

        }
        catch (
            classifierError
        ) {

            this.logger.warn?.(
                {
                    classifierError
                },
                'Circuit breaker failure classifier failed; counting failure'
            );

            return true;
        }
    }

    /**
     * =========================================================================
     * FAILURE RECORDING
     * =========================================================================
     */

    recordFailure() {

        this.failureEvents.push(
            Date.now()
        );
    }

    /**
     * =========================================================================
     * FAILURE WINDOW CLEANUP
     * =========================================================================
     */

    pruneFailureWindow() {

        const cutoff =
            Date.now() -
            this.config.failureWindow;

        this.failureEvents =
            this.failureEvents.filter(
                timestamp =>
                    timestamp >= cutoff
            );

        this.failures =
            this.failureEvents.length;
    }

    /**
     * =========================================================================
     * OPEN CIRCUIT DECISION
     * =========================================================================
     */

    shouldOpenCircuit() {

        this.pruneFailureWindow();

        if (
            this.failureEvents.length <
            this.config.volumeThreshold
        ) {

            return false;
        }

        return (
            this.failureEvents.length >=
            this.config.failureThreshold
        );
    }

    /**
     * =========================================================================
     * OPEN CIRCUIT
     * =========================================================================
     */

    open(
        reason = 'manual'
    ) {

        if (
            this.state === STATES.OPEN
        ) {

            return;
        }

        this.openedAt =
            Date.now();

        this.totalTrips++;

        this.transitionTo(
            STATES.OPEN,
            {
                reason
            }
        );

        this.emitEvent(
            EVENTS.OPENED,
            {
                reason,
                openedAt:
                    this.openedAt
            }
        );

        this.emitMetric(
            'circuit_breaker.opened',
            1
        );
    }

    /**
     * =========================================================================
     * REFRESH STATE
     * =========================================================================
     */

    refreshState() {

        if (
            this.state !== STATES.OPEN
        ) {

            return;
        }

        if (
            !this.openedAt
        ) {

            return;
        }

        const elapsed =
            Date.now() -
            this.openedAt;

        if (
            elapsed <
            this.config.resetTimeout
        ) {

            return;
        }

        this.enterHalfOpen();
    }

    /**
     * =========================================================================
     * HALF OPEN
     * =========================================================================
     */

    enterHalfOpen() {

        this.halfOpenedAt =
            Date.now();

        this.halfOpenProbes = 0;

        this.halfOpenSuccesses = 0;

        this.halfOpenFailures = 0;

        this.transitionTo(
            STATES.HALF_OPEN,
            {
                reason:
                    'recovery timeout elapsed'
            }
        );

        this.emitEvent(
            EVENTS.HALF_OPENED,
            {
                openedAt:
                    this.openedAt,

                halfOpenedAt:
                    this.halfOpenedAt
            }
        );

        this.emitMetric(
            'circuit_breaker.half_open',
            1
        );
    }

    /**
     * =========================================================================
     * MANUAL RESET
     * =========================================================================
     */

    reset(
        reason = 'manual-reset'
    ) {

        const previousState =
            this.state;

        this.failures = 0;

        this.failureEvents = [];

        this.openedAt = null;

        this.halfOpenedAt = null;

        this.halfOpenProbes = 0;

        this.halfOpenSuccesses = 0;

        this.halfOpenFailures = 0;

        this.lastError = null;

        this.transitionTo(
            STATES.CLOSED,
            {
                reason
            }
        );

        this.emitEvent(
            EVENTS.RESET,
            {
                previousState,
                reason
            }
        );

        this.emitMetric(
            'circuit_breaker.reset',
            1
        );

        return this.getHealth();
    }

    /**
     * =========================================================================
     * MANUAL OPEN
     * =========================================================================
     */

    trip(
        reason = 'manual-trip'
    ) {

        this.open(
            reason
        );

        return this.getHealth();
    }

    /**
     * =========================================================================
     * STATE TRANSITION
     * =========================================================================
     */

    transitionTo(
        nextState,
        metadata = {}
    ) {

        const previousState =
            this.state;

        if (
            previousState ===
            nextState
        ) {

            return;
        }

        this.state =
            nextState;

        this.lastStateChangeAt =
            new Date();

        if (
            nextState ===
            STATES.CLOSED
        ) {

            this.openedAt = null;

            this.halfOpenedAt = null;

            this.halfOpenProbes = 0;

            this.halfOpenSuccesses = 0;

            this.halfOpenFailures = 0;

            this.failures = 0;

            this.failureEvents = [];

            this.emitEvent(
                EVENTS.CLOSED,
                {
                    previousState,
                    ...metadata
                }
            );
        }

        this.emitEvent(
            EVENTS.STATE_CHANGED,
            {
                previousState,
                currentState:
                    nextState,
                ...metadata
            }
        );

        if (
            this.onStateChange
        ) {

            try {

                this.onStateChange({

                    breaker:
                        this.identity.breakerId,

                    previousState,

                    currentState:
                        nextState,

                    timestamp:
                        new Date(),

                    metadata
                });

            }
            catch (
                callbackError
            ) {

                this.logger.warn?.(
                    {
                        callbackError
                    },
                    'Circuit breaker state callback failed'
                );
            }
        }

        this.logger.info?.(
            {
                breakerId:
                    this.identity.breakerId,

                previousState,

                currentState:
                    nextState,

                metadata
            },
            'Transaction circuit breaker state changed'
        );
    }

    /**
     * =========================================================================
     * OPEN CIRCUIT ERROR
     * =========================================================================
     */

    createOpenCircuitError(
        executionId,
        metadata = {}
    ) {

        return new CircuitBreakerError(
            'Transaction circuit breaker is open',
            'TRANSACTION_CIRCUIT_BREAKER_OPEN',
            {
                executionId,

                breakerId:
                    this.identity.breakerId,

                breakerName:
                    this.identity.name,

                state:
                    this.state,

                openedAt:
                    this.openedAt
                        ? new Date(
                            this.openedAt
                        )
                        : null,

                retryAfterMs:
                    this.getRetryAfterMs(),

                ...metadata
            }
        );
    }

    /**
     * =========================================================================
     * RETRY AFTER
     * =========================================================================
     */

    getRetryAfterMs() {

        if (
            !this.openedAt
        ) {

            return 0;
        }

        return Math.max(
            0,
            this.config.resetTimeout -
            (
                Date.now() -
                this.openedAt
            )
        );
    }

    /**
     * =========================================================================
     * OPERATIONAL ASSERTION
     * =========================================================================
     */

    assertOperational() {

        if (
            this.destroyed
        ) {

            throw new CircuitBreakerError(
                'Circuit breaker has been destroyed',
                'TRANSACTION_CIRCUIT_BREAKER_DESTROYED'
            );
        }
    }

    /**
     * =========================================================================
     * HEALTH SNAPSHOT
     * =========================================================================
     */

    getHealth() {

        this.pruneFailureWindow();

        return {

            healthy:
                this.state === STATES.CLOSED,

            state:
                this.state,

            ready:
                this.state !== STATES.OPEN,

            enabled:
                this.config.enabled,

            breakerId:
                this.identity.breakerId,

            name:
                this.identity.name,

            serviceName:
                this.identity.serviceName,

            failures:
                this.failures,

            successes:
                this.successes,

            totalExecutions:
                this.totalExecutions,

            totalFailures:
                this.totalFailures,

            totalSuccesses:
                this.totalSuccesses,

            rejectedExecutions:
                this.rejectedExecutions,

            timeoutCount:
                this.timeoutCount,

            totalTrips:
                this.totalTrips,

            activeExecutions:
                this.activeExecutions.size,

            halfOpenProbes:
                this.halfOpenProbes,

            halfOpenSuccesses:
                this.halfOpenSuccesses,

            halfOpenFailures:
                this.halfOpenFailures,

            openedAt:
                this.openedAt
                    ? new Date(
                        this.openedAt
                    )
                    : null,

            halfOpenedAt:
                this.halfOpenedAt
                    ? new Date(
                        this.halfOpenedAt
                    )
                    : null,

            lastFailureAt:
                this.lastFailureAt,

            lastSuccessAt:
                this.lastSuccessAt,

            lastStateChangeAt:
                this.lastStateChangeAt,

            retryAfterMs:
                this.getRetryAfterMs(),

            lastError:
                this.lastError,

            timestamp:
                new Date()
        };
    }

    /**
     * =========================================================================
     * STATE
     * =========================================================================
     */

    getState() {

        this.refreshState();

        return this.state;
    }

    /**
     * =========================================================================
     * IDENTITY
     * =========================================================================
     */

    getIdentity() {

        return this.identity;
    }

    /**
     * =========================================================================
     * STATUS HELPERS
     * =========================================================================
     */

    isOpen() {

        this.refreshState();

        return this.state === STATES.OPEN;
    }

    isClosed() {

        return this.state === STATES.CLOSED;
    }

    isHalfOpen() {

        this.refreshState();

        return this.state === STATES.HALF_OPEN;
    }

    /**
     * =========================================================================
     * METRICS
     * =========================================================================
     */

    emitMetric(
        name,
        value = 1,
        labels = {}
    ) {

        if (
            !this.metrics
        ) {

            return;
        }

        try {

            if (
                typeof this.metrics.increment ===
                'function'
            ) {

                this.metrics.increment(
                    name,
                    value,
                    labels
                );

                return;
            }

            if (
                typeof this.metrics.inc ===
                'function'
            ) {

                this.metrics.inc(
                    name,
                    value,
                    labels
                );
            }

        }
        catch (
            error
        ) {

            this.logger.warn?.(
                {
                    error,
                    metric: name
                },
                'Circuit breaker metrics emission failed'
            );
        }
    }

    /**
     * =========================================================================
     * EVENT EMISSION
     * =========================================================================
     */

    emitEvent(
        event,
        payload = {}
    ) {

        const eventPayload = {

            event,

            breakerId:
                this.identity.breakerId,

            breakerName:
                this.identity.name,

            timestamp:
                new Date(),

            state:
                this.state,

            ...payload
        };

        try {

            this.emit(
                event,
                eventPayload
            );

        }
        catch (
            error
        ) {

            this.logger.warn?.(
                {
                    error,
                    event
                },
                'Circuit breaker event listener failed'
            );
        }
    }

    /**
     * =========================================================================
     * ERROR SERIALIZATION
     * =========================================================================
     */

    serializeError(
        error
    ) {

        if (
            !error
        ) {

            return null;
        }

        return {

            name:
                error.name,

            message:
                error.message,

            code:
                error.code,

            stack:
                error.stack
        };
    }

    /**
     * =========================================================================
     * RUNTIME STATISTICS
     * =========================================================================
     */

    getStatistics() {

        const executions =
            this.totalExecutions;

        const failureRate =
            executions > 0
                ? Number(
                    (
                        this.totalFailures /
                        executions
                    ).toFixed(4)
                )
                : 0;

        const rejectionRate =
            executions > 0
                ? Number(
                    (
                        this.rejectedExecutions /
                        executions
                    ).toFixed(4)
                )
                : 0;

        return {

            breakerId:
                this.identity.breakerId,

            state:
                this.state,

            executions,

            successes:
                this.totalSuccesses,

            failures:
                this.totalFailures,

            rejected:
                this.rejectedExecutions,

            timeouts:
                this.timeoutCount,

            trips:
                this.totalTrips,

            failureRate,

            rejectionRate,

            activeExecutions:
                this.activeExecutions.size,

            failureWindowSize:
                this.failureEvents.length,

            timestamp:
                new Date()
        };
    }

    /**
     * =========================================================================
     * DESTROY
     * =========================================================================
     *
     * Used during graceful application shutdown.
     */

    destroy() {

        this.destroyed = true;

        this.activeExecutions.clear();

        this.failureEvents = [];

        this.removeAllListeners();

        this.state =
            STATES.CLOSED;

        this.openedAt = null;

        this.halfOpenedAt = null;
    }
}

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 *
 * Preserve the existing default export contract.
 * =============================================================================
 */

module.exports =
    TransactionCircuitBreaker;

module.exports.TransactionCircuitBreaker =
    TransactionCircuitBreaker;

module.exports.CircuitBreakerError =
    CircuitBreakerError;

module.exports.STATES =
    STATES;

module.exports.EVENTS =
    EVENTS;