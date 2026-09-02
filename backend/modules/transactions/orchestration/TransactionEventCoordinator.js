'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Event Coordinator
 * =============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/TransactionEventCoordinator.js
 *
 * Version:
 * 3.0.0
 *
 * Purpose
 * -------
 * Central orchestration component responsible for coordinating distributed
 * financial transactions across:
 *
 * • DistributedTransactionManager
 * • TransactionStateMachine
 * • TransactionContext
 * • TransactionEventPublisher
 * • Audit Publisher
 * • Metrics
 * • Tracing
 * • Consistency Validation
 * • Compensation / Rollback
 *
 * Architectural Rules
 * -------------------
 * • This class coordinates infrastructure.
 * • It does not implement financial business logic.
 * • It does not mutate ledger balances.
 * • It does not bypass the transaction manager.
 * • It does not silently swallow transaction failures.
 * • Every execution has transaction + correlation identity.
 * • Every execution is tenant-scoped.
 * • Every execution is idempotency-aware.
 * • Every execution is observable.
 * • Every terminal state is explicitly recorded.
 *
 * =============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const DistributedTransactionManager =
    require('../DistributedTransactionManager');

const TransactionStateMachine =
    require('../TransactionStateMachine');

const TransactionContext =
    require('../TransactionContext');

const {
    deepFreeze
} = require('../utils/TransactionObjectUtils');

/**
 * =============================================================================
 * DEFAULT CONFIGURATION
 * =============================================================================
 */

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    strictMode: true,

    publishLifecycleEvents: true,

    validateDependencies: true,

    auditEnabled: true,

    tracingEnabled: true,

    metricsEnabled: true,

    compensationEnabled: true,

    coordinatorName: 'enterprise-transaction-coordinator',

    lockTimeoutMs: 30000,

    completedExecutionRetentionMs: 86400000,

    heartbeatIntervalMs: 10000,

    shutdownTimeoutMs: 30000,

    maxConcurrentTransactions: 1000,

    allowExecutionWithoutPublisher: false,

    allowExecutionWithoutMetrics: true,

    allowExecutionWithoutTracing: true,

    allowExecutionWithoutAudit: true

});

/**
 * =============================================================================
 * RUNTIME VALIDATION DEFAULTS
 * =============================================================================
 */

const RuntimeValidationDefaults = Object.freeze({

    requirePublisher: true,

    requireStateMachine: true,

    requireTransactionManager: true,

    allowDegradedMode: false

});

/**
 * =============================================================================
 * TRANSACTION CONTEXT DEFAULTS
 * =============================================================================
 */

const TransactionContextDefaults = Object.freeze({

    source: 'transaction-coordinator',

    auditEnabled: true,

    tracingEnabled: true,

    metricsEnabled: true,

    compensationEnabled: true

});

/**
 * =============================================================================
 * TRANSACTION LIFECYCLE STATES
 * =============================================================================
 */

const TransactionLifecycleState = Object.freeze({

    CREATED: 'CREATED',

    INITIALIZED: 'INITIALIZED',

    VALIDATING: 'VALIDATING',

    EXECUTING: 'EXECUTING',

    COMMITTING: 'COMMITTING',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    ROLLING_BACK: 'ROLLING_BACK',

    COMPENSATING: 'COMPENSATING',

    CANCELLED: 'CANCELLED'

});

/**
 * =============================================================================
 * COORDINATOR STATES
 * =============================================================================
 */

const CoordinatorState = Object.freeze({

    CREATED: 'CREATED',

    INITIALIZING: 'INITIALIZING',

    READY: 'READY',

    RUNNING: 'RUNNING',

    STOPPING: 'STOPPING',

    STOPPED: 'STOPPED',

    FAILED: 'FAILED'

});

/**
 * =============================================================================
 * EXECUTION GUARD DEFAULTS
 * =============================================================================
 */

const ExecutionGuardDefaults = Object.freeze({

    lockTimeoutMs: 30000,

    allowReplay: false,

    enforceIdempotency: true

});

/**
 * =============================================================================
 * TRANSACTION REQUEST DEFAULTS
 * =============================================================================
 */

const TransactionRequestDefaults = Object.freeze({

    priority: 'NORMAL',

    source: 'transaction-coordinator',

    version: 1,

    retryable: true,

    timeoutMs: 30000,

    metadata: {},

    tags: []

});

/**
 * =============================================================================
 * LIFECYCLE EVENTS
 * =============================================================================
 */

const LifecycleEvents = Object.freeze({

    INITIALIZED: 'coordinator.initialized',

    STARTED: 'transaction.started',

    INITIALIZED_TRANSACTION: 'transaction.initialized',

    VALIDATING: 'transaction.validating',

    EXECUTING: 'transaction.executing',

    COMMITTING: 'transaction.committing',

    COMMITTED: 'transaction.committed',

    ROLLED_BACK: 'transaction.rolled_back',

    COMPENSATING: 'transaction.compensating',

    FAILED: 'transaction.failed',

    CANCELLED: 'transaction.cancelled',

    STATE_CHANGED: 'transaction.state.changed',

    STOPPED: 'coordinator.stopped'

});

/**
 * =============================================================================
 * ERROR CODES
 * =============================================================================
 */

const ErrorCodes = Object.freeze({

    INVALID_REQUEST: 'INVALID_TRANSACTION_REQUEST',

    DUPLICATE_EXECUTION: 'DUPLICATE_TRANSACTION_EXECUTION',

    RUNTIME_VALIDATION_FAILED:
        'TRANSACTION_RUNTIME_VALIDATION_FAILED',

    COORDINATOR_NOT_READY:
        'TRANSACTION_COORDINATOR_NOT_READY',

    EXECUTION_TIMEOUT:
        'TRANSACTION_EXECUTION_TIMEOUT',

    EXECUTION_LOCK_EXPIRED:
        'TRANSACTION_EXECUTION_LOCK_EXPIRED',

    EXECUTION_FAILED:
        'TRANSACTION_EXECUTION_FAILED',

    COMPENSATION_FAILED:
        'TRANSACTION_COMPENSATION_FAILED',

    STATE_TRANSITION_FAILED:
        'TRANSACTION_STATE_TRANSITION_FAILED',

    SHUTDOWN_IN_PROGRESS:
        'TRANSACTION_COORDINATOR_SHUTTING_DOWN'

});

/**
 * =============================================================================
 * SERVICE
 * =============================================================================
 */

class TransactionEventCoordinator extends EventEmitter {

