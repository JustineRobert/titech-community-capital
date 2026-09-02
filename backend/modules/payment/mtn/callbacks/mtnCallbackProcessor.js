'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Processor
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackProcessor.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Orchestrates the MTN callback lifecycle without implementing ledger
 * accounting itself.
 *
 * Financial boundary:
 *
 * Callback Processor
 *       |
 *       +--> idempotency ownership
 *       |
 *       +--> transaction correlation
 *       |
 *       +--> callback state transition
 *       |
 *       +--> successful transaction handoff
 *       |
 *       +--> failed transaction handoff
 *       |
 *       +--> retry classification
 *       |
 *       +--> dead-letter escalation
 *       |
 *       +--> audit / observability
 *
 * The existing MTN payment service / Finance Core remains responsible for
 * actual financial execution and ledger posting.
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Verify ownership before completing processing.
 * - Never mark idempotency complete before all required processing succeeds.
 * - Never allow audit or DLQ infrastructure failures to hide the original
 *   payment-processing error.
 * - Prefer explicit callback state transitions.
 * - Preserve tenant / request / correlation context.
 * - Treat duplicate delivery as an expected distributed-systems condition.
 * - Prevent stale workers from completing newer callback attempts.
 * - Keep provider-specific status mapping outside core financial logic where
 *   possible.
 *
 * ============================================================================
 */

const {
    MTNCallbackProcessingError,
} = require('./mtnCallbackErrors');

/**
 * ============================================================================
 * Callback States
 * ============================================================================
 *
 * Kept backward-compatible with the original processor.
 * ============================================================================
 */

const CALLBACK_STATE = Object.freeze({

    RECEIVED:
        'RECEIVED',

    VALIDATED:
        'VALIDATED',

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    RETRY_PENDING:
        'RETRY_PENDING',

    DEAD_LETTERED:
        'DEAD_LETTERED',

});

/**
 * ============================================================================
 * Provider Result States
 * ============================================================================
 */

const PROVIDER_STATUS = Object.freeze({

    SUCCESSFUL:
        'SUCCESSFUL',

    FAILED:
        'FAILED',

    SUCCESS:
        'SUCCESS',

    FAILURE:
        'FAILURE',

    UNKNOWN:
        'UNKNOWN',

});

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_MAX_ATTEMPTS = 5;

const DEFAULT_ATTEMPT = 1;

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_HEARTBEAT_MS =
    60 * 1000;

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}

function normalizeAttempt(value) {

    const attempt =
        Number(value);

    if (
        Number.isSafeInteger(
            attempt
        ) &&
        attempt >= 1
    ) {
        return attempt;
    }

    return DEFAULT_ATTEMPT;
}

function normalizeMaxAttempts(value) {

    const attempts =
        Number(value);

    if (
        Number.isSafeInteger(
            attempts
        ) &&
        attempts > 0 &&
        attempts <= 100000
    ) {
        return attempts;
    }

    return DEFAULT_MAX_ATTEMPTS;
}

function normalizeLeaseMs(value) {

    const lease =
        Number(value);

    if (
        Number.isFinite(lease) &&
        lease > 0
    ) {
        return lease;
    }

    return DEFAULT_LEASE_MS;
}

function normalizeHeartbeatMs(
    heartbeatMs,
    leaseMs
) {

    const heartbeat =
        Number(heartbeatMs);

    if (
        Number.isFinite(heartbeat) &&
        heartbeat > 0 &&
        heartbeat < leaseMs
    ) {
        return heartbeat;
    }

    return Math.min(
        DEFAULT_HEARTBEAT_MS,
        Math.max(
            Math.floor(
                leaseMs / 3
            ),
            1000
        )
    );
}

function normalizeStatus(status) {

    if (
        typeof status !== 'string'
    ) {
        return PROVIDER_STATUS.UNKNOWN;
    }

    return status
        .trim()
        .toUpperCase();
}

function isSuccessfulStatus(
    status
) {

    const normalized =
        normalizeStatus(
            status
        );

    return (
        normalized ===
            PROVIDER_STATUS.SUCCESSFUL ||
        normalized ===
            PROVIDER_STATUS.SUCCESS
    );
}

