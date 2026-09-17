'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Callback Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks.js
 *
 * Architectural Role
 * ------------------
 * Public composition root and stable facade for the Airtel Money callback
 * processing subsystem.
 *
 * The facade coordinates the canonical callback pipeline:
 *
 *   Airtel Callback
 *        │
 *        ▼
 *   callbacks.js
 *        │
 *        ├── signatureVerifier
 *        ├── callbackValidator
 *        ├── callbackProcessor
 *        │      ├── stateUpdater
 *        │      ├── ledgerPoster
 *        │      ├── reconciliationMatcher
 *        │      └── deadLetterQueue
 *        │
 *        ├── auditService
 *        └── event/outbox boundary
 *
 * Responsibilities
 * ----------------
 * • Compose the Airtel callback subsystem.
 * • Expose a stable callback processing API.
 * • Validate critical callback dependencies.
 * • Preserve tenant, correlation and operation context.
 * • Delegate signature verification.
 * • Delegate payload validation.
 * • Delegate idempotency/replay processing to the canonical processor.
 * • Delegate transaction state transitions.
 * • Delegate authoritative financial posting.
 * • Delegate reconciliation.
 * • Delegate dead-letter handling.
 * • Emit safe audit and event metadata.
 * • Expose health and diagnostics without sensitive payloads.
 *
 * Does NOT:
 * ----------
 * • Initiate Airtel payments.
 * • Handle OAuth/token lifecycle.
 * • Modify balances directly.
 * • Write ledger entries directly.
 * • Decide settlement independently of the canonical payment pipeline.
 * • Trust a provider callback as proof of successful financial settlement.
 * • Store arbitrary raw callback payloads in logs.
 * • Implement provider cryptographic rules directly.
 *
 * Security Principles
 * -------------------
 * • Signature validation must occur before trusting callback content.
 * • Replay/idempotency protection must be enforced by the processing boundary.
 * • Unauthenticated callback payloads must not be placed in a persistent DLQ
 *   merely because they failed signature validation.
 * • Tenant context must never be inferred from untrusted callback content when
 *   a trusted request context is available.
 * • Raw callback payloads must not be emitted to logs or general events.
 * • Access credentials, signatures and secrets are never returned by health
 *   or diagnostics.
 * • Financial mutation remains delegated to canonical services.
 *
 * Financial Safety
 * ---------------
 * A callback receipt or successful callback HTTP response is NOT equivalent
 * to financial settlement. The downstream processor must validate, correlate,
 * reconcile and perform authoritative financial posting before a transaction
 * becomes financially settled.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const CallbackProcessor =
    require('./callbacks/callbackProcessor');

const CallbackValidator =
    require('./callbacks/callbackValidator');

const SignatureVerifier =
    require('./callbacks/signatureVerifier');

const PaymentStateUpdater =
    require('./callbacks/paymentStateUpdater');

const LedgerPoster =
    require('./callbacks/ledgerPoster');

const ReconciliationMatcher =
    require('./callbacks/reconciliationMatcher');

const CallbackDeadLetterQueue =
    require('./callbacks/callbackDeadLetterQueue');


const PROVIDER = 'AIRTEL';

const CALLBACK_STATUS = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    PROCESSING: 'PROCESSING',
    PROCESSED: 'PROCESSED',
    DUPLICATE: 'DUPLICATE',
    REJECTED: 'REJECTED',
    FAILED: 'FAILED',
    DEGRADED: 'DEGRADED'
});


const MAX_CALLBACK_BYTES = 1024 * 1024;


/**
 * ----------------------------------------------------------------------------
 * Utility helpers
 * ----------------------------------------------------------------------------
 */

function isFunction(value) {
    return typeof value === 'function';
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function generateId() {
    return crypto.randomUUID();
}


function safeString(value, max = 256) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(0, max);
}


function safeError(error) {
    if (!error) {
        return null;
    }

    if (
        isFunction(error.toJSON)
    ) {
        try {
            return error.toJSON();
        } catch (_) {
            // Fall through.
        }
    }

    return {
        name:
            error.name,
        code:
            error.code,
        message:
            error.message
    };
}


/**
 * Header names are normalized without logging their sensitive values.
 */
function normalizeHeaders(headers = {}) {
    if (!isObject(headers)) {
        return {};
    }

    const normalized = {};

    for (
        const [key, value]
        of Object.entries(headers)
    ) {
        normalized[
            String(key).toLowerCase()
        ] = value;
    }

    return normalized;
}


