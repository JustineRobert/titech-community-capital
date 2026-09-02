'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Backpressure Controller
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionBackpressureController.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose
 * -------
 * Enterprise admission-control and backpressure engine for distributed
 * financial transaction processing.
 *
 * Responsibilities
 * ----------------
 * • Protect transaction infrastructure from overload
 * • Enforce global and tenant-level concurrency limits
 * • Enforce queue depth limits
 * • Apply priority-aware admission control
 * • Prevent uncontrolled transaction accumulation
 * • Support transaction execution timeouts
 * • Support graceful draining / shutdown
 * • Provide deterministic rejection reasons
 * • Provide retry-after hints
 * • Track operational metrics
 * • Maintain tenant isolation
 * • Integrate with transaction orchestration components without owning
 *   transaction business logic
 *
 * Design Principles
 * -----------------
 * • This component controls admission; it does not execute transactions.
 * • No financial state is mutated by this service.
 * • No transaction is silently dropped.
 * • Rejected requests receive machine-readable reasons.
 * • Configuration is immutable after construction.
 * • Runtime state is isolated from configuration.
 * • All public methods are defensive against malformed input.
 *
 * Integration Targets
 * -------------------
 * Compatible with:
 *
 *   TransactionEventCoordinator
 *   SagaOrchestrator
 *   DistributedTransactionManager
 *   TransactionStateMachine
 *   TransactionContext
 *   CompensationOrchestrator
 *
 * ============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const VERSION = '3.0.0';

const CONTROLLER_STATES = Object.freeze({
    CREATED: 'CREATED',
    READY: 'READY',
    RUNNING: 'RUNNING',
    DRAINING: 'DRAINING',
    STOPPED: 'STOPPED',
    FAILED: 'FAILED'
});

const REQUEST_STATES = Object.freeze({
    ADMITTED: 'ADMITTED',
    EXECUTING: 'EXECUTING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    TIMED_OUT: 'TIMED_OUT',
    REJECTED: 'REJECTED',
    RELEASED: 'RELEASED'
});

const PRIORITIES = Object.freeze({
    CRITICAL: 100,
    HIGH: 75,
    NORMAL: 50,
    LOW: 25,
    BULK: 10
});

const REJECTION_REASONS = Object.freeze({
    CONTROLLER_NOT_READY: 'CONTROLLER_NOT_READY',
    CONTROLLER_DRAINING: 'CONTROLLER_DRAINING',
    CONTROLLER_STOPPED: 'CONTROLLER_STOPPED',
    GLOBAL_CONCURRENCY_LIMIT: 'GLOBAL_CONCURRENCY_LIMIT',
    TENANT_CONCURRENCY_LIMIT: 'TENANT_CONCURRENCY_LIMIT',
    GLOBAL_QUEUE_LIMIT: 'GLOBAL_QUEUE_LIMIT',
    TENANT_QUEUE_LIMIT: 'TENANT_QUEUE_LIMIT',
    PRIORITY_CAPACITY_LIMIT: 'PRIORITY_CAPACITY_LIMIT',
    DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
    INVALID_REQUEST: 'INVALID_REQUEST',
    REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
    ABORTED: 'ABORTED'
});

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,

    globalConcurrency: 100,

    globalQueueLimit: 1000,

    tenantConcurrency: 20,

    tenantQueueLimit: 200,

    priorityConcurrency: {
        CRITICAL: 25,
        HIGH: 30,
        NORMAL: 40,
        LOW: 20,
        BULK: 10
    },

    defaultTimeoutMs: 30000,

    maximumTimeoutMs: 120000,

    minimumTimeoutMs: 1000,

    retryAfterMs: 1000,

    criticalBypassQueueLimit: true,

    rejectWhenDraining: true,

    allowDuplicateTransaction: false,

    cleanupIntervalMs: 30000,

    completedRequestRetentionMs: 60000,

    enableTimeoutEnforcement: true,

    enableMetrics: true,

    strictTenantIsolation: true,

    maxMetricsSamples: 500,

    maxTenantRegistrySize: 10000
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(value, min, max) {
    return Math.min(
        Math.max(value, min),
        max
    );
}

function now() {
    return Date.now();
}

