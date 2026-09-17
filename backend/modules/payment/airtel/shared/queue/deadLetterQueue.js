'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Dead-Letter Queue
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/queue/deadLetterQueue.js
 *
 * Architectural Role
 * ------------------
 * Canonical dead-letter handling boundary for failed Airtel payment/callback
 * processing.
 *
 * This module records work that could not be safely processed by the primary
 * payment pipeline and delegates durable storage/delivery to the configured
 * repository or queue adapter.
 *
 * Responsibilities
 * ----------------
 * • Create dead-letter records.
 * • Preserve tenant and correlation context.
 * • Classify failure reasons.
 * • Protect against duplicate DLQ insertion.
 * • Bound payload size.
 * • Sanitize sensitive metadata.
 * • Support operator/recovery requeue workflows.
 * • Track attempt/dead-letter metadata.
 * • Support acknowledgement/resolution.
 * • Provide safe inspection and health reporting.
 * • Integrate audit and metrics.
 *
 * Does NOT:
 * ----------
 * • Process payment callbacks.
 * • Verify callback signatures.
 * • Decide whether a payment is valid.
 * • Modify transaction state directly.
 * • Post ledger entries.
 * • Modify wallet balances.
 * • Perform settlement.
 * • Perform reconciliation.
 * • Retry provider payments automatically.
 * • Convert provider failure into payment success.
 *
 * Security Principles
 * -------------------
 * • Unauthenticated traffic should not be persisted to the DLQ by default.
 * • Secrets, credentials, tokens, signatures and authorization headers are
 *   removed from persisted metadata.
 * • Raw payloads are bounded and may be omitted when oversized.
 * • Tenant identity is mandatory for payment-related DLQ operations.
 * • Requeue requires an explicit operator/application action.
 * • DLQ records are evidence of processing failure, not financial truth.
 *
 * Recovery Principles
 * -------------------
 * • Requeueing a message does not itself retry a financial operation.
 * • Recovery must pass through the canonical payment/callback processor.
 * • Duplicate protection is required before requeueing.
 * • A message that repeatedly fails should become a poison/requires-review
 *   record rather than being retried indefinitely.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';


const DLQ_STATUS = Object.freeze({
    DEAD_LETTERED:
        'DEAD_LETTERED',

    READY_FOR_REVIEW:
        'READY_FOR_REVIEW',

    REQUEUE_PENDING:
        'REQUEUE_PENDING',

    REQUEUED:
        'REQUEUED',

    PROCESSING:
        'PROCESSING',

    RESOLVED:
        'RESOLVED',

    DISCARDED:
        'DISCARDED',

    POISON:
        'POISON'
});


const FAILURE_CLASS = Object.freeze({
    VALIDATION:
        'VALIDATION',

    SIGNATURE:
        'SIGNATURE',

    REPLAY:
        'REPLAY',

    DUPLICATE:
        'DUPLICATE',

    PROVIDER:
        'PROVIDER',

    NETWORK:
        'NETWORK',

    TIMEOUT:
        'TIMEOUT',

    STATE:
        'STATE',

    RECONCILIATION:
        'RECONCILIATION',

    FINANCIAL:
        'FINANCIAL',

    DEPENDENCY:
        'DEPENDENCY',

    INTERNAL:
        'INTERNAL',

    UNKNOWN:
        'UNKNOWN'
});


const DEFAULTS = Object.freeze({
    maxPayloadBytes:
        512 * 1024,

    maxMetadataBytes:
        64 * 1024,

    maxAttempts:
        5,

    visibilityTimeoutMs:
        60_000,

    retentionDays:
        30
});


const SENSITIVE_KEYS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',

    'password',
    'secret',
    'clientSecret',
    'client_secret',

    'apiKey',
    'api_key',

    'token',
    'accessToken',
    'access_token',

    'refreshToken',
    'refresh_token',

    'signature',

    'privateKey',
    'private_key',

    'credentials'
]);


const RAW_TRANSPORT_KEYS = new Set([
    'request',
    'response',
    'requestBody',
    'responseBody',
    'request_body',
    'response_body',
    'rawRequest',
    'rawResponse',
    'rawPayload'
]);


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function isPlainObject(value) {
    if (
        !isObject(value)
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}


function isFunction(value) {
    return typeof value === 'function';
}


function generateId() {
    return crypto.randomUUID();
}


function safeString(
    value,
    maxLength = 2048
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(
            0,
            maxLength
        );
}


function estimateBytes(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return 0;
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return value.length;
    }

    if (
        typeof value === 'string'
    ) {
        return Buffer.byteLength(
            value,
            'utf8'
        );
    }

    try {
        return Buffer.byteLength(
            JSON.stringify(
                value
            ),
            'utf8'
        );
    } catch (_) {
        return Number.MAX_SAFE_INTEGER;
    }
}