function extractSignature(headers = {}) {
    const normalized =
        normalizeHeaders(headers);

    return (
        normalized['x-airtel-signature'] ||
        normalized['x-signature'] ||
        normalized['signature'] ||
        normalized['x-webhook-signature']
    );
}


function redactHeaders(headers = {}) {
    const normalized =
        normalizeHeaders(headers);

    const sensitive =
        new Set([
            'authorization',
            'proxy-authorization',
            'x-api-key',
            'api-key',
            'x-airtel-signature',
            'x-signature',
            'signature',
            'x-webhook-signature',
            'cookie',
            'set-cookie'
        ]);

    const result = {};

    for (
        const [key, value]
        of Object.entries(normalized)
    ) {
        if (
            sensitive.has(key)
        ) {
            result[key] = '[REDACTED]';
        } else {
            result[key] = value;
        }
    }

    return result;
}


function estimatePayloadBytes(payload) {
    if (
        payload === undefined ||
        payload === null
    ) {
        return 0;
    }

    if (
        Buffer.isBuffer(payload)
    ) {
        return payload.length;
    }

    if (
        typeof payload === 'string'
    ) {
        return Buffer.byteLength(
            payload,
            'utf8'
        );
    }

    try {
        return Buffer.byteLength(
            JSON.stringify(payload),
            'utf8'
        );
    } catch (_) {
        return Number.MAX_SAFE_INTEGER;
    }
}


function hashPayload(payload) {
    const serialized =
        Buffer.isBuffer(payload)
            ? payload
            : typeof payload === 'string'
                ? payload
                : JSON.stringify(
                    payload ?? {}
                );

    return crypto
        .createHash('sha256')
        .update(serialized)
        .digest('hex');
}


function sanitizeResult(result) {
    if (!isObject(result)) {
        return result;
    }

    const sensitiveKeys =
        new Set([
            'payload',
            'raw',
            'rawPayload',
            'requestBody',
            'responseBody',
            'secret',
            'signature',
            'accessToken',
            'refreshToken',
            'clientSecret',
            'apiKey',
            'authorization',
            'credentials'
        ]);

    const output = {};

    for (
        const [key, value]
        of Object.entries(result)
    ) {
        if (
            sensitiveKeys.has(key)
        ) {
            continue;
        }

        if (
            isObject(value) &&
            !Array.isArray(value)
        ) {
            output[key] =
                sanitizeResult(value);
            continue;
        }

        output[key] = value;
    }

    return output;
}


/**
 * ----------------------------------------------------------------------------
 * Airtel Callback Facade
 * ----------------------------------------------------------------------------
 */

class AirtelCallbackModule {