    constructor(options = {}) {

        super();

        /**
         * ---------------------------------------------------------------------
         * Configuration
         * ---------------------------------------------------------------------
         */

        this.config = Object.freeze({

            ...DEFAULT_CONFIGURATION,

            ...(options.config || {})

        });

        /**
         * ---------------------------------------------------------------------
         * Enterprise Dependencies
         * ---------------------------------------------------------------------
         */

        this.transactionManager =
            options.transactionManager ||
            new DistributedTransactionManager();

        this.stateMachine =
            options.stateMachine ||
            new TransactionStateMachine();

        this.eventPublisher =
            options.eventPublisher || null;

        this.auditPublisher =
            options.auditPublisher || null;

        this.metrics =
            options.metrics || null;

        this.tracer =
            options.tracer || null;

        this.logger =
            options.logger || console;

        this.consistencyValidator =
            options.consistencyValidator || null;

        this.compensationManager =
            options.compensationManager || null;

        this.rollbackCoordinator =
            options.rollbackCoordinator || null;

        this.transactionRepository =
            options.transactionRepository || null;

        /**
         * ---------------------------------------------------------------------
         * Runtime Identity
         * ---------------------------------------------------------------------
         */

        this.identity = Object.freeze({

            coordinatorId:
                options.coordinatorId ||
                `tx-coordinator-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,

            hostname:
                process.env.HOSTNAME ||
                'localhost',

            processId:
                process.pid,

            service:
                process.env.SERVICE_NAME ||
                'transaction-service',

            environment:
                process.env.NODE_ENV ||
                'development',

            startedAt:
                new Date()

        });

        /**
         * ---------------------------------------------------------------------
         * Runtime State
         * ---------------------------------------------------------------------
         */

        this.state = CoordinatorState.CREATED;

        this.executionRegistry = new Map();

        this.executionLocks = new Map();

        this.completedExecutions = new Map();

        this.runningTransactions = new Map();

        this.completedTransactions = 0;

        this.failedTransactions = 0;

        this.rollbackOperations = 0;

        this.lastFailure = null;

        this.initialized = false;

        this.started = false;

        this.shuttingDown = false;

        this.heartbeatTimer = null;

        this.retentionTimer = null;

        this.stateListeners = new Map();

        this.health = {

            status: 'UNKNOWN',

            ready: false,

            startedAt: null,

            lastHeartbeat: null,

            lastFailure: null

        };

        /**
         * ---------------------------------------------------------------------
         * Validate Dependencies
         * ---------------------------------------------------------------------
         */

        this.validateDependencies();

        this.logger.info?.(
            {
                coordinatorId:
                    this.identity.coordinatorId,

                state:
                    this.state
            },
            'TransactionEventCoordinator created'
        );
    }

    /**
     * =========================================================================
     * INITIALIZE
     * =========================================================================
     *
     * Performs dependency initialization without starting transaction
     * execution.
     */

    async initialize() {

        if (this.initialized) {

            return this.getHealth();

        }

        if (this.shuttingDown) {

            throw this.createRuntimeError(
                'Coordinator is shutting down',
                ErrorCodes.SHUTDOWN_IN_PROGRESS
            );

        }

        this.state =
            CoordinatorState.INITIALIZING;

        this.health.status = 'INITIALIZING';

        try {

            this.validateDependencies();

            await this.initializeDependency(
                this.transactionManager,
                'DistributedTransactionManager'
            );

            await this.initializeDependency(
                this.stateMachine,
                'TransactionStateMachine'
            );

            await this.initializeDependency(
                this.eventPublisher,
                'TransactionEventPublisher',
                false
            );

            await this.initializeDependency(
                this.auditPublisher,
                'AuditPublisher',
                false
            );

            await this.initializeDependency(
                this.metrics,
                'Metrics',
                false
            );

            await this.initializeDependency(
                this.tracer,
                'Tracer',
                false
            );

            this.initialized = true;

            this.state =
                CoordinatorState.READY;

            this.health.status = 'READY';

            this.health.ready = true;

            this.health.startedAt = new Date();

            this.health.lastHeartbeat = new Date();

            this.startMaintenanceTimers();

            await this.publishLifecycleEvent(
                LifecycleEvents.INITIALIZED,
                {
                    coordinatorId:
                        this.identity.coordinatorId,

                    state:
                        this.state
                }
            );

            this.safeMetricIncrement(
                'transaction.coordinator.initialized'
            );

            this.logger.info?.(
                {
                    coordinatorId:
                        this.identity.coordinatorId
                },
                'TransactionEventCoordinator initialized'
            );

            return this.getHealth();

        } catch (error) {

            this.state =
                CoordinatorState.FAILED;

            this.health.status =
                'FAILED';

            this.health.ready = false;

            this.health.lastFailure =
                this.serializeError(error);

            this.lastFailure =
                this.health.lastFailure;

            throw error;

        }

    }

    /**
     * =========================================================================
     * START
     * =========================================================================
     */

    async start() {

        if (this.started) {

            return this.getHealth();

        }

        if (!this.initialized) {

            await this.initialize();

        }

        if (this.shuttingDown) {

            throw this.createRuntimeError(
                'Coordinator is shutting down',
                ErrorCodes.SHUTDOWN_IN_PROGRESS
            );

        }

        this.started = true;

        this.state =
            CoordinatorState.READY;

        this.health.status =
            'READY';

        this.health.ready =
            true;

        this.health.lastHeartbeat =
            new Date();

        return this.getHealth();

    }

    /**
     * =========================================================================
     * STOP
     * =========================================================================
     */

    async stop(options = {}) {

        if (
            this.state === CoordinatorState.STOPPED
        ) {

            return this.getHealth();

        }

        this.shuttingDown = true;

        this.state =
            CoordinatorState.STOPPING;

        this.health.status =
            'STOPPING';

        this.health.ready =
            false;

        const timeoutMs =
            Number(
                options.timeoutMs ||
                this.config.shutdownTimeoutMs
            );

        const startedAt =
            Date.now();

        while (
            this.runningTransactions.size > 0 &&
            Date.now() - startedAt < timeoutMs
        ) {

            await this.sleep(50);

        }

        this.stopMaintenanceTimers();

        this.state =
            CoordinatorState.STOPPED;

        this.started = false;

        this.initialized = false;

        this.health.status =
            'STOPPED';

        this.health.ready =
            false;

        this.health.lastHeartbeat =
            new Date();

        await this.publishLifecycleEvent(
            LifecycleEvents.STOPPED,
            {
                coordinatorId:
                    this.identity.coordinatorId
            }
        );

        this.emit(
            LifecycleEvents.STOPPED,
            this.getHealth()
        );

        return this.getHealth();

    }

    /**
     * =========================================================================
     * DEPENDENCY INITIALIZATION
     * =========================================================================
     */

    async initializeDependency(
        dependency,
        name,
        required = true
    ) {

        if (!dependency) {

            if (required) {

                throw this.createRuntimeError(
                    `${name} unavailable`
                );

            }

            return;

        }

        if (
            typeof dependency.initialize === 'function'
        ) {

            await dependency.initialize();

        }

        if (
            typeof dependency.start === 'function'
        ) {

            await dependency.start();

        }

        if (
            typeof dependency.isReady === 'function'
        ) {

            const ready =
                await dependency.isReady();

            if (!ready && required) {

                throw this.createRuntimeError(
                    `${name} not ready`
                );

            }

        }

    }

    /**
     * =========================================================================
     * DEPENDENCY VALIDATION
     * =========================================================================
     */

    validateDependencies() {

        if (!this.config.validateDependencies) {

            return true;

        }

        if (
            !this.transactionManager &&
            RuntimeValidationDefaults.requireTransactionManager
        ) {

            throw new Error(
                'DistributedTransactionManager is required.'
            );

        }

        if (
            !this.stateMachine &&
            RuntimeValidationDefaults.requireStateMachine
        ) {

            throw new Error(
                'TransactionStateMachine is required.'
            );

        }

        if (
            this.config.publishLifecycleEvents &&
            !this.eventPublisher &&
            RuntimeValidationDefaults.requirePublisher &&
            !this.config.allowExecutionWithoutPublisher
        ) {

            throw new Error(
                'TransactionEventPublisher is required.'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * HEALTH SNAPSHOT
     * =========================================================================
     */

    getHealth() {

        return {

            status:
                this.health.status,

            ready:
                this.health.ready,

            state:
                this.state,

            initialized:
                this.initialized,

            started:
                this.started,

            shuttingDown:
                this.shuttingDown,

            runningTransactions:
                this.runningTransactions.size,

            activeExecutions:
                this.executionRegistry.size,

            completedExecutions:
                this.completedExecutions.size,

            completedTransactions:
                this.completedTransactions,

            failedTransactions:
                this.failedTransactions,

            rollbackOperations:
                this.rollbackOperations,

            lastFailure:
                this.lastFailure,

            identity:
                this.identity,

            heartbeat:
                this.health.lastHeartbeat

        };

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
     * STATE
     * =========================================================================
     */

    getState() {

        return this.state;

    }

    /**
     * =========================================================================
     * CREATE CONTEXT
     * =========================================================================
     */

    createContext(options = {}) {

        return new TransactionContext({

            ...options,

            coordinatorId:
                this.identity.coordinatorId

        });

    }

    /**
     * =========================================================================
     * MAIN EXECUTION ENTRYPOINT
     * =========================================================================
     *
     * Pipeline:
     *
     * 1. Configuration/readiness validation
     * 2. Request normalization
     * 3. Duplicate/idempotency protection
     * 4. Runtime validation
     * 5. Context creation
     * 6. State machine initialization
     * 7. Transaction coordination
     * 8. Commit/failure handling
     * 9. Audit/metrics/tracing
     * 10. Cleanup
     */

    async execute(request = {}) {

        const startedAt =
            process.hrtime.bigint();

        let normalizedRequest = null;

        let context = null;

        let executionRegistered = false;

        let completed = false;

        let traceScope = null;

        try {

            if (this.shuttingDown) {

                throw this.createRuntimeError(
                    'Coordinator is shutting down',
                    ErrorCodes.SHUTDOWN_IN_PROGRESS
                );

            }

            if (!this.initialized) {

                await this.initialize();

            }

            if (!this.started) {

                await this.start();

            }

            normalizedRequest =
                this.normalizeRequest(request);

            this.ensureCapacity();

            this.registerExecution(
                normalizedRequest
            );

            executionRegistered = true;

            this.validateExecutionLock(
                normalizedRequest.transactionId
            );

            await this.validateRuntime(
                normalizedRequest
            );

            context =
                this.createExecutionContext(
                    normalizedRequest
                );

            traceScope =
                await this.startTrace(
                    normalizedRequest
                );

            await this.writeAudit(
                'transaction.execution.started',
                normalizedRequest,
                context
            );

            await this.transitionLifecycle(
                normalizedRequest.transactionId,
                TransactionLifecycleState.VALIDATING,
                context
            );

            await this.publishLifecycleEvent(
                LifecycleEvents.STARTED,
                this.createLifecyclePayload(
                    normalizedRequest,
                    context
                )
            );

            const result =
                await this.coordinateTransaction(
                    context
                );

            completed = true;

            return {

                success: true,

                transactionId:
                    normalizedRequest.transactionId,

                correlationId:
                    normalizedRequest.correlationId,

                ...result,

                durationMs:
                    this.calculateDurationMs(
                        startedAt
                    )

            };

        } catch (error) {

            this.failedTransactions += 1;

            this.lastFailure =
                this.serializeError(error);

            if (normalizedRequest) {

                await this.handleExecutionFailure(
                    error,
                    normalizedRequest,
                    context
                );

            }

            throw error;

        } finally {

            await this.finishTrace(
                traceScope
            );

            if (normalizedRequest) {

                this.recordExecutionMetrics(
                    normalizedRequest,
                    startedAt,
                    completed
                );

                await this.writeAuditSafely(
                    completed
                        ? 'transaction.execution.completed'
                        : 'transaction.execution.failed',
                    normalizedRequest,
                    context,
                    completed
                );

                if (executionRegistered) {

                    this.releaseExecution(
                        normalizedRequest.transactionId,
                        {
                            completed
                        }
                    );

                }

                this.runningTransactions.delete(
                    normalizedRequest.transactionId
                );

            }

        }

    }

    /**
     * =========================================================================
     * TRANSACTION COORDINATION
     * =========================================================================
     */

    async coordinateTransaction(context) {

        this.validateContext(context);

        const transactionId =
            context.transactionId;

        const execution =
            this.runningTransactions.get(
                transactionId
            );

        const startedAt =
            process.hrtime.bigint();

        try {

            if (execution) {

                execution.state =
                    TransactionLifecycleState.EXECUTING;

            }

            await this.publishLifecycleEvent(
                LifecycleEvents.EXECUTING,
                {
                    transactionId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId,

                    state:
                        TransactionLifecycleState.EXECUTING
                }
            );

            await this.transitionLifecycle(
                transactionId,
                TransactionLifecycleState.EXECUTING,
                context
            );

            this.validateExecutionLock(
                transactionId
            );

            await this.validateConsistency(
                context
            );

            const result =
                await this.executeTransactionManager(
                    context
                );

            await this.transitionLifecycle(
                transactionId,
                TransactionLifecycleState.COMMITTING,
                context
            );

            await this.publishLifecycleEvent(
                LifecycleEvents.COMMITTING,
                {
                    transactionId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId
                }
            );

            await this.finalizeSuccessfulTransaction(
                context,
                result
            );

            const durationMs =
                this.calculateDurationMs(
                    startedAt
                );

            this.completedTransactions += 1;

            this.safeMetricIncrement(
                'transaction.completed'
            );

            this.safeMetricObserve(
                'transaction.duration_ms',
                durationMs
            );

            return {

                transactionId,

                correlationId:
                    context.correlationId,

                state:
                    TransactionLifecycleState.COMPLETED,

                result,

                durationMs

            };

        } catch (error) {

            await this.compensateFailedTransaction(
                context,
                error
            );

            throw error;

        }

    }

    /**
     * =========================================================================
     * TRANSACTION MANAGER DELEGATION
     * =========================================================================
     *
     * Supports common manager interfaces without coupling the coordinator to
     * one concrete implementation.
     */

    async executeTransactionManager(context) {

        const manager =
            this.transactionManager;

        if (!manager) {

            throw this.createRuntimeError(
                'DistributedTransactionManager unavailable'
            );

        }

        const payload = {

            transactionId:
                context.transactionId,

            correlationId:
                context.correlationId,

            tenantId:
                context.tenantId,

            operation:
                context.operation,

            operations:
                context.operations,

            metadata:
                context.metadata,

            context

        };

        if (
            typeof manager.execute === 'function'
        ) {

            return manager.execute(payload);

        }

        if (
            typeof manager.executeTransaction === 'function'
        ) {

            return manager.executeTransaction(payload);

        }

        if (
            typeof manager.process === 'function'
        ) {

            return manager.process(payload);

        }

        if (
            typeof manager.run === 'function'
        ) {

            return manager.run(payload);

        }

        throw this.createRuntimeError(
            'DistributedTransactionManager does not expose an execution method'
        );

    }

    /**
     * =========================================================================
     * CONSISTENCY VALIDATION
     * =========================================================================
     */

    async validateConsistency(context) {

        if (!this.consistencyValidator) {

            return true;

        }

        const validator =
            this.consistencyValidator;

        const payload = {

            transactionId:
                context.transactionId,

            correlationId:
                context.correlationId,

            tenantId:
                context.tenantId,

            context

        };

        let result = true;

        if (
            typeof validator.validate === 'function'
        ) {

            result =
                await validator.validate(
                    payload
                );

        } else if (
            typeof validator.validateTransaction === 'function'
        ) {

            result =
                await validator.validateTransaction(
                    payload
                );

        }

        if (
            result === false ||
            result?.valid === false
        ) {

            throw this.createRuntimeError(
                'Transaction consistency validation failed',
                ErrorCodes.RUNTIME_VALIDATION_FAILED
            );

        }

        return result;

    }

    /**
     * =========================================================================
     * FINALIZE SUCCESSFUL TRANSACTION
     * =========================================================================
     */

    async finalizeSuccessfulTransaction(
        context,
        result
    ) {

        const transactionId =
            context.transactionId;

        await this.transitionLifecycle(
            transactionId,
            TransactionLifecycleState.COMPLETED,
            context
        );

        await this.persistTransactionState({

            transactionId,

            state:
                TransactionLifecycleState.COMPLETED,

            context

        });

        await this.publishLifecycleEvent(
            LifecycleEvents.COMMITTED,
            {
                transactionId,

                correlationId:
                    context.correlationId,

                tenantId:
                    context.tenantId,

                state:
                    TransactionLifecycleState.COMPLETED,

                result
            }
        );

        this.emit(
            LifecycleEvents.COMMITTED,
            {
                transactionId,

                correlationId:
                    context.correlationId,

                result
            }
        );

    }

    /**
     * =========================================================================
     * FAILED TRANSACTION HANDLER
     * =========================================================================
     */

    async handleExecutionFailure(
        error,
        request,
        context
    ) {

        const transactionId =
            request.transactionId;

        try {

            if (context) {

                await this.transitionLifecycle(
                    transactionId,
                    TransactionLifecycleState.FAILED,
                    context
                );

            }

            await this.publishLifecycleEvent(
                LifecycleEvents.FAILED,
                {
                    transactionId,

                    correlationId:
                        request.correlationId,

                    tenantId:
                        request.tenantId,

                    error:
                        this.serializeError(error),

                    state:
                        TransactionLifecycleState.FAILED
                }
            );

            this.emit(
                LifecycleEvents.FAILED,
                {
                    transactionId,

                    error:
                        this.serializeError(error)
                }
            );

        } catch (secondaryError) {

            this.logger.error?.(
                {
                    transactionId,

                    primaryError:
                        this.serializeError(error),

                    secondaryError:
                        this.serializeError(
                            secondaryError
                        )
                },
                'Failed to finalize transaction error state'
            );

        }

    }

    /**
     * =========================================================================
     * COMPENSATION / ROLLBACK
     * =========================================================================
     */

    async compensateFailedTransaction(
        context,
        originalError
    ) {

        if (
            !context ||
            !this.config.compensationEnabled
        ) {

            return null;

        }

        const transactionId =
            context.transactionId;

        this.rollbackOperations += 1;

        try {

            await this.transitionLifecycle(
                transactionId,
                TransactionLifecycleState.COMPENSATING,
                context
            );

            await this.publishLifecycleEvent(
                LifecycleEvents.COMPENSATING,
                {
                    transactionId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId,

                    originalError:
                        this.serializeError(
                            originalError
                        )
                }
            );

            let result = null;

            if (
                this.compensationManager
            ) {

                if (
                    typeof this.compensationManager.compensate ===
                    'function'
                ) {

                    result =
                        await this.compensationManager.compensate(
                            {
                                context,
                                error: originalError
                            }
                        );

                } else if (
                    typeof this.compensationManager.execute ===
                    'function'
                ) {

                    result =
                        await this.compensationManager.execute(
                            {
                                context,
                                error: originalError
                            }
                        );

                }

            } else if (
                this.rollbackCoordinator
            ) {

                if (
                    typeof this.rollbackCoordinator.rollback ===
                    'function'
                ) {

                    result =
                        await this.rollbackCoordinator.rollback(
                            {
                                context,
                                error: originalError
                            }
                        );

                }

            } else if (
                this.transactionManager &&
                typeof this.transactionManager.rollback ===
                'function'
            ) {

                result =
                    await this.transactionManager.rollback(
                        {
                            transactionId,

                            correlationId:
                                context.correlationId,

                            tenantId:
                                context.tenantId,

                            context,

                            error:
                                originalError
                        }
                    );

            }

            await this.transitionLifecycle(
                transactionId,
                TransactionLifecycleState.ROLLING_BACK,
                context
            );

            await this.publishLifecycleEvent(
                LifecycleEvents.ROLLED_BACK,
                {
                    transactionId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId,

                    state:
                        TransactionLifecycleState.ROLLING_BACK,

                    result
                }
            );

            return result;

        } catch (compensationError) {

            const wrapped =
                this.createCompensationError(
                    compensationError,
                    originalError,
                    transactionId
                );

            this.logger.error?.(
                {
                    transactionId,

                    error:
                        this.serializeError(
                            wrapped
                        )
                },
                'Transaction compensation failed'
            );

            throw wrapped;

        }

    }

    /**
     * =========================================================================
     * STATE MACHINE TRANSITION
     * =========================================================================
     */

    async transitionLifecycle(
        transactionId,
        targetState,
        context
    ) {

        if (!this.stateMachine) {

            return;

        }

        try {

            if (
                typeof this.stateMachine.transition ===
                'function'
            ) {

                await this.stateMachine.transition(
                    targetState,
                    {
                        transactionId,
                        context
                    }
                );

            } else if (
                typeof this.stateMachine.transitionTo ===
                'function'
            ) {

                await this.stateMachine.transitionTo(
                    targetState,
                    {
                        transactionId,
                        context
                    }
                );

            } else if (
                typeof this.stateMachine.setState ===
                'function'
            ) {

                await this.stateMachine.setState(
                    targetState
                );

            }

            await this.persistTransactionState({

                transactionId,

                state:
                    targetState,

                context

            });

        } catch (error) {

            const wrapped =
                new Error(
                    `Transaction state transition failed: ${targetState}`
                );

            wrapped.code =
                ErrorCodes.STATE_TRANSITION_FAILED;

            wrapped.cause =
                error;

            wrapped.transactionId =
                transactionId;

            throw wrapped;

        }

    }

    /**
     * =========================================================================
     * NORMALIZE REQUEST
     * =========================================================================
     */

    normalizeRequest(request = {}) {

        const timeoutMs =
            Number(
                request.timeoutMs ||
                TransactionRequestDefaults.timeoutMs
            );

        const normalized = {

            transactionId:
                request.transactionId ||
                this.generateTransactionId(),

            correlationId:
                request.correlationId ||
                this.generateCorrelationId(),

            tenantId:
                request.tenantId,

            operation:
                request.operation,

            operations:
                Array.isArray(request.operations)
                    ? [...request.operations]
                    : [],

            priority:
                request.priority ||
                TransactionRequestDefaults.priority,

            source:
                request.source ||
                TransactionRequestDefaults.source,

            version:
                request.version ||
                TransactionRequestDefaults.version,

            retryable:
                request.retryable ??
                TransactionRequestDefaults.retryable,

            timeoutMs:
                timeoutMs > 0
                    ? timeoutMs
                    : TransactionRequestDefaults.timeoutMs,

            metadata: {

                ...TransactionRequestDefaults.metadata,

                ...(request.metadata || {})

            },

            tags:
                Array.isArray(request.tags)
                    ? [...request.tags]
                    : [],

            actor:
                request.actor || null,

            createdAt:
                new Date(),

            coordinatorId:
                this.identity.coordinatorId

        };

        this.validateNormalizedRequest(
            normalized
        );

        return this.freezeRequest(
            normalized
        );

    }

    /**
     * =========================================================================
     * GENERATE TRANSACTION ID
     * =========================================================================
     */

    generateTransactionId() {

        return `txn-${crypto.randomUUID()}`;

    }

    /**
     * =========================================================================
     * GENERATE CORRELATION ID
     * =========================================================================
     */

    generateCorrelationId() {

        return `corr-${crypto.randomUUID()}`;

    }

    /**
     * =========================================================================
     * VALIDATE NORMALIZED REQUEST
     * =========================================================================
     */

    validateNormalizedRequest(request) {

        const errors = [];

        if (!request.transactionId) {

            errors.push(
                'transactionId is required'
            );

        }

        if (!request.tenantId) {

            errors.push(
                'tenantId is required'
            );

        }

        if (
            !request.operation &&
            request.operations.length === 0
        ) {

            errors.push(
                'operation or operations required'
            );

        }

        if (!request.correlationId) {

            errors.push(
                'correlationId is required'
            );

        }

        if (
            request.timeoutMs <= 0
        ) {

            errors.push(
                'timeoutMs must be greater than zero'
            );

        }

        if (
            request.tags.length > 100
        ) {

            errors.push(
                'tags cannot contain more than 100 entries'
            );

        }

        if (errors.length > 0) {

            const error =
                new Error(
                    'Invalid transaction request'
                );

            error.code =
                ErrorCodes.INVALID_REQUEST;

            error.details =
                errors;

            throw error;

        }

        return true;

    }

    /**
     * =========================================================================
     * FREEZE REQUEST
     * =========================================================================
     */

    freezeRequest(request) {

        return deepFreeze(
            request
        );

    }

    /**
     * =========================================================================
     * DUPLICATE EXECUTION GUARD
     * =========================================================================
     */

    registerExecution(request) {

        const {
            transactionId,
            correlationId
        } = request;

        const idempotencyKey =
            this.createIdempotencyKey(
                request
            );

        if (
            this.executionRegistry.has(
                transactionId
            )
        ) {

            throw this.createDuplicateError(
                transactionId,
                'Transaction already running'
            );

        }

        const existingLock =
            this.executionLocks.get(
                idempotencyKey
            );

        if (
            existingLock &&
            existingLock.expiresAt > new Date()
        ) {

            throw this.createDuplicateError(
                transactionId,
                'Transaction execution lock already exists'
            );

        }

        if (
            this.config.enforceIdempotency &&
            !ExecutionGuardDefaults.allowReplay &&
            this.completedExecutions.has(
                idempotencyKey
            )
        ) {

            throw this.createDuplicateError(
                transactionId,
                'Duplicate idempotency request'
            );

        }

        const lockTimeout =
            this.config.lockTimeoutMs ||
            ExecutionGuardDefaults.lockTimeoutMs;

        const lock = {

            transactionId,

            correlationId,

            idempotencyKey,

            acquiredAt:
                new Date(),

            expiresAt:
                new Date(
                    Date.now() +
                    lockTimeout
                )

        };

        this.executionLocks.set(
            idempotencyKey,
            lock
        );

        this.executionRegistry.set(
            transactionId,
            {

                ...request,

                lock,

                status:
                    'RUNNING'

            }
        );

        return lock;

    }

    /**
     * =========================================================================
     * IDEMPOTENCY KEY
     * =========================================================================
     */

    createIdempotencyKey(request) {

        return [

            request.tenantId,

            request.operation,

            request.transactionId,

            request.correlationId

        ]

            .filter(Boolean)

            .join(':');

    }

    /**
     * =========================================================================
     * EXECUTION ACTIVE
     * =========================================================================
     */

    isExecutionActive(transactionId) {

        return this.executionRegistry.has(
            transactionId
        );

    }

    /**
     * =========================================================================
     * RELEASE EXECUTION
     * =========================================================================
     */

    releaseExecution(
        transactionId,
        options = {}
    ) {

        const execution =
            this.executionRegistry.get(
                transactionId
            );

        if (!execution) {

            return false;

        }

        const completed =
            options.completed === true;

        if (completed) {

            this.completedExecutions.set(
                execution.lock.idempotencyKey,
                {

                    transactionId,

                    completedAt:
                        new Date()

                }
            );

        }

        this.executionLocks.delete(
            execution.lock.idempotencyKey
        );

        this.executionRegistry.delete(
            transactionId
        );

        return true;

    }

    /**
     * =========================================================================
     * VALIDATE EXECUTION LOCK
     * =========================================================================
     */

    validateExecutionLock(
        transactionId
    ) {

        const execution =
            this.executionRegistry.get(
                transactionId
            );

        if (!execution) {

            const error =
                new Error(
                    'Transaction execution lock missing'
                );

            error.code =
                ErrorCodes.EXECUTION_LOCK_EXPIRED;

            throw error;

        }

        if (
            execution.lock.expiresAt < new Date()
        ) {

            this.releaseExecution(
                transactionId
            );

            const error =
                new Error(
                    'Transaction execution lock expired'
                );

            error.code =
                ErrorCodes.EXECUTION_LOCK_EXPIRED;

            error.transactionId =
                transactionId;

            throw error;

        }

        return true;

    }

    /**
     * =========================================================================
     * DUPLICATE ERROR
     * =========================================================================
     */

    createDuplicateError(
        transactionId,
        message
    ) {

        const error =
            new Error(message);

        error.code =
            ErrorCodes.DUPLICATE_EXECUTION;

        error.transactionId =
            transactionId;

        error.timestamp =
            new Date();

        return error;

    }

    /**
     * =========================================================================
     * RUNTIME VALIDATION
     * =========================================================================
     */

    async validateRuntime(request) {

        this.validateCoordinatorRuntime();

        await this.validateDependenciesRuntime();

        this.validateTransactionState(
            request
        );

        this.validateExecutionEnvironment();

        return true;

    }

    /**
     * =========================================================================
     * COORDINATOR RUNTIME VALIDATION
     * =========================================================================
     */

    validateCoordinatorRuntime() {

        if (!this.config.enabled) {

            throw this.createRuntimeError(
                'Coordinator disabled by configuration',
                ErrorCodes.COORDINATOR_NOT_READY
            );

        }

        if (!this.initialized) {

            throw this.createRuntimeError(
                'Coordinator has not been initialized',
                ErrorCodes.COORDINATOR_NOT_READY
            );

        }

        const allowedStates = [

            CoordinatorState.READY,

            CoordinatorState.RUNNING

        ];

        if (
            !allowedStates.includes(
                this.state
            )
        ) {

            throw this.createRuntimeError(
                `Invalid coordinator state: ${this.state}`,
                ErrorCodes.COORDINATOR_NOT_READY
            );

        }

        if (
            this.health.ready !== true
        ) {

            throw this.createRuntimeError(
                'Coordinator is not ready',
                ErrorCodes.COORDINATOR_NOT_READY
            );

        }

    }

    /**
     * =========================================================================
     * RUNTIME DEPENDENCY VALIDATION
     * =========================================================================
     */

    async validateDependenciesRuntime() {

        const checks = [

            {

                name:
                    'DistributedTransactionManager',

                dependency:
                    this.transactionManager

            },

            {

                name:
                    'TransactionStateMachine',

                dependency:
                    this.stateMachine

            }

        ];

        if (
            RuntimeValidationDefaults.requirePublisher &&
            !this.config.allowExecutionWithoutPublisher
        ) {

            checks.push({

                name:
                    'TransactionEventPublisher',

                dependency:
                    this.eventPublisher

            });

        }

        for (
            const check of checks
        ) {

            if (
                !check.dependency
            ) {

                throw this.createRuntimeError(
                    `${check.name} unavailable`
                );

            }

            if (
                typeof check.dependency.isReady ===
                'function'
            ) {

                const ready =
                    await check.dependency.isReady();

                if (!ready) {

                    throw this.createRuntimeError(
                        `${check.name} not ready`
                    );

                }

            }

        }

        return true;

    }

    /**
     * =========================================================================
     * TRANSACTION STATE VALIDATION
     * =========================================================================
     */

    validateTransactionState(request) {

        if (!request.transactionId) {

            throw this.createRuntimeError(
                'Missing transaction identity'
            );

        }

        if (!request.tenantId) {

            throw this.createRuntimeError(
                'Missing tenant context'
            );

        }

        if (
            this.runningTransactions.has(
                request.transactionId
            )
        ) {

            throw this.createRuntimeError(
                'Transaction already executing'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * EXECUTION ENVIRONMENT
     * =========================================================================
     */

    validateExecutionEnvironment() {

        if (!process.pid) {

            throw this.createRuntimeError(
                'Invalid runtime process'
            );

        }

        if (
            process.env.NODE_ENV === 'production' &&
            !process.env.SERVICE_NAME
        ) {

            throw this.createRuntimeError(
                'SERVICE_NAME missing in production'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * CONTEXT VALIDATION
     * =========================================================================
     */

    validateContext(context) {

        if (!context) {

            throw this.createRuntimeError(
                'Transaction context missing'
            );

        }

        if (!context.transactionId) {

            throw this.createRuntimeError(
                'Context transaction ID missing'
            );

        }

        if (!context.correlationId) {

            throw this.createRuntimeError(
                'Context correlation ID missing'
            );

        }

        if (!context.tenantId) {

            throw this.createRuntimeError(
                'Context tenant ID missing'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * RUNTIME ERROR
     * =========================================================================
     */

    createRuntimeError(
        message,
        code =
            ErrorCodes.RUNTIME_VALIDATION_FAILED
    ) {

        const error =
            new Error(message);

        error.code =
            code;

        error.timestamp =
            new Date();

        error.coordinatorId =
            this.identity.coordinatorId;

        return error;

    }

    /**
     * =========================================================================
     * EXECUTION CONTEXT
     * =========================================================================
     */

    createExecutionContext(request) {

        const timestamp =
            new Date();

        const auditContext =
            this.createAuditContext(
                request
            );

        const traceContext =
            this.createTraceContext(
                request
            );

        const metricsContext =
            this.createMetricsContext(
                request
            );

        const compensationContext =
            this.createCompensationContext(
                request
            );

        const context =
            new TransactionContext({

                transactionId:
                    request.transactionId,

                correlationId:
                    request.correlationId,

                tenantId:
                    request.tenantId,

                operation:
                    request.operation,

                operations:
                    request.operations,

                metadata:
                    request.metadata,

                source:
                    request.source ||
                    TransactionContextDefaults.source,

                createdAt:
                    timestamp,

                coordinatorId:
                    this.identity.coordinatorId,

                auditContext,

                traceContext,

                metricsContext,

                compensationContext

            });

        this.validateContext(
            context
        );

        this.runningTransactions.set(
            request.transactionId,
            {

                context,

                startedAt:
                    new Date(),

                state:
                    TransactionLifecycleState.INITIALIZED

            }
        );

        return context;

    }

    /**
     * =========================================================================
     * CORRELATION CONTEXT
     * =========================================================================
     */

    createCorrelationContext(request) {

        return Object.freeze({

            correlationId:
                request.correlationId,

            transactionId:
                request.transactionId,

            tenantId:
                request.tenantId,

            createdAt:
                new Date()

        });

    }

    /**
     * =========================================================================
     * TENANT CONTEXT
     * =========================================================================
     */

    createTenantContext(request) {

        return Object.freeze({

            tenantId:
                request.tenantId,

            isolation:
                'strict',

            validated:
                true

        });

    }

    /**
     * =========================================================================
     * AUDIT CONTEXT
     * =========================================================================
     */

    createAuditContext(request) {

        return Object.freeze({

            enabled:
                this.config.auditEnabled,

            transactionId:
                request.transactionId,

            correlationId:
                request.correlationId,

            tenantId:
                request.tenantId,

            actor:
                request.actor || null,

            source:
                request.source,

            createdAt:
                new Date()

        });

    }

    /**
     * =========================================================================
     * TRACE CONTEXT
     * =========================================================================
     */

    createTraceContext(request) {

        return Object.freeze({

            enabled:
                this.config.tracingEnabled,

            correlationId:
                request.correlationId,

            transactionId:
                request.transactionId,

            span:
                null

        });

    }

    /**
     * =========================================================================
     * METRICS CONTEXT
     * =========================================================================
     */

    createMetricsContext(request) {

        return {

            enabled:
                this.config.metricsEnabled,

            operation:
                request.operation,

            startedAt:
                Date.now(),

            counters: {

                events: 0,

                retries: 0,

                failures: 0

            }

        };

    }

    /**
     * =========================================================================
     * COMPENSATION CONTEXT
     * =========================================================================
     */

    createCompensationContext(request) {

        return {

            enabled:
                this.config.compensationEnabled,

            transactionId:
                request.transactionId,

            registeredActions: [],

            completedActions: []

        };

    }

    /**
     * =========================================================================
     * STATE MACHINE INITIALIZATION
     * =========================================================================
     */

    async initializeStateMachine(context) {

        if (!context) {

            throw this.createRuntimeError(
                'Cannot initialize state machine without context'
            );

        }

        const transactionId =
            context.transactionId;

        if (
            typeof this.stateMachine.attachContext ===
            'function'
        ) {

            await this.stateMachine.attachContext(
                context
            );

        }

        const initialState =
            TransactionLifecycleState.INITIALIZED;

        if (
            typeof this.stateMachine.initialize ===
            'function'
        ) {

            await this.stateMachine.initialize({

                transactionId,

                state:
                    initialState,

                context

            });

        } else if (
            typeof this.stateMachine.setState ===
            'function'
        ) {

            await this.stateMachine.setState(
                initialState
            );

        }

        this.registerStateListeners(
            transactionId
        );

        await this.persistTransactionState({

            transactionId,

            state:
                initialState,

            context

        });

        await this.publishLifecycleEvent(

            LifecycleEvents.INITIALIZED_TRANSACTION,

            {

                transactionId,

                correlationId:
                    context.correlationId,

                tenantId:
                    context.tenantId,

                state:
                    initialState

            }

        );

        return {

            transactionId,

            state:
                initialState

        };

    }

    /**
     * =========================================================================
     * STATE LISTENERS
     * =========================================================================
     */

    registerStateListeners(
        transactionId
    ) {

        if (
            !this.stateMachine ||
            typeof this.stateMachine.on !==
            'function'
        ) {

            return;

        }

        if (
            this.stateListeners.has(
                transactionId
            )
        ) {

            return;

        }

        const listener =
            async transition => {

                try {

                    await this.handleStateTransition({

                        transactionId,

                        transition

                    });

                } catch (error) {

                    this.logger.error?.(
                        {
                            transactionId,

                            error:
                                this.serializeError(
                                    error
                                )
                        },
                        'Transaction state transition handler failed'
                    );

                }

            };

        this.stateListeners.set(
            transactionId,
            listener
        );

        this.stateMachine.on(
            'transition',
            listener
        );

    }

    /**
     * =========================================================================
     * HANDLE STATE TRANSITION
     * =========================================================================
     */

    async handleStateTransition({

        transactionId,

        transition

    }) {

        const execution =
            this.runningTransactions.get(
                transactionId
            );

        if (!execution) {

            return;

        }

        execution.state =
            transition.to;

        this.runningTransactions.set(
            transactionId,
            execution
        );

        this.safeMetricIncrement(
            'transaction.state.transition'
        );

        await this.publishLifecycleEvent(

            LifecycleEvents.STATE_CHANGED,

            {

                transactionId,

                from:
                    transition.from,

                to:
                    transition.to,

                timestamp:
                    new Date()

            }

        );

        this.emit(
            LifecycleEvents.STATE_CHANGED,
            {
                transactionId,
                transition
            }
        );

    }

    /**
     * =========================================================================
     * PERSIST TRANSACTION STATE
     * =========================================================================
     */

    async persistTransactionState({

        transactionId,

        state,

        context

    }) {

        if (
            !this.transactionRepository
        ) {

            return null;

        }

        const payload = {

            transactionId,

            state,

            correlationId:
                context?.correlationId,

            tenantId:
                context?.tenantId,

            updatedAt:
                new Date()

        };

        if (
            typeof this.transactionRepository.saveState ===
            'function'
        ) {

            return this.transactionRepository.saveState(
                payload
            );

        }

        if (
            typeof this.transactionRepository.updateState ===
            'function'
        ) {

            return this.transactionRepository.updateState(
                payload
            );

        }

        return null;

    }

    /**
     * =========================================================================
     * PUBLISH LIFECYCLE EVENT
     * =========================================================================
     */

    async publishLifecycleEvent(
        type,
        payload
    ) {

        if (
            !this.config.publishLifecycleEvents
        ) {

            return null;

        }

        if (
            !this.eventPublisher
        ) {

            if (
                this.config.allowExecutionWithoutPublisher
            ) {

                return null;

            }

            throw this.createRuntimeError(
                'TransactionEventPublisher unavailable'
            );

        }

        const event = {

            eventId:
                crypto.randomUUID(),

            eventType:
                type,

            aggregateType:
                'TRANSACTION',

            aggregateId:
                payload?.transactionId ||
                this.identity.coordinatorId,

            transactionId:
                payload?.transactionId || null,

            correlationId:
                payload?.correlationId || null,

            tenantId:
                payload?.tenantId || null,

            payload,

            timestamp:
                new Date(),

            source:
                this.identity.coordinatorId,

            version:
                1

        };

        if (
            typeof this.eventPublisher.publish ===
            'function'
        ) {

            await this.eventPublisher.publish(
                event
            );

        } else if (
            typeof this.eventPublisher.publishEvent ===
            'function'
        ) {

            await this.eventPublisher.publishEvent(
                event
            );

        } else {

            throw this.createRuntimeError(
                'TransactionEventPublisher does not expose publish()'
            );

        }

        this.safeMetricIncrement(
            'transaction.lifecycle.event.published'
        );

        return event;

    }

    /**
     * =========================================================================
     * AUDIT
     * =========================================================================
     */

    async writeAudit(
        eventType,
        request,
        context,
        success = true
    ) {

        if (
            !this.config.auditEnabled ||
            !this.auditPublisher
        ) {

            return null;

        }

        const payload = {

            auditId:
                crypto.randomUUID(),

            eventType,

            success,

            transactionId:
                request?.transactionId ||
                context?.transactionId,

            correlationId:
                request?.correlationId ||
                context?.correlationId,

            tenantId:
                request?.tenantId ||
                context?.tenantId,

            actor:
                request?.actor || null,

            operation:
                request?.operation || null,

            source:
                this.identity.coordinatorId,

            timestamp:
                new Date()

        };

        if (
            typeof this.auditPublisher.publish ===
            'function'
        ) {

            return this.auditPublisher.publish(
                payload
            );

        }

        if (
            typeof this.auditPublisher.record ===
            'function'
        ) {

            return this.auditPublisher.record(
                payload
            );

        }

        return null;

    }

    /**
     * =========================================================================
     * SAFE AUDIT
     * =========================================================================
     */

    async writeAuditSafely(
        eventType,
        request,
        context,
        success
    ) {

        try {

            await this.writeAudit(
                eventType,
                request,
                context,
                success
            );

        } catch (error) {

            this.logger.error?.(
                {
                    eventType,

                    transactionId:
                        request?.transactionId,

                    error:
                        this.serializeError(
                            error
                        )
                },
                'Transaction audit publication failed'
            );

            this.safeMetricIncrement(
                'transaction.audit.failure'
            );

        }

    }

    /**
     * =========================================================================
     * LIFECYCLE PAYLOAD
     * =========================================================================
     */

    createLifecyclePayload(
        request,
        context
    ) {

        return {

            transactionId:
                request.transactionId,

            correlationId:
                request.correlationId,

            tenantId:
                request.tenantId,

            operation:
                request.operation,

            source:
                request.source,

            coordinatorId:
                this.identity.coordinatorId,

            timestamp:
                new Date()

        };

    }

    /**
     * =========================================================================
     * TRACING
     * =========================================================================
     */

    async startTrace(request) {

        if (
            !this.config.tracingEnabled ||
            !this.tracer
        ) {

            return null;

        }

        try {

            if (
                typeof this.tracer.startSpan ===
                'function'
            ) {

                const span =
                    this.tracer.startSpan(
                        'transaction.execute',
                        {

                            attributes: {

                                'transaction.id':
                                    request.transactionId,

                                'transaction.correlation_id':
                                    request.correlationId,

                                'tenant.id':
                                    request.tenantId,

                                'transaction.operation':
                                    request.operation ||
                                    'batch'

                            }

                        }
                    );

                return span;

            }

            if (
                typeof this.tracer.startActiveSpan ===
                'function'
            ) {

                return this.tracer.startActiveSpan(
                    'transaction.execute'
                );

            }

        } catch (error) {

            this.logger.warn?.(
                {
                    error:
                        this.serializeError(
                            error
                        )
                },
                'Transaction tracing initialization failed'
            );

        }

        return null;

    }

    /**
     * =========================================================================
     * FINISH TRACE
     * =========================================================================
     */

    async finishTrace(
        span
    ) {

        if (!span) {

            return;

        }

        try {

            if (
                typeof span.end ===
                'function'
            ) {

                span.end();

            }

        } catch (error) {

            this.logger.warn?.(
                {
                    error:
                        this.serializeError(
                            error
                        )
                },
                'Transaction trace finalization failed'
            );

        }

    }

    /**
     * =========================================================================
     * METRICS
     * =========================================================================
     */

    recordExecutionMetrics(
        request,
        startedAt,
        completed
    ) {

        const durationMs =
            this.calculateDurationMs(
                startedAt
            );

        this.safeMetricObserve(
            'transaction.duration_ms',
            durationMs
        );

        this.safeMetricIncrement(
            completed
                ? 'transaction.execution.success'
                : 'transaction.execution.failure'
        );

    }

    safeMetricIncrement(
        metric,
        value = 1,
        labels = {}
    ) {

        if (
            !this.config.metricsEnabled ||
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
                    metric,
                    value,
                    labels
                );

            } else if (
                typeof this.metrics.inc ===
                'function'
            ) {

                this.metrics.inc(
                    metric,
                    value,
                    labels
                );

            }

        } catch (error) {

            this.logger.warn?.(
                {
                    metric,

                    error:
                        this.serializeError(
                            error
                        )
                },
                'Transaction metric increment failed'
            );

        }

    }

    safeMetricObserve(
        metric,
        value,
        labels = {}
    ) {

        if (
            !this.config.metricsEnabled ||
            !this.metrics
        ) {

            return;

        }

        try {

            if (
                typeof this.metrics.observe ===
                'function'
            ) {

                this.metrics.observe(
                    metric,
                    value,
                    labels
                );

            } else if (
                typeof this.metrics.record ===
                'function'
            ) {

                this.metrics.record(
                    metric,
                    value,
                    labels
                );

            }

        } catch (error) {

            this.logger.warn?.(
                {
                    metric,

                    error:
                        this.serializeError(
                            error
                        )
                },
                'Transaction metric observation failed'
            );

        }

    }

    /**
     * =========================================================================
     * CAPACITY CONTROL
     * =========================================================================
     */

    ensureCapacity() {

        if (
            this.runningTransactions.size >=
            this.config.maxConcurrentTransactions
        ) {

            const error =
                new Error(
                    'Transaction coordinator concurrency limit reached'
                );

            error.code =
                'TRANSACTION_COORDINATOR_CAPACITY_EXCEEDED';

            error.capacity =
                this.config.maxConcurrentTransactions;

            throw error;

        }

    }

    /**
     * =========================================================================
     * MAINTENANCE TIMERS
     * =========================================================================
     */

    startMaintenanceTimers() {

        this.stopMaintenanceTimers();

        this.heartbeatTimer =
            setInterval(
                () => {

                    this.health.lastHeartbeat =
                        new Date();

                },
                this.config.heartbeatIntervalMs
            );

        this.retentionTimer =
            setInterval(
                () => {

                    this.cleanupCompletedExecutions();

                },
                Math.max(
                    60000,
                    Math.floor(
                        this.config.completedExecutionRetentionMs /
                        4
                    )
                )
            );

        this.heartbeatTimer.unref?.();

        this.retentionTimer.unref?.();

    }

    /**
     * =========================================================================
     * STOP MAINTENANCE
     * =========================================================================
     */

    stopMaintenanceTimers() {

        if (this.heartbeatTimer) {

            clearInterval(
                this.heartbeatTimer
            );

            this.heartbeatTimer =
                null;

        }

        if (this.retentionTimer) {

            clearInterval(
                this.retentionTimer
            );

            this.retentionTimer =
                null;

        }

    }

    /**
     * =========================================================================
     * CLEANUP COMPLETED EXECUTIONS
     * =========================================================================
     */

    cleanupCompletedExecutions() {

        const cutoff =
            Date.now() -
            this.config.completedExecutionRetentionMs;

        for (
            const [
                key,
                execution
            ] of this.completedExecutions.entries()
        ) {

            if (
                execution.completedAt &&
                execution.completedAt.getTime() <
                cutoff
            ) {

                this.completedExecutions.delete(
                    key
                );

            }

        }

        for (
            const [
                transactionId,
                execution
            ] of this.executionRegistry.entries()
        ) {

            if (
                execution.lock?.expiresAt &&
                execution.lock.expiresAt.getTime() <
                Date.now()
            ) {

                this.logger.warn?.(
                    {
                        transactionId
                    },
                    'Removing expired transaction execution lock'
                );

                this.executionRegistry.delete(
                    transactionId
                );

                if (
                    execution.lock.idempotencyKey
                ) {

                    this.executionLocks.delete(
                        execution.lock.idempotencyKey
                    );

                }

            }

        }

    }

    /**
     * =========================================================================
     * SERIALIZE ERROR
     * =========================================================================
     */

    serializeError(error) {

        if (!error) {

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
                error.stack,

            transactionId:
                error.transactionId,

            timestamp:
                error.timestamp ||
                new Date()

        };

    }

    /**
     * =========================================================================
     * COMPENSATION ERROR
     * =========================================================================
     */

    createCompensationError(
        compensationError,
        originalError,
        transactionId
    ) {

        const error =
            new Error(
                'Transaction compensation failed'
            );

        error.code =
            ErrorCodes.COMPENSATION_FAILED;

        error.transactionId =
            transactionId;

        error.cause =
            compensationError;

        error.originalError =
            this.serializeError(
                originalError
            );

        error.compensationError =
            this.serializeError(
                compensationError
            );

        return error;

    }

    /**
     * =========================================================================
     * DURATION
     * =========================================================================
     */

    calculateDurationMs(
        startedAt
    ) {

        if (
            typeof startedAt ===
            'bigint'
        ) {

            return Number(
                process.hrtime.bigint() -
                startedAt
            ) / 1000000;

        }

        return 0;

    }

    /**
     * =========================================================================
     * SLEEP
     * =========================================================================
     */

    sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports = {

    TransactionEventCoordinator,

    CoordinatorState,

    LifecycleEvents,

    TransactionLifecycleState,

    ErrorCodes

};