function createId(prefix) {
    if (typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 12)}`;
}

/**
 * ============================================================================
 * TRANSACTION BACKPRESSURE CONTROLLER
 * ============================================================================
 */

class TransactionBackpressureController extends EventEmitter {

    constructor(options = {}) {

        super();

        this.config = Object.freeze({
            ...DEFAULT_CONFIG,
            ...(options.config || {}),

            priorityConcurrency: Object.freeze({
                ...DEFAULT_CONFIG.priorityConcurrency,
                ...(options.config?.priorityConcurrency || {})
            })
        });

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.clock =
            options.clock ||
            Date;

        this.controllerId =
            options.controllerId ||
            createId('backpressure');

        this.state =
            CONTROLLER_STATES.CREATED;

        /**
         * ---------------------------------------------------------------------
         * Active Requests
         * ---------------------------------------------------------------------
         *
         * requestId -> request record
         */

        this.activeRequests =
            new Map();

        /**
         * transactionId -> requestId
         */

        this.transactionRegistry =
            new Map();

        /**
         * tenantId -> runtime counters
         */

        this.tenantRegistry =
            new Map();

        /**
         * priority -> active count
         */

        this.priorityRegistry =
            new Map();

        Object.keys(PRIORITIES).forEach(priority => {
            this.priorityRegistry.set(
                priority,
                0
            );
        });

        /**
         * ---------------------------------------------------------------------
         * Completed request retention
         * ---------------------------------------------------------------------
         */

        this.completedRequests =
            new Map();

        /**
         * ---------------------------------------------------------------------
         * Operational metrics
         * ---------------------------------------------------------------------
         */

        this.counters = {
            admitted: 0,
            completed: 0,
            failed: 0,
            timedOut: 0,
            rejected: 0,

            duplicateRejected: 0,
            globalLimitRejected: 0,
            tenantLimitRejected: 0,
            queueLimitRejected: 0,
            drainingRejected: 0,

            releases: 0,

            totalExecutionMs: 0,
            peakConcurrency: 0,
            peakQueueDepth: 0
        };

        this.rejectionCounters =
            new Map();

        this.latencySamples =
            [];

        this.lastError =
            null;

        this.startedAt =
            null;

        this.stoppedAt =
            null;

        this.cleanupTimer =
            null;

        this.initialized =
            false;

        this.validateConfiguration();

        this.logger.info?.(
            {
                controllerId: this.controllerId,
                version: VERSION,
                state: this.state
            },
            'TransactionBackpressureController created'
        );
    }

    /**
     * =========================================================================
     * CONFIGURATION VALIDATION
     * =========================================================================
     */

    validateConfiguration() {

        const numericFields = [
            'globalConcurrency',
            'globalQueueLimit',
            'tenantConcurrency',
            'tenantQueueLimit',
            'defaultTimeoutMs',
            'maximumTimeoutMs',
            'minimumTimeoutMs',
            'retryAfterMs',
            'cleanupIntervalMs',
            'completedRequestRetentionMs',
            'maxMetricsSamples',
            'maxTenantRegistrySize'
        ];

        for (const field of numericFields) {

            if (
                !Number.isFinite(
                    Number(this.config[field])
                )
            ) {
                throw new Error(
                    `Invalid backpressure configuration: ${field}`
                );
            }

            if (
                Number(this.config[field]) < 0
            ) {
                throw new Error(
                    `Backpressure configuration cannot be negative: ${field}`
                );
            }
        }

        if (
            this.config.globalConcurrency < 1
        ) {
            throw new Error(
                'globalConcurrency must be greater than zero'
            );
        }

        if (
            this.config.tenantConcurrency < 1
        ) {
            throw new Error(
                'tenantConcurrency must be greater than zero'
            );
        }

        for (const priority of Object.keys(PRIORITIES)) {

            const limit =
                this.config.priorityConcurrency[priority];

            if (
                !Number.isFinite(Number(limit)) ||
                Number(limit) < 1
            ) {
                throw new Error(
                    `Invalid priority concurrency limit: ${priority}`
                );
            }
        }

        if (
            this.config.maximumTimeoutMs <
            this.config.minimumTimeoutMs
        ) {
            throw new Error(
                'maximumTimeoutMs must be >= minimumTimeoutMs'
            );
        }
    }

    /**
     * =========================================================================
     * LIFECYCLE
     * =========================================================================
     */

    async initialize() {

        if (
            this.initialized
        ) {
            return this.getHealth();
        }

        if (
            !this.config.enabled
        ) {
            this.state =
                CONTROLLER_STATES.STOPPED;

            return this.getHealth();
        }

        this.state =
            CONTROLLER_STATES.READY;

        this.startedAt =
            new Date();

        this.initialized =
            true;

        this.startCleanupTimer();

        this.emit(
            'initialized',
            this.getHealth()
        );

        this.logger.info?.(
            {
                controllerId: this.controllerId
            },
            'Transaction backpressure controller initialized'
        );

        return this.getHealth();
    }

    async start() {

        if (
            !this.initialized
        ) {
            await this.initialize();
        }

        if (
            this.state === CONTROLLER_STATES.STOPPED
        ) {
            throw new Error(
                'Cannot start a stopped backpressure controller'
            );
        }

        this.state =
            CONTROLLER_STATES.RUNNING;

        this.emit(
            'started',
            this.getHealth()
        );

        return this.getHealth();
    }

    async beginDrain() {

        if (
            this.state === CONTROLLER_STATES.STOPPED
        ) {
            return this.getHealth();
        }

        this.state =
            CONTROLLER_STATES.DRAINING;

        this.emit(
            'draining',
            this.getHealth()
        );

        this.logger.warn?.(
            {
                controllerId: this.controllerId,
                activeRequests: this.activeRequests.size
            },
            'Transaction backpressure controller entering drain mode'
        );

        return this.getHealth();
    }

    async stop(options = {}) {

        const {
            force = false
        } = options;

        if (
            this.state !== CONTROLLER_STATES.DRAINING &&
            this.state !== CONTROLLER_STATES.STOPPED
        ) {
            await this.beginDrain();
        }

        if (force) {
            this.forceReleaseAll(
                'Controller stopped forcefully'
            );
        }

        this.stopCleanupTimer();

        this.state =
            CONTROLLER_STATES.STOPPED;

        this.stoppedAt =
            new Date();

        this.emit(
            'stopped',
            this.getHealth()
        );

        return this.getHealth();
    }

    /**
     * =========================================================================
     * ADMISSION CONTROL
     * =========================================================================
     *
     * Attempts to reserve execution capacity for a transaction.
     *
     * This is intentionally separate from transaction execution.
     */

    admit(request = {}) {

        const normalized =
            this.normalizeRequest(
                request
            );

        const validation =
            this.validateRequest(
                normalized
            );

        if (!validation.valid) {

            return this.reject(
                normalized,
                REJECTION_REASONS.INVALID_REQUEST,
                validation.errors
            );
        }

        const readiness =
            this.checkReadiness();

        if (!readiness.allowed) {

            return this.reject(
                normalized,
                readiness.reason
            );
        }

        const duplicate =
            this.checkDuplicate(
                normalized
            );

        if (duplicate) {

            this.counters.duplicateRejected++;

            return this.reject(
                normalized,
                REJECTION_REASONS.DUPLICATE_TRANSACTION
            );
        }

        const capacity =
            this.evaluateCapacity(
                normalized
            );

        if (!capacity.allowed) {

            return this.reject(
                normalized,
                capacity.reason,
                {
                    retryAfterMs:
                        capacity.retryAfterMs
                }
            );
        }

        const requestId =
            normalized.requestId ||
            createId('admission');

        const admittedAt =
            this.currentTime();

        const timeoutMs =
            normalized.timeoutMs;

        const record = {
            requestId,

            transactionId:
                normalized.transactionId,

            correlationId:
                normalized.correlationId,

            tenantId:
                normalized.tenantId,

            operation:
                normalized.operation,

            priority:
                normalized.priority,

            state:
                REQUEST_STATES.ADMITTED,

            admittedAt,

            startedAt:
                null,

            deadline:
                new Date(
                    admittedAt.getTime() +
                    timeoutMs
                ),

            timeoutMs,

            metadata:
                normalized.metadata,

            tags:
                normalized.tags
        };

        this.activeRequests.set(
            requestId,
            record
        );

        this.transactionRegistry.set(
            normalized.transactionId,
            requestId
        );

        this.incrementTenant(
            normalized.tenantId
        );

        this.incrementPriority(
            normalized.priority
        );

        this.counters.admitted++;

        this.updatePeaks();

        if (
            this.state === CONTROLLER_STATES.READY
        ) {
            this.state =
                CONTROLLER_STATES.RUNNING;
        }

        this.emit(
            'admitted',
            this.sanitizeRecord(record)
        );

        this.incrementMetric(
            'transaction.backpressure.admitted'
        );

        return {
            admitted: true,

            requestId,

            transactionId:
                normalized.transactionId,

            correlationId:
                normalized.correlationId,

            tenantId:
                normalized.tenantId,

            priority:
                normalized.priority,

            timeoutMs,

            deadline:
                record.deadline,

            state:
                REQUEST_STATES.ADMITTED,

            controllerId:
                this.controllerId
        };
    }

    /**
     * =========================================================================
     * BEGIN EXECUTION
     * =========================================================================
     */

    beginExecution(requestId) {

        const record =
            this.activeRequests.get(
                requestId
            );

        if (!record) {

            throw this.createError(
                'BACKPRESSURE_REQUEST_NOT_FOUND',
                `Backpressure request not found: ${requestId}`
            );
        }

        if (
            record.state !==
            REQUEST_STATES.ADMITTED
        ) {
            throw this.createError(
                'BACKPRESSURE_INVALID_STATE',
                `Request ${requestId} cannot begin execution from state ${record.state}`
            );
        }

        if (
            this.isExpired(record)
        ) {

            this.timeout(
                requestId
            );

            throw this.createError(
                REJECTION_REASONS.REQUEST_TIMEOUT,
                'Transaction admission expired before execution'
            );
        }

        record.state =
            REQUEST_STATES.EXECUTING;

        record.startedAt =
            this.currentTime();

        this.emit(
            'execution.started',
            this.sanitizeRecord(record)
        );

        this.incrementMetric(
            'transaction.backpressure.execution.started'
        );

        return this.sanitizeRecord(
            record
        );
    }

    /**
     * =========================================================================
     * COMPLETION
     * =========================================================================
     */

    complete(requestId, metadata = {}) {

        const record =
            this.activeRequests.get(
                requestId
            );

        if (!record) {
            return false;
        }

        const completedAt =
            this.currentTime();

        record.state =
            REQUEST_STATES.COMPLETED;

        record.completedAt =
            completedAt;

        record.resultMetadata =
            metadata;

        const duration =
            record.startedAt
                ? completedAt.getTime() -
                  record.startedAt.getTime()
                : completedAt.getTime() -
                  record.admittedAt.getTime();

        record.durationMs =
            Math.max(
                0,
                duration
            );

        this.counters.completed++;

        this.counters.totalExecutionMs +=
            record.durationMs;

        this.addLatencySample(
            record.durationMs
        );

        this.releaseInternal(
            record,
            {
                completed: true
            }
        );

        this.emit(
            'completed',
            this.sanitizeRecord(record)
        );

        this.incrementMetric(
            'transaction.backpressure.completed',
            record.durationMs
        );

        return true;
    }

    /**
     * =========================================================================
     * FAILURE
     * =========================================================================
     */

    fail(requestId, error, metadata = {}) {

        const record =
            this.activeRequests.get(
                requestId
            );

        if (!record) {
            return false;
        }

        const failedAt =
            this.currentTime();

        record.state =
            REQUEST_STATES.FAILED;

        record.failedAt =
            failedAt;

        record.durationMs =
            record.startedAt
                ? Math.max(
                    0,
                    failedAt.getTime() -
                    record.startedAt.getTime()
                )
                : 0;

        record.error =
            this.serializeError(
                error
            );

        record.resultMetadata =
            metadata;

        this.counters.failed++;

        this.counters.totalExecutionMs +=
            record.durationMs;

        this.addLatencySample(
            record.durationMs
        );

        this.releaseInternal(
            record,
            {
                completed: false
            }
        );

        this.emit(
            'failed',
            this.sanitizeRecord(record)
        );

        this.incrementMetric(
            'transaction.backpressure.failed'
        );

        return true;
    }

    /**
     * =========================================================================
     * TIMEOUT
     * =========================================================================
     */

    timeout(requestId) {

        const record =
            this.activeRequests.get(
                requestId
            );

        if (!record) {
            return false;
        }

        const timeoutAt =
            this.currentTime();

        record.state =
            REQUEST_STATES.TIMED_OUT;

        record.timeoutAt =
            timeoutAt;

        record.durationMs =
            record.startedAt
                ? Math.max(
                    0,
                    timeoutAt.getTime() -
                    record.startedAt.getTime()
                )
                : 0;

        record.error = {
            code:
                REJECTION_REASONS.REQUEST_TIMEOUT,

            message:
                'Transaction execution timeout exceeded'
        };

        this.counters.timedOut++;

        this.releaseInternal(
            record,
            {
                completed: false
            }
        );

        this.emit(
            'timedout',
            this.sanitizeRecord(record)
        );

        this.incrementMetric(
            'transaction.backpressure.timeout'
        );

        return true;
    }

    /**
     * =========================================================================
     * RELEASE
     * =========================================================================
     */

    release(requestId, metadata = {}) {

        const record =
            this.activeRequests.get(
                requestId
            );

        if (!record) {
            return false;
        }

        record.state =
            REQUEST_STATES.RELEASED;

        record.releaseMetadata =
            metadata;

        this.releaseInternal(
            record,
            {
                completed: false
            }
        );

        this.counters.releases++;

        this.emit(
            'released',
            this.sanitizeRecord(record)
        );

        return true;
    }

    /**
     * =========================================================================
     * INTERNAL RELEASE
     * =========================================================================
     */

    releaseInternal(record, options = {}) {

        if (!record) {
            return;
        }

        this.activeRequests.delete(
            record.requestId
        );

        this.transactionRegistry.delete(
            record.transactionId
        );

        this.decrementTenant(
            record.tenantId
        );

        this.decrementPriority(
            record.priority
        );

        if (
            options.completed
        ) {

            this.completedRequests.set(
                record.requestId,
                {
                    requestId:
                        record.requestId,

                    transactionId:
                        record.transactionId,

                    tenantId:
                        record.tenantId,

                    completedAt:
                        this.currentTime()
                }
            );
        }
    }

    /**
     * =========================================================================
     * CAPACITY EVALUATION
     * =========================================================================
     */

    evaluateCapacity(request) {

        const priority =
            request.priority;

        const isCritical =
            priority === 'CRITICAL';

        const globalActive =
            this.activeRequests.size;

        if (
            globalActive >=
            this.config.globalConcurrency
        ) {

            if (
                !(
                    isCritical &&
                    this.config.criticalBypassQueueLimit
                )
            ) {
                this.counters.globalLimitRejected++;

                return {
                    allowed: false,

                    reason:
                        REJECTION_REASONS.GLOBAL_CONCURRENCY_LIMIT,

                    retryAfterMs:
                        this.config.retryAfterMs
                };
            }
        }

        const tenant =
            this.getTenantCounters(
                request.tenantId
            );

        if (
            tenant.active >=
            this.config.tenantConcurrency
        ) {

            this.counters.tenantLimitRejected++;

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.TENANT_CONCURRENCY_LIMIT,

                retryAfterMs:
                    this.config.retryAfterMs
            };
        }

        if (
            tenant.queueDepth >=
            this.config.tenantQueueLimit
        ) {

            this.counters.queueLimitRejected++;

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.TENANT_QUEUE_LIMIT,

                retryAfterMs:
                    this.config.retryAfterMs
            };
        }

        if (
            globalActive >=
            this.config.globalQueueLimit +
            this.config.globalConcurrency
        ) {

            if (
                !(
                    isCritical &&
                    this.config.criticalBypassQueueLimit
                )
            ) {

                this.counters.queueLimitRejected++;

                return {
                    allowed: false,

                    reason:
                        REJECTION_REASONS.GLOBAL_QUEUE_LIMIT,

                    retryAfterMs:
                        this.config.retryAfterMs
                };
            }
        }

        const priorityActive =
            this.getPriorityCount(
                priority
            );

        const priorityLimit =
            this.config.priorityConcurrency[
                priority
            ];

        if (
            priorityActive >=
            priorityLimit
        ) {

            if (
                !isCritical
            ) {

                this.counters.queueLimitRejected++;

                return {
                    allowed: false,

                    reason:
                        REJECTION_REASONS.PRIORITY_CAPACITY_LIMIT,

                    retryAfterMs:
                        this.config.retryAfterMs
                };
            }
        }

        return {
            allowed: true
        };
    }

    /**
     * =========================================================================
     * READINESS
     * =========================================================================
     */

    checkReadiness() {

        if (
            !this.config.enabled
        ) {

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.CONTROLLER_STOPPED
            };
        }

        if (
            !this.initialized
        ) {

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.CONTROLLER_NOT_READY
            };
        }

        if (
            this.state ===
            CONTROLLER_STATES.DRAINING
        ) {

            this.counters.drainingRejected++;

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.CONTROLLER_DRAINING
            };
        }

        if (
            this.state ===
            CONTROLLER_STATES.STOPPED
        ) {

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.CONTROLLER_STOPPED
            };
        }

        if (
            this.state ===
            CONTROLLER_STATES.FAILED
        ) {

            return {
                allowed: false,

                reason:
                    REJECTION_REASONS.CONTROLLER_NOT_READY
            };
        }

        return {
            allowed: true
        };
    }

    /**
     * =========================================================================
     * REQUEST NORMALIZATION
     * =========================================================================
     */

    normalizeRequest(request = {}) {

        const timeoutMs =
            clamp(
                safeNumber(
                    request.timeoutMs,
                    this.config.defaultTimeoutMs
                ),
                this.config.minimumTimeoutMs,
                this.config.maximumTimeoutMs
            );

        return {
            requestId:
                request.requestId ||
                createId('request'),

            transactionId:
                request.transactionId ||
                null,

            correlationId:
                request.correlationId ||
                null,

            tenantId:
                request.tenantId ||
                null,

            operation:
                request.operation ||
                'UNKNOWN',

            priority:
                this.normalizePriority(
                    request.priority
                ),

            timeoutMs,

            metadata:
                request.metadata &&
                typeof request.metadata === 'object'
                    ? {
                        ...request.metadata
                    }
                    : {},

            tags:
                Array.isArray(request.tags)
                    ? [...request.tags]
                    : []
        };
    }

    normalizePriority(priority) {

        const normalized =
            String(
                priority || 'NORMAL'
            ).toUpperCase();

        return Object.prototype.hasOwnProperty.call(
            PRIORITIES,
            normalized
        )
            ? normalized
            : 'NORMAL';
    }

    /**
     * =========================================================================
     * REQUEST VALIDATION
     * =========================================================================
     */

    validateRequest(request) {

        const errors = [];

        if (
            !request.transactionId
        ) {
            errors.push(
                'transactionId is required'
            );
        }

        if (
            !request.tenantId
        ) {
            errors.push(
                'tenantId is required'
            );
        }

        if (
            !request.correlationId
        ) {
            errors.push(
                'correlationId is required'
            );
        }

        if (
            !request.operation
        ) {
            errors.push(
                'operation is required'
            );
        }

        if (
            !Number.isFinite(
                request.timeoutMs
            )
        ) {
            errors.push(
                'timeoutMs must be numeric'
            );
        }

        return {
            valid:
                errors.length === 0,

            errors
        };
    }

    /**
     * =========================================================================
     * DUPLICATE DETECTION
     * =========================================================================
     */

    checkDuplicate(request) {

        if (
            this.config.allowDuplicateTransaction
        ) {
            return false;
        }

        if (
            this.transactionRegistry.has(
                request.transactionId
            )
        ) {
            return true;
        }

        return false;
    }

    /**
     * =========================================================================
     * REJECTION
     * =========================================================================
     */

    reject(request, reason, details = null) {

        this.counters.rejected++;

        const current =
            this.rejectionCounters.get(
                reason
            ) || 0;

        this.rejectionCounters.set(
            reason,
            current + 1
        );

        const response = {
            admitted: false,

            requestId:
                request.requestId,

            transactionId:
                request.transactionId,

            correlationId:
                request.correlationId,

            tenantId:
                request.tenantId,

            reason,

            retryable:
                this.isRetryableRejection(
                    reason
                ),

            retryAfterMs:
                this.config.retryAfterMs,

            controllerId:
                this.controllerId,

            timestamp:
                this.currentTime(),

            details
        };

        this.emit(
            'rejected',
            response
        );

        this.incrementMetric(
            'transaction.backpressure.rejected'
        );

        return response;
    }

    isRetryableRejection(reason) {

        return [
            REJECTION_REASONS.GLOBAL_CONCURRENCY_LIMIT,
            REJECTION_REASONS.TENANT_CONCURRENCY_LIMIT,
            REJECTION_REASONS.GLOBAL_QUEUE_LIMIT,
            REJECTION_REASONS.TENANT_QUEUE_LIMIT,
            REJECTION_REASONS.PRIORITY_CAPACITY_LIMIT
        ].includes(reason);
    }

    /**
     * =========================================================================
     * TENANT REGISTRY
     * =========================================================================
     */

    getTenantCounters(tenantId) {

        if (
            !tenantId
        ) {
            return {
                active: 0,
                queueDepth: 0
            };
        }

        let counters =
            this.tenantRegistry.get(
                tenantId
            );

        if (!counters) {

            if (
                this.tenantRegistry.size >=
                this.config.maxTenantRegistrySize
            ) {
                throw this.createError(
                    'TENANT_REGISTRY_LIMIT',
                    'Maximum tenant registry capacity reached'
                );
            }

            counters = {
                active: 0,
                queueDepth: 0,
                admitted: 0,
                completed: 0,
                rejected: 0,
                failed: 0,
                lastActivityAt:
                    this.currentTime()
            };

            this.tenantRegistry.set(
                tenantId,
                counters
            );
        }

        return counters;
    }

    incrementTenant(tenantId) {

        const counters =
            this.getTenantCounters(
                tenantId
            );

        counters.active++;

        counters.admitted++;

        counters.queueDepth =
            Math.max(
                0,
                counters.active -
                this.config.tenantConcurrency
            );

        counters.lastActivityAt =
            this.currentTime();
    }

    decrementTenant(tenantId) {

        const counters =
            this.tenantRegistry.get(
                tenantId
            );

        if (!counters) {
            return;
        }

        counters.active =
            Math.max(
                0,
                counters.active - 1
            );

        counters.completed++;

        counters.queueDepth =
            Math.max(
                0,
                counters.active -
                this.config.tenantConcurrency
            );

        counters.lastActivityAt =
            this.currentTime();
    }

    /**
     * =========================================================================
     * PRIORITY REGISTRY
     * =========================================================================
     */

    incrementPriority(priority) {

        const current =
            this.getPriorityCount(
                priority
            );

        this.priorityRegistry.set(
            priority,
            current + 1
        );
    }

    decrementPriority(priority) {

        const current =
            this.getPriorityCount(
                priority
            );

        this.priorityRegistry.set(
            priority,
            Math.max(
                0,
                current - 1
            )
        );
    }

    getPriorityCount(priority) {

        return (
            this.priorityRegistry.get(
                priority
            ) || 0
        );
    }

    /**
     * =========================================================================
     * TIMEOUT ENFORCEMENT
     * =========================================================================
     */

    enforceTimeouts() {

        if (
            !this.config.enableTimeoutEnforcement
        ) {
            return 0;
        }

        const current =
            this.currentTime();

        let timedOut =
            0;

        for (
            const record of
            this.activeRequests.values()
        ) {

            if (
                record.deadline <= current
            ) {

                if (
                    this.timeout(
                        record.requestId
                    )
                ) {
                    timedOut++;
                }
            }
        }

        return timedOut;
    }

    /**
     * =========================================================================
     * CLEANUP
     * =========================================================================
     */

    cleanupCompletedRequests() {

        const cutoff =
            this.currentTime().getTime() -
            this.config.completedRequestRetentionMs;

        for (
            const [
                requestId,
                record
            ] of this.completedRequests.entries()
        ) {

            if (
                record.completedAt.getTime() <
                cutoff
            ) {
                this.completedRequests.delete(
                    requestId
                );
            }
        }

        this.cleanupTenantRegistry();

        return true;
    }

    cleanupTenantRegistry() {

        for (
            const [
                tenantId,
                counters
            ] of this.tenantRegistry.entries()
        ) {

            if (
                counters.active === 0 &&
                counters.queueDepth === 0
            ) {

                this.tenantRegistry.delete(
                    tenantId
                );
            }
        }
    }

    startCleanupTimer() {

        if (
            this.cleanupTimer ||
            this.config.cleanupIntervalMs <= 0
        ) {
            return;
        }

        this.cleanupTimer =
            setInterval(
                () => {

                    try {

                        this.enforceTimeouts();

                        this.cleanupCompletedRequests();

                    } catch (error) {

                        this.lastError =
                            this.serializeError(
                                error
                            );

                        this.logger.error?.(
                            {
                                error
                            },
                            'Backpressure cleanup failed'
                        );
                    }
                },
                this.config.cleanupIntervalMs
            );

        if (
            typeof this.cleanupTimer.unref ===
            'function'
        ) {
            this.cleanupTimer.unref();
        }
    }

    stopCleanupTimer() {

        if (
            !this.cleanupTimer
        ) {
            return;
        }

        clearInterval(
            this.cleanupTimer
        );

        this.cleanupTimer =
            null;
    }

    /**
     * =========================================================================
     * FORCE RELEASE
     * =========================================================================
     */

    forceReleaseAll(reason) {

        const requestIds =
            Array.from(
                this.activeRequests.keys()
            );

        for (
            const requestId of requestIds
        ) {

            const record =
                this.activeRequests.get(
                    requestId
                );

            if (!record) {
                continue;
            }

            record.state =
                REQUEST_STATES.RELEASED;

            record.releaseReason =
                reason;

            this.releaseInternal(
                record
            );
        }

        return requestIds.length;
    }

    /**
     * =========================================================================
     * HEALTH
     * =========================================================================
     */

    getHealth() {

        const active =
            this.activeRequests.size;

        const queueDepth =
            this.getQueueDepth();

        const utilization =
            this.config.globalConcurrency > 0
                ? Number(
                    (
                        active /
                        this.config.globalConcurrency
                    ).toFixed(4)
                )
                : 0;

        let status =
            'HEALTHY';

        if (
            this.state ===
            CONTROLLER_STATES.DRAINING
        ) {
            status =
                'DRAINING';
        } else if (
            this.state ===
            CONTROLLER_STATES.FAILED
        ) {
            status =
                'FAILED';
        } else if (
            utilization >= 0.9
        ) {
            status =
                'SATURATED';
        } else if (
            utilization >= 0.75
        ) {
            status =
                'DEGRADED';
        }

        return {
            status,

            ready:
                this.initialized &&
                this.state ===
                    CONTROLLER_STATES.RUNNING,

            state:
                this.state,

            controllerId:
                this.controllerId,

            version:
                VERSION,

            activeRequests:
                active,

            queueDepth,

            globalConcurrency:
                this.config.globalConcurrency,

            globalQueueLimit:
                this.config.globalQueueLimit,

            utilization,

            tenantCount:
                this.tenantRegistry.size,

            priorityUtilization:
                this.getPriorityUtilization(),

            counters:
                {
                    ...this.counters
                },

            rejectionCounters:
                Object.fromEntries(
                    this.rejectionCounters
                ),

            averageExecutionMs:
                this.getAverageExecutionMs(),

            p95ExecutionMs:
                this.getPercentile(0.95),

            startedAt:
                this.startedAt,

            stoppedAt:
                this.stoppedAt,

            lastError:
                this.lastError
        };
    }

    /**
     * =========================================================================
     * QUEUE / UTILIZATION METRICS
     * =========================================================================
     */

    getQueueDepth() {

        return Math.max(
            0,
            this.activeRequests.size -
            this.config.globalConcurrency
        );
    }

    getPriorityUtilization() {

        const result = {};

        for (
            const priority of
            Object.keys(PRIORITIES)
        ) {

            const active =
                this.getPriorityCount(
                    priority
                );

            const limit =
                this.config.priorityConcurrency[
                    priority
                ];

            result[priority] = {
                active,

                limit,

                utilization:
                    limit > 0
                        ? Number(
                            (
                                active /
                                limit
                            ).toFixed(4)
                        )
                        : 0
            };
        }

        return result;
    }

    updatePeaks() {

        const active =
            this.activeRequests.size;

        const queue =
            this.getQueueDepth();

        this.counters.peakConcurrency =
            Math.max(
                this.counters.peakConcurrency,
                active
            );

        this.counters.peakQueueDepth =
            Math.max(
                this.counters.peakQueueDepth,
                queue
            );
    }

    addLatencySample(durationMs) {

        if (
            !this.config.enableMetrics
        ) {
            return;
        }

        this.latencySamples.push(
            safeNumber(
                durationMs
            )
        );

        if (
            this.latencySamples.length >
            this.config.maxMetricsSamples
        ) {
            this.latencySamples.shift();
        }
    }

    getAverageExecutionMs() {

        if (
            this.latencySamples.length === 0
        ) {
            return 0;
        }

        const total =
            this.latencySamples.reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        return Number(
            (
                total /
                this.latencySamples.length
            ).toFixed(2)
        );
    }

    getPercentile(percentile) {

        if (
            this.latencySamples.length === 0
        ) {
            return 0;
        }

        const sorted =
            [...this.latencySamples]
                .sort(
                    (a, b) => a - b
                );

        const index =
            Math.min(
                sorted.length - 1,
                Math.max(
                    0,
                    Math.ceil(
                        percentile *
                        sorted.length
                    ) - 1
                )
            );

        return sorted[index];
    }

    /**
     * =========================================================================
     * REQUEST INSPECTION
     * =========================================================================
     */

    getRequest(requestId) {

        const record =
            this.activeRequests.get(
                requestId
            );

        return record
            ? this.sanitizeRecord(record)
            : null;
    }

    getTenantStatus(tenantId) {

        if (
            !tenantId
        ) {
            return null;
        }

        const counters =
            this.tenantRegistry.get(
                tenantId
            );

        if (!counters) {

            return {
                tenantId,

                active: 0,

                queueDepth: 0,

                limit:
                    this.config.tenantConcurrency,

                utilization: 0
            };
        }

        return {
            tenantId,

            active:
                counters.active,

            queueDepth:
                counters.queueDepth,

            limit:
                this.config.tenantConcurrency,

            utilization:
                Number(
                    (
                        counters.active /
                        this.config.tenantConcurrency
                    ).toFixed(4)
                ),

            admitted:
                counters.admitted,

            completed:
                counters.completed,

            rejected:
                counters.rejected,

            failed:
                counters.failed,

            lastActivityAt:
                counters.lastActivityAt
        };
    }

    /**
     * =========================================================================
     * ERROR / SERIALIZATION
     * =========================================================================
     */

    createError(code, message) {

        const error =
            new Error(
                message
            );

        error.code =
            code;

        error.controllerId =
            this.controllerId;

        error.timestamp =
            this.currentTime();

        return error;
    }

    serializeError(error) {

        if (!error) {
            return null;
        }

        return {
            name:
                error.name ||
                'Error',

            message:
                error.message ||
                String(error),

            code:
                error.code ||
                'TRANSACTION_BACKPRESSURE_ERROR'
        };
    }

    sanitizeRecord(record) {

        if (!record) {
            return null;
        }

        return {
            requestId:
                record.requestId,

            transactionId:
                record.transactionId,

            correlationId:
                record.correlationId,

            tenantId:
                record.tenantId,

            operation:
                record.operation,

            priority:
                record.priority,

            state:
                record.state,

            admittedAt:
                record.admittedAt,

            startedAt:
                record.startedAt,

            completedAt:
                record.completedAt,

            failedAt:
                record.failedAt,

            timeoutAt:
                record.timeoutAt,

            deadline:
                record.deadline,

            timeoutMs:
                record.timeoutMs,

            durationMs:
                record.durationMs,

            error:
                record.error
        };
    }

    isExpired(record) {

        return (
            record.deadline &&
            record.deadline.getTime() <=
                this.currentTime().getTime()
        );
    }

    currentTime() {

        return new this.clock();
    }

    /**
     * =========================================================================
     * METRICS INTEGRATION
     * =========================================================================
     */

    incrementMetric(name, value = 1) {

        if (
            !this.config.enableMetrics ||
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
                    value
                );

                return;
            }

            if (
                typeof this.metrics.inc ===
                'function'
            ) {
                this.metrics.inc(
                    name,
                    value
                );
            }

        } catch (error) {

            this.logger.warn?.(
                {
                    error,
                    metric: name
                },
                'Backpressure metric update failed'
            );
        }
    }

    /**
     * =========================================================================
     * SNAPSHOT
     * =========================================================================
     */

    getSnapshot() {

        return {
            controllerId:
                this.controllerId,

            version:
                VERSION,

            state:
                this.state,

            timestamp:
                this.currentTime(),

            health:
                this.getHealth(),

            activeTransactions:
                Array.from(
                    this.activeRequests.values()
                ).map(
                    record =>
                        this.sanitizeRecord(
                            record
                        )
                ),

            tenants:
                Array.from(
                    this.tenantRegistry.keys()
                ).map(
                    tenantId =>
                        this.getTenantStatus(
                            tenantId
                        )
                )
        };
    }

    /**
     * =========================================================================
     * RESET
     * =========================================================================
     *
     * Intended primarily for controlled testing or process reinitialization.
     * Never call this during normal financial transaction processing.
     */

    resetRuntimeState() {

        if (
            this.activeRequests.size > 0
        ) {
            throw this.createError(
                'BACKPRESSURE_ACTIVE_REQUESTS',
                'Cannot reset while transactions are active'
            );
        }

        this.transactionRegistry.clear();

        this.tenantRegistry.clear();

        this.completedRequests.clear();

        this.rejectionCounters.clear();

        this.latencySamples.length =
            0;

        Object.keys(
            this.counters
        ).forEach(key => {
            this.counters[key] =
                0;
        });

        this.lastError =
            null;

        return true;
    }
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

function createTransactionBackpressureController(
    options = {}
) {
    return new TransactionBackpressureController(
        options
    );
}

/**
 * ============================================================================
 * DEFAULT INSTANCE
 * ============================================================================
 *
 * The default export preserves the common singleton service pattern used by
 * the TITech backend while still exposing the class/factory for tests and
 * isolated service instances.
 * ============================================================================
 */

const defaultInstance =
    new TransactionBackpressureController();

module.exports =
    defaultInstance;

module.exports.TransactionBackpressureController =
    TransactionBackpressureController;

module.exports.createTransactionBackpressureController =
    createTransactionBackpressureController;

module.exports.CONTROLLER_STATES =
    CONTROLLER_STATES;

module.exports.REQUEST_STATES =
    REQUEST_STATES;

module.exports.PRIORITIES =
    PRIORITIES;

module.exports.REJECTION_REASONS =
    REJECTION_REASONS;

module.exports.VERSION =
    VERSION;