function isFailedStatus(status) {

    const normalized =
        normalizeStatus(
            status
        );

    return (
        normalized ===
            PROVIDER_STATUS.FAILED ||
        normalized ===
            PROVIDER_STATUS.FAILURE
    );
}

function safeId(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    if (
        typeof value === 'string'
    ) {
        return value;
    }

    if (
        typeof value === 'number'
    ) {
        return String(value);
    }

    if (
        typeof value.toString ===
        'function'
    ) {
        return value.toString();
    }

    return null;
}

/**
 * ============================================================================
 * Constructor
 * ============================================================================
 */

class MTNCallbackProcessor {

    constructor(options = {}) {

        this.logger =
            options.logger ||
            console;

        /**
         * Idempotency coordinator.
         *
         * Preferred production contract:
         *
         * reserve()
         * start()
         * heartbeat()
         * complete()
         * fail()
         * release()
         *
         * Backward compatibility:
         * reserve() / complete() / fail() remain supported.
         */

        this.idempotency =
            options.idempotency ||
            null;

        this.deadLetter =
            options.deadLetter ||
            null;

        this.transactionResolver =
            options.transactionResolver ||
            null;

        this.stateHandler =
            options.stateHandler ||
            null;

        this.successHandler =
            options.successHandler ||
            null;

        this.failureHandler =
            options.failureHandler ||
            null;

        this.audit =
            options.audit ||
            null;

        this.maxAttempts =
            normalizeMaxAttempts(
                options.maxAttempts
            );

        this.leaseMs =
            normalizeLeaseMs(
                options.leaseMs
            );

        this.heartbeatMs =
            normalizeHeartbeatMs(
                options.heartbeatMs,
                this.leaseMs
            );

        /**
         * Optional provider-specific status resolver.
         *
         * Allows MTN status semantics to evolve without embedding them into
         * the processor.
         */

        this.statusResolver =
            typeof options.statusResolver ===
            'function'
                ? options.statusResolver
                : null;

        /**
         * Strict mode prevents a successful callback from being considered
         * processed when there is no actual downstream handoff.
         *
         * Existing deployments can deliberately disable this if their
         * stateHandler itself performs the financial handoff.
         */

        this.requireSuccessHandler =
            options.requireSuccessHandler !==
                undefined
                ? Boolean(
                    options.requireSuccessHandler
                )
                : false;

        this.requireFailureHandler =
            options.requireFailureHandler !==
                undefined
                ? Boolean(
                    options.requireFailureHandler
                )
                : false;

        /**
         * Runtime operational counters.
         *
         * These are process-local diagnostics only.
         */

        this.statistics = {

            processed: 0,

            duplicates: 0,

            failures: 0,

            deadLettered: 0,

            ownershipLost: 0,

            auditFailures: 0,

            deadLetterFailures: 0,

            idempotencyFailures: 0,

        };

        /**
         * Export state constants for consumers.
         */

        this.STATE =
            CALLBACK_STATE;

        Object.freeze(
            this.statistics
        );
    }

    /**
     * =========================================================================
     * Validate Callback
     * =========================================================================
     */

