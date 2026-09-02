'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Audit Publisher
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionAuditPublisher.js
 *
 * Purpose
 * -------
 * Enterprise audit publication layer for distributed financial transaction
 * workflows.
 *
 * Responsibilities
 * ----------------
 * • Immutable audit event construction
 * • Deterministic SHA-256 integrity hashing
 * • Tenant isolation
 * • Correlation/request propagation
 * • Durable audit persistence
 * • Event-bus publication
 * • Audit idempotency
 * • Buffered delivery
 * • Retry-safe flushing
 * • Hash-chain support
 * • Security metadata redaction
 * • OpenTelemetry tracing
 * • Metrics
 * • Operational diagnostics
 *
 * IMPORTANT
 * ---------
 * The in-memory sequence/hash chain is an optimization, not the authoritative
 * distributed chain.
 *
 * For multi-instance deployments the repository should provide a durable
 * sequence/previousHash allocation mechanism.
 *
 * Financial truth remains in the ledger.
 *
 * Audit records are immutable evidence of what happened.
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


/**
 * ============================================================================
 * Severity
 * ============================================================================
 */

const AuditSeverity = Object.freeze({

    INFO:
        'INFO',

    WARNING:
        'WARNING',

    CRITICAL:
        'CRITICAL',

    SECURITY:
        'SECURITY',

    FINANCIAL:
        'FINANCIAL'

});


/**
 * ============================================================================
 * Delivery State
 * ============================================================================
 */

const DeliveryState = Object.freeze({

    BUFFERED:
        'BUFFERED',

    PERSISTING:
        'PERSISTING',

    PERSISTED:
        'PERSISTED',

    PUBLISHED:
        'PUBLISHED',

    FAILED:
        'FAILED'

});


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_MAX_BUFFER_SIZE =
    100;

const DEFAULT_MAX_BATCH_SIZE =
    100;

const DEFAULT_MAX_RETRIES =
    3;

const DEFAULT_RETRY_DELAY_MS =
    250;

const DEFAULT_MAX_METADATA_DEPTH =
    8;

const DEFAULT_MAX_STRING_LENGTH =
    5000;


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',

    'passwd',

    'secret',

    'clientSecret',

    'client_secret',

    'accessToken',

    'access_token',

    'refreshToken',

    'refresh_token',

    'authorization',

    'Authorization',

    'apiKey',

    'api_key',

    'privateKey',

    'private_key',

    'token',

    'credential',

    'credentials'

]);


/**
 * ============================================================================
 * Helper
 * ============================================================================
 */

function safeError(
    error
) {

    if (
        !error
    ) {

        return {

            name:
                'Error',

            message:
                'Unknown error',

            code:
                undefined

        };

    }


    return {

        name:
            error.name,

        message:
            String(
                error.message ||
                error
            )
                .slice(
                    0,
                    2000
                ),

        code:
            error.code,

        retryable:
            error.retryable

    };

}


/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 */

function deepFreeze(
    value,
    seen = new WeakSet()
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        seen.has(value)
    ) {

        return value;

    }


    seen.add(value);


    for (
        const key
        of Reflect.ownKeys(
            value
        )
    ) {

        deepFreeze(
            value[key],
            seen
        );

    }


    return Object.freeze(
        value
    );

}


/**
 * ============================================================================
 * Transaction Audit Publisher
 * ============================================================================
 */

class TransactionAuditPublisher {

    constructor(
        options = {}
    ) {

        this.repository =
            options.repository ||
            null;

        this.eventBus =
            options.eventBus ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics;

        this.tracer =
            options.tracer;

        this.retryPolicy =
            options.retryPolicy;

        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();

        this.maxBufferSize =
            Number(
                options.maxBufferSize ||
                DEFAULT_MAX_BUFFER_SIZE
            );

        this.maxBatchSize =
            Number(
                options.maxBatchSize ||
                DEFAULT_MAX_BATCH_SIZE
            );

        this.maxRetries =
            Number(
                options.maxRetries ??
                DEFAULT_MAX_RETRIES
            );

        this.retryDelayMs =
            Number(
                options.retryDelayMs ||
                DEFAULT_RETRY_DELAY_MS
            );

        this.autoFlush =
            options.autoFlush !== false;

        this.maxMetadataDepth =
            Number(
                options.maxMetadataDepth ||
                DEFAULT_MAX_METADATA_DEPTH
            );

        this.maxStringLength =
            Number(
                options.maxStringLength ||
                DEFAULT_MAX_STRING_LENGTH
            );

        this.buffer =
            [];

        this.flushPromise =
            null;

        this.shutdownStarted =
            false;

        this.sequence =
            0;

        this.previousHash =
            null;

        this.statistics = {

            created:
                0,

            buffered:
                0,

            persisted:
                0,

            published:
                0,

            failed:
                0,

            duplicate:
                0,

            flushes:
                0,

            retries:
                0

        };

    }


