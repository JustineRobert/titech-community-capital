'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Timeout Manager
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/TransactionTimeoutManager.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 * ✓ Transaction deadline management
 * ✓ Operation deadline management
 * ✓ Timeout registration
 * ✓ Timeout detection
 * ✓ AbortSignal propagation
 * ✓ Operation cancellation
 * ✓ Automatic timeout escalation
 * ✓ Recovery integration
 * ✓ Audit integration
 * ✓ Event publishing
 * ✓ Metrics
 * ✓ Distributed tracing
 * ✓ Structured logging
 * ✓ Heartbeat / deadline extension
 * ✓ Timeout idempotency
 * ✓ Tenant awareness
 * ✓ Correlation awareness
 * ✓ Graceful shutdown
 *
 * Architectural rule
 * ----------------------------------------------------------------------------
 *
 * This manager controls execution deadlines.
 *
 * It does NOT decide the financial state transition itself.
 *
 * The TransactionStateMachine remains responsible for:
 *
 *   RUNNING
 *      ↓
 *   TIMED_OUT
 *      ↓
 *   RECOVERING
 *
 * The timeout manager signals the timeout and coordinates cancellation /
 * recovery.
 *
 * ============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_TIMEOUTS = Object.freeze({

    transaction:
        120000,

    operation:
        30000,

    monitorInterval:
        5000,

    maxTransactionTimeout:
        900000,

    maxOperationTimeout:
        120000,

    shutdownGracePeriod:
        10000

});


/**
 * ============================================================================
 * Timeout Statuses
 * ============================================================================
 */

const TimeoutStatuses = Object.freeze({

    ACTIVE:
        'ACTIVE',

    EXPIRING:
        'EXPIRING',

    EXPIRED:
        'EXPIRED',

    COMPLETED:
        'COMPLETED',

    CANCELLED:
        'CANCELLED',

    RECOVERING:
        'RECOVERING',

    RECOVERED:
        'RECOVERED',

    RECOVERY_FAILED:
        'RECOVERY_FAILED'

});


/**
 * ============================================================================
 * Timeout Error
 * ============================================================================
 */

class TransactionTimeoutError extends Error {

    constructor(
        message = 'Transaction operation timed out.',
        options = {}
    ) {

        super(message);

        this.name =
            'TransactionTimeoutError';

        this.code =
            options.code ||
            'TRANSACTION_TIMEOUT';

        this.transactionId =
            options.transactionId ||
            null;

        this.operation =
            options.operation ||
            null;

        this.tenantId =
            options.tenantId ||
            null;

        this.retryable =
            options.retryable ??
            true;

        this.timeoutMs =
            options.timeoutMs ??
            null;

        this.deadline =
            options.deadline ??
            null;

    }

}


/**
 * ============================================================================
 * Transaction Timeout Manager
 * ============================================================================
 */

class TransactionTimeoutManager extends EventEmitter {

    constructor(options = {}) {

        super();


        this.logger =
            options.logger ||
            console;


        this.metrics =
            options.metrics ||
            null;


        this.tracer =
            options.tracer ||
            null;


        this.auditPublisher =
            options.auditPublisher ||
            null;


        this.eventBus =
            options.eventBus ||
            null;


        this.recoveryManager =
            options.recoveryManager ||
            null;


        this.stateMachine =
            options.stateMachine ||
            null;


        this.config = {

            ...DEFAULT_TIMEOUTS,

            ...options

        };


        this.timeouts =
            new Map();


        this.operations =
            new Map();


        this.controllers =
            new Map();


        this.operationTimers =
            new Map();


        this.running =
            false;


        this.shuttingDown =
            false;


        this.timer =
            null;


        this.clock =
            options.clock ||
            (() => Date.now());


        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();


        this.defaultTenantId =
            options.tenantId ||
            null;


        this.defaultCorrelationId =
            options.correlationId ||
            null;


        this.defaultRequestId =
            options.requestId ||
            null;


        this.validateConfiguration();

    }


    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        const numericFields = [

            'transaction',

            'operation',

            'monitorInterval',

            'maxTransactionTimeout',

            'maxOperationTimeout',

            'shutdownGracePeriod'

        ];