function stableFingerprint(
    value
) {
    let input;

    if (
        Buffer.isBuffer(value)
    ) {
        input =
            value;
    } else if (
        typeof value === 'string'
    ) {
        input =
            value;
    } else {
        try {
            input =
                JSON.stringify(
                    value ?? {}
                );
        } catch (_) {
            input =
                String(value);
        }
    }

    return crypto
        .createHash('sha256')
        .update(input)
        .digest('hex');
}


function sanitize(
    value,
    depth = 0
) {
    if (
        depth > 8
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return '[BUFFER_REDACTED]';
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(
            0,
            4000
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        Array.isArray(value)
    ) {
        return value
            .slice(
                0,
                200
            )
            .map(
                item =>
                    sanitize(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        isObject(value)
    ) {
        const result = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {
            const lowerKey =
                String(key)
                    .toLowerCase();

            if (
                SENSITIVE_KEYS.has(
                    key
                ) ||
                SENSITIVE_KEYS.has(
                    lowerKey
                )
            ) {
                result[key] =
                    '[REDACTED]';

                continue;
            }

            if (
                RAW_TRANSPORT_KEYS.has(
                    key
                ) ||
                RAW_TRANSPORT_KEYS.has(
                    lowerKey
                )
            ) {
                result[key] =
                    '[OMITTED]';

                continue;
            }

            result[key] =
                sanitize(
                    item,
                    depth + 1
                );
        }

        return result;
    }

    return safeString(
        value
    );
}


function sanitizeError(
    error
) {
    if (
        !error
    ) {
        return null;
    }

    if (
        isFunction(error.toJSON)
    ) {
        try {
            return sanitize(
                error.toJSON()
            );
        } catch (_) {
            // Continue.
        }
    }

    return {
        name:
            safeString(
                error.name,
                128
            ),

        code:
            safeString(
                error.code,
                256
            ),

        message:
            safeString(
                error.message,
                2000
            )
    };
}


function sanitizePayload(
    payload,
    maxPayloadBytes
) {
    const bytes =
        estimateBytes(
            payload
        );

    if (
        bytes >
        maxPayloadBytes
    ) {
        return {
            omitted:
                true,

            reason:
                'PAYLOAD_TOO_LARGE',

            bytes,

            sha256:
                stableFingerprint(
                    payload
                )
        };
    }

    return sanitize(
        payload
    );
}


function sanitizeMetadata(
    metadata,
    maxMetadataBytes
) {
    const sanitized =
        sanitize(
            metadata
        );

    const bytes =
        estimateBytes(
            sanitized
        );

    if (
        bytes >
        maxMetadataBytes
    ) {
        return {
            omitted:
                true,

            reason:
                'METADATA_TOO_LARGE',

            bytes,

            sha256:
                stableFingerprint(
                    sanitized
                )
        };
    }

    return sanitized;
}


function inferFailureClass({
    failureClass,
    error,
    reason
}) {
    if (
        failureClass &&
        Object.values(
            FAILURE_CLASS
        ).includes(
            String(
                failureClass
            ).toUpperCase()
        )
    ) {
        return String(
            failureClass
        ).toUpperCase();
    }

    const code =
        String(
            error?.code ||
            ''
        ).toUpperCase();

    const combined =
        `${code} ${reason || ''}`.toUpperCase();

    if (
        combined.includes(
            'SIGNATURE'
        )
    ) {
        return FAILURE_CLASS.SIGNATURE;
    }

    if (
        combined.includes(
            'REPLAY'
        )
    ) {
        return FAILURE_CLASS.REPLAY;
    }

    if (
        combined.includes(
            'DUPLICATE'
        )
    ) {
        return FAILURE_CLASS.DUPLICATE;
    }

    if (
        combined.includes(
            'TIMEOUT'
        ) ||
        combined.includes(
            'ETIMEDOUT'
        )
    ) {
        return FAILURE_CLASS.TIMEOUT;
    }

    if (
        combined.includes(
            'NETWORK'
        ) ||
        [
            'ECONNRESET',
            'ECONNREFUSED',
            'ENETUNREACH',
            'EHOSTUNREACH'
        ].includes(
            code
        )
    ) {
        return FAILURE_CLASS.NETWORK;
    }

    if (
        combined.includes(
            'RECONCILIATION'
        )
    ) {
        return FAILURE_CLASS.RECONCILIATION;
    }

    if (
        combined.includes(
            'FINANCIAL'
        ) ||
        combined.includes(
            'LEDGER'
        )
    ) {
        return FAILURE_CLASS.FINANCIAL;
    }

    if (
        combined.includes(
            'STATE'
        ) ||
        combined.includes(
            'TRANSITION'
        )
    ) {
        return FAILURE_CLASS.STATE;
    }

    if (
        combined.includes(
            'VALID'
        )
    ) {
        return FAILURE_CLASS.VALIDATION;
    }

    if (
        combined.includes(
            'PROVIDER'
        ) ||
        error?.provider
    ) {
        return FAILURE_CLASS.PROVIDER;
    }

    if (
        combined.includes(
            'DEPENDENCY'
        )
    ) {
        return FAILURE_CLASS.DEPENDENCY;
    }

    if (
        error
    ) {
        return FAILURE_CLASS.INTERNAL;
    }

    return FAILURE_CLASS.UNKNOWN;
}


function createQueueError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'AirtelDeadLetterQueueError';

    error.code =
        code;

    error.provider =
        PROVIDER;

    Object.assign(
        error,
        details
    );

    return error;
}


class AirtelDeadLetterQueue {

    constructor({
        repository,

        queueAdapter,
        publisher,

        auditService,

        logger,
        metrics,
        tracer,

        tenantResolver,

        maxPayloadBytes =
            DEFAULTS.maxPayloadBytes,

        maxMetadataBytes =
            DEFAULTS.maxMetadataBytes,

        maxAttempts =
            DEFAULTS.maxAttempts,

        visibilityTimeoutMs =
            DEFAULTS.visibilityTimeoutMs,

        retentionDays =
            DEFAULTS.retentionDays
    } = {}) {
        this.repository =
            repository;

        this.queueAdapter =
            queueAdapter ||
            publisher;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.tenantResolver =
            tenantResolver;

        this.maxPayloadBytes =
            this.normalizePositiveInteger(
                maxPayloadBytes,
                'maxPayloadBytes'
            );

        this.maxMetadataBytes =
            this.normalizePositiveInteger(
                maxMetadataBytes,
                'maxMetadataBytes'
            );

        this.maxAttempts =
            this.normalizePositiveInteger(
                maxAttempts,
                'maxAttempts'
            );

        this.visibilityTimeoutMs =
            this.normalizePositiveInteger(
                visibilityTimeoutMs,
                'visibilityTimeoutMs'
            );

        this.retentionDays =
            this.normalizePositiveInteger(
                retentionDays,
                'retentionDays'
            );

        this.startedAt =
            new Date();

        this.statistics = {
            enqueued:
                0,

            duplicates:
                0,

            enqueueFailures:
                0,

            requeueAttempts:
                0,

            requeued:
                0,

            requeueFailures:
                0,

            resolved:
                0,

            discarded:
                0,

            poison:
                0
        };
    }


    /**
     * =========================================================================
     * Enqueue / Dead-Letter
     * =========================================================================
     */
    async enqueue({
        tenantId,
        payload,
        headers = {},
        actor,
        reason,
        error,
        failureClass,
        source =
            'AIRTEL_PAYMENT_PIPELINE',

        transactionId,
        paymentReference,
        providerReference,

        correlationId =
            generateId(),

        operationId =
            generateId(),

        idempotencyKey,

        callbackFingerprint,

        context = {},

        authenticated = false,
        signatureVerified = false,

        sourceEventId,

        session
    } = {}) {
        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.dlq.enqueue'
            );

        try {
            const resolvedTenantId =
                await this.requireTenant({
                    tenantId,
                    context
                });

            /**
             * Prevent unauthenticated traffic from becoming a durable
             * persistence/DoS vector.
             */
            if (
                !authenticated &&
                !signatureVerified
            ) {
                throw createQueueError(
                    'AIRTEL_DLQ_UNAUTHENTICATED_FORBIDDEN',
                    'Unauthenticated Airtel data cannot be dead-lettered'
                );
            }

            const normalizedFailureClass =
                inferFailureClass({
                    failureClass,
                    error,
                    reason
                });

            const fingerprint =
                callbackFingerprint ||
                stableFingerprint(
                    payload
                );

            const effectiveKey =
                idempotencyKey ||
                this.buildIdempotencyKey({
                    tenantId:
                        resolvedTenantId,
                    callbackFingerprint:
                        fingerprint,
                    paymentReference,
                    providerReference,
                    operationId,
                    sourceEventId
                });

            const existing =
                await this.findDuplicate({
                    tenantId:
                        resolvedTenantId,
                    idempotencyKey:
                        effectiveKey,
                    sourceEventId,
                    fingerprint,
                    session
                });

            if (
                existing
            ) {
                this.statistics.duplicates++;

                this.metrics?.increment?.(
                    'payment_airtel_dlq_duplicate_total'
                );

                return {
                    ...existing,
                    duplicate:
                        true
                };
            }

            const record = {
                dlqId:
                    generateId(),

                provider:
                    PROVIDER,

                source:
                    safeString(
                        source,
                        256
                    ),

                tenantId:
                    resolvedTenantId,

                status:
                    DLQ_STATUS.DEAD_LETTERED,

                failureClass:
                    normalizedFailureClass,

                reason:
                    safeString(
                        reason ||
                        error?.code ||
                        'AIRTEL_PAYMENT_PROCESSING_FAILED',
                        1000
                    ),

                error:
                    sanitizeError(
                        error
                    ),

                tenantIdHash:
                    this.hashTenant(
                        resolvedTenantId
                    ),

                transactionId:
                    safeString(
                        transactionId,
                        256
                    ),

                paymentReference:
                    safeString(
                        paymentReference,
                        256
                    ),

                providerReference:
                    safeString(
                        providerReference,
                        256
                    ),

                callbackFingerprint:
                    fingerprint,

                sourceEventId:
                    safeString(
                        sourceEventId,
                        256
                    ),

                idempotencyKey:
                    effectiveKey,

                correlationId:
                    safeString(
                        correlationId,
                        256
                    ),

                operationId:
                    safeString(
                        operationId,
                        256
                    ),

                actorId:
                    safeString(
                        actor?.id ||
                        actor?.userId ||
                        actor?._id,
                        256
                    ),

                payload:
                    sanitizePayload(
                        payload,
                        this.maxPayloadBytes
                    ),

                headers:
                    sanitizeMetadata(
                        headers,
                        this.maxMetadataBytes
                    ),

                context:
                    sanitizeMetadata(
                        context,
                        this.maxMetadataBytes
                    ),

                attempts:
                    0,

                maxAttempts:
                    this.maxAttempts,

                createdAt:
                    new Date(),

                updatedAt:
                    new Date(),

                nextAttemptAt:
                    null,

                resolvedAt:
                    null,

                discardedAt:
                    null,

                retentionUntil:
                    this.retentionDate()
            };

            const stored =
                await this.persist(
                    record,
                    session
                );

            this.statistics.enqueued++;

            this.metrics?.increment?.(
                'payment_airtel_dlq_enqueued_total'
            );

            await this.audit({
                action:
                    'AIRTEL_PAYMENT_DLQ_ENQUEUED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId,
                metadata: {
                    dlqId:
                        stored?.dlqId ||
                        record.dlqId,

                    failureClass:
                        normalizedFailureClass,

                    reason:
                        record.reason,

                    callbackFingerprint:
                        fingerprint
                }
            });

            return stored;
        } catch (error) {
            this.statistics.enqueueFailures++;

            this.metrics?.increment?.(
                'payment_airtel_dlq_enqueue_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel dead-letter enqueue failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    this.safeErrorForLog(
                        error
                    )
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */
    async findDuplicate({
        tenantId,
        idempotencyKey,
        sourceEventId,
        fingerprint,
        session
    } = {}) {
        if (
            !this.repository
        ) {
            return null;
        }

        if (
            isFunction(
                this.repository.findByIdempotencyKey
            ) &&
            idempotencyKey
        ) {
            const result =
                await this.repository.findByIdempotencyKey({
                    tenantId,
                    idempotencyKey,
                    session
                });

            if (
                result
            ) {
                return result;
            }
        }

        if (
            isFunction(
                this.repository.findBySourceEventId
            ) &&
            sourceEventId
        ) {
            const result =
                await this.repository.findBySourceEventId({
                    tenantId,
                    sourceEventId,
                    session
                });

            if (
                result
            ) {
                return result;
            }
        }

        if (
            isFunction(
                this.repository.findByFingerprint
            ) &&
            fingerprint
        ) {
            return this.repository.findByFingerprint({
                tenantId,
                callbackFingerprint:
                    fingerprint,
                session
            });
        }

        return null;
    }


    /**
     * =========================================================================
     * Durable Persistence
     * =========================================================================
     */
    async persist(
        record,
        session
    ) {
        if (
            this.repository
        ) {
            if (
                isFunction(
                    this.repository.enqueue
                )
            ) {
                return this.repository.enqueue({
                    ...record,
                    session
                });
            }

            if (
                isFunction(
                    this.repository.create
                )
            ) {
                return this.repository.create({
                    ...record,
                    session
                });
            }

            if (
                isFunction(
                    this.repository.insert
                )
            ) {
                return this.repository.insert({
                    ...record,
                    session
                });
            }
        }

        /**
         * A queue adapter without durable repository support can be used when
         * the adapter itself provides durable DLQ semantics.
         */
        if (
            this.queueAdapter
        ) {
            if (
                isFunction(
                    this.queueAdapter.deadLetter
                )
            ) {
                return this.queueAdapter.deadLetter(
                    record
                );
            }

            if (
                isFunction(
                    this.queueAdapter.send
                )
            ) {
                return this.queueAdapter.send({
                    queue:
                        'airtel-dead-letter',
                    message:
                        record
                });
            }

            if (
                isFunction(
                    this.queueAdapter.publish
                )
            ) {
                return this.queueAdapter.publish({
                    topic:
                        'airtel.dead-letter',
                    payload:
                        record
                });
            }
        }

        throw createQueueError(
            'AIRTEL_DLQ_STORAGE_UNAVAILABLE',
            'No Airtel dead-letter persistence or queue adapter is configured'
        );
    }


    /**
     * =========================================================================
     * Requeue
     * =========================================================================
     *
     * Requeue is explicit. It does not directly invoke payment execution.
     */
    async requeue({
        dlqId,
        tenantId,
        actor,
        reason,
        context = {},
        session,
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        this.statistics.requeueAttempts++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.dlq.requeue'
            );

        try {
            const resolvedTenantId =
                await this.requireTenant({
                    tenantId,
                    context
                });

            if (
                !dlqId
            ) {
                throw createQueueError(
                    'AIRTEL_DLQ_ID_REQUIRED',
                    'dlqId is required for requeue'
                );
            }

            const record =
                await this.findById({
                    dlqId,
                    tenantId:
                        resolvedTenantId,
                    session
                });

            if (
                !record
            ) {
                throw createQueueError(
                    'AIRTEL_DLQ_NOT_FOUND',
                    'Dead-letter record not found'
                );
            }

            if (
                record.status ===
                DLQ_STATUS.RESOLVED
            ) {
                return {
                    ...record,
                    duplicate:
                        true
                };
            }

            if (
                record.status ===
                DLQ_STATUS.DISCARDED
            ) {
                throw createQueueError(
                    'AIRTEL_DLQ_DISCARDED',
                    'Discarded dead-letter records cannot be requeued'
                );
            }

            if (
                record.attempts >=
                Math.min(
                    record.maxAttempts ||
                    this.maxAttempts,
                    this.maxAttempts
                )
            ) {
                await this.markPoison({
                    dlqId,
                    tenantId:
                        resolvedTenantId,
                    reason:
                        'MAX_ATTEMPTS_EXCEEDED',
                    session,
                    correlationId,
                    operationId
                });

                throw createQueueError(
                    'AIRTEL_DLQ_MAX_ATTEMPTS_EXCEEDED',
                    'Dead-letter message reached the maximum retry attempts'
                );
            }

            const updated =
                await this.transition({
                    dlqId,
                    tenantId:
                        resolvedTenantId,
                    expectedStatus:
                        record.status,
                    nextStatus:
                        DLQ_STATUS.REQUEUED,
                    update: {
                        attempts:
                            Number(
                                record.attempts ||
                                0
                            ) + 1,

                        requeuedAt:
                            new Date(),

                        requeueReason:
                            safeString(
                                reason,
                                1000
                            ),

                        lastActorId:
                            safeString(
                                actor?.id ||
                                actor?.userId ||
                                actor?._id,
                                256
                            ),

                        correlationId,

                        operationId,

                        updatedAt:
                            new Date()
                    },
                    session,
                    correlationId,
                    operationId
                });

            this.statistics.requeued++;

            this.metrics?.increment?.(
                'payment_airtel_dlq_requeued_total'
            );

            await this.audit({
                action:
                    'AIRTEL_PAYMENT_DLQ_REQUEUED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId,
                metadata: {
                    dlqId,
                    reason
                }
            });

            return updated;
        } catch (error) {
            this.statistics.requeueFailures++;

            this.metrics?.increment?.(
                'payment_airtel_dlq_requeue_failure_total'
            );

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Processing Claim
     * =========================================================================
     *
     * Useful when a recovery worker needs an atomic lease before handing the
     * message to the canonical callback/payment processor.
     */
    async claim({
        dlqId,
        tenantId,
        workerId,
        session,
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        const resolvedTenantId =
            await this.requireTenant({
                tenantId
            });

        if (
            !dlqId
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_ID_REQUIRED',
                'dlqId is required for claim'
            );
        }

        const leaseUntil =
            new Date(
                Date.now() +
                this.visibilityTimeoutMs
            );

        const update = {
            status:
                DLQ_STATUS.PROCESSING,

            workerId:
                safeString(
                    workerId,
                    256
                ),

            leaseUntil,

            processingStartedAt:
                new Date(),

            correlationId,

            operationId,

            updatedAt:
                new Date()
        };

        if (
            this.repository &&
            isFunction(
                this.repository.claim
            )
        ) {
            return this.repository.claim({
                dlqId,
                tenantId:
                    resolvedTenantId,
                expectedStatuses: [
                    DLQ_STATUS.REQUEUED,
                    DLQ_STATUS.DEAD_LETTERED,
                    DLQ_STATUS.READY_FOR_REVIEW
                ],
                update,
                session,
                correlationId,
                operationId
            });
        }

        return this.transition({
            dlqId,
            tenantId:
                resolvedTenantId,
            expectedStatus:
                DLQ_STATUS.REQUEUED,
            nextStatus:
                DLQ_STATUS.PROCESSING,
            update,
            session,
            correlationId,
            operationId
        });
    }


    /**
     * =========================================================================
     * Resolve
     * =========================================================================
     */
    async resolve({
        dlqId,
        tenantId,
        actor,
        reason,
        session,
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        const resolvedTenantId =
            await this.requireTenant({
                tenantId
            });

        if (
            !dlqId
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_ID_REQUIRED',
                'dlqId is required'
            );
        }

        const updated =
            await this.transition({
                dlqId,
                tenantId:
                    resolvedTenantId,
                expectedStatuses: [
                    DLQ_STATUS.PROCESSING,
                    DLQ_STATUS.REQUEUED,
                    DLQ_STATUS.READY_FOR_REVIEW
                ],
                nextStatus:
                    DLQ_STATUS.RESOLVED,
                update: {
                    resolvedAt:
                        new Date(),

                    resolutionReason:
                        safeString(
                            reason,
                            1000
                        ),

                    resolvedBy:
                        safeString(
                            actor?.id ||
                            actor?.userId ||
                            actor?._id,
                            256
                        ),

                    correlationId,

                    operationId,

                    updatedAt:
                        new Date()
                },
                session,
                correlationId,
                operationId
            });

        this.statistics.resolved++;

        this.metrics?.increment?.(
            'payment_airtel_dlq_resolved_total'
        );

        await this.audit({
            action:
                'AIRTEL_PAYMENT_DLQ_RESOLVED',
            tenantId:
                resolvedTenantId,
            correlationId,
            operationId,
            metadata: {
                dlqId,
                reason
            }
        });

        return updated;
    }


    /**
     * =========================================================================
     * Discard
     * =========================================================================
     */
    async discard({
        dlqId,
        tenantId,
        actor,
        reason,
        session,
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        const resolvedTenantId =
            await this.requireTenant({
                tenantId
            });

        if (
            !reason ||
            !String(reason).trim()
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_DISCARD_REASON_REQUIRED',
                'A reason is required to discard a dead-letter record'
            );
        }

        const updated =
            await this.transition({
                dlqId,
                tenantId:
                    resolvedTenantId,
                expectedStatuses: [
                    DLQ_STATUS.DEAD_LETTERED,
                    DLQ_STATUS.READY_FOR_REVIEW,
                    DLQ_STATUS.POISON
                ],
                nextStatus:
                    DLQ_STATUS.DISCARDED,
                update: {
                    discardedAt:
                        new Date(),

                    discardReason:
                        safeString(
                            reason,
                            1000
                        ),

                    discardedBy:
                        safeString(
                            actor?.id ||
                            actor?.userId ||
                            actor?._id,
                            256
                        ),

                    correlationId,

                    operationId,

                    updatedAt:
                        new Date()
                },
                session,
                correlationId,
                operationId
            });

        this.statistics.discarded++;

        this.metrics?.increment?.(
            'payment_airtel_dlq_discarded_total'
        );

        await this.audit({
            action:
                'AIRTEL_PAYMENT_DLQ_DISCARDED',
            tenantId:
                resolvedTenantId,
            correlationId,
            operationId,
            metadata: {
                dlqId,
                reason
            }
        });

        return updated;
    }


    /**
     * =========================================================================
     * Poison Message
     * =========================================================================
     */
    async markPoison({
        dlqId,
        tenantId,
        reason =
            'MAX_ATTEMPTS_EXCEEDED',
        session,
        correlationId =
            generateId(),
        operationId =
            generateId()
    } = {}) {
        const resolvedTenantId =
            await this.requireTenant({
                tenantId
            });

        const result =
            await this.transition({
                dlqId,
                tenantId:
                    resolvedTenantId,
                expectedStatuses: [
                    DLQ_STATUS.DEAD_LETTERED,
                    DLQ_STATUS.REQUEUED,
                    DLQ_STATUS.PROCESSING,
                    DLQ_STATUS.READY_FOR_REVIEW
                ],
                nextStatus:
                    DLQ_STATUS.POISON,
                update: {
                    poisonReason:
                        safeString(
                            reason,
                            1000
                        ),

                    poisonAt:
                        new Date(),

                    updatedAt:
                        new Date(),

                    correlationId,

                    operationId
                },
                session,
                correlationId,
                operationId
            });

        this.statistics.poison++;

        this.metrics?.increment?.(
            'payment_airtel_dlq_poison_total'
        );

        return result;
    }


    /**
     * =========================================================================
     * Find / Inspect
     * =========================================================================
     */
    async findById({
        dlqId,
        tenantId,
        session
    } = {}) {
        if (
            this.repository &&
            isFunction(
                this.repository.findById
            )
        ) {
            return this.repository.findById(
                {
                    dlqId,
                    tenantId,
                    session
                }
            );
        }

        if (
            this.repository &&
            isFunction(
                this.repository.findOne
            )
        ) {
            return this.repository.findOne({
                dlqId,
                tenantId,
                provider:
                    PROVIDER,
                session
            });
        }

        throw createQueueError(
            'AIRTEL_DLQ_LOOKUP_UNAVAILABLE',
            'Dead-letter repository does not support lookup'
        );
    }


    async list({
        tenantId,
        status,
        failureClass,
        limit = 100,
        cursor,
        session
    } = {}) {
        const resolvedTenantId =
            await this.requireTenant({
                tenantId
            });

        const normalizedLimit =
            Math.min(
                Math.max(
                    Number(limit) || 1,
                    1
                ),
                500
            );

        if (
            this.repository &&
            isFunction(
                this.repository.list
            )
        ) {
            return this.repository.list({
                tenantId:
                    resolvedTenantId,

                provider:
                    PROVIDER,

                status,

                failureClass,

                limit:
                    normalizedLimit,

                cursor,

                session
            });
        }

        if (
            this.repository &&
            isFunction(
                this.repository.find
            )
        ) {
            return this.repository.find({
                tenantId:
                    resolvedTenantId,

                provider:
                    PROVIDER,

                status,

                failureClass,

                limit:
                    normalizedLimit,

                cursor,

                session
            });
        }

        throw createQueueError(
            'AIRTEL_DLQ_LIST_UNAVAILABLE',
            'Dead-letter repository does not support listing'
        );
    }


    /**
     * =========================================================================
     * State Transition
     * =========================================================================
     */
    async transition({
        dlqId,
        tenantId,
        expectedStatus,
        expectedStatuses,
        nextStatus,
        update = {},
        session,
        correlationId,
        operationId
    } = {}) {
        const allowedExpectedStatuses =
            expectedStatuses ||
            (
                expectedStatus
                    ? [expectedStatus]
                    : []
            );

        if (
            !dlqId
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_ID_REQUIRED',
                'dlqId is required for state transition'
            );
        }

        if (
            !Object.values(
                DLQ_STATUS
            ).includes(
                nextStatus
            )
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_STATUS_INVALID',
                `Invalid DLQ target status: ${nextStatus}`
            );
        }

        if (
            this.repository &&
            isFunction(
                this.repository.transition
            )
        ) {
            return this.repository.transition({
                dlqId,
                tenantId,
                provider:
                    PROVIDER,
                expectedStatuses:
                    allowedExpectedStatuses,
                nextStatus,
                update,
                session,
                correlationId,
                operationId
            });
        }

        if (
            this.repository &&
            isFunction(
                this.repository.compareAndSetStatus
            )
        ) {
            return this.repository.compareAndSetStatus({
                dlqId,
                tenantId,
                provider:
                    PROVIDER,
                expectedStatuses:
                    allowedExpectedStatuses,
                nextStatus,
                update,
                session,
                correlationId,
                operationId
            });
        }

        if (
            this.repository &&
            isFunction(
                this.repository.update
            )
        ) {
            this.logger?.warn?.({
                message:
                    'Using non-atomic Airtel DLQ status update compatibility path',
                provider:
                    PROVIDER,
                dlqId,
                tenantId,
                nextStatus,
                correlationId,
                operationId
            });

            return this.repository.update(
                dlqId,
                {
                    ...update,

                    tenantId,

                    provider:
                        PROVIDER,

                    status:
                        nextStatus,

                    expectedStatus:
                        expectedStatus,

                    expectedStatuses:
                        allowedExpectedStatuses,

                    session
                }
            );
        }

        throw createQueueError(
            'AIRTEL_DLQ_TRANSITION_UNAVAILABLE',
            'Dead-letter repository does not support state transition'
        );
    }


    /**
     * =========================================================================
     * Tenant
     * =========================================================================
     */
    async requireTenant({
        tenantId,
        context = {}
    } = {}) {
        let resolved =
            tenantId;

        if (
            (
                resolved === undefined ||
                resolved === null ||
                String(
                    resolved
                ).trim() === ''
            ) &&
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            resolved =
                await this.tenantResolver.resolve(
                    context
                );
        }

        if (
            resolved === undefined ||
            resolved === null ||
            String(
                resolved
            ).trim() === ''
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_TENANT_REQUIRED',
                'Tenant context is required'
            );
        }

        return String(
            resolved
        );
    }


    hashTenant(
        tenantId
    ) {
        return crypto
            .createHash('sha256')
            .update(
                String(
                    tenantId
                )
            )
            .digest('hex');
    }


    buildIdempotencyKey({
        tenantId,
        callbackFingerprint,
        paymentReference,
        providerReference,
        operationId,
        sourceEventId
    }) {
        return crypto
            .createHash('sha256')
            .update(
                [
                    PROVIDER,

                    tenantId || '',

                    callbackFingerprint || '',

                    paymentReference || '',

                    providerReference || '',

                    sourceEventId || '',

                    operationId || ''
                ].join('|')
            )
            .digest('hex');
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
                    sanitizeMetadata(
                        metadata,
                        this.maxMetadataBytes
                    )
            });
        } catch (error) {
            this.logger?.error?.({
                message:
                    'Airtel DLQ audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                action,
                error:
                    sanitizeError(
                        error
                    )
            });
        }
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {
        const repositoryHealth =
            await this.safeHealth(
                this.repository
            );

        const queueHealth =
            await this.safeHealth(
                this.queueAdapter
            );

        const hasStorage =
            Boolean(
                this.repository ||
                this.queueAdapter
            );

        const hasDown =
            repositoryHealth.status ===
                'DOWN' ||
            queueHealth.status ===
                'DOWN';

        return {
            provider:
                PROVIDER,

            module:
                'queue.deadLetterQueue',

            status:
                hasDown
                    ? 'DOWN'
                    : hasStorage
                        ? 'UP'
                        : 'DEGRADED',

            storage:
                repositoryHealth,

            queueAdapter:
                queueHealth,

            tenantAware:
                Boolean(
                    this.tenantResolver
                ),

            maxPayloadBytes:
                this.maxPayloadBytes,

            maxMetadataBytes:
                this.maxMetadataBytes,

            maxAttempts:
                this.maxAttempts,

            visibilityTimeoutMs:
                this.visibilityTimeoutMs,

            retentionDays:
                this.retentionDays,

            statistics: {
                ...this.statistics
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
                return sanitize(
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
                    sanitizeError(
                        error
                    )
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
                'queue.deadLetterQueue',

            architecture: {
                repository:
                    Boolean(
                        this.repository
                    ),

                queueAdapter:
                    Boolean(
                        this.queueAdapter
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                auditService:
                    Boolean(
                        this.auditService
                    ),

                directFinancialMutation:
                    false,

                automaticPaymentRetry:
                    false
            },

            policy: {
                maxPayloadBytes:
                    this.maxPayloadBytes,

                maxMetadataBytes:
                    this.maxMetadataBytes,

                maxAttempts:
                    this.maxAttempts,

                visibilityTimeoutMs:
                    this.visibilityTimeoutMs,

                retentionDays:
                    this.retentionDays
            },

            statuses:
                Object.values(
                    DLQ_STATUS
                ),

            failureClasses:
                Object.values(
                    FAILURE_CLASS
                ),

            statistics: {
                ...this.statistics
            },

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()
        };
    }


    /**
     * =========================================================================
     * Utility
     * =========================================================================
     */
    normalizePositiveInteger(
        value,
        name
    ) {
        const number =
            Number(value);

        if (
            !Number.isSafeInteger(
                number
            ) ||
            number <= 0
        ) {
            throw createQueueError(
                'AIRTEL_DLQ_CONFIGURATION_INVALID',
                `${name} must be a positive safe integer`
            );
        }

        return number;
    }


    retentionDate() {
        return new Date(
            Date.now() +
            this.retentionDays *
            24 *
            60 *
            60 *
            1000
        );
    }


    safeErrorForLog(
        error
    ) {
        return sanitizeError(
            error
        );
    }
}


/**
 * ============================================================================
 * Factory
 * ============================================================================
 */
function createDeadLetterQueue(
    options = {}
) {
    return new AirtelDeadLetterQueue(
        options
    );
}


/**
 * ============================================================================
 * Public API
 * ============================================================================
 */
module.exports =
    AirtelDeadLetterQueue;

module.exports.AirtelDeadLetterQueue =
    AirtelDeadLetterQueue;

module.exports.createDeadLetterQueue =
    createDeadLetterQueue;

module.exports.PROVIDER =
    PROVIDER;

module.exports.DLQ_STATUS =
    DLQ_STATUS;

module.exports.FAILURE_CLASS =
    FAILURE_CLASS;

module.exports.DEFAULTS =
    DEFAULTS;