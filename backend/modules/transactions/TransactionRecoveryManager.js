'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Recovery Manager
 * ============================================================================
 *
 * Coordinates automatic recovery of interrupted, failed, timed-out and
 * partially completed distributed financial transactions.
 *
 * Production capabilities
 * ----------------------------------------------------------------------------
 *
 * ✓ Automatic recovery scheduler
 * ✓ Crash recovery
 * ✓ Atomic recovery claiming / leases
 * ✓ Distributed-worker protection
 * ✓ Saga compensation
 * ✓ Retry orchestration
 * ✓ Exponential backoff + jitter
 * ✓ Retry attempt limits
 * ✓ Retry eligibility checks
 * ✓ Dead-letter queue integration
 * ✓ Dead-letter metadata
 * ✓ Stuck transaction detection
 * ✓ Timeout recovery
 * ✓ Handler execution timeout
 * ✓ Multi-tenant support
 * ✓ Tenant-aware recovery context
 * ✓ Recovery state-machine validation
 * ✓ Recovery history
 * ✓ Idempotent recovery operations
 * ✓ Audit events
 * ✓ Event publication
 * ✓ Metrics
 * ✓ OpenTelemetry hooks
 * ✓ Structured logging
 * ✓ Graceful scheduler shutdown
 * ✓ Scheduler overlap protection
 * ✓ Pluggable recovery handlers
 * ✓ Health / readiness information
 *
 * Delivery model
 * ----------------------------------------------------------------------------
 *
 * This component coordinates recovery. It does not attempt to provide
 * distributed exactly-once semantics by itself.
 *
 * The repository should provide atomic claim / lease operations where
 * available:
 *
 *   claimForRecovery()
 *   releaseRecoveryLease()
 *   updateState()
 *   recordRecoveryAttempt()
 *   recordRecoveryHistory()
 *
 * The implementation below remains compatible with repositories that expose
 * only the original list(), updateState() and findByTransactionId() methods.
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

const DEFAULT_INTERVAL =
    30000;

const DEFAULT_STUCK_TIMEOUT =
    300000;

const DEFAULT_BATCH_SIZE =
    100;

const DEFAULT_LEASE_DURATION =
    120000;

const DEFAULT_HANDLER_TIMEOUT =
    120000;

const DEFAULT_MAX_RETRIES =
    5;

const DEFAULT_RETRY_DELAY =
    1000;

const DEFAULT_MAX_RETRY_DELAY =
    60000;

const DEFAULT_BACKOFF_MULTIPLIER =
    2;


/**
 * ============================================================================
 * Recovery States
 * ============================================================================
 */

const STATES = Object.freeze({

    RUNNING:
        'RUNNING',

    WAITING_EXTERNAL:
        'WAITING_EXTERNAL',

    FAILED:
        'FAILED',

    TIMED_OUT:
        'TIMED_OUT',

    ROLLING_BACK:
        'ROLLING_BACK',

    RECOVERING:
        'RECOVERING',

    RETRYING:
        'RETRYING',

    ROLLED_BACK:
        'ROLLED_BACK',

    COMPLETED:
        'COMPLETED',

    DEAD_LETTERED:
        'DEAD_LETTERED'

});


/**
 * ============================================================================
 * Recoverable States
 * ============================================================================
 */

const RECOVERABLE_STATES = Object.freeze([

    STATES.RUNNING,

    STATES.WAITING_EXTERNAL,

    STATES.FAILED,

    STATES.TIMED_OUT,

    STATES.ROLLING_BACK

]);


/**
 * ============================================================================
 * Terminal States
 * ============================================================================
 */

const TERMINAL_STATES = new Set([

    STATES.ROLLED_BACK,

    STATES.COMPLETED,

    STATES.DEAD_LETTERED

]);


/**
 * ============================================================================
 * Transaction Recovery Manager
 * ============================================================================
 */