        for (
            const field
            of numericFields
        ) {

            const value =
                this.config[field];


            if (
                !Number.isFinite(value) ||
                value < 0
            ) {

                throw new TypeError(

                    `Invalid timeout configuration: ${field}`

                );

            }

        }

    }


    /**
     * =========================================================================
     * Register Transaction Timeout
     * =========================================================================
     */

    register(
        transactionId,
        options = {}
    ) {

        this.validateTransactionId(
            transactionId
        );


        if (
            this.shuttingDown
        ) {

            throw this.createManagerError(

                'TIMEOUT_MANAGER_SHUTTING_DOWN',

                'Cannot register timeout while timeout manager is shutting down.'

            );

        }


        const existing =
            this.timeouts.get(
                transactionId
            );


        /**
         * Registration is idempotent by default.
         *
         * Callers may explicitly replace an existing timeout using replace=true.
         */

        if (
            existing &&
            existing.status ===
                TimeoutStatuses.ACTIVE &&
            options.replace !== true
        ) {

            return this.cloneRecord(
                existing
            );

        }


        if (
            existing
        ) {

            this.cancel(
                transactionId,
                {

                    reason:
                        'Timeout registration replaced',

                    silent:
                        true

                }

            );

        }


        const timeoutMs =
            this.resolveTimeout(

                options.timeout,

                this.config.transaction,

                this.config.maxTransactionTimeout

            );


        const now =
            this.now();


        const expiresAt =
            now + timeoutMs;


        const controller =
            this.createAbortController(
                transactionId
            );


        const record = {

            id:
                crypto.randomUUID(),

            transactionId,

            tenantId:
                options.tenantId ??
                this.defaultTenantId,

            correlationId:
                options.correlationId ??
                this.defaultCorrelationId,

            requestId:
                options.requestId ??
                this.defaultRequestId,

            operation:
                options.operation ||
                null,

            timeout:
                timeoutMs,

            createdAt:
                new Date(
                    now
                ).toISOString(),

            expiresAt:
                new Date(
                    expiresAt
                ).toISOString(),

            status:
                TimeoutStatuses.ACTIVE,

            metadata:
                this.sanitizeMetadata(
                    options.metadata ||
                    {}
                ),

            heartbeatAt:
                new Date(
                    now
                ).toISOString(),

            heartbeatCount:
                0,

            extensionCount:
                0,

            timeoutCount:
                0,

            controllerId:
                crypto.randomUUID(),

            signal:
                controller.signal

        };


        this.timeouts.set(

            transactionId,

            record

        );


        this.emit(

            'registered',

            this.cloneRecord(
                record
            )

        );


        this.safeMetric(

            'transaction_timeout_registered_total'

        );


        this.safeLog(

            'debug',

            '[TimeoutManager] Timeout registered',

            {

                transactionId,

                tenantId:
                    record.tenantId,

                timeout:
                    timeoutMs,

                expiresAt:
                    record.expiresAt

            }

        );


        return this.cloneRecord(
            record
        );

    }


    /**
     * =========================================================================
     * Register Operation Timeout
     * =========================================================================
     */

    registerOperation(
        transactionId,
        operation,
        timeout,
        options = {}
    ) {

        this.validateTransactionId(
            transactionId
        );


        if (
            !operation
        ) {

            throw new TypeError(

                'Operation name is required.'

            );

        }


        const operationKey =
            this.createOperationKey(

                transactionId,

                operation

            );


        const timeoutMs =
            this.resolveTimeout(

                timeout,

                this.config.operation,

                this.config.maxOperationTimeout

            );


        const now =
            this.now();


        const controller =
            new AbortController();


        const record = {

            id:
                crypto.randomUUID(),

            operationKey,

            transactionId,

            operation,

            tenantId:
                options.tenantId ??
                this.defaultTenantId,

            correlationId:
                options.correlationId ??
                this.defaultCorrelationId,

            requestId:
                options.requestId ??
                this.defaultRequestId,

            timeout:
                timeoutMs,

            createdAt:
                new Date(
                    now
                ).toISOString(),

            expiresAt:
                new Date(
                    now + timeoutMs
                ).toISOString(),

            status:
                TimeoutStatuses.ACTIVE,

            metadata:
                this.sanitizeMetadata(
                    options.metadata ||
                    {}
                ),

            controller

        };


        const existing =
            this.operations.get(
                operationKey
            );


        if (
            existing
        ) {

            this.clearOperationTimer(
                operationKey
            );

            try {

                existing.controller.abort(
                    'Operation timeout registration replaced'
                );

            }
            catch (_) {}

        }


        this.operations.set(
            operationKey,
            record
        );


        const timer =
            setTimeout(

                () => {

                    this.handleOperationTimeout(
                        operationKey
                    )
                    .catch(
                        error => {

                            this.safeLog(

                                'error',

                                '[TimeoutManager] Operation timeout handler failed',

                                {

                                    transactionId,

                                    operation,

                                    error:
                                        this.normalizeError(
                                            error
                                        )

                                }

                            );

                        }

                    );

                },

                timeoutMs

            );


        if (
            typeof timer.unref ===
            'function'
        ) {

            timer.unref();

        }


        this.operationTimers.set(

            operationKey,

            timer

        );


        return this.cloneOperationRecord(
            record
        );

    }


    /**
     * =========================================================================
     * Start Monitor
     * =========================================================================
     */

    start() {

        if (
            this.running
        ) {

            return;

        }


        if (
            this.shuttingDown
        ) {

            throw this.createManagerError(

                'TIMEOUT_MANAGER_SHUTTING_DOWN',

                'Cannot start a shutting-down timeout manager.'

            );

        }


        this.running =
            true;


        this.timer =
            setInterval(

                () => {

                    this.checkExpired()
                        .catch(
                            error => {

                                this.safeLog(

                                    'error',

                                    '[TimeoutManager] Monitor error',

                                    {

                                        error:
                                            this.normalizeError(
                                                error
                                            )

                                    }

                                );

                            }

                        );

                },

                this.config.monitorInterval

            );


        if (
            typeof this.timer.unref ===
            'function'
        ) {

            this.timer.unref();

        }


        this.safeLog(

            'info',

            '[TimeoutManager] Started',

            {

                monitorInterval:
                    this.config.monitorInterval

            }

        );


        this.emit(
            'started'
        );

    }


    /**
     * =========================================================================
     * Stop Monitor
     * =========================================================================
     */

    stop() {

        this.running =
            false;


        if (
            this.timer
        ) {

            clearInterval(
                this.timer
            );

            this.timer =
                null;

        }


        this.emit(
            'stopped'
        );

    }


    /**
     * =========================================================================
     * Check Expired Transactions
     * =========================================================================
     */

    async checkExpired() {

        if (
            this.shuttingDown
        ) {

            return {

                checked:
                    0,

                expired:
                    0

            };

        }


        const now =
            this.now();


        let checked =
            0;


        let expired =
            0;


        const records =
            [...this.timeouts.values()];


        for (
            const timeout
            of records
        ) {

            if (
                timeout.status !==
                TimeoutStatuses.ACTIVE
            ) {

                continue;

            }


            checked++;


            if (
                new Date(
                    timeout.expiresAt
                ).getTime()
                <=
                now
            ) {

                expired++;


                await this.handleTimeout(
                    timeout
                );

            }

        }


        this.safeMetric(

            'transaction_timeout_check_total',

            1

        );


        return {

            checked,

            expired

        };

    }


    /**
     * =========================================================================
     * Handle Transaction Timeout
     * =========================================================================
     */

    async handleTimeout(
        timeout
    ) {

        if (
            !timeout
        ) {

            return false;

        }


        /**
         * Idempotency fence.
         */

        if (
            timeout.status !==
            TimeoutStatuses.ACTIVE
        ) {

            return false;

        }


        timeout.status =
            TimeoutStatuses.EXPIRING;


        timeout.timeoutCount =
            (timeout.timeoutCount || 0) + 1;


        const span =
            this.startSpan(
                'transaction.timeout',
                timeout
            );


        const timeoutError =
            new TransactionTimeoutError(

                'Transaction deadline exceeded.',

                {

                    transactionId:
                        timeout.transactionId,

                    timeoutMs:
                        timeout.timeout,

                    deadline:
                        timeout.expiresAt,

                    tenantId:
                        timeout.tenantId

                }

            );


        try {

            timeout.status =
                TimeoutStatuses.EXPIRED;


            timeout.expiredAt =
                new Date(
                    this.now()
                ).toISOString();


            this.safeMetric(

                'transaction_timeout_total',

                1,

                {

                    tenantId:
                        timeout.tenantId

                }

            );


            this.safeLog(

                'warn',

                '[TimeoutManager] Transaction timeout',

                {

                    transactionId:
                        timeout.transactionId,

                    tenantId:
                        timeout.tenantId,

                    correlationId:
                        timeout.correlationId,

                    timeoutMs:
                        timeout.timeout,

                    expiresAt:
                        timeout.expiresAt

                }

            );


            /**
             * Cancel local execution.
             */

            this.abort(

                timeout.transactionId,

                timeoutError

            );


            /**
             * Notify the state machine.
             */

            await this.signalStateMachineTimeout(
                timeout,
                timeoutError
            );


            /**
             * Audit.
             */

            await this.publishAudit(
                timeout,
                timeoutError
            );


            /**
             * Event.
             */

            await this.publishEvent(
                timeout,
                timeoutError
            );


            this.emit(

                'timeout',

                this.cloneRecord(
                    timeout
                )

            );


            /**
             * Recovery.
             */

            await this.startRecovery(
                timeout,
                timeoutError
            );


            return true;

        }

        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * State Machine Timeout Integration
     * =========================================================================
     */

    async signalStateMachineTimeout(
        timeout,
        error
    ) {

        if (
            !this.stateMachine
        ) {

            return;

        }


        try {

            if (
                typeof this.stateMachine.timeout ===
                'function' &&
                !this.stateMachine.is?.('TIMED_OUT') &&
                !this.stateMachine.is?.('RECOVERING') &&
                !this.stateMachine.is?.('RECOVERED')
            ) {

                await this.stateMachine.timeout(

                    'Transaction execution deadline exceeded',

                    {

                        transitionKey:
                            `timeout:${timeout.id}`,

                        tenantId:
                            timeout.tenantId,

                        correlationId:
                            timeout.correlationId,

                        source:
                            'timeout-manager',

                        error:
                            this.normalizeError(
                                error
                            )

                    }

                );

            }

        }

        catch (stateError) {

            this.safeLog(

                'error',

                '[TimeoutManager] State machine timeout transition failed',

                {

                    transactionId:
                        timeout.transactionId,

                    error:
                        this.normalizeError(
                            stateError
                        )

                }

            );


            this.safeMetric(

                'transaction_timeout_state_transition_failures_total'

            );

        }

    }


    /**
     * =========================================================================
     * Recovery
     * =========================================================================
     */

    async startRecovery(
        timeout,
        error
    ) {

        if (
            !this.recoveryManager
        ) {

            return false;

        }


        if (
            timeout.status ===
            TimeoutStatuses.RECOVERING ||
            timeout.status ===
            TimeoutStatuses.RECOVERED
        ) {

            return false;

        }


        timeout.status =
            TimeoutStatuses.RECOVERING;


        try {

            const recoveryResult =
                await this.recoveryManager.recoverById(

                    timeout.transactionId,

                    {

                        reason:
                            'TRANSACTION_TIMEOUT',

                        tenantId:
                            timeout.tenantId,

                        correlationId:
                            timeout.correlationId,

                        timeoutId:
                            timeout.id,

                        error:
                            this.normalizeError(
                                error
                            )

                    }

                );


            timeout.status =
                TimeoutStatuses.RECOVERED;


            timeout.recoveredAt =
                new Date(
                    this.now()
                ).toISOString();


            this.safeMetric(

                'transaction_timeout_recovery_success_total'

            );


            this.emit(

                'recovered',

                {

                    timeout:
                        this.cloneRecord(
                            timeout
                        ),

                    result:
                        recoveryResult

                }

            );


            return true;

        }

        catch (recoveryError) {

            timeout.status =
                TimeoutStatuses.RECOVERY_FAILED;


            timeout.recoveryFailedAt =
                new Date(
                    this.now()
                ).toISOString();


            this.safeMetric(

                'transaction_timeout_recovery_failure_total'

            );


            this.safeLog(

                'error',

                '[TimeoutManager] Recovery failed',

                {

                    transactionId:
                        timeout.transactionId,

                    error:
                        this.normalizeError(
                            recoveryError
                        )

                }

            );


            this.emit(

                'recoveryFailed',

                {

                    timeout:
                        this.cloneRecord(
                            timeout
                        ),

                    error:
                        this.normalizeError(
                            recoveryError
                        )

                }

            );


            return false;

        }

    }


    /**
     * =========================================================================
     * Operation Timeout Handler
     * =========================================================================
     */

    async handleOperationTimeout(
        operationKey
    ) {

        const operation =
            this.operations.get(
                operationKey
            );


        if (
            !operation ||
            operation.status !==
                TimeoutStatuses.ACTIVE
        ) {

            return false;

        }


        operation.status =
            TimeoutStatuses.EXPIRED;


        operation.expiredAt =
            new Date(
                this.now()
            ).toISOString();


        this.clearOperationTimer(
            operationKey
        );


        const error =
            new TransactionTimeoutError(

                `Operation timed out: ${operation.operation}`,

                {

                    code:
                        'OPERATION_TIMEOUT',

                    transactionId:
                        operation.transactionId,

                    operation:
                        operation.operation,

                    tenantId:
                        operation.tenantId,

                    timeoutMs:
                        operation.timeout,

                    deadline:
                        operation.expiresAt

                }

            );


        try {

            operation.controller.abort(
                error
            );

        }

        catch (_) {}


        this.safeMetric(

            'transaction_operation_timeout_total',

            1,

            {

                operation:
                    operation.operation

            }

        );


        this.safeLog(

            'warn',

            '[TimeoutManager] Operation timeout',

            {

                transactionId:
                    operation.transactionId,

                operation:
                    operation.operation,

                timeoutMs:
                    operation.timeout

            }

        );


        await this.publishOperationTimeout(
            operation,
            error
        );


        this.emit(

            'operationTimeout',

            {

                operation:
                    this.cloneOperationRecord(
                        operation
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            }

        );


        return true;

    }


    /**
     * =========================================================================
     * Execute With Timeout
     * =========================================================================
     *
     * The operation receives an AbortSignal.
     *
     * IMPORTANT:
     *
     * A timeout cannot forcibly terminate arbitrary JavaScript execution.
     * It can only signal cancellation.
     *
     * Therefore production operations should honor:
     *
     *   signal.aborted
     *
     * or listen to:
     *
     *   signal.addEventListener('abort', ...)
     *
     */

    async execute(
        operation,
        options = {}
    ) {

        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(

                'Timeout-managed operation must be a function.'

            );

        }


        const transactionId =
            options.transactionId ||
            null;


        const operationName =
            options.operation ||
            'operation';


        const timeoutMs =
            this.resolveTimeout(

                options.timeout,

                this.config.operation,

                this.config.maxOperationTimeout

            );


        const controller =
            new AbortController();


        const externalSignal =
            options.signal;


        const abortFromExternal =
            () => {

                if (
                    !controller.signal.aborted
                ) {

                    controller.abort(

                        externalSignal.reason ||
                        'Operation cancelled'

                    );

                }

            };


        if (
            externalSignal
        ) {

            if (
                externalSignal.aborted
            ) {

                abortFromExternal();

            }
            else {

                externalSignal.addEventListener(

                    'abort',

                    abortFromExternal,

                    {

                        once:
                            true

                    }

                );

            }

        }


        let timeoutHandle =
            null;


        const timeoutPromise =
            new Promise(
                (_, reject) => {

                    timeoutHandle =
                        setTimeout(

                            () => {

                                const error =
                                    new TransactionTimeoutError(

                                        `Operation timed out: ${operationName}`,

                                        {

                                            code:
                                                'OPERATION_TIMEOUT',

                                            transactionId,

                                            operation:
                                                operationName,

                                            timeoutMs

                                        }

                                    );


                                try {

                                    controller.abort(
                                        error
                                    );

                                }

                                catch (_) {}


                                reject(
                                    error
                                );

                            },

                            timeoutMs

                        );


                    if (
                        typeof timeoutHandle.unref ===
                        'function'
                    ) {

                        timeoutHandle.unref();

                    }

                }

            );


        const span =
            this.startSpan(

                'transaction.operation.timeout',

                {

                    transactionId,

                    operation:
                        operationName

                }

            );


        try {

            const result =
                await Promise.race([

                    Promise.resolve().then(

                        () => operation(
                            {

                                signal:
                                    controller.signal,

                                transactionId,

                                operation:
                                    operationName

                            }

                        )

                    ),

                    timeoutPromise

                ]);


            return result;

        }

        catch (error) {

            if (
                error?.code ===
                'OPERATION_TIMEOUT'
            ) {

                this.safeMetric(

                    'transaction_operation_timeout_total'

                );

            }


            span?.recordException?.(
                error
            );


            throw error;

        }

        finally {

            if (
                timeoutHandle
            ) {

                clearTimeout(
                    timeoutHandle
                );

            }


            if (
                externalSignal
            ) {

                externalSignal.removeEventListener(

                    'abort',

                    abortFromExternal

                );

            }


            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     *
     * Indicates that the transaction is still actively executing.
     *
     * This does NOT automatically extend the deadline.
     *
     * It only records liveness.
     */

    heartbeat(
        transactionId,
        metadata = {}
    ) {

        const timeout =
            this.timeouts.get(
                transactionId
            );


        if (
            !timeout ||
            timeout.status !==
                TimeoutStatuses.ACTIVE
        ) {

            return false;

        }


        timeout.heartbeatAt =
            new Date(
                this.now()
            ).toISOString();


        timeout.heartbeatCount =
            (timeout.heartbeatCount || 0) + 1;


        timeout.lastHeartbeatMetadata =
            this.sanitizeMetadata(
                metadata
            );


        this.emit(

            'heartbeat',

            this.cloneRecord(
                timeout
            )

        );


        return true;

    }


    /**
     * =========================================================================
     * Extend Deadline
     * =========================================================================
     */

    extend(
        transactionId,
        extensionMs,
        options = {}
    ) {

        const timeout =
            this.timeouts.get(
                transactionId
            );


        if (
            !timeout
        ) {

            return null;

        }


        if (
            timeout.status !==
            TimeoutStatuses.ACTIVE
        ) {

            throw this.createManagerError(

                'TIMEOUT_NOT_ACTIVE',

                `Cannot extend timeout in state ${timeout.status}.`

            );

        }


        if (
            !Number.isFinite(
                extensionMs
            ) ||
            extensionMs <= 0
        ) {

            throw new TypeError(

                'extensionMs must be a positive number.'

            );

        }


        const currentDeadline =
            new Date(
                timeout.expiresAt
            ).getTime();


        const newDeadline =
            currentDeadline +
            extensionMs;


        const maxDeadline =
            timeout.createdAt
                ? new Date(
                    timeout.createdAt
                ).getTime() +
                    this.config.maxTransactionTimeout
                : Infinity;


        if (
            newDeadline >
            maxDeadline &&
            options.allowBeyondMaximum !== true
        ) {

            throw this.createManagerError(

                'TIMEOUT_MAXIMUM_EXCEEDED',

                'Requested timeout extension exceeds the configured maximum deadline.'

            );

        }


        timeout.expiresAt =
            new Date(
                newDeadline
            ).toISOString();


        timeout.extensionCount =
            (timeout.extensionCount || 0) + 1;


        timeout.lastExtensionAt =
            new Date(
                this.now()
            ).toISOString();


        timeout.lastExtensionReason =
            options.reason ||
            null;


        this.safeMetric(

            'transaction_timeout_extension_total'

        );


        this.emit(

            'extended',

            this.cloneRecord(
                timeout
            )

        );


        return this.cloneRecord(
            timeout
        );

    }


    /**
     * =========================================================================
     * Complete Transaction
     * =========================================================================
     */

    complete(
        transactionId,
        options = {}
    ) {

        const timeout =
            this.timeouts.get(
                transactionId
            );


        if (
            !timeout
        ) {

            return false;

        }


        if (
            timeout.status ===
                TimeoutStatuses.EXPIRED ||
            timeout.status ===
                TimeoutStatuses.RECOVERING ||
            timeout.status ===
                TimeoutStatuses.RECOVERY_FAILED
        ) {

            /**
             * A timed-out transaction must not silently become completed.
             *
             * This prevents a late worker from masking a timeout.
             */

            return false;

        }


        timeout.status =
            TimeoutStatuses.COMPLETED;


        timeout.completedAt =
            new Date(
                this.now()
            ).toISOString();


        this.safeMetric(

            'transaction_timeout_completed_total'

        );


        this.emit(

            'completed',

            this.cloneRecord(
                timeout
            )

        );


        this.cleanup(
            transactionId
        );


        return true;

    }


    /**
     * =========================================================================
     * Cancel Transaction Timeout
     * =========================================================================
     */

    cancel(
        transactionId,
        options = {}
    ) {

        const timeout =
            this.timeouts.get(
                transactionId
            );


        if (
            !timeout
        ) {

            return false;

        }


        if (
            timeout.status ===
                TimeoutStatuses.EXPIRED ||
            timeout.status ===
                TimeoutStatuses.RECOVERING ||
            timeout.status ===
                TimeoutStatuses.RECOVERED
        ) {

            return false;

        }


        timeout.status =
            TimeoutStatuses.CANCELLED;


        timeout.cancelledAt =
            new Date(
                this.now()
            ).toISOString();


        timeout.cancelReason =
            options.reason ||
            null;


        this.abort(

            transactionId,

            options.reason ||
            'Transaction timeout cancelled'

        );


        if (
            !options.silent
        ) {

            this.emit(

                'cancelled',

                this.cloneRecord(
                    timeout
                )

            );

        }


        this.cleanup(
            transactionId
        );


        return true;

    }


    /**
     * =========================================================================
     * Abort Controller
     * =========================================================================
     */

    createAbortController(
        transactionId
    ) {

        const existing =
            this.controllers.get(
                transactionId
            );


        if (
            existing
        ) {

            return existing;

        }


        const controller =
            new AbortController();


        this.controllers.set(

            transactionId,

            controller

        );


        return controller;

    }


    /**
     * =========================================================================
     * Get Abort Signal
     * =========================================================================
     */

    getAbortSignal(
        transactionId
    ) {

        return this.controllers

            .get(
                transactionId
            )

            ?.signal;

    }


    /**
     * =========================================================================
     * Abort
     * =========================================================================
     */

    abort(
        transactionId,
        reason =
            'Transaction timeout'
    ) {

        const controller =
            this.controllers.get(
                transactionId
            );


        if (
            !controller
        ) {

            return false;

        }


        if (
            controller.signal.aborted
        ) {

            return false;

        }


        try {

            controller.abort(
                reason
            );

            return true;

        }

        catch (_) {

            return false;

        }

    }


    /**
     * =========================================================================
     * Cancel Operation
     * =========================================================================
     */

    cancelOperation(
        transactionId,
        operation,
        reason =
            'Operation cancelled'
    ) {

        const key =
            this.createOperationKey(

                transactionId,

                operation

            );


        const record =
            this.operations.get(
                key
            );


        if (
            !record
        ) {

            return false;

        }


        if (
            record.status !==
            TimeoutStatuses.ACTIVE
        ) {

            return false;

        }


        record.status =
            TimeoutStatuses.CANCELLED;


        record.cancelledAt =
            new Date(
                this.now()
            ).toISOString();


        try {

            record.controller.abort(
                reason
            );

        }

        catch (_) {}


        this.clearOperationTimer(
            key
        );


        this.operations.delete(
            key
        );


        return true;

    }


    /**
     * =========================================================================
     * Operation Completion
     * =========================================================================
     */

    completeOperation(
        transactionId,
        operation
    ) {

        const key =
            this.createOperationKey(

                transactionId,

                operation

            );


        const record =
            this.operations.get(
                key
            );


        if (
            !record
        ) {

            return false;

        }


        if (
            record.status !==
            TimeoutStatuses.ACTIVE
        ) {

            return false;

        }


        record.status =
            TimeoutStatuses.COMPLETED;


        record.completedAt =
            new Date(
                this.now()
            ).toISOString();


        this.clearOperationTimer(
            key
        );


        this.operations.delete(
            key
        );


        return true;

    }


    /**
     * =========================================================================
     * Cleanup
     * =========================================================================
     */

    cleanup(
        transactionId
    ) {

        this.timeouts.delete(
            transactionId
        );


        this.controllers.delete(
            transactionId
        );


        for (
            const [
                key,
                operation
            ]
            of this.operations.entries()
        ) {

            if (
                operation.transactionId ===
                transactionId
            ) {

                this.clearOperationTimer(
                    key
                );

                this.operations.delete(
                    key
                );

            }

        }

    }


    /**
     * =========================================================================
     * Clear Operation Timer
     * =========================================================================
     */

    clearOperationTimer(
        operationKey
    ) {

        const timer =
            this.operationTimers.get(
                operationKey
            );


        if (
            timer
        ) {

            clearTimeout(
                timer
            );

        }


        this.operationTimers.delete(
            operationKey
        );

    }


    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    getStatus(
        transactionId
    ) {

        const record =
            this.timeouts.get(
                transactionId
            );


        return record
            ? this.cloneRecord(
                record
            )
            : null;

    }


    /**
     * =========================================================================
     * Operation Status
     * =========================================================================
     */

    getOperationStatus(
        transactionId,
        operation
    ) {

        const key =
            this.createOperationKey(

                transactionId,

                operation

            );


        const record =
            this.operations.get(
                key
            );


        return record
            ? this.cloneOperationRecord(
                record
            )
            : null;

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    getStatistics() {

        let active =
            0;

        let expired =
            0;

        let recovering =
            0;


        for (
            const timeout
            of this.timeouts.values()
        ) {

            if (
                timeout.status ===
                TimeoutStatuses.ACTIVE
            ) {

                active++;

            }


            if (
                timeout.status ===
                TimeoutStatuses.EXPIRED
            ) {

                expired++;

            }


            if (
                timeout.status ===
                TimeoutStatuses.RECOVERING
            ) {

                recovering++;

            }

        }


        return {

            activeTimeouts:
                active,

            expiredTimeouts:
                expired,

            recoveringTimeouts:
                recovering,

            activeOperations:
                this.operations.size,

            controllers:
                this.controllers.size,

            operationTimers:
                this.operationTimers.size,

            running:
                this.running,

            shuttingDown:
                this.shuttingDown

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown(
        options = {}
    ) {

        if (
            this.shuttingDown
        ) {

            return;

        }


        this.shuttingDown =
            true;


        this.stop();


        const gracePeriod =
            Number.isFinite(
                options.gracePeriod
            )
                ? options.gracePeriod
                : this.config.shutdownGracePeriod;


        const shutdownDeadline =
            this.now() +
            gracePeriod;


        /**
         * Stop accepting new operations and cancel tracked operations.
         */

        for (
            const [
                transactionId,
                controller
            ]
            of this.controllers.entries()
        ) {

            if (
                this.now() >=
                shutdownDeadline
            ) {

                break;

            }


            if (
                !controller.signal.aborted
            ) {

                try {

                    controller.abort(
                        'Timeout manager shutdown'
                    );

                }

                catch (_) {}

            }

        }


        /**
         * Clear operation timers.
         */

        for (
            const key
            of this.operationTimers.keys()
        ) {

            this.clearOperationTimer(
                key
            );

        }


        this.timeouts.clear();

        this.controllers.clear();

        this.operations.clear();

        this.operationTimers.clear();


        this.emit(
            'shutdown'
        );


        this.safeLog(

            'info',

            '[TimeoutManager] Shutdown complete'

        );

    }


    /**
     * =========================================================================
     * Audit Publication
     * =========================================================================
     */

    async publishAudit(
        timeout,
        error
    ) {

        if (
            !this.auditPublisher?.publish
        ) {

            return;

        }


        try {

            await this.auditPublisher.publish({

                type:
                    'TRANSACTION_TIMEOUT',

                id:
                    timeout.id,

                transactionId:
                    timeout.transactionId,

                tenantId:
                    timeout.tenantId,

                correlationId:
                    timeout.correlationId,

                timeoutMs:
                    timeout.timeout,

                expiresAt:
                    timeout.expiresAt,

                expiredAt:
                    timeout.expiredAt,

                metadata:
                    timeout.metadata,

                error:
                    this.normalizeError(
                        error
                    ),

                timestamp:
                    new Date(
                        this.now()
                    ).toISOString()

            });

        }

        catch (publishError) {

            this.safeMetric(

                'transaction_timeout_audit_publish_failures_total'

            );


            this.safeLog(

                'error',

                '[TimeoutManager] Timeout audit publication failed',

                {

                    transactionId:
                        timeout.transactionId,

                    error:
                        this.normalizeError(
                            publishError
                        )

                }

            );

        }

    }


    /**
     * =========================================================================
     * Event Publication
     * =========================================================================
     */

    async publishEvent(
        timeout,
        error
    ) {

        if (
            !this.eventBus?.publish
        ) {

            return;

        }


        try {

            await this.eventBus.publish({

                type:
                    'transaction.timeout',

                id:
                    timeout.id,

                transactionId:
                    timeout.transactionId,

                tenantId:
                    timeout.tenantId,

                correlationId:
                    timeout.correlationId,

                timeoutMs:
                    timeout.timeout,

                expiresAt:
                    timeout.expiresAt,

                metadata:
                    timeout.metadata,

                error:
                    this.normalizeError(
                        error
                    ),

                timestamp:
                    new Date(
                        this.now()
                    ).toISOString()

            });

        }

        catch (publishError) {

            this.safeMetric(

                'transaction_timeout_event_publish_failures_total'

            );


            this.safeLog(

                'error',

                '[TimeoutManager] Timeout event publication failed',

                {

                    transactionId:
                        timeout.transactionId,

                    error:
                        this.normalizeError(
                            publishError
                        )

                }

            );

        }

    }


    /**
     * =========================================================================
     * Operation Timeout Publication
     * =========================================================================
     */

    async publishOperationTimeout(
        operation,
        error
    ) {

        const payload = {

            type:
                'TRANSACTION_OPERATION_TIMEOUT',

            id:
                operation.id,

            transactionId:
                operation.transactionId,

            operation:
                operation.operation,

            tenantId:
                operation.tenantId,

            correlationId:
                operation.correlationId,

            timeoutMs:
                operation.timeout,

            expiresAt:
                operation.expiresAt,

            metadata:
                operation.metadata,

            error:
                this.normalizeError(
                    error
                ),

            timestamp:
                new Date(
                    this.now()
                ).toISOString()

        };


        try {

            await this.auditPublisher?.publish?.(
                payload
            );

        }

        catch (publishError) {

            this.safeLog(

                'error',

                '[TimeoutManager] Operation timeout audit failed',

                {

                    transactionId:
                        operation.transactionId,

                    operation:
                        operation.operation,

                    error:
                        this.normalizeError(
                            publishError
                        )

                }

            );

        }


        try {

            await this.eventBus?.publish?.({

                ...payload,

                type:
                    'transaction.operation.timeout'

            });

        }

        catch (publishError) {

            this.safeLog(

                'error',

                '[TimeoutManager] Operation timeout event failed',

                {

                    transactionId:
                        operation.transactionId,

                    operation:
                        operation.operation,

                    error:
                        this.normalizeError(
                            publishError
                        )

                }

            );

        }

    }


    /**
     * =========================================================================
     * Span
     * =========================================================================
     */

    startSpan(
        name,
        context = {}
    ) {

        try {

            return this.tracer?.startSpan?.(

                name,

                {

                    attributes: {

                        'transaction.id':
                            context.transactionId ||
                            '',

                        'transaction.tenant_id':
                            context.tenantId ||
                            '',

                        'transaction.operation':
                            context.operation ||
                            '',

                        'transaction.timeout_ms':
                            context.timeout ||
                            context.timeoutMs ||
                            0

                    }

                }

            );

        }

        catch (_) {

            return null;

        }

    }


    /**
     * =========================================================================
     * Timeout Resolution
     * =========================================================================
     */

    resolveTimeout(
        requested,
        fallback,
        maximum
    ) {

        const value =
            requested ??
            fallback;


        if (
            !Number.isFinite(
                value
            ) ||
            value <= 0
        ) {

            throw new TypeError(

                'Timeout must be a positive finite number.'

            );

        }


        return Math.min(
            value,
            maximum
        );

    }


    /**
     * =========================================================================
     * Operation Key
     * =========================================================================
     */

    createOperationKey(
        transactionId,
        operation
    ) {

        return [

            transactionId,

            operation

        ]

            .map(
                value =>
                    String(
                        value
                    )
            )

            .join(':');

    }


    /**
     * =========================================================================
     * Transaction ID Validation
     * =========================================================================
     */

    validateTransactionId(
        transactionId
    ) {

        if (
            !transactionId ||
            typeof transactionId !==
            'string'
        ) {

            throw new TypeError(

                'transactionId is required.'

            );

        }

    }


    /**
     * =========================================================================
     * Manager Error
     * =========================================================================
     */

    createManagerError(
        code,
        message
    ) {

        const error =
            new Error(
                message
            );


        error.name =
            'TransactionTimeoutManagerError';


        error.code =
            code;


        error.retryable =
            false;


        return error;

    }


    /**
     * =========================================================================
     * Current Time
     * =========================================================================
     */

    now() {

        return this.clock();

    }


    /**
     * =========================================================================
     * Metadata Sanitization
     * =========================================================================
     */

    sanitizeMetadata(
        value
    ) {

        const sensitiveFields =
            new Set([

                'password',

                'token',

                'accessToken',

                'refreshToken',

                'secret',

                'apiKey',

                'authorization',

                'pin',

                'otp',

                'cardNumber',

                'cvv',

                'securityCode',

                'clientSecret'

            ]);


        const sanitize =
            input => {

                if (
                    input === null ||
                    input === undefined
                ) {

                    return input;

                }


                if (
                    Array.isArray(
                        input
                    )
                ) {

                    return input.map(
                        sanitize
                    );

                }


                if (
                    typeof input !==
                    'object'
                ) {

                    return input;

                }


                const output = {};


                for (
                    const [
                        key,
                        val
                    ]
                    of Object.entries(
                        input
                    )
                ) {

                    output[key] =
                        sensitiveFields.has(
                            key
                        )

                            ? '[REDACTED]'

                            : sanitize(
                                val
                            );

                }


                return output;

            };


        return sanitize(
            value
        );

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (
            !error
        ) {

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
                null,

            status:
                error.status ??
                error.statusCode ??
                null,

            retryable:
                error.retryable ??
                null

        };

    }


    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    safeLog(
        level,
        message,
        data
    ) {

        try {

            const method =
                this.logger?.[level];


            if (
                typeof method ===
                'function'
            ) {

                method.call(

                    this.logger,

                    message,

                    data

                );

            }

        }

        catch (_) {

            /**
             * Logging must never break timeout enforcement.
             */

        }

    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    safeMetric(
        name,
        value = 1,
        labels
    ) {

        try {

            const increment =
                this.metrics?.increment;


            if (
                typeof increment !==
                'function'
            ) {

                return;

            }


            if (
                labels === undefined
            ) {

                increment.call(

                    this.metrics,

                    name,

                    value

                );

            }
            else {

                increment.call(

                    this.metrics,

                    name,

                    value,

                    labels

                );

            }

        }

        catch (_) {

            /**
             * Metrics are observational only.
             */

        }

    }


    /**
     * =========================================================================
     * Clone Timeout Record
     * =========================================================================
     */

    cloneRecord(
        record
    ) {

        if (
            !record
        ) {

            return null;

        }


        const clone = {

            ...record,

            metadata:
                this.deepClone(
                    record.metadata ||
                    {}
                )

        };


        /**
         * Never expose the AbortSignal/controller internals through the
         * public status API.
         */

        delete clone.signal;


        return clone;

    }


    /**
     * =========================================================================
     * Clone Operation Record
     * =========================================================================
     */

    cloneOperationRecord(
        record
    ) {

        if (
            !record
        ) {

            return null;

        }


        return {

            ...record,

            metadata:
                this.deepClone(
                    record.metadata ||
                    {}
                )

        };

    }


    /**
     * =========================================================================
     * Deep Clone
     * =========================================================================
     */

    deepClone(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }


        if (
            typeof structuredClone ===
            'function'
        ) {

            try {

                return structuredClone(
                    value
                );

            }

            catch (_) {}

        }


        return JSON.parse(

            JSON.stringify(
                value
            )

        );

    }


    /**
     * =========================================================================
     * Static Properties
     * =========================================================================
     */

    static get Statuses() {

        return TimeoutStatuses;

    }


    static get Defaults() {

        return DEFAULT_TIMEOUTS;

    }


    static get TimeoutError() {

        return TransactionTimeoutError;

    }

}


module.exports =
    TransactionTimeoutManager;