    /**
     * =========================================================================
     * Publish Audit Event
     * =========================================================================
     *
     * This method only constructs/buffers the audit event.
     *
     * Persistence happens during flush().
     */

    async publish(
        event = {}
    ) {

        if (
            this.shutdownStarted
        ) {

            throw new Error(
                'TransactionAuditPublisher is shutting down'
            );

        }


        const span =
            this.startSpan(
                'transaction.audit.publish',
                event
            );


        try {

            const auditEvent =
                await this.createAuditEvent(
                    event
                );


            this.buffer.push(
                auditEvent
            );


            this.statistics.created++;
            this.statistics.buffered++;


            this.metrics?.increment?.(
                'transaction_audit_events_created_total'
            );


            if (
                this.autoFlush &&
                this.buffer.length >=
                this.maxBufferSize
            ) {

                await this.flush();

            }


            return auditEvent;

        }
        catch (error) {

            this.statistics.failed++;


            this.metrics?.increment?.(
                'transaction_audit_event_creation_failure_total'
            );


            this.logger.error?.(

                '[TransactionAuditPublisher] Audit event creation failed',

                {

                    error:
                        safeError(error),

                    tenantId:
                        event.tenantId,

                    transactionId:
                        event.transactionId,

                    correlationId:
                        event.correlationId

                }

            );


            this.setSpanError(
                span,
                error
            );


            throw error;

        }
        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Create Audit Event
     * =========================================================================
     *
     * Durable repositories may provide the authoritative chain checkpoint.
     *
     * Supported repository hook:
     *
     *   allocateAuditSequence({
     *       tenantId,
     *       previousHash
     *   })
     *
     * Returning:
     *
     *   {
     *       sequence,
     *       previousHash
     *   }
     *
     * This removes dependence on process-local sequence numbers in a
     * multi-instance deployment.
     */

    async createAuditEvent(
        event = {}
    ) {

        const timestamp =
            new Date();


        const tenantId =
            event.tenantId ||
            null;


        const auditId =
            event.auditId ||
            crypto.randomUUID();


        let sequence =
            this.sequence + 1;


        let previousHash =
            this.previousHash;


        if (
            typeof this.repository?.allocateAuditSequence ===
            'function'
        ) {

            const allocation =
                await this.repository
                    .allocateAuditSequence({

                        tenantId,

                        previousHash

                    });


            if (
                allocation
            ) {

                if (
                    Number.isFinite(
                        Number(
                            allocation.sequence
                        )
                    )
                ) {

                    sequence =
                        Number(
                            allocation.sequence
                        );

                }

                if (
                    allocation.previousHash !==
                    undefined
                ) {

                    previousHash =
                        allocation.previousHash ||
                        null;

                }

            }

        }


        const payload = {

            auditId,

            sequence,

            timestamp,

            severity:
                this.normalizeSeverity(
                    event.severity
                ),

            type:
                event.type ||
                'TRANSACTION_EVENT',

            transactionId:
                event.transactionId ||
                null,

            correlationId:
                event.correlationId ||
                null,

            requestId:
                event.requestId ||
                null,

            tenantId,

            organizationId:
                event.organizationId ||
                null,

            userId:
                event.userId ||
                null,

            service:
                event.service ||
                'transaction-system',

            action:
                event.action ||
                null,

            entity:
                event.entity ||
                null,

            metadata:
                this.sanitizeMetadata(
                    event.metadata ||
                    {}
                ),

            source:
                event.source ||
                this.instanceId,

            previousHash,

            deliveryState:
                DeliveryState.BUFFERED,

            /**
             * Replay-safe identity.
             *
             * If supplied by the caller, the same business audit event can be
             * recognized by the repository.
             */
            idempotencyKey:
                event.idempotencyKey ||
                null

        };


        payload.hash =
            this.generateHash(
                payload
            );


        this.sequence =
            sequence;

        this.previousHash =
            payload.hash;


        return deepFreeze(
            payload
        );

    }


    /**
     * =========================================================================
     * Deterministic Hash
     * =========================================================================
     */

    generateHash(
        payload
    ) {

        const canonical =
            this.canonicalize(
                {

                    ...payload,

                    hash:
                        undefined

                }
            );


        return crypto

            .createHash(
                'sha256'
            )

            .update(
                JSON.stringify(
                    canonical
                ),
                'utf8'
            )

            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Canonicalization
     * =========================================================================
     */

    canonicalize(
        value,
        depth = 0
    ) {

        if (
            depth >
            this.maxMetadataDepth
        ) {

            return '[MAX_DEPTH]';

        }


        if (
            value ===
            null ||
            typeof value !==
            'object'
        ) {

            if (
                typeof value ===
                'string'
            ) {

                return value.slice(
                    0,
                    this.maxStringLength
                );

            }

            if (
                value instanceof Date
            ) {

                return value.toISOString();

            }

            return value;

        }


        if (
            value instanceof Date
        ) {

            return value.toISOString();

        }


        if (
            Array.isArray(
                value
            )
        ) {

            return value.map(
                item =>
                    this.canonicalize(
                        item,
                        depth + 1
                    )
            );

        }


        return Object.keys(
            value
        )
            .sort()
            .reduce(

                (
                    output,
                    key
                ) => {

                    output[key] =
                        this.canonicalize(
                            value[key],
                            depth + 1
                        );

                    return output;

                },

                {}

            );

    }


    /**
     * =========================================================================
     * Flush
     * =========================================================================
     *
     * Important:
     *
     * We do NOT remove events permanently before durable persistence succeeds.
     *
     * Persistence and event-bus publication are treated as separate delivery
     * stages.
     */

    async flush() {

        if (
            this.flushPromise
        ) {

            return this.flushPromise;

        }


        if (
            this.buffer.length ===
            0
        ) {

            return [];

        }


        this.flushPromise =
            this.executeFlush();


        try {

            return await this.flushPromise;

        }
        finally {

            this.flushPromise =
                null;

        }

    }


    /**
     * =========================================================================
     * Execute Flush
     * =========================================================================
     */

    async executeFlush() {

        this.statistics.flushes++;


        const batch =
            this.buffer
                .slice(
                    0,
                    this.maxBatchSize
                );


        if (
            batch.length ===
            0
        ) {

            return [];

        }


        const startedAt =
            Date.now();


        try {

            this.markDeliveryState(
                batch,
                DeliveryState.PERSISTING
            );


            /**
             * ---------------------------------------------------------------
             * Durable persistence.
             * ---------------------------------------------------------------
             */

            await this.persistWithRetry(
                batch
            );


            this.statistics.persisted +=
                batch.length;


            this.metrics?.increment?.(
                'transaction_audit_events_persisted_total',
                {

                    count:
                        batch.length

                }
            );


            this.markDeliveryState(
                batch,
                DeliveryState.PERSISTED
            );


            /**
             * ---------------------------------------------------------------
             * Remove only the records that were actually persisted.
             * ---------------------------------------------------------------
             */

            this.removePersistedBatch(
                batch
            );


            /**
             * ---------------------------------------------------------------
             * Event bus publication is best-effort and independently retryable.
             * ---------------------------------------------------------------
             */

            await this.publishEventsSafely(
                batch
            );


            this.metrics?.histogram?.(

                'transaction_audit_flush_duration_ms',

                Date.now() -
                startedAt

            );


            /**
             * ---------------------------------------------------------------
             * Continue draining if additional records remain.
             * ---------------------------------------------------------------
             */

            if (
                this.buffer.length > 0 &&
                this.autoFlush
            ) {

                return this.flush();

            }


            return batch;

        }
        catch (error) {

            this.statistics.failed +=
                batch.length;


            this.markDeliveryState(
                batch,
                DeliveryState.FAILED
            );


            /**
             * Keep failed records buffered for a future flush/retry.
             */
            this.logger.error?.(

                '[TransactionAuditPublisher] Audit flush failed',

                {

                    batchSize:
                        batch.length,

                    error:
                        safeError(
                            error
                        )

                }

            );


            this.metrics?.increment?.(
                'transaction_audit_flush_failure_total'
            );


            throw error;

        }

    }


    /**
     * =========================================================================
     * Persist
     * =========================================================================
     */

    async persist(
        events
    ) {

        if (
            !this.repository
        ) {

            return;

        }


        const immutableEvents =
            events.map(
                event =>
                    this.cloneForPersistence(
                        event
                    )
            );


        if (
            typeof this.repository.bulkCreate ===
            'function'
        ) {

            return this.repository.bulkCreate(
                immutableEvents
            );

        }


        if (
            typeof this.repository.createMany ===
            'function'
        ) {

            return this.repository.createMany(
                immutableEvents
            );

        }


        if (
            typeof this.repository.create ===
            'function'
        ) {

            for (
                const event
                of immutableEvents
            ) {

                try {

                    await this.repository.create(
                        event
                    );

                }
                catch (error) {

                    if (
                        this.isDuplicateError(
                            error
                        )
                    ) {

                        this.statistics.duplicate++;

                        continue;

                    }


                    throw error;

                }

            }

            return;

        }


        throw new Error(
            'Audit repository does not implement create(), createMany(), or bulkCreate()'
        );

    }


    /**
     * =========================================================================
     * Persist With Retry
     * =========================================================================
     */

    async persistWithRetry(
        events
    ) {

        let attempt =
            0;

        let lastError;


        while (
            attempt <=
            this.maxRetries
        ) {

            attempt++;


            try {

                if (
                    this.retryPolicy?.execute
                ) {

                    return await this.retryPolicy.execute(

                        () =>
                            this.persist(
                                events
                            ),

                        {

                            operation:
                                'transaction-audit-persist',

                            attempt

                        }

                    );

                }


                return await this.persist(
                    events
                );

            }
            catch (error) {

                lastError =
                    error;


                if (
                    attempt >
                    this.maxRetries
                ) {

                    break;

                }


                if (
                    !this.isRetryableError(
                        error
                    )
                ) {

                    throw error;

                }


                this.statistics.retries++;


                await this.sleep(

                    this.retryDelayMs *
                    Math.pow(
                        2,
                        attempt - 1
                    )

                );

            }

        }


        throw lastError;

    }


    /**
     * =========================================================================
     * Publish Events
     * =========================================================================
     */

    async publishEvents(
        events
    ) {

        if (
            !this.eventBus
        ) {

            return;

        }


        for (
            const event
            of events
        ) {

            await this.eventBus.publish({

                type:
                    'audit.transaction.event',

                eventId:
                    event.auditId,

                payload:
                    event

            });


            this.statistics.published++;


            this.metrics?.increment?.(
                'transaction_audit_events_published_total'
            );

        }

    }


    /**
     * =========================================================================
     * Safe Event Publication
     * =========================================================================
     *
     * Publication failure is intentionally NOT persisted again.
     *
     * The audit record is already durable.
     *
     * A real implementation should use an outbox or publication-status field
     * for durable event delivery.
     */

    async publishEventsSafely(
        events
    ) {

        try {

            this.markDeliveryState(
                events,
                DeliveryState.PUBLISHED
            );


            await this.publishEvents(
                events
            );

        }
        catch (error) {

            this.metrics?.increment?.(
                'transaction_audit_event_publication_failure_total'
            );


            this.logger.warn?.(

                '[TransactionAuditPublisher] Event publication failed after persistence',

                {

                    batchSize:
                        events.length,

                    error:
                        safeError(
                            error
                        )

                }

            );

        }

    }


    /**
     * =========================================================================
     * Remove Persisted Batch
     * =========================================================================
     */

    removePersistedBatch(
        batch
    ) {

        const persistedIds =
            new Set(

                batch.map(
                    event =>
                        event.auditId
                )

            );


        this.buffer =
            this.buffer.filter(
                event =>
                    !persistedIds.has(
                        event.auditId
                    )
            );


        this.statistics.buffered =
            this.buffer.length;

    }


    /**
     * =========================================================================
     * Delivery State
     * =========================================================================
     */

    markDeliveryState(
        events,
        state
    ) {

        /**
         * Frozen events are intentionally replaced in memory rather than
         * mutated.
         */
        const byId =
            new Map(

                events.map(
                    event =>
                        [
                            event.auditId,
                            event
                        ]
                )

            );


        this.buffer =
            this.buffer.map(

                event => {

                    if (
                        byId.has(
                            event.auditId
                        )
                    ) {

                        return deepFreeze({

                            ...event,

                            deliveryState:
                                state

                        });

                    }


                    return event;

                }

            );

    }


    /**
     * =========================================================================
     * Convenience Methods
     * =========================================================================
     */

    async transactionCreated(
        context
    ) {

        return this.publish({

            type:
                'TRANSACTION_CREATED',

            severity:
                AuditSeverity.FINANCIAL,

            action:
                'TRANSACTION_CREATED',

            ...context

        });

    }


    async transactionCommitted(
        context
    ) {

        return this.publish({

            type:
                'TRANSACTION_COMMITTED',

            severity:
                AuditSeverity.FINANCIAL,

            action:
                'TRANSACTION_COMMITTED',

            ...context

        });

    }


    async transactionFailed(
        context
    ) {

        return this.publish({

            type:
                'TRANSACTION_FAILED',

            severity:
                AuditSeverity.CRITICAL,

            action:
                'TRANSACTION_FAILED',

            ...context

        });

    }


    async transactionRolledBack(
        context
    ) {

        return this.publish({

            type:
                'TRANSACTION_ROLLED_BACK',

            severity:
                AuditSeverity.FINANCIAL,

            action:
                'TRANSACTION_ROLLED_BACK',

            ...context

        });

    }


    async compensationCompleted(
        context
    ) {

        return this.publish({

            type:
                'COMPENSATION_COMPLETED',

            severity:
                AuditSeverity.FINANCIAL,

            action:
                'COMPENSATION_COMPLETED',

            ...context

        });

    }


    async compensationFailed(
        context
    ) {

        return this.publish({

            type:
                'COMPENSATION_FAILED',

            severity:
                AuditSeverity.CRITICAL,

            action:
                'COMPENSATION_FAILED',

            ...context

        });

    }


    async securityEvent(
        context
    ) {

        return this.publish({

            type:
                'SECURITY_EVENT',

            severity:
                AuditSeverity.SECURITY,

            action:
                context.action ||
                'SECURITY_EVENT',

            ...context

        });

    }


    /**
     * =========================================================================
     * Hash Chain Verification
     * =========================================================================
     */

    verifyChain(
        events
    ) {

        if (
            !Array.isArray(
                events
            )
        ) {

            return false;

        }


        let previousHash =
            null;


        for (
            const event
            of events
        ) {

            if (
                event.previousHash !==
                previousHash
            ) {

                return false;

            }


            const expected =
                this.generateHash(
                    event
                );


            if (
                expected !==
                event.hash
            ) {

                return false;

            }


            previousHash =
                event.hash;

        }


        return true;

    }


    /**
     * =========================================================================
     * Verify Individual Record
     * =========================================================================
     */

    verifyEvent(
        event
    ) {

        if (
            !event ||
            !event.hash
        ) {

            return false;

        }


        return (

            this.generateHash(
                event
            ) ===
            event.hash

        );

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    getStatistics() {

        return {

            instanceId:
                this.instanceId,

            sequence:
                this.sequence,

            buffered:
                this.buffer.length,

            lastHash:
                this.previousHash,

            flushInProgress:
                Boolean(
                    this.flushPromise
                ),

            shutdownStarted:
                this.shutdownStarted,

            statistics:
                {

                    ...this.statistics

                }

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let repositoryStatus =
            'NOT_CONFIGURED';


        if (
            this.repository &&
            typeof this.repository.health ===
            'function'
        ) {

            try {

                const health =
                    await this.repository.health();


                repositoryStatus =
                    health?.status ||
                    'UNKNOWN';

            }
            catch (error) {

                repositoryStatus =
                    'DOWN';

            }

        }


        return {

            status:
                repositoryStatus ===
                'DOWN'

                    ? 'DEGRADED'

                    : 'UP',

            component:
                'transaction-audit-publisher',

            repository:
                repositoryStatus,

            eventBus:
                this.eventBus
                    ? 'CONFIGURED'
                    : 'NOT_CONFIGURED',

            buffered:
                this.buffer.length,

            sequence:
                this.sequence

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.shutdownStarted =
            true;


        try {

            await this.flush();

        }
        catch (error) {

            this.logger.error?.(

                '[TransactionAuditPublisher] Shutdown flush failed',

                {

                    error:
                        safeError(
                            error
                        ),

                    buffered:
                        this.buffer.length

                }

            );


            throw error;

        }

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    normalizeSeverity(
        severity
    ) {

        const value =
            String(
                severity ||
                AuditSeverity.INFO
            )
                .trim()
                .toUpperCase();


        return Object.values(
            AuditSeverity
        )
            .includes(
                value
            )

            ? value

            : AuditSeverity.INFO;

    }


    /**
     * =========================================================================
     * Metadata Sanitization
     * =========================================================================
     */

    sanitizeMetadata(
        metadata,
        depth = 0
    ) {

        if (
            depth >
            this.maxMetadataDepth
        ) {

            return '[MAX_DEPTH]';

        }


        if (
            metadata ===
            null ||
            metadata ===
            undefined
        ) {

            return metadata;

        }


        if (
            typeof metadata ===
            'string'
        ) {

            return metadata.slice(
                0,
                this.maxStringLength
            );

        }


        if (
            typeof metadata !==
            'object'
        ) {

            return metadata;

        }


        if (
            metadata instanceof Date
        ) {

            return metadata.toISOString();

        }


        if (
            Array.isArray(
                metadata
            )
        ) {

            return metadata.map(
                item =>
                    this.sanitizeMetadata(
                        item,
                        depth + 1
                    )
            );

        }


        const output = {};


        for (
            const [
                key,
                value
            ]
            of Object.entries(
                metadata
            )
        ) {

            if (
                SENSITIVE_FIELDS.has(
                    key
                )
            ) {

                output[key] =
                    '[REDACTED]';

                continue;

            }


            output[key] =
                this.sanitizeMetadata(
                    value,
                    depth + 1
                );

        }


        return output;

    }


    /**
     * =========================================================================
     * Persistence Clone
     * =========================================================================
     */

    cloneForPersistence(
        event
    ) {

        return JSON.parse(

            JSON.stringify(
                event
            )

        );

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    isRetryableError(
        error
    ) {

        if (
            typeof error?.retryable ===
            'boolean'
        ) {

            return error.retryable;

        }


        const status =
            Number(
                error?.statusCode ||
                error?.status
            );


        if (
            status >= 500 ||
            status === 408 ||
            status === 409 ||
            status === 429
        ) {

            return true;

        }


        return [

            'ETIMEDOUT',

            'ECONNRESET',

            'ECONNREFUSED',

            'ECONNABORTED',

            'EAI_AGAIN',

            'NETWORK_ERROR',

            'SERVICE_UNAVAILABLE'

        ].includes(

            String(
                error?.code ||
                ''
            )
                .toUpperCase()

        );

    }


    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */

    isDuplicateError(
        error
    ) {

        return (
            error?.code ===
            11000
        );

    }


    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        event
    ) {

        try {

            return this.tracer?.startSpan?.(

                name,

                {

                    attributes: {

                        'transaction.id':
                            event?.transactionId,

                        'tenant.id':
                            event?.tenantId,

                        'correlation.id':
                            event?.correlationId

                    }

                }

            );

        }
        catch (_) {

            return null;

        }

    }


    setSpanError(
        span,
        error
    ) {

        try {

            span?.recordException?.(
                error
            );

            span?.setStatus?.({

                code:
                    2,

                message:
                    error?.message

            });

        }
        catch (_) {
            // Never allow tracing to affect auditing.
        }

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        ms
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}


TransactionAuditPublisher.Severity =
    AuditSeverity;

TransactionAuditPublisher.DeliveryState =
    DeliveryState;


module.exports =
    TransactionAuditPublisher;


module.exports.TransactionAuditPublisher =
    TransactionAuditPublisher;


module.exports.AuditSeverity =
    AuditSeverity;


module.exports.DeliveryState =
    DeliveryState;