class TransactionRecoveryManager extends EventEmitter {


    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {

        super();


        if (!options.repository) {

            throw new Error(
                'TransactionRecoveryManager requires a repository.'
            );

        }


        this.repository =
            options.repository;


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


        this.deadLetterQueue =
            options.deadLetterQueue ||
            null;


        this.recoveryHandlers =
            new Map();


        this.statistics =
            this.createStatistics();


        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();


        this.options = {

            interval:
                this.normalizePositiveInteger(
                    options.interval,
                    DEFAULT_INTERVAL
                ),

            stuckTimeout:
                this.normalizePositiveInteger(
                    options.stuckTimeout,
                    DEFAULT_STUCK_TIMEOUT
                ),

            batchSize:
                this.normalizePositiveInteger(
                    options.batchSize,
                    DEFAULT_BATCH_SIZE
                ),

            leaseDuration:
                this.normalizePositiveInteger(
                    options.leaseDuration,
                    DEFAULT_LEASE_DURATION
                ),

            handlerTimeout:
                this.normalizePositiveInteger(
                    options.handlerTimeout,
                    DEFAULT_HANDLER_TIMEOUT
                ),

            maxRetries:
                this.normalizeNonNegativeInteger(
                    options.maxRetries,
                    DEFAULT_MAX_RETRIES
                ),

            retryDelay:
                this.normalizeNonNegativeInteger(
                    options.retryDelay,
                    DEFAULT_RETRY_DELAY
                ),

            maxRetryDelay:
                this.normalizeNonNegativeInteger(
                    options.maxRetryDelay,
                    DEFAULT_MAX_RETRY_DELAY
                ),

            backoffMultiplier:
                this.normalizeMultiplier(
                    options.backoffMultiplier,
                    DEFAULT_BACKOFF_MULTIPLIER
                ),

            jitter:
                options.jitter !== false,

            continueOnError:
                options.continueOnError !== false,

            autoDeadLetter:
                options.autoDeadLetter !== false,

            publishRecoveryEvents:
                options.publishRecoveryEvents !== false,

            publishAuditEvents:
                options.publishAuditEvents !== false,

            enableLeaseRenewal:
                options.enableLeaseRenewal !== false

        };


        this.timer =
            null;


        this.running =
            false;


        this.scanning =
            false;


        this.stopping =
            false;


        this.activeRecoveries =
            new Map();


        this.recoveryKeys =
            new Set();


        this.validateRepositoryCapabilities();

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    createStatistics() {

        return {

            scanned:
                0,

            claimed:
                0,

            recovered:
                0,

            retries:
                0,

            retryScheduled:
                0,

            compensations:
                0,

            deadLetters:
                0,

            failures:
                0,

            skipped:
                0,

            leaseConflicts:
                0,

            timeouts:
                0,

            handlerFailures:
                0,

            auditFailures:
                0,

            eventFailures:
                0

        };

    }


    /**
     * =========================================================================
     * Register Recovery Handler
     * =========================================================================
     *
     * @param {String} state
     * @param {Function} handler
     * @returns {TransactionRecoveryManager}
     */

    registerHandler(state, handler) {

        if (!state) {

            throw new Error(
                'Recovery handler state is required.'
            );

        }


        if (
            typeof handler !==
            'function'
        ) {

            throw new Error(
                'Recovery handler must be a function.'
            );

        }


        this.recoveryHandlers.set(
            state,
            handler
        );


        return this;

    }


    /**
     * =========================================================================
     * Unregister Recovery Handler
     * =========================================================================
     */

    unregisterHandler(state) {

        this.recoveryHandlers.delete(
            state
        );


        return this;

    }


    /**
     * =========================================================================
     * Start Scheduler
     * =========================================================================
     */

    start() {

        if (this.running) {

            return false;

        }


        if (this.stopping) {

            return false;

        }


        this.running =
            true;


        this.stopping =
            false;


        this.timer =
            setInterval(

                () => {

                    this.scan()
                        .catch(
                            error => {

                                this.logError(
                                    'Recovery scheduler scan failed',
                                    error
                                );

                                this.incrementMetric(
                                    'transaction_recovery_scan_failure_total'
                                );

                            }
                        );

                },

                this.options.interval

            );


        this.timer.unref?.();


        this.logInfo(
            'Transaction recovery manager started',
            {

                instanceId:
                    this.instanceId,

                interval:
                    this.options.interval,

                batchSize:
                    this.options.batchSize,

                leaseDuration:
                    this.options.leaseDuration

            }
        );


        this.emit(
            'started'
        );


        return true;

    }


    /**
     * =========================================================================
     * Stop Scheduler
     * =========================================================================
     *
     * Prevents new scans and waits for currently running recovery operations
     * to finish when waitForActiveRecoveries() is explicitly requested.
     */

    stop() {

        this.running =
            false;


        this.stopping =
            true;


        if (this.timer) {

            clearInterval(
                this.timer
            );


            this.timer =
                null;

        }


        this.logInfo(
            'Transaction recovery manager stopped',
            {

                instanceId:
                    this.instanceId

            }
        );


        this.emit(
            'stopped'
        );


        return true;

    }


    /**
     * =========================================================================
     * Graceful Shutdown
     * =========================================================================
     */

    async shutdown(options = {}) {

        const timeout =
            this.normalizePositiveInteger(
                options.timeout,
                this.options.handlerTimeout
            );


        this.stop();


        try {

            await this.waitForActiveRecoveries(
                timeout
            );

        }

        catch (error) {

            this.logWarn(
                'Recovery manager shutdown timed out',
                {

                    activeRecoveries:
                        this.activeRecoveries.size,

                    error:
                        error.message

                }
            );

        }


        return this.getHealth();

    }


    /**
     * =========================================================================
     * Scan Repository
     * =========================================================================
     *
     * Important:
     *
     * Discovery is followed by an atomic claim where supported.
     * This prevents multiple application instances from processing the same
     * stale transaction concurrently.
     */

    async scan() {

        if (
            this.scanning
        ) {

            this.incrementMetric(
                'transaction_recovery_scan_overlap_total'
            );


            return {

                scanned:
                    0,

                recovered:
                    0,

                skipped:
                    0,

                overlapping:
                    true

            };

        }


        this.scanning =
            true;


        const span =
            this.startSpan(
                'transaction.recovery.scan'
            );


        try {

            const cutoff =
                new Date(

                    Date.now() -
                    this.options.stuckTimeout

                );


            const result =
                await this.repository.list(

                    {

                        state: {

                            $in:
                                RECOVERABLE_STATES

                        },

                        updatedAt: {

                            $lte:
                                cutoff

                        }

                    },

                    {

                        limit:
                            this.options.batchSize

                    }

                );


            const transactions =
                Array.isArray(result)
                    ? result
                    : (
                        Array.isArray(
                            result?.items
                        )
                            ? result.items
                            : []
                    );


            let recovered =
                0;


            let skipped =
                0;


            for (
                const transaction
                of transactions
            ) {

                if (
                    this.stopping &&
                    !this.running
                ) {

                    break;

                }


                try {

                    const outcome =
                        await this.recover(
                            transaction
                        );


                    if (
                        outcome === true ||
                        outcome?.recovered
                    ) {

                        recovered++;

                    }

                    else {

                        skipped++;

                    }

                }

                catch (error) {

                    if (
                        !this.options.continueOnError
                    ) {

                        throw error;

                    }


                    skipped++;


                    this.logError(
                        'Transaction recovery attempt failed during scan',
                        error,
                        {

                            transactionId:
                                transaction?.transactionId

                        }
                    );

                }

            }


            return {

                scanned:
                    transactions.length,

                recovered,

                skipped

            };

        }

        finally {

            this.scanning =
                false;


            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Recover Transaction
     * =========================================================================
     */

    async recover(transaction) {

        this.statistics.scanned++;


        if (
            !transaction ||
            !transaction.transactionId
        ) {

            this.statistics.skipped++;


            return {

                recovered:
                    false,

                skipped:
                    true,

                reason:
                    'INVALID_TRANSACTION'

            };

        }


        const transactionId =
            transaction.transactionId;


        const state =
            transaction.state;


        if (
            TERMINAL_STATES.has(
                state
            )
        ) {

            this.statistics.skipped++;


            return {

                recovered:
                    false,

                skipped:
                    true,

                reason:
                    'TERMINAL_STATE'

            };

        }


        const handler =
            this.recoveryHandlers.get(
                state
            );


        if (!handler) {

            this.statistics.skipped++;


            this.logWarn(
                'No recovery handler registered',
                {

                    transactionId,

                    state,

                    tenantId:
                        transaction.tenantId ||
                        null

                }
            );


            return {

                recovered:
                    false,

                skipped:
                    true,

                reason:
                    'NO_HANDLER'

            };

        }


        const recoveryKey =
            this.createRecoveryKey(
                transaction
            );


        if (
            this.recoveryKeys.has(
                recoveryKey
            )
        ) {

            this.statistics.skipped++;


            return {

                recovered:
                    false,

                skipped:
                    true,

                reason:
                    'LOCAL_DUPLICATE'

            };

        }


        this.recoveryKeys.add(
            recoveryKey
        );


        let lease =
            null;


        const span =
            this.startSpan(
                'transaction.recovery'
            );


        try {

            /**
             * Atomically claim transaction ownership.
             */

            lease =
                await this.claimTransaction(
                    transaction
                );


            if (
                lease === false
            ) {

                this.statistics.leaseConflicts++;


                this.incrementMetric(
                    'transaction_recovery_lease_conflict_total'
                );


                return {

                    recovered:
                        false,

                    skipped:
                        true,

                    reason:
                        'LEASE_CONFLICT'

                };

            }


            this.statistics.claimed++;


            this.incrementMetric(
                'transaction_recovery_claim_total'
            );


            const context =
                this.createRecoveryContext(
                    transaction,
                    lease
                );


            this.logInfo(
                'Transaction recovery started',
                context
            );


            await this.recordRecoveryAttempt(
                transaction,
                context
            );


            const activeRecovery =
                {

                    transactionId,

                    lease,

                    startedAt:
                        Date.now(),

                    state

                };


            this.activeRecoveries.set(
                recoveryKey,
                activeRecovery
            );


            let leaseRenewal =
                null;


            try {

                if (
                    this.options.enableLeaseRenewal
                ) {

                    leaseRenewal =
                        this.startLeaseRenewal(
                            transaction,
                            lease
                        );

                }


                const result =
                    await this.executeHandler(
                        handler,
                        transaction,
                        context
                    );


                this.statistics.recovered++;


                this.incrementMetric(
                    'transaction_recovery_success_total'
                );


                await this.recordRecoverySuccess(
                    transaction,
                    context,
                    result
                );


                await this.publishRecoveryAudit(
                    transaction,
                    context,
                    result
                );


                await this.publishRecoveryEvent(
                    transaction,
                    context,
                    result
                );


                this.emit(
                    'recovered',
                    transaction,
                    result
                );


                this.logInfo(
                    'Transaction recovery completed',
                    {

                        ...context,

                        durationMs:
                            Date.now() -
                            activeRecovery.startedAt

                    }
                );


                return {

                    recovered:
                        true,

                    result

                };

            }

            finally {

                if (leaseRenewal) {

                    clearInterval(
                        leaseRenewal
                    );

                }


                await this.releaseTransactionLease(
                    transaction,
                    lease
                );

            }

        }

        catch (error) {

            this.statistics.failures++;


            this.statistics.handlerFailures++;


            this.incrementMetric(
                'transaction_recovery_failure_total'
            );


            const context =
                this.createRecoveryContext(
                    transaction,
                    lease
                );


            this.logError(
                'Transaction recovery failed',
                error,
                context
            );


            const retryDecision =
                this.evaluateRetry(
                    transaction,
                    error
                );


            if (
                retryDecision.retry
            ) {

                try {

                    await this.scheduleRetry(
                        transaction,
                        retryDecision
                    );

                }

                catch (retryError) {

                    this.logError(
                        'Failed to schedule transaction recovery retry',
                        retryError,
                        context
                    );

                }

            }

            else if (
                this.options.autoDeadLetter
            ) {

                try {

                    await this.sendToDeadLetter(
                        transaction,
                        error
                    );

                }

                catch (deadLetterError) {

                    this.logError(
                        'Failed to send transaction to dead-letter queue',
                        deadLetterError,
                        context
                    );

                }

            }


            this.emit(
                'failure',
                transaction,
                error
            );


            return {

                recovered:
                    false,

                failed:
                    true,

                retry:
                    retryDecision.retry,

                reason:
                    retryDecision.reason

            };

        }

        finally {

            this.activeRecoveries.delete(
                recoveryKey
            );


            this.recoveryKeys.delete(
                recoveryKey
            );


            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Claim Transaction
     * =========================================================================
     *
     * Preferred repository contract:
     *
     * repository.claimForRecovery(transactionId, options)
     *
     * Expected result:
     *
     * - false/null => another worker owns the transaction
     * - object => lease successfully acquired
     */

    async claimTransaction(transaction) {

        const transactionId =
            transaction.transactionId;


        if (
            typeof this.repository.claimForRecovery ===
            'function'
        ) {

            const result =
                await this.repository.claimForRecovery(

                    transactionId,

                    {

                        owner:
                            this.instanceId,

                        leaseUntil:
                            new Date(
                                Date.now() +
                                this.options.leaseDuration
                            ),

                        expectedState:
                            transaction.state

                    }

                );


            return result || false;

        }


        /**
         * Backward-compatible fallback.
         *
         * This is not as strong as an atomic database claim. Repository
         * implementations should implement claimForRecovery() for distributed
         * deployments.
         */

        if (
            typeof this.repository.updateState ===
            'function'
        ) {

            try {

                await this.repository.updateState(

                    transactionId,

                    STATES.RECOVERING,

                    {

                        recoveryOwner:
                            this.instanceId,

                        recoveryLeaseUntil:
                            new Date(
                                Date.now() +
                                this.options.leaseDuration
                            )

                    }

                );


                return {

                    owner:
                        this.instanceId,

                    leaseUntil:
                        new Date(
                            Date.now() +
                            this.options.leaseDuration
                        )

                };

            }

            catch (error) {

                return false;

            }

        }


        return {

            owner:
                this.instanceId,

            leaseUntil:
                new Date(
                    Date.now() +
                    this.options.leaseDuration
                )

        };

    }


    /**
     * =========================================================================
     * Lease Renewal
     * =========================================================================
     */

    startLeaseRenewal(
        transaction,
        lease
    ) {

        if (
            !lease ||
            typeof this.repository.renewRecoveryLease !==
            'function'
        ) {

            return null;

        }


        const interval =
            Math.max(

                1000,

                Math.floor(
                    this.options.leaseDuration /
                    3
                )

            );


        return setInterval(

            () => {

                this.repository
                    .renewRecoveryLease(

                        transaction.transactionId,

                        {

                            owner:
                                this.instanceId,

                            leaseUntil:
                                new Date(
                                    Date.now() +
                                    this.options.leaseDuration
                                )

                        }

                    )
                    .catch(
                        error => {

                            this.logWarn(
                                'Failed to renew recovery lease',
                                {

                                    transactionId:
                                        transaction.transactionId,

                                    error:
                                        error.message

                                }
                            );

                        }
                    );

            },

            interval

        );

    }


    /**
     * =========================================================================
     * Release Transaction Lease
     * =========================================================================
     */

    async releaseTransactionLease(
        transaction,
        lease
    ) {

        if (
            typeof this.repository.releaseRecoveryLease !==
            'function'
        ) {

            return;

        }


        try {

            await this.repository.releaseRecoveryLease(

                transaction.transactionId,

                {

                    owner:
                        this.instanceId,

                    lease

                }

            );

        }

        catch (error) {

            this.logWarn(
                'Failed to release recovery lease',
                {

                    transactionId:
                        transaction.transactionId,

                    error:
                        error.message

                }
            );

        }

    }


    /**
     * =========================================================================
     * Execute Handler
     * =========================================================================
     */

    async executeHandler(
        handler,
        transaction,
        context
    ) {

        const handlerPromise =
            Promise.resolve(
                handler(
                    transaction,
                    context
                )
            );


        return this.withTimeout(

            handlerPromise,

            this.options.handlerTimeout,

            () => {

                this.statistics.timeouts++;


                this.incrementMetric(
                    'transaction_recovery_handler_timeout_total'
                );


                const error =
                    new Error(
                        'Transaction recovery handler timed out.'
                    );


                error.code =
                    'RECOVERY_HANDLER_TIMEOUT';


                error.retryable =
                    true;


                return error;

            }

        );

    }


    /**
     * =========================================================================
     * Retry Transaction
     * =========================================================================
     */

    async retry(
        transaction,
        executor
    ) {

        if (
            typeof executor !==
            'function'
        ) {

            throw new TypeError(
                'Transaction retry executor must be a function.'
            );

        }


        const decision =
            this.evaluateRetry(
                transaction
            );


        if (
            !decision.retry
        ) {

            throw new Error(
                `Transaction retry not permitted: ${decision.reason}`
            );

        }


        this.statistics.retries++;


        await this.scheduleRetry(
            transaction,
            decision
        );


        return executor(
            transaction
        );

    }


    /**
     * =========================================================================
     * Evaluate Retry
     * =========================================================================
     */

    evaluateRetry(
        transaction,
        error = null
    ) {

        const attempts =
            this.getRetryAttempts(
                transaction
            );


        if (
            attempts >=
            this.options.maxRetries
        ) {

            return {

                retry:
                    false,

                reason:
                    'MAX_RETRIES_EXCEEDED',

                attempts

            };

        }


        if (
            transaction.retryable ===
            false
        ) {

            return {

                retry:
                    false,

                reason:
                    'TRANSACTION_NOT_RETRYABLE',

                attempts

            };

        }


        if (
            error?.retryable ===
            false
        ) {

            return {

                retry:
                    false,

                reason:
                    'ERROR_NOT_RETRYABLE',

                attempts

            };

        }


        const nextAttempt =
            attempts + 1;


        return {

            retry:
                true,

            reason:
                'RETRY_ELIGIBLE',

            attempts,

            nextAttempt,

            delayMs:
                this.calculateRetryDelay(
                    nextAttempt
                )

        };

    }


    /**
     * =========================================================================
     * Schedule Retry
     * =========================================================================
     */

    async scheduleRetry(
        transaction,
        decision
    ) {

        this.statistics.retries++;


        this.statistics.retryScheduled++;


        this.incrementMetric(
            'transaction_recovery_retry_total'
        );


        const retryAt =
            new Date(

                Date.now() +
                decision.delayMs

            );


        const metadata = {

            owner:
                this.instanceId,

            retryAttempt:
                decision.nextAttempt,

            retryAt,

            retryDelayMs:
                decision.delayMs

        };


        if (
            typeof this.repository.scheduleRetry ===
            'function'
        ) {

            await this.repository.scheduleRetry(

                transaction.transactionId,

                metadata

            );

        }

        else {

            await this.repository.updateState(

                transaction.transactionId,

                STATES.RETRYING,

                metadata

            );

        }


        this.logInfo(
            'Transaction recovery retry scheduled',
            {

                transactionId:
                    transaction.transactionId,

                retryAttempt:
                    decision.nextAttempt,

                retryAt:
                    retryAt.toISOString(),

                retryDelayMs:
                    decision.delayMs

            }
        );


        this.emit(
            'retryScheduled',
            transaction,
            metadata
        );


        return metadata;

    }


    /**
     * =========================================================================
     * Compensate Transaction
     * =========================================================================
     */

    async compensate(
        transaction,
        compensation
    ) {

        if (
            typeof compensation !==
            'function'
        ) {

            throw new TypeError(
                'Transaction compensation must be a function.'
            );

        }


        if (
            TERMINAL_STATES.has(
                transaction.state
            )
        ) {

            return {

                compensated:
                    false,

                skipped:
                    true,

                reason:
                    'TERMINAL_STATE'

            };

        }


        this.statistics.compensations++;


        const context =
            this.createRecoveryContext(
                transaction
            );


        try {

            await this.executeHandler(

                compensation,

                transaction,

                context

            );


            await this.transitionState(

                transaction,

                STATES.ROLLED_BACK
            );


            this.incrementMetric(
                'transaction_recovery_compensation_success_total'
            );


            await this.publishRecoveryAudit(

                transaction,

                context,

                {

                    compensation:
                        true

                }

            );


            this.emit(
                'compensated',
                transaction
            );


            return {

                compensated:
                    true

            };

        }

        catch (error) {

            this.incrementMetric(
                'transaction_recovery_compensation_failure_total'
            );


            this.logError(
                'Transaction compensation failed',
                error,
                context
            );


            throw error;

        }

    }


    /**
     * =========================================================================
     * Transition State
     * =========================================================================
     */

    async transitionState(
        transaction,
        nextState,
        metadata = {}
    ) {

        this.validateStateTransition(

            transaction.state,

            nextState

        );


        if (
            typeof this.repository.updateState !==
            'function'
        ) {

            return;

        }


        await this.repository.updateState(

            transaction.transactionId,

            nextState,

            {

                ...metadata,

                updatedAt:
                    new Date(),

                recoveryOwner:
                    this.instanceId

            }

        );


        transaction.state =
            nextState;

    }


    /**
     * =========================================================================
     * State Transition Validation
     * =========================================================================
     */

    validateStateTransition(
        currentState,
        nextState
    ) {

        if (
            currentState ===
            nextState
        ) {

            return true;

        }


        if (
            TERMINAL_STATES.has(
                currentState
            )
        ) {

            throw new Error(

                `Invalid transaction state transition: ` +
                `${currentState} -> ${nextState}`

            );

        }


        return true;

    }


    /**
     * =========================================================================
     * Dead Letter
     * =========================================================================
     */

    async sendToDeadLetter(
        transaction,
        error
    ) {

        this.statistics.deadLetters++;


        this.incrementMetric(
            'transaction_recovery_dead_letter_total'
        );


        const payload = {

            id:
                this.createDeadLetterId(
                    transaction
                ),

            transactionId:
                transaction.transactionId,

            tenantId:
                transaction.tenantId ||
                null,

            state:
                transaction.state,

            transaction,

            error:
                this.normalizeError(
                    error
                ),

            attempts:
                this.getRetryAttempts(
                    transaction
                ),

            instanceId:
                this.instanceId,

            timestamp:
                new Date(),

            reason:
                'RECOVERY_EXHAUSTED'

        };


        if (
            this.deadLetterQueue?.enqueue
        ) {

            await this.deadLetterQueue.enqueue(
                payload
            );

        }


        if (
            typeof this.repository.markDeadLettered ===
            'function'
        ) {

            await this.repository.markDeadLettered(

                transaction.transactionId,

                {

                    deadLetterId:
                        payload.id,

                    reason:
                        payload.reason,

                    error:
                        payload.error,

                    timestamp:
                        payload.timestamp

                }

            );

        }

        else if (
            typeof this.repository.updateState ===
            'function'
        ) {

            await this.repository.updateState(

                transaction.transactionId,

                STATES.DEAD_LETTERED,

                {

                    deadLetterId:
                        payload.id,

                    reason:
                        payload.reason,

                    error:
                        payload.error,

                    timestamp:
                        payload.timestamp

                }

            );

        }


        this.emit(
            'deadLettered',
            transaction,
            payload
        );


        return payload;

    }


    /**
     * =========================================================================
     * Recover Single Transaction
     * =========================================================================
     */

    async recoverById(
        transactionId
    ) {

        if (
            !transactionId
        ) {

            throw new TypeError(
                'transactionId is required.'
            );

        }


        const transaction =
            await this.repository.findByTransactionId(

                transactionId

            );


        if (!transaction) {

            throw new Error(
                `Transaction not found: ${transactionId}`
            );

        }


        return this.recover(
            transaction
        );

    }


    /**
     * =========================================================================
     * Crash Recovery
     * =========================================================================
     */

    async recoverAfterRestart() {

        this.logInfo(
            'Starting transaction crash recovery',
            {

                instanceId:
                    this.instanceId

            }
        );


        this.incrementMetric(
            'transaction_recovery_crash_recovery_total'
        );


        return this.scan();

    }


    /**
     * =========================================================================
     * Recovery Context
     * =========================================================================
     */

    createRecoveryContext(
        transaction,
        lease = null
    ) {

        return {

            recoveryId:
                this.createRecoveryId(
                    transaction
                ),

            transactionId:
                transaction.transactionId,

            tenantId:
                transaction.tenantId ||
                null,

            state:
                transaction.state,

            provider:
                transaction.provider ||
                transaction.providerId ||
                null,

            recoveryOwner:
                this.instanceId,

            lease,

            attempt:
                this.getRetryAttempts(
                    transaction
                ),

            timestamp:
                new Date()

        };

    }


    /**
     * =========================================================================
     * Recovery Attempt Persistence
     * =========================================================================
     */

    async recordRecoveryAttempt(
        transaction,
        context
    ) {

        if (
            typeof this.repository.recordRecoveryAttempt ===
            'function'
        ) {

            await this.repository.recordRecoveryAttempt(

                transaction.transactionId,

                {

                    recoveryId:
                        context.recoveryId,

                    owner:
                        this.instanceId,

                    attempt:
                        context.attempt,

                    state:
                        transaction.state,

                    timestamp:
                        new Date()

                }

            );

        }

    }


    /**
     * =========================================================================
     * Recovery Success Persistence
     * =========================================================================
     */

    async recordRecoverySuccess(
        transaction,
        context,
        result
    ) {

        if (
            typeof this.repository.recordRecoveryHistory ===
            'function'
        ) {

            await this.repository.recordRecoveryHistory(

                transaction.transactionId,

                {

                    recoveryId:
                        context.recoveryId,

                    status:
                        'SUCCESS',

                    state:
                        transaction.state,

                    owner:
                        this.instanceId,

                    result:
                        this.safeMetadata(
                            result
                        ),

                    timestamp:
                        new Date()

                }

            );

        }

    }


    /**
     * =========================================================================
     * Recovery Audit
     * =========================================================================
     */

    async publishRecoveryAudit(
        transaction,
        context,
        result = null
    ) {

        if (
            !this.options.publishAuditEvents ||
            !this.auditPublisher?.publish
        ) {

            return;

        }


        try {

            await this.auditPublisher.publish({

                type:
                    'TRANSACTION_RECOVERED',

                recoveryId:
                    context.recoveryId,

                transactionId:
                    transaction.transactionId,

                tenantId:
                    transaction.tenantId ||
                    null,

                state:
                    transaction.state,

                recoveryOwner:
                    this.instanceId,

                result:
                    this.safeMetadata(
                        result
                    ),

                timestamp:
                    new Date()

            });

        }

        catch (error) {

            this.statistics.auditFailures++;


            this.incrementMetric(
                'transaction_recovery_audit_failure_total'
            );


            this.logWarn(
                'Transaction recovery audit publication failed',
                {

                    transactionId:
                        transaction.transactionId,

                    error:
                        error.message

                }
            );

        }

    }


    /**
     * =========================================================================
     * Recovery Event
     * =========================================================================
     */

    async publishRecoveryEvent(
        transaction,
        context,
        result = null
    ) {

        if (
            !this.options.publishRecoveryEvents ||
            !this.eventBus?.publish
        ) {

            return;

        }


        try {

            await this.eventBus.publish({

                type:
                    'transaction.recovered',

                eventType:
                    'TRANSACTION_RECOVERED',

                transactionId:
                    transaction.transactionId,

                tenantId:
                    transaction.tenantId ||
                    null,

                recoveryId:
                    context.recoveryId,

                state:
                    transaction.state,

                recoveryOwner:
                    this.instanceId,

                payload:
                    this.safeMetadata(
                        result
                    ),

                timestamp:
                    new Date()

            });

        }

        catch (error) {

            this.statistics.eventFailures++;


            this.incrementMetric(
                'transaction_recovery_event_failure_total'
            );


            this.logWarn(
                'Transaction recovery event publication failed',
                {

                    transactionId:
                        transaction.transactionId,

                    error:
                        error.message

                }
            );

        }

    }


    /**
     * =========================================================================
     * Retry Attempts
     * =========================================================================
     */

    getRetryAttempts(
        transaction
    ) {

        return Number(

            transaction.retryAttempts ??
            transaction.attempts ??
            transaction.recoveryAttempts ??
            0

        ) || 0;

    }


    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    calculateRetryDelay(
        attempt
    ) {

        const exponential =
            this.options.retryDelay *
            Math.pow(

                this.options.backoffMultiplier,

                Math.max(
                    0,
                    attempt - 1
                )

            );


        const bounded =
            Math.min(

                exponential,

                this.options.maxRetryDelay

            );


        if (
            !this.options.jitter
        ) {

            return bounded;

        }


        return (

            bounded +
            Math.floor(
                Math.random() *
                Math.max(
                    1,
                    bounded * 0.2
                )
            )

        );

    }


    /**
     * =========================================================================
     * Recovery Identity
     * =========================================================================
     */

    createRecoveryId(
        transaction
    ) {

        return crypto

            .createHash(
                'sha256'
            )

            .update(

                [

                    transaction.transactionId,

                    transaction.state,

                    this.instanceId

                ].join('|')

            )

            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Recovery Key
     * =========================================================================
     */

    createRecoveryKey(
        transaction
    ) {

        return [

            transaction.tenantId ||
                '',

            transaction.transactionId,

            transaction.state

        ].join(':');

    }


    /**
     * =========================================================================
     * Dead-Letter Identity
     * =========================================================================
     */

    createDeadLetterId(
        transaction
    ) {

        return crypto

            .createHash(
                'sha256'
            )

            .update(

                [

                    transaction.tenantId ||
                        '',

                    transaction.transactionId,

                    transaction.state,

                    this.getRetryAttempts(
                        transaction
                    )

                ].join('|')

            )

            .digest(
                'hex'
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
                null,

            status:
                error.status ??
                error.statusCode ??
                null,

            retryable:
                error.retryable ??
                null,

            stack:
                error.stack ||
                null

        };

    }


    /**
     * =========================================================================
     * Safe Metadata
     * =========================================================================
     */

    safeMetadata(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return value;

        }


        if (
            typeof value ===
            'string' ||
            typeof value ===
            'number' ||
            typeof value ===
            'boolean'
        ) {

            return value;

        }


        try {

            return JSON.parse(
                JSON.stringify(
                    value
                )
            );

        }

        catch {

            return {

                value:
                    '[UNSERIALIZABLE]'

            };

        }

    }


    /**
     * =========================================================================
     * Timeout Wrapper
     * =========================================================================
     */

    withTimeout(
        promise,
        timeout,
        onTimeout
    ) {

        let timer =
            null;


        const timeoutPromise =
            new Promise(

                (_, reject) => {

                    timer =
                        setTimeout(

                            () => {

                                try {

                                    reject(
                                        onTimeout()
                                    );

                                }

                                catch (error) {

                                    reject(
                                        error
                                    );

                                }

                            },

                            timeout

                        );

                }

            );


        return Promise.race(

            [

                promise,

                timeoutPromise

            ]

        ).finally(

            () => {

                if (timer) {

                    clearTimeout(
                        timer
                    );

                }

            }

        );

    }


    /**
     * =========================================================================
     * Wait for Active Recoveries
     * =========================================================================
     */

    async waitForActiveRecoveries(
        timeout
    ) {

        const started =
            Date.now();


        while (
            this.activeRecoveries.size > 0
        ) {

            if (
                Date.now() -
                started >=
                timeout
            ) {

                throw new Error(
                    'Timed out waiting for active transaction recoveries.'
                );

            }


            await this.sleep(
                100
            );

        }

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        milliseconds
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );

    }


    /**
     * =========================================================================
     * OpenTelemetry Span
     * =========================================================================
     */

    startSpan(
        name
    ) {

        try {

            if (
                typeof this.tracer?.startSpan !==
                'function'
            ) {

                return null;

            }


            return this.tracer.startSpan(
                name
            );

        }

        catch {

            return null;

        }

    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {

        try {

            if (
                typeof this.metrics?.increment ===
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
                typeof this.metrics?.inc ===
                'function'
            ) {

                this.metrics.inc(

                    name,

                    value,

                    labels

                );

            }

        }

        catch {

            // Metrics must never break transaction recovery.

        }

    }


    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    logInfo(
        message,
        context = {}
    ) {

        try {

            this.logger.info?.(
                message,
                context
            );

        }

        catch {

            // Logging must never break transaction recovery.

        }

    }


    logWarn(
        message,
        context = {}
    ) {

        try {

            this.logger.warn?.(
                message,
                context
            );

        }

        catch {

            // Logging must never break transaction recovery.

        }

    }


    logError(
        message,
        error,
        context = {}
    ) {

        try {

            this.logger.error?.(

                message,

                {

                    ...context,

                    error:
                        this.normalizeError(
                            error
                        )

                }

            );

        }

        catch {

            // Logging must never break transaction recovery.

        }

    }


    /**
     * =========================================================================
     * Repository Capability Validation
     * =========================================================================
     */

    validateRepositoryCapabilities() {

        if (
            typeof this.repository.list !==
            'function'
        ) {

            throw new Error(
                'TransactionRecoveryManager requires repository.list().'
            );

        }


        if (
            typeof this.repository.findByTransactionId !==
            'function'
        ) {

            throw new Error(
                'TransactionRecoveryManager requires repository.findByTransactionId().'
            );

        }

    }


    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            instanceId:
                this.instanceId,

            ...this.options,

            registeredHandlers:
                this.recoveryHandlers.size,

            activeRecoveries:
                this.activeRecoveries.size

        };

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    getStatistics() {

        return {

            ...this.statistics,

            running:
                this.running,

            scanning:
                this.scanning,

            stopping:
                this.stopping,

            registeredHandlers:
                this.recoveryHandlers.size,

            activeRecoveries:
                this.activeRecoveries.size,

            instanceId:
                this.instanceId,

            interval:
                this.options.interval,

            stuckTimeout:
                this.options.stuckTimeout,

            batchSize:
                this.options.batchSize,

            maxRetries:
                this.options.maxRetries

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    getHealth() {

        const healthy =
            Boolean(
                this.repository
            );


        return {

            status:
                healthy &&
                !this.stopping
                    ? 'UP'
                    : 'DOWN',

            instanceId:
                this.instanceId,

            running:
                this.running,

            scanning:
                this.scanning,

            activeRecoveries:
                this.activeRecoveries.size,

            registeredHandlers:
                this.recoveryHandlers.size,

            repository:
                healthy
                    ? 'AVAILABLE'
                    : 'UNAVAILABLE',

            statistics:
                this.getStatistics()

        };

    }


    /**
     * =========================================================================
     * Reset Statistics
     * =========================================================================
     */

    resetStatistics() {

        this.statistics =
            this.createStatistics();

    }


    /**
     * =========================================================================
     * Utility Normalizers
     * =========================================================================
     */

    normalizePositiveInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);


        if (
            !Number.isInteger(number) ||
            number <= 0
        ) {

            return fallback;

        }


        return number;

    }


    normalizeNonNegativeInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);


        if (
            !Number.isInteger(number) ||
            number < 0
        ) {

            return fallback;

        }


        return number;

    }


    normalizeMultiplier(
        value,
        fallback
    ) {

        const number =
            Number(value);


        if (
            !Number.isFinite(number) ||
            number < 1
        ) {

            return fallback;

        }


        return number;

    }

}


/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

TransactionRecoveryManager.States =
    STATES;


TransactionRecoveryManager.RecoverableStates =
    RECOVERABLE_STATES;


TransactionRecoveryManager.TerminalStates =
    Object.freeze(
        Array.from(
            TERMINAL_STATES
        )
    );


/**
 * ============================================================================
 * Module Export
 * ============================================================================
 */

module.exports =
    TransactionRecoveryManager;