    constructor({
        callbackProcessor,

        validator,
        callbackValidator,

        signatureVerifier,

        stateUpdater,
        paymentStateUpdater,

        ledgerPoster,

        reconciliationMatcher,

        deadLetterQueue,

        auditService,

        eventBus,
        eventPublisher,
        outboxService,

        logger,
        metrics,
        tracer,

        repository,
        stateMachine,
        ledgerEngine,
        reconciliationRepository,
        deadLetterRepository,

        signatureSecret,

        tenantResolver,
        idempotencyService,
        replayGuard,
        authorizationService,

        payloadMaxBytes
    } = {}) {

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.eventPublisher =
            eventPublisher;

        this.outboxService =
            outboxService;

        this.tenantResolver =
            tenantResolver;

        this.idempotencyService =
            idempotencyService;

        this.replayGuard =
            replayGuard;

        this.authorizationService =
            authorizationService;

        this.payloadMaxBytes =
            Number(
                payloadMaxBytes ||
                MAX_CALLBACK_BYTES
            );

        /**
         * --------------------------------------------------------------------
         * Cryptographic verification boundary
         * --------------------------------------------------------------------
         *
         * The exact Airtel signature contract belongs inside
         * signatureVerifier. This facade never invents signing algorithms or
         * canonicalization rules.
         */
        this.signatureVerifier =
            signatureVerifier ||
            new SignatureVerifier({
                secret:
                    signatureSecret,
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Payload validation boundary
         * --------------------------------------------------------------------
         */
        this.validator =
            validator ||
            callbackValidator ||
            new CallbackValidator({
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Payment state boundary
         * --------------------------------------------------------------------
         */
        this.stateUpdater =
            stateUpdater ||
            paymentStateUpdater ||
            new PaymentStateUpdater({
                repository,
                stateMachine,
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Financial posting boundary
         * --------------------------------------------------------------------
         *
         * LedgerPoster is a delegated boundary. It must not become an excuse
         * for this facade to perform direct balance or ledger mutation.
         */
        this.ledgerPoster =
            ledgerPoster ||
            new LedgerPoster({
                ledgerEngine,
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Reconciliation boundary
         * --------------------------------------------------------------------
         */
        this.reconciliationMatcher =
            reconciliationMatcher ||
            new ReconciliationMatcher({
                repository:
                    reconciliationRepository,
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Dead-letter boundary
         * --------------------------------------------------------------------
         */
        this.deadLetterQueue =
            deadLetterQueue ||
            new CallbackDeadLetterQueue({
                repository:
                    deadLetterRepository,
                logger,
                metrics,
                tracer
            });

        /**
         * --------------------------------------------------------------------
         * Canonical callback processor
         * --------------------------------------------------------------------
         */
        this.processor =
            callbackProcessor ||
            new CallbackProcessor({
                signatureVerifier:
                    this.signatureVerifier,

                validator:
                    this.validator,

                stateUpdater:
                    this.stateUpdater,

                ledgerPoster:
                    this.ledgerPoster,

                reconciliationMatcher:
                    this.reconciliationMatcher,

                deadLetterQueue:
                    this.deadLetterQueue,

                auditService:
                    this.auditService,

                idempotencyService:
                    this.idempotencyService,

                replayGuard:
                    this.replayGuard,

                tenantResolver:
                    this.tenantResolver,

                authorizationService:
                    this.authorizationService,

                logger:
                    this.logger,

                metrics:
                    this.metrics,

                tracer:
                    this.tracer
            });

        this.state = {
            status:
                CALLBACK_STATUS.CREATED,

            initialized:
                false,

            initializing:
                false,

            initializedAt:
                null,

            lastProcessedAt:
                null,

            lastRejectedAt:
                null,

            lastFailureAt:
                null
        };

        this.statistics = {
            initialized:
                0,

            received:
                0,

            verified:
                0,

            rejected:
                0,

            duplicates:
                0,

            processed:
                0,

            failed:
                0,

            deadLettered:
                0
        };

        this.initializationPromise =
            null;
    }


    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */
    async initialize(options = {}) {
        if (
            this.state.initialized
        ) {
            return this.initializationResult();
        }

        if (
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        const operationId =
            options.operationId ||
            generateId();

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId
            })
                .finally(() => {
                    this.initializationPromise =
                        null;
                });

        return this.initializationPromise;
    }


    async initializeInternal({
        tenantId,
        correlationId,
        operationId,
        context = {}
    } = {}) {
        this.state.initializing =
            true;

        this.state.status =
            CALLBACK_STATUS.INITIALIZING;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.callback.initialize'
            );

        try {
            this.validateDependencies();

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            if (
                this.processor &&
                isFunction(
                    this.processor.initialize
                )
            ) {
                await this.processor.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            this.state.initialized =
                true;

            this.state.initializing =
                false;

            this.state.status =
                CALLBACK_STATUS.READY;

            this.state.initializedAt =
                new Date();

            this.statistics.initialized++;

            this.metrics?.increment?.(
                'airtel_callback_module_initialized_total'
            );

            this.metrics?.counter?.(
                'airtel_callback_module_initialized_total'
            );

            await this.audit({
                action:
                    'AIRTEL_CALLBACK_SUBSYSTEM_INITIALIZED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            this.logger?.info?.({
                message:
                    'Airtel callback subsystem initialized',
                provider:
                    PROVIDER,
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            return this.initializationResult();
        } catch (error) {
            this.state.initializing =
                false;

            this.state.status =
                CALLBACK_STATUS.FAILED;

            this.state.lastFailureAt =
                new Date();

            this.metrics?.increment?.(
                'airtel_callback_module_initialization_failure_total'
            );

            this.metrics?.counter?.(
                'airtel_callback_module_initialization_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel callback subsystem initialization failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Process Callback
     * =========================================================================
     */
    async process({
        headers = {},
        payload,
        tenantId,
        actor,
        context = {},
        correlationId,
        operationId,
        session
    } = {}) {
        const effectiveCorrelationId =
            correlationId ||
            context.correlationId ||
            generateId();

        const effectiveOperationId =
            operationId ||
            context.operationId ||
            generateId();

        this.statistics.received++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.callback.process'
            );

        const normalizedHeaders =
            normalizeHeaders(headers);

        const payloadFingerprint =
            this.safePayloadFingerprint(
                payload
            );

        try {
            this.assertPayloadSize(
                payload
            );

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            /**
             * ----------------------------------------------------------------
             * Trusted transport metadata
             * ----------------------------------------------------------------
             */
            const requestContext = {
                tenantId:
                    resolvedTenantId,

                actor,

                correlationId:
                    effectiveCorrelationId,

                operationId:
                    effectiveOperationId,

                session,

                context: {
                    ...context,

                    provider:
                        PROVIDER,

                    callbackFingerprint:
                        payloadFingerprint
                }
            };

            /**
             * ----------------------------------------------------------------
             * Authorization
             * ----------------------------------------------------------------
             */
            await this.assertAuthorized({
                tenantId:
                    resolvedTenantId,
                actor,
                action:
                    'PROCESS_AIRTEL_CALLBACK',
                context:
                    requestContext
            });

            /**
             * ----------------------------------------------------------------
             * Signature verification
             * ----------------------------------------------------------------
             *
             * Verification is performed before idempotency/replay persistence
             * so an attacker cannot poison a replay cache with unauthenticated
             * traffic.
             */
            const signature =
                extractSignature(
                    normalizedHeaders
                );

            const verification =
                await this.verify({
                    payload,
                    signature,
                    headers:
                        normalizedHeaders,
                    tenantId:
                        resolvedTenantId,
                    correlationId:
                        effectiveCorrelationId,
                    operationId:
                        effectiveOperationId,
                    context:
                        requestContext
                });

            if (
                verification === false ||
                verification?.valid === false
            ) {
                this.statistics.rejected++;
                this.state.lastRejectedAt =
                    new Date();

                this.metrics?.increment?.(
                    'airtel_callback_signature_rejected_total'
                );

                await this.audit({
                    action:
                        'AIRTEL_CALLBACK_SIGNATURE_REJECTED',
                    tenantId:
                        resolvedTenantId,
                    correlationId:
                        effectiveCorrelationId,
                    operationId:
                        effectiveOperationId,
                    metadata: {
                        payloadFingerprint,
                        headers:
                            redactHeaders(
                                normalizedHeaders
                            )
                    }
                });

                /**
                 * Do not DLQ unauthenticated traffic by default.
                 */
                return {
                    success:
                        false,
                    status:
                        CALLBACK_STATUS.REJECTED,
                    reason:
                        'INVALID_SIGNATURE',
                    correlationId:
                        effectiveCorrelationId,
                    operationId:
                        effectiveOperationId
                };
            }

            this.statistics.verified++;

            this.metrics?.increment?.(
                'airtel_callback_signature_verified_total'
            );

            /**
             * ----------------------------------------------------------------
             * Callback processing
             * ----------------------------------------------------------------
             *
             * The canonical processor owns duplicate detection and financial
             * state convergence. The facade passes all trusted context into it.
             */
            this.state.status =
                CALLBACK_STATUS.PROCESSING;

            const result =
                await this.processor.process({
                    headers:
                        normalizedHeaders,

                    payload,

                    tenantId:
                        resolvedTenantId,

                    actor,

                    correlationId:
                        effectiveCorrelationId,

                    operationId:
                        effectiveOperationId,

                    context:
                        requestContext,

                    session
                });

            const safeResult =
                sanitizeResult(
                    result
                );

            const isDuplicate =
                Boolean(
                    result?.duplicate ||
                    result?.status ===
                        CALLBACK_STATUS.DUPLICATE ||
                    result?.status ===
                        'DUPLICATE'
                );

            if (
                isDuplicate
            ) {
                this.statistics.duplicates++;

                this.state.status =
                    CALLBACK_STATUS.DUPLICATE;

                this.metrics?.increment?.(
                    'airtel_callback_duplicate_total'
                );
            } else {
                this.statistics.processed++;

                this.state.status =
                    CALLBACK_STATUS.PROCESSED;

                this.state.lastProcessedAt =
                    new Date();

                this.metrics?.increment?.(
                    'airtel_callback_processed_total'
                );

                this.metrics?.counter?.(
                    'airtel_callback_processed_total'
                );
            }

            await this.audit({
                action:
                    isDuplicate
                        ? 'AIRTEL_CALLBACK_DUPLICATE'
                        : 'AIRTEL_CALLBACK_PROCESSED',
                tenantId:
                    resolvedTenantId,
                correlationId:
                    effectiveCorrelationId,
                operationId:
                    effectiveOperationId,
                metadata: {
                    payloadFingerprint,
                    status:
                        result?.status,
                    duplicate:
                        isDuplicate,
                    transactionId:
                        result?.transactionId ||
                        result?.financialTransactionId ||
                        result?.reference
                }
            });

            /**
             * ----------------------------------------------------------------
             * Event publication
             * ----------------------------------------------------------------
             *
             * Prefer transactional outbox whenever available. A direct event
             * publisher remains a compatibility fallback.
             */
            await this.publishEvent({
                eventType:
                    isDuplicate
                        ? 'AIRTEL_CALLBACK_DUPLICATE'
                        : 'AIRTEL_CALLBACK_PROCESSED',

                tenantId:
                    resolvedTenantId,

                correlationId:
                    effectiveCorrelationId,

                operationId:
                    effectiveOperationId,

                session,

                payload: {
                    provider:
                        PROVIDER,

                    status:
                        result?.status,

                    duplicate:
                        isDuplicate,

                    transactionId:
                        result?.transactionId ||
                        result?.financialTransactionId ||
                        result?.reference,

                    correlationId:
                        effectiveCorrelationId,

                    operationId:
                        effectiveOperationId
                }
            });

            return {
                ...safeResult,

                success:
                    result?.success !== false,

                provider:
                    PROVIDER,

                duplicate:
                    isDuplicate,

                correlationId:
                    effectiveCorrelationId,

                operationId:
                    effectiveOperationId
            };
        } catch (error) {
            this.statistics.failed++;

            this.state.status =
                CALLBACK_STATUS.FAILED;

            this.state.lastFailureAt =
                new Date();

            this.metrics?.increment?.(
                'airtel_callback_processing_failure_total'
            );

            this.metrics?.counter?.(
                'airtel_callback_processing_failure_total'
            );

            const errorMetadata = {
                error:
                    safeError(error)
            };

            /**
             * Only authenticated/verified callbacks should normally enter the
             * callback DLQ. The processor may already have performed DLQ logic;
             * therefore use the explicit processor/dead-letter boundary only
             * when it is available and the callback reached verification.
             */
            const signature =
                extractSignature(
                    normalizedHeaders
                );

            let verified = false;

            try {
                const verification =
                    await this.verify({
                        payload,
                        signature,
                        headers:
                            normalizedHeaders,
                        tenantId,
                        correlationId:
                            effectiveCorrelationId,
                        operationId:
                            effectiveOperationId,
                        context
                    });

                verified =
                    verification === true ||
                    verification?.valid === true;
            } catch (_) {
                verified = false;
            }

            if (
                verified
            ) {
                await this.safeDeadLetter({
                    headers:
                        normalizedHeaders,
                    payload,
                    tenantId,
                    actor,
                    correlationId:
                        effectiveCorrelationId,
                    operationId:
                        effectiveOperationId,
                    context,
                    error
                });
            }

            await this.audit({
                action:
                    'AIRTEL_CALLBACK_PROCESSING_FAILED',
                tenantId,
                correlationId:
                    effectiveCorrelationId,
                operationId:
                    effectiveOperationId,
                metadata: {
                    payloadFingerprint,
                    ...errorMetadata
                }
            });

            this.logger?.error?.({
                message:
                    'Airtel callback processing failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId:
                    effectiveCorrelationId,
                operationId:
                    effectiveOperationId,
                payloadFingerprint,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Verify Signature
     * =========================================================================
     */
    async verify({
        payload,
        signature,
        headers = {},
        tenantId,
        correlationId,
        operationId,
        context = {}
    } = {}) {
        if (
            !this.signatureVerifier
        ) {
            throw new Error(
                'Airtel signature verifier is unavailable'
            );
        }

        if (
            !isFunction(
                this.signatureVerifier.verify
            )
        ) {
            throw new Error(
                'Airtel signature verifier contract is invalid'
            );
        }

        return this.signatureVerifier.verify({
            payload,
            signature,
            headers,
            tenantId,
            correlationId,
            operationId,
            context
        });
    }


    /**
     * =========================================================================
     * Validate Callback Payload
     * =========================================================================
     */
    async validate(
        payload,
        options = {}
    ) {
        if (
            !this.validator
        ) {
            throw new Error(
                'Airtel callback validator is unavailable'
            );
        }

        if (
            !isFunction(
                this.validator.validate
            )
        ) {
            throw new Error(
                'Airtel callback validator contract is invalid'
            );
        }

        return this.validator.validate(
            payload,
            options
        );
    }


    /**
     * =========================================================================
     * Dead-Letter Handling
     * =========================================================================
     */
    async safeDeadLetter({
        headers,
        payload,
        tenantId,
        actor,
        correlationId,
        operationId,
        context,
        error
    } = {}) {
        if (
            !this.deadLetterQueue ||
            !isFunction(
                this.deadLetterQueue.enqueue
            )
        ) {
            return null;
        }

        try {
            /**
             * Persist a fingerprint and controlled metadata rather than
             * blindly persisting secrets or oversized payloads.
             */
            const payloadFingerprint =
                this.safePayloadFingerprint(
                    payload
                );

            const result =
                await this.deadLetterQueue.enqueue({
                    provider:
                        PROVIDER,

                    tenantId,

                    actor,

                    correlationId,

                    operationId,

                    payloadFingerprint,

                    headers:
                        redactHeaders(
                            headers
                        ),

                    payload:
                        this.safeDeadLetterPayload(
                            payload
                        ),

                    reason:
                        error?.code ||
                        'AIRTEL_CALLBACK_PROCESSING_FAILED',

                    error:
                        safeError(error),

                    context:
                        this.safeContext(
                            context
                        )
                });

            this.statistics.deadLettered++;

            this.metrics?.increment?.(
                'airtel_callback_dead_lettered_total'
            );

            return result;
        } catch (dlqError) {
            this.logger?.error?.({
                message:
                    'Airtel callback dead-letter persistence failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(dlqError)
            });

            return null;
        }
    }


    safeDeadLetterPayload(
        payload
    ) {
        const bytes =
            estimatePayloadBytes(
                payload
            );

        /**
         * DLQ implementations may have their own encryption and storage
         * policies. Do not force raw payload storage here when it is too large.
         */
        if (
            bytes >
            this.payloadMaxBytes
        ) {
            return {
                omitted:
                    true,

                reason:
                    'PAYLOAD_TOO_LARGE',

                sha256:
                    this.safePayloadFingerprint(
                        payload
                    )
            };
        }

        return payload;
    }


    safePayloadFingerprint(
        payload
    ) {
        try {
            return hashPayload(
                payload
            );
        } catch (_) {
            return undefined;
        }
    }


    /**
     * =========================================================================
     * Tenant Resolution
     * =========================================================================
     */
    async resolveTenant({
        tenantId,
        context = {}
    } = {}) {
        if (
            tenantId !== undefined &&
            tenantId !== null &&
            String(tenantId).trim() !== ''
        ) {
            return String(
                tenantId
            );
        }

        if (
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            const resolved =
                await this.tenantResolver.resolve(
                    context
                );

            if (
                resolved !== undefined &&
                resolved !== null &&
                String(resolved).trim() !== ''
            ) {
                return String(
                    resolved
                );
            }
        }

        return null;
    }


    /**
     * =========================================================================
     * Authorization
     * =========================================================================
     */
    async assertAuthorized({
        tenantId,
        actor,
        action,
        context
    } = {}) {
        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            isFunction(
                this.authorizationService.assertAuthorized
            )
        ) {
            await this.authorizationService.assertAuthorized({
                tenantId,
                actor,
                action,
                context
            });

            return true;
        }

        if (
            isFunction(
                this.authorizationService.authorize
            )
        ) {
            const allowed =
                await this.authorizationService.authorize({
                    tenantId,
                    actor,
                    action,
                    context
                });

            if (
                allowed === false
            ) {
                const error =
                    new Error(
                        'Airtel callback processing is not authorized'
                    );

                error.code =
                    'AIRTEL_CALLBACK_UNAUTHORIZED';

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Event / Outbox
     * =========================================================================
     */
    async publishEvent({
        eventType,
        tenantId,
        correlationId,
        operationId,
        session,
        payload
    } = {}) {
        const eventPayload = {
            ...payload,

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            operationId
        };

        if (
            this.outboxService
        ) {
            if (
                isFunction(
                    this.outboxService.enqueue
                )
            ) {
                await this.outboxService.enqueue({
                    tenantId,
                    aggregateType:
                        'AIRTEL_CALLBACK',
                    aggregateId:
                        operationId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId || 'unknown'}:${operationId}`,
                    session
                });

                return;
            }

            if (
                isFunction(
                    this.outboxService.publish
                )
            ) {
                await this.outboxService.publish({
                    tenantId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId || 'unknown'}:${operationId}`,
                    session
                });

                return;
            }
        }

        const publisher =
            this.eventBus ||
            this.eventPublisher;

        if (
            publisher &&
            isFunction(
                publisher.publish
            )
        ) {
            await publisher.publish({
                type:
                    eventType,
                payload:
                    eventPayload,
                correlationId,
                operationId
            });
        }
    }


    /**
     * =========================================================================
     * Payload Validation
     * =========================================================================
     */
    assertPayloadSize(
        payload
    ) {
        const size =
            estimatePayloadBytes(
                payload
            );

        if (
            size >
            this.payloadMaxBytes
        ) {
            const error =
                new Error(
                    'Airtel callback payload exceeds configured size limit'
                );

            error.code =
                'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE';

            throw error;
        }

        return true;
    }


    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */
    validateDependencies() {
        const dependencies = {
            signatureVerifier:
                this.signatureVerifier,

            validator:
                this.validator,

            processor:
                this.processor,

            stateUpdater:
                this.stateUpdater,

            ledgerPoster:
                this.ledgerPoster,

            reconciliationMatcher:
                this.reconciliationMatcher,

            deadLetterQueue:
                this.deadLetterQueue
        };

        const missing =
            Object.entries(
                dependencies
            )
                .filter(
                    ([, dependency]) =>
                        !dependency
                )
                .map(
                    ([name]) =>
                        name
                );

        if (
            missing.length
        ) {
            const error =
                new Error(
                    `Airtel callback dependencies unavailable: ${missing.join(', ')}`
                );

            error.code =
                'AIRTEL_CALLBACK_DEPENDENCY_FAILURE';

            throw error;
        }

        const contracts = [
            [
                'signatureVerifier.verify',
                this.signatureVerifier,
                'verify'
            ],
            [
                'validator.validate',
                this.validator,
                'validate'
            ],
            [
                'processor.process',
                this.processor,
                'process'
            ]
        ];

        const invalid =
            contracts
                .filter(
                    ([, object, method]) =>
                        !isFunction(
                            object?.[method]
                        )
                )
                .map(
                    ([name]) =>
                        name
                );

        if (
            invalid.length
        ) {
            const error =
                new Error(
                    `Airtel callback dependency contract invalid: ${invalid.join(', ')}`
                );

            error.code =
                'AIRTEL_CALLBACK_CONTRACT_INVALID';

            throw error;
        }

        return true;
    }


    /**
     * =========================================================================
     * Safe Context
     * =========================================================================
     */
    safeContext(
        context = {}
    ) {
        if (
            !isObject(context)
        ) {
            return {};
        }

        const forbidden =
            new Set([
                'authorization',
                'cookie',
                'secret',
                'signature',
                'token',
                'accessToken',
                'refreshToken',
                'clientSecret',
                'apiKey',
                'password'
            ]);

        const result = {};

        for (
            const [key, value]
            of Object.entries(context)
        ) {
            if (
                forbidden.has(
                    String(key)
                        .toLowerCase()
                )
            ) {
                continue;
            }

            if (
                isObject(value) &&
                !Array.isArray(value)
            ) {
                result[key] =
                    this.safeContext(
                        value
                    );
            } else {
                result[key] =
                    value;
            }
        }

        return result;
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async audit({
        action,
        tenantId,
        correlationId,
        operationId,
        metadata = {}
    } = {}) {
        if (
            !this.auditService ||
            !isFunction(
                this.auditService.record
            )
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                metadata:
                    this.safeContext(
                        metadata
                    )
            });
        } catch (error) {
            /**
             * Audit failures remain observable but must not rewrite the
             * authoritative callback result.
             */
            this.logger?.error?.({
                message:
                    'Airtel callback audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                action,
                error:
                    safeError(error)
            });
        }
    }


    /**
     * =========================================================================
     * Initialization Result
     * =========================================================================
     */
    initializationResult() {
        return {
            provider:
                PROVIDER,

            module:
                'callbacks',

            initialized:
                this.state.initialized,

            status:
                this.state.status,

            initializedAt:
                this.state.initializedAt
        };
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health(options = {}) {
        const checks = {};

        checks.processor =
            await this.safeHealth(
                this.processor
            );

        checks.signatureVerifier =
            await this.safeHealth(
                this.signatureVerifier
            );

        checks.validator =
            await this.safeHealth(
                this.validator
            );

        checks.stateUpdater =
            await this.safeHealth(
                this.stateUpdater
            );

        checks.ledgerPoster =
            await this.safeHealth(
                this.ledgerPoster
            );

        checks.reconciliationMatcher =
            await this.safeHealth(
                this.reconciliationMatcher
            );

        checks.deadLetterQueue =
            await this.safeHealth(
                this.deadLetterQueue
            );

        checks.observability =
            await this.safeHealth(
                this.tracer
            );

        const dependencyAvailable =
            Boolean(
                this.processor &&
                this.signatureVerifier &&
                this.validator
            );

        const hasDown =
            Object.values(
                checks
            ).some(
                item =>
                    item?.status === 'DOWN'
            );

        const status =
            hasDown
                ? 'DOWN'
                : !dependencyAvailable
                    ? 'DEGRADED'
                    : !this.state.initialized
                        ? 'DEGRADED'
                        : 'UP';

        return {
            provider:
                PROVIDER,

            module:
                'callbacks',

            status,

            initialized:
                this.state.initialized,

            state:
                this.state.status,

            payloadMaxBytes:
                this.payloadMaxBytes,

            dependencies: {
                processor:
                    Boolean(
                        this.processor
                    ),

                signatureVerifier:
                    Boolean(
                        this.signatureVerifier
                    ),

                validator:
                    Boolean(
                        this.validator
                    ),

                stateUpdater:
                    Boolean(
                        this.stateUpdater
                    ),

                ledgerPoster:
                    Boolean(
                        this.ledgerPoster
                    ),

                reconciliationMatcher:
                    Boolean(
                        this.reconciliationMatcher
                    ),

                deadLetterQueue:
                    Boolean(
                        this.deadLetterQueue
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                idempotencyService:
                    Boolean(
                        this.idempotencyService
                    ),

                replayGuard:
                    Boolean(
                        this.replayGuard
                    ),

                outboxService:
                    Boolean(
                        this.outboxService
                    )
            },

            checks,

            statistics: {
                ...this.statistics
            },

            timestamps: {
                initializedAt:
                    this.state.initializedAt,

                lastProcessedAt:
                    this.state.lastProcessedAt,

                lastRejectedAt:
                    this.state.lastRejectedAt,

                lastFailureAt:
                    this.state.lastFailureAt
            }
        };
    }


    async safeHealth(
        dependency
    ) {
        if (
            !dependency
        ) {
            return {
                status:
                    'NOT_CONFIGURED'
            };
        }

        try {
            if (
                isFunction(
                    dependency.health
                )
            ) {
                return sanitizeResult(
                    await dependency.health()
                );
            }

            return {
                status:
                    'AVAILABLE'
            };
        } catch (error) {
            return {
                status:
                    'DOWN',

                error:
                    safeError(error)
            };
        }
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'callbacks',

            status:
                this.state.status,

            initialized:
                this.state.initialized,

            initializing:
                this.state.initializing,

            payloadMaxBytes:
                this.payloadMaxBytes,

            architecture: {
                callbackProcessor:
                    Boolean(
                        this.processor
                    ),

                signatureVerifier:
                    Boolean(
                        this.signatureVerifier
                    ),

                validator:
                    Boolean(
                        this.validator
                    ),

                stateUpdater:
                    Boolean(
                        this.stateUpdater
                    ),

                ledgerPoster:
                    Boolean(
                        this.ledgerPoster
                    ),

                reconciliationMatcher:
                    Boolean(
                        this.reconciliationMatcher
                    ),

                deadLetterQueue:
                    Boolean(
                        this.deadLetterQueue
                    ),

                outboxEnabled:
                    Boolean(
                        this.outboxService
                    ),

                replayProtectionEnabled:
                    Boolean(
                        this.replayGuard ||
                        this.idempotencyService
                    ),

                tenantResolutionEnabled:
                    Boolean(
                        this.tenantResolver
                    )
            },

            statistics: {
                ...this.statistics
            },

            timestamps: {
                initializedAt:
                    this.state.initializedAt,

                lastProcessedAt:
                    this.state.lastProcessedAt,

                lastRejectedAt:
                    this.state.lastRejectedAt,

                lastFailureAt:
                    this.state.lastFailureAt
            }
        };
    }
}


module.exports =
    AirtelCallbackModule;

module.exports.AirtelCallbackModule =
    AirtelCallbackModule;

module.exports.PROVIDER =
    PROVIDER;

module.exports.CALLBACK_STATUS =
    CALLBACK_STATUS;