    validateCallback(
        callback
    ) {

        if (
            !callback ||
            !isObject(callback)
        ) {
            throw new MTNCallbackProcessingError(
                'Callback is required.',
                {
                    code:
                        'MTN_CALLBACK_REQUIRED',
                }
            );
        }

        if (
            !callback.callbackId
        ) {
            throw new MTNCallbackProcessingError(
                'Callback ID is required.',
                {
                    code:
                        'MTN_CALLBACK_ID_REQUIRED',
                }
            );
        }

        if (
            !callback.idempotencyKey
        ) {
            throw new MTNCallbackProcessingError(
                'Callback idempotency key is required.',
                {
                    code:
                        'MTN_CALLBACK_IDEMPOTENCY_KEY_REQUIRED',
                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Resolve Provider Result
     * =========================================================================
     */

    resolveResult(
        callback,
        context
    ) {

        if (
            this.statusResolver
        ) {

            return this.statusResolver(
                callback,
                context
            );

        }

        const status =
            normalizeStatus(
                callback.status
            );

        if (
            isSuccessfulStatus(
                status
            )
        ) {

            return {
                type:
                    'SUCCESS',

                status,

                successful:
                    true,

                failed:
                    false,
            };
        }

        if (
            isFailedStatus(
                status
            )
        ) {

            return {
                type:
                    'FAILED',

                status,

                successful:
                    false,

                failed:
                    true,
            };
        }

        return {
            type:
                'UNKNOWN',

            status,

            successful:
                false,

            failed:
                false,
        };
    }

    /**
     * =========================================================================
     * Process
     * =========================================================================
     */

    async process(
        callback,
        context = {}
    ) {

        this.validateCallback(
            callback
        );

        const normalizedContext =
            this.normalizeContext(
                callback,
                context
            );

        const result =
            this.resolveResult(
                callback,
                normalizedContext
            );

        let reservation = null;

        let heartbeatTimer =
            null;

        let transaction =
            null;

        let processingStarted =
            false;

        try {

            /**
             * ---------------------------------------------------------------
             * IDEMPOTENCY RESERVATION
             * ---------------------------------------------------------------
             */

            reservation =
                await this.reserveOwnership(
                    callback,
                    normalizedContext
                );

            /**
             * Duplicate delivery is a successful API-level outcome.
             *
             * It does NOT mean this worker processed the callback.
             */

            if (
                reservation?.duplicate ||
                reservation?.alreadyCompleted
            ) {

                this.statistics.duplicates++;

                await this.transitionStateSafely(
                    callback,
                    CALLBACK_STATE.COMPLETED,
                    normalizedContext,
                    {
                        duplicate:
                            true,
                    }
                );

                await this.auditEvent(
                    'CALLBACK_DUPLICATE',
                    {
                        callback:
                            this.buildAuditCallback(
                                callback
                            ),

                        reservation:
                            this.buildSafeReservation(
                                reservation
                            ),

                        context:
                            this.buildAuditContext(
                                normalizedContext
                            ),
                    }
                );

                return this.buildDuplicateResult(
                    callback,
                    reservation
                );
            }

            /**
             * ---------------------------------------------------------------
             * PROCESSING OWNERSHIP TOKEN
             * ---------------------------------------------------------------
             *
             * The reservation may expose:
             *
             * claimToken / token / leaseToken
             *
             * The exact value is preserved and forwarded unchanged.
             */

            const claimToken =
                reservation?.claimToken ||
                reservation?.token ||
                reservation?.leaseToken ||
                null;

            const ownedContext =
                {
                    ...normalizedContext,

                    claimToken,

                    reservation,
                };

            /**
             * ---------------------------------------------------------------
             * Start ownership lifecycle
             * ---------------------------------------------------------------
             */

            await this.startOwnership(
                callback,
                ownedContext
            );

            /**
             * ---------------------------------------------------------------
             * Begin heartbeat for long-running processing.
             * ---------------------------------------------------------------
             */

            heartbeatTimer =
                this.startHeartbeat(
                    callback,
                    ownedContext
                );

            /**
             * ---------------------------------------------------------------
             * TRANSACTION CORRELATION
             * ---------------------------------------------------------------
             */

            if (
                this.transactionResolver
            ) {

                transaction =
                    await this.transactionResolver(
                        callback,
                        ownedContext
                    );

            }

            /**
             * ---------------------------------------------------------------
             * STATE TRANSITION / VALIDATED HANDOFF
             * ---------------------------------------------------------------
             */

            await this.transitionState(
                callback,
                CALLBACK_STATE.VALIDATED,
                ownedContext,
                {
                    transaction,
                }
            );

            /**
             * ---------------------------------------------------------------
             * PROCESSING STATE
             * ---------------------------------------------------------------
             */

            await this.transitionState(
                callback,
                CALLBACK_STATE.PROCESSING,
                ownedContext,
                {
                    transaction,
                }
            );

            processingStarted =
                true;

            /**
             * ---------------------------------------------------------------
             * SUCCESSFUL PAYMENT HANDOFF
             * ---------------------------------------------------------------
             */

            if (
                result.successful
            ) {

                if (
                    this.requireSuccessHandler &&
                    typeof this.successHandler !==
                        'function'
                ) {

                    throw this.processingError(
                        'MTN_SUCCESS_HANDLER_REQUIRED',
                        'Successful MTN callback requires a success handler.',
                        callback,
                        {
                            retryable:
                                false,
                        }
                    );
                }

                if (
                    this.successHandler
                ) {

                    await this.successHandler(
                        callback,
                        transaction,
                        ownedContext
                    );

                }

            }

            /**
             * ---------------------------------------------------------------
             * FAILED PAYMENT HANDOFF
             * ---------------------------------------------------------------
             */

            if (
                result.failed
            ) {

                if (
                    this.requireFailureHandler &&
                    typeof this.failureHandler !==
                        'function'
                ) {

                    throw this.processingError(
                        'MTN_FAILURE_HANDLER_REQUIRED',
                        'Failed MTN callback requires a failure handler.',
                        callback,
                        {
                            retryable:
                                false,
                        }
                    );
                }

                if (
                    this.failureHandler
                ) {

                    await this.failureHandler(
                        callback,
                        transaction,
                        ownedContext
                    );

                }

            }

            /**
             * ---------------------------------------------------------------
             * UNKNOWN PROVIDER STATUS
             * ---------------------------------------------------------------
             */

            if (
                !result.successful &&
                !result.failed
            ) {

                throw this.processingError(
                    'MTN_CALLBACK_UNKNOWN_STATUS',
                    `Unsupported MTN callback status: ${result.status}`,
                    callback,
                    {
                        retryable:
                            false,
                    }
                );

            }

            /**
             * ---------------------------------------------------------------
             * CALLBACK STATE COMPLETION
             * ---------------------------------------------------------------
             */

            await this.transitionState(
                callback,
                CALLBACK_STATE.COMPLETED,
                ownedContext,
                {
                    transaction,

                    result,
                }
            );

            /**
             * ---------------------------------------------------------------
             * IDEMPOTENCY COMPLETE
             * ---------------------------------------------------------------
             *
             * COMPLETE is intentionally AFTER:
             *
             * - transaction resolution
             * - state handoff
             * - successful / failed handoff
             * - callback state completion
             *
             * If complete() fails, we do NOT falsely report success.
             * ---------------------------------------------------------------
             */

            await this.completeOwnership(
                callback,
                ownedContext,
                {
                    processedAt:
                        new Date(),

                    finalStatus:
                        callback.status,

                    transactionId:
                        safeId(
                            transaction?._id ||
                            transaction?.id
                        ),
                }
            );

            this.statistics.processed++;

            await this.auditEvent(
                'CALLBACK_PROCESSED',
                {
                    callback:
                        this.buildAuditCallback(
                            callback
                        ),

                    transactionId:
                        safeId(
                            transaction?._id ||
                            transaction?.id
                        ),

                    context:
                        this.buildAuditContext(
                            ownedContext
                        ),

                    status:
                        callback.status,
                }
            );

            return {
                success:
                    true,

                processed:
                    true,

                duplicate:
                    false,

                callbackId:
                    callback.callbackId,

                reference:
                    callback.reference ||
                    null,

                providerReference:
                    callback.providerReference ||
                    null,

                status:
                    callback.status,

                transactionId:
                    safeId(
                        transaction?._id ||
                        transaction?.id
                    ),

                correlationId:
                    ownedContext.correlationId ||
                    null,
            };

        } catch (error) {

            this.statistics.failures++;

            const normalized =
                this.normalizeError(
                    error,
                    callback
                );

            /**
             * ---------------------------------------------------------------
             * Stop heartbeat BEFORE recovery actions.
             * ---------------------------------------------------------------
             */

            this.stopHeartbeat(
                heartbeatTimer
            );

            heartbeatTimer =
                null;

            /**
             * ---------------------------------------------------------------
             * IDEMPOTENCY FAILURE
             * ---------------------------------------------------------------
             *
             * A failure to record the processing failure is operationally
             * important, but MUST NOT replace the original error.
             * ---------------------------------------------------------------
             */

            await this.failOwnershipSafely(
                callback,
                normalized,
                normalizedContext
            );

            /**
             * ---------------------------------------------------------------
             * CALLBACK FAILURE STATE
             * ---------------------------------------------------------------
             */

            await this.transitionFailureStateSafely(
                callback,
                normalized,
                normalizedContext,
                {
                    processingStarted,
                }
            );

            /**
             * ---------------------------------------------------------------
             * AUDIT
             * ---------------------------------------------------------------
             */

            await this.auditEvent(
                'CALLBACK_PROCESSING_FAILED',
                {
                    callback:
                        this.buildAuditCallback(
                            callback
                        ),

                    error: {
                        code:
                            normalized.code,

                        message:
                            normalized.message,

                        retryable:
                            normalized.retryable,
                    },

                    context:
                        this.buildAuditContext(
                            normalizedContext
                        ),
                }
            );

            /**
             * ---------------------------------------------------------------
             * RETRY / DLQ
             * ---------------------------------------------------------------
             */

            const attempt =
                normalizedContext.attempt;

            const exhausted =
                attempt >=
                this.maxAttempts;

            const shouldDeadLetter =
                exhausted ||
                normalized.retryable ===
                    false;

            if (
                shouldDeadLetter
            ) {

                await this.enqueueDeadLetterSafely(
                    callback,
                    normalized,
                    normalizedContext,
                    {
                        attempt,

                        exhausted,
                    }
                );

                await this.transitionDeadLetterStateSafely(
                    callback,
                    normalizedContext
                );
            }

            throw normalized;

        } finally {

            this.stopHeartbeat(
                heartbeatTimer
            );

        }
    }

    /**
     * =========================================================================
     * Context Normalization
     * =========================================================================
     */

    normalizeContext(
        callback,
        context
    ) {

        const attempt =
            normalizeAttempt(
                context.attempt
            );

        const leaseMs =
            normalizeLeaseMs(
                context.leaseMs ||
                this.leaseMs
            );

        const heartbeatMs =
            normalizeHeartbeatMs(
                context.heartbeatMs ||
                this.heartbeatMs,
                leaseMs
            );

        return {
            ...context,

            attempt,

            leaseMs,

            heartbeatMs,

            requestId:
                context.requestId ||
                callback.requestId ||
                null,

            correlationId:
                context.correlationId ||
                callback.correlationId ||
                context.requestId ||
                callback.requestId ||
                null,

            tenantId:
                context.tenantId ||
                callback.tenantId ||
                null,
        };
    }

    /**
     * =========================================================================
     * Idempotency Reservation
     * =========================================================================
     */

    async reserveOwnership(
        callback,
        context
    ) {

        if (
            !this.idempotency
        ) {

            /**
             * Explicitly operate without a reservation only when no
             * coordinator was injected.
             *
             * Production wiring should always inject one.
             */

            this.logger.warn?.({
                event:
                    'payment.mtn.callback.idempotency_unavailable',

                callbackId:
                    callback.callbackId,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,
            });

            return {
                reserved:
                    false,

                claimToken:
                    null,
            };
        }

        if (
            typeof this.idempotency.reserve !==
            'function'
        ) {

            throw this.processingError(
                'MTN_CALLBACK_IDEMPOTENCY_RESERVE_UNAVAILABLE',
                'Callback idempotency reservation is unavailable.',
                callback,
                {
                    retryable:
                        true,
                }
            );

        }

        try {

            return await this.idempotency.reserve(
                callback,
                {
                    attempt:
                        context.attempt,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    tenantId:
                        context.tenantId,

                    leaseMs:
                        context.leaseMs,
                }
            );

        } catch (error) {

            this.statistics.idempotencyFailures++;

            throw this.processingError(
                'MTN_CALLBACK_IDEMPOTENCY_RESERVE_FAILED',
                error?.message ||
                    'Unable to reserve callback processing ownership.',
                callback,
                {
                    retryable:
                        error?.retryable !==
                            undefined
                            ? Boolean(
                                error.retryable
                            )
                            : true,

                    cause:
                        error,
                }
            );
        }
    }

    /**
     * =========================================================================
     * Start Ownership
     * =========================================================================
     */

    async startOwnership(
        callback,
        context
    ) {

        if (
            !this.idempotency ||
            typeof this.idempotency.start !==
                'function'
        ) {

            return;

        }

        await this.idempotency.start(
            callback,
            {
                claimToken:
                    context.claimToken,

                tenantId:
                    context.tenantId,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,

                leaseMs:
                    context.leaseMs,
            }
        );
    }

    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    startHeartbeat(
        callback,
        context
    ) {

        if (
            !this.idempotency ||
            typeof this.idempotency.heartbeat !==
                'function'
        ) {

            return null;

        }

        const timer =
            setInterval(
                async () => {

                    try {

                        await this.idempotency.heartbeat(
                            callback,
                            {
                                claimToken:
                                    context.claimToken,

                                tenantId:
                                    context.tenantId,

                                requestId:
                                    context.requestId,

                                correlationId:
                                    context.correlationId,

                                leaseMs:
                                    context.leaseMs,
                            }
                        );

                    } catch (error) {

                        /**
                         * Heartbeat loss is serious.
                         *
                         * Do not throw from setInterval because it would
                         * escape the process() promise. Instead log the loss.
                         * The eventual complete() call will fail ownership if
                         * another worker has reclaimed the operation.
                         */

                        this.logger.error?.({
                            event:
                                'payment.mtn.callback.heartbeat_failed',

                            callbackId:
                                callback.callbackId,

                            requestId:
                                context.requestId,

                            correlationId:
                                context.correlationId,

                            error:
                                error?.message,
                        });

                    }

                },
                context.heartbeatMs
            );

        /**
         * Do not keep Node alive solely because of heartbeat.
         */
        timer.unref?.();

        return timer;
    }

    stopHeartbeat(
        timer
    ) {

        if (
            timer
        ) {

            clearInterval(
                timer
            );

        }
    }

    /**
     * =========================================================================
     * Complete Ownership
     * =========================================================================
     */

    async completeOwnership(
        callback,
        context,
        result
    ) {

        if (
            !this.idempotency
        ) {

            return;

        }

        if (
            typeof this.idempotency.complete !==
            'function'
        ) {

            throw this.processingError(
                'MTN_CALLBACK_IDEMPOTENCY_COMPLETE_UNAVAILABLE',
                'Callback idempotency completion is unavailable.',
                callback,
                {
                    retryable:
                        true,
                }
            );

        }

        try {

            await this.idempotency.complete(
                callback,
                {
                    ...result,

                    claimToken:
                        context.claimToken,

                    tenantId:
                        context.tenantId,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,
                }
            );

        } catch (error) {

            this.statistics.ownershipLost++;

            throw this.processingError(
                'MTN_CALLBACK_IDEMPOTENCY_COMPLETE_FAILED',
                error?.message ||
                    'Callback ownership could not be completed.',
                callback,
                {
                    retryable:
                        error?.retryable !==
                            undefined
                            ? Boolean(
                                error.retryable
                            )
                            : true,

                    cause:
                        error,
                }
            );
        }
    }

    /**
     * =========================================================================
     * Fail Ownership
     * =========================================================================
     */

    async failOwnershipSafely(
        callback,
        error,
        context
    ) {

        if (
            !this.idempotency ||
            typeof this.idempotency.fail !==
                'function'
        ) {

            return;

        }

        try {

            await this.idempotency.fail(
                callback,
                {
                    error:
                        error.message,

                    code:
                        error.code,

                    retryable:
                        error.retryable,

                    claimToken:
                        context.claimToken,

                    tenantId:
                        context.tenantId,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,
                }
            );

        } catch (failureError) {

            this.statistics.idempotencyFailures++;

            this.logger.error?.({
                event:
                    'payment.mtn.callback.idempotency_fail_failed',

                callbackId:
                    callback.callbackId,

                error:
                    failureError?.message,
            });

        }
    }

    /**
     * =========================================================================
     * State Transition
     * =========================================================================
     */

    async transitionState(
        callback,
        state,
        context,
        payload = {}
    ) {

        if (
            typeof this.stateHandler !==
            'function'
        ) {

            return;

        }

        return this.stateHandler(
            callback,
            {
                ...payload,

                state,
            },
            context
        );
    }

    /**
     * =========================================================================
     * Safe Generic State Transition
     * =========================================================================
     */

    async transitionStateSafely(
        callback,
        state,
        context,
        payload = {}
    ) {

        try {

            await this.transitionState(
                callback,
                state,
                context,
                payload
            );

        } catch (error) {

            this.logger.warn?.({
                event:
                    'payment.mtn.callback.state_transition_failed',

                callbackId:
                    callback.callbackId,

                state,

                error:
                    error?.message,
            });

        }
    }

    /**
     * =========================================================================
     * Failure State
     * =========================================================================
     */

    async transitionFailureStateSafely(
        callback,
        error,
        context,
        {
            processingStarted
        } = {}
    ) {

        try {

            if (
                typeof this.stateHandler !==
                'function'
            ) {

                return;

            }

            await this.stateHandler(
                callback,
                {
                    state:
                        processingStarted
                            ? CALLBACK_STATE.FAILED
                            : CALLBACK_STATE.RETRY_PENDING,

                    error,
                },
                context
            );

        } catch (stateError) {

            this.logger.error?.({
                event:
                    'payment.mtn.callback.failure_state_update_failed',

                callbackId:
                    callback.callbackId,

                error:
                    stateError?.message,
            });

        }
    }

    /**
     * =========================================================================
     * Dead Letter State
     * =========================================================================
     */

    async transitionDeadLetterStateSafely(
        callback,
        context
    ) {

        try {

            if (
                typeof this.stateHandler !==
                'function'
            ) {

                return;

            }

            await this.stateHandler(
                callback,
                {
                    state:
                        CALLBACK_STATE.DEAD_LETTERED,
                },
                context
            );

        } catch (error) {

            this.logger.error?.({
                event:
                    'payment.mtn.callback.dead_letter_state_update_failed',

                callbackId:
                    callback.callbackId,

                error:
                    error?.message,
            });

        }
    }

    /**
     * =========================================================================
     * Dead Letter Queue
     * =========================================================================
     */

    async enqueueDeadLetterSafely(
        callback,
        error,
        context,
        {
            attempt,
            exhausted
        }
    ) {

        if (
            !this.deadLetter ||
            typeof this.deadLetter.enqueue !==
                'function'
        ) {

            this.logger.error?.({
                event:
                    'payment.mtn.callback.dlq_unavailable',

                callbackId:
                    callback.callbackId,

                attempt,

                exhausted,

                error:
                    error.message,
            });

            this.statistics.deadLetterFailures++;

            return;

        }

        try {

            await this.deadLetter.enqueue(
                callback,
                error,
                {
                    attempt,

                    exhausted,

                    tenantId:
                        context.tenantId,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    claimToken:
                        context.claimToken,
                }
            );

            this.statistics.deadLettered++;

        } catch (dlqError) {

            this.statistics.deadLetterFailures++;

            /**
             * Preserve the original processing error.
             */
            this.logger.error?.({
                event:
                    'payment.mtn.callback.dlq_enqueue_failed',

                callbackId:
                    callback.callbackId,

                attempt,

                error:
                    dlqError?.message,
            });

        }
    }

    /**
     * =========================================================================
     * Normalize Processing Error
     * =========================================================================
     */

    normalizeError(
        error,
        callback
    ) {

        if (
            error instanceof
            MTNCallbackProcessingError
        ) {

            return error;

        }

        return new MTNCallbackProcessingError(
            error?.message ||
                'MTN callback processing failed.',
            {
                code:
                    error?.code ||
                    'MTN_CALLBACK_PROCESSING_FAILED',

                reference:
                    callback.reference,

                providerReference:
                    callback.providerReference,

                callbackId:
                    callback.callbackId,

                tenantId:
                    callback.tenantId ||
                    null,

                retryable:
                    error?.retryable !==
                        undefined
                        ? Boolean(
                            error.retryable
                        )
                        : true,

                cause:
                    error,
            }
        );
    }

    /**
     * =========================================================================
     * Build Processing Error
     * =========================================================================
     */

    processingError(
        code,
        message,
        callback,
        options = {}
    ) {

        return new MTNCallbackProcessingError(
            message,
            {
                ...options,

                code,

                reference:
                    callback.reference,

                providerReference:
                    callback.providerReference,

                callbackId:
                    callback.callbackId,
            }
        );
    }

    /**
     * =========================================================================
     * Duplicate Result
     * =========================================================================
     */

    buildDuplicateResult(
        callback,
        reservation
    ) {

        return {
            success:
                true,

            processed:
                false,

            duplicate:
                true,

            callbackId:
                callback.callbackId,

            reference:
                callback.reference ||
                null,

            providerReference:
                callback.providerReference ||
                null,

            status:
                callback.status,

            transactionId:
                safeId(
                    reservation?.transactionId
                ),

            correlationId:
                reservation?.correlationId ||
                callback.correlationId ||
                null,
        };
    }

    /**
     * =========================================================================
     * Safe Reservation Representation
     * =========================================================================
     */

    buildSafeReservation(
        reservation
    ) {

        if (
            !reservation ||
            typeof reservation !==
                'object'
        ) {

            return null;

        }

        return {
            duplicate:
                Boolean(
                    reservation.duplicate
                ),

            alreadyCompleted:
                Boolean(
                    reservation.alreadyCompleted
                ),

            reserved:
                Boolean(
                    reservation.reserved
                ),

            transactionId:
                safeId(
                    reservation.transactionId
                ),

            correlationId:
                reservation.correlationId ||
                null,

            /**
             * Never audit a raw claim token.
             */
        };
    }

    /**
     * =========================================================================
     * Safe Callback Audit Representation
     * =========================================================================
     */

    buildAuditCallback(
        callback
    ) {

        return {
            callbackId:
                callback.callbackId ||
                null,

            reference:
                callback.reference ||
                null,

            providerReference:
                callback.providerReference ||
                null,

            status:
                callback.status ||
                null,

            tenantId:
                callback.tenantId ||
                null,
        };
    }

    /**
     * =========================================================================
     * Safe Audit Context
     * =========================================================================
     */

    buildAuditContext(
        context
    ) {

        return {
            tenantId:
                context?.tenantId ||
                null,

            requestId:
                context?.requestId ||
                null,

            correlationId:
                context?.correlationId ||
                null,

            attempt:
                context?.attempt ||
                DEFAULT_ATTEMPT,
        };
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     *
     * Audit failure never replaces payment failure.
     * =========================================================================
     */

    async auditEvent(
        action,
        payload
    ) {

        try {

            if (
                typeof this.audit ===
                'function'
            ) {

                await this.audit(
                    action,
                    payload
                );

            }

        } catch (error) {

            this.statistics.auditFailures++;

            this.logger.error?.(
                '[MTN_MOMO] callback audit failed',
                {
                    action,

                    error:
                        error?.message,

                    callbackId:
                        payload?.callback
                            ?.callbackId ||
                        null,
                }
            );

        }
    }

    /**
     * =========================================================================
     * Statistics Snapshot
     * =========================================================================
     */

    stats() {

        return {
            processed:
                this.statistics.processed,

            duplicates:
                this.statistics.duplicates,

            failures:
                this.statistics.failures,

            deadLettered:
                this.statistics.deadLettered,

            ownershipLost:
                this.statistics.ownershipLost,

            auditFailures:
                this.statistics.auditFailures,

            deadLetterFailures:
                this.statistics.deadLetterFailures,

            idempotencyFailures:
                this.statistics.idempotencyFailures,
        };
    }
}

/**
 * ============================================================================
 * Public Constants
 * ============================================================================
 */

MTNCallbackProcessor.STATE =
    CALLBACK_STATE;

MTNCallbackProcessor.PROVIDER_STATUS =
    PROVIDER_STATUS;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallbackProcessor;