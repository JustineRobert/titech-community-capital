'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Payment Domain Event Publisher
 * ============================================================================
 *
 * Enterprise in-process payment domain event dispatcher.
 *
 * Responsibilities
 * ----------------
 * • Payment domain event publication
 * • Event envelope normalization
 * • Event ID generation
 * • Correlation/request propagation
 * • Tenant context propagation
 * • Event schema/versioning
 * • Listener registration
 * • Listener removal
 * • Listener failure isolation
 * • Listener execution timeout protection
 * • Structured logging
 * • Metrics instrumentation
 * • Audit hooks
 * • Operational diagnostics
 * • Graceful shutdown
 *
 * IMPORTANT
 * ---------
 * This component is an IN-PROCESS dispatcher.
 *
 * It is NOT a replacement for:
 *
 * • Transactional Outbox
 * • Kafka
 * • RabbitMQ
 * • Redis Streams
 * • AWS SNS/SQS
 *
 * Durable financial events should be persisted through the
 * application's Outbox/Event Publisher infrastructure.
 *
 * The publisher should therefore be treated as a domain-level
 * dispatch abstraction that can later be backed by durable
 * infrastructure without changing payment services.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'PAYMENT';

const DEFAULT_EVENT_VERSION = '1.0';

const DEFAULT_LISTENER_TIMEOUT_MS = 10000;

const DEFAULT_MAX_LISTENERS = 100;

const EVENT_STATUS = Object.freeze({

    PUBLISHED:
        'PUBLISHED',

    PARTIAL_FAILURE:
        'PARTIAL_FAILURE',

    FAILED:
        'FAILED'

});


class PaymentEventPublisher {


    constructor({

        logger = null,

        metrics = null,

        auditService = null,

        eventBus = null,

        listenerTimeoutMs =
            DEFAULT_LISTENER_TIMEOUT_MS,

        maxListeners =
            DEFAULT_MAX_LISTENERS,

        serviceName =
            'payment-event-publisher',

        eventVersion =
            DEFAULT_EVENT_VERSION

    } = {}) {


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.auditService =
            auditService;


        /**
         * Optional downstream event bus.
         *
         * This should NOT be confused with the local
         * listener registry.
         */
        this.eventBus =
            eventBus;


        this.listenerTimeoutMs =
            listenerTimeoutMs;


        this.maxListeners =
            maxListeners;


        this.serviceName =
            serviceName;


        this.eventVersion =
            eventVersion;


        /**
         * Listener registry.
         *
         * Map gives every listener a stable identity and
         * makes unsubscribe() deterministic.
         */
        this.listeners =
            new Map();


        this.startedAt =
            new Date();


        this.shuttingDown =
            false;


        this.statistics = {

            published:
                0,

            successful:
                0,

            failed:
                0,

            partialFailures:
                0,

            listenerInvocations:
                0,

            listenerFailures:
                0,

            listenerTimeouts:
                0

        };


    }


    /**
     * =========================================================================
     * Subscribe
     * =========================================================================
     *
     * Backward compatible:
     *
     * publisher.subscribe(listener)
     *
     * Also supports:
     *
     * publisher.subscribe(listener, {
     *     id: 'aml-handler'
     * })
     *
     * Returns an unsubscribe function.
     */
    subscribe(
        listener,
        options = {}
    ) {


        if (
            typeof listener !== 'function'
        ) {

            throw new TypeError(
                'Payment event listener must be a function'
            );

        }


        if (this.shuttingDown) {

            throw new Error(
                'Payment event publisher is shutting down'
            );

        }


        if (
            this.listeners.size >=
            this.maxListeners
        ) {

            throw new Error(
                `Maximum payment event listeners exceeded (${this.maxListeners})`
            );

        }


        const listenerId =
            options.id
            ||
            crypto.randomUUID();


        if (
            this.listeners.has(listenerId)
        ) {

            throw new Error(
                `Payment event listener already registered: ${listenerId}`
            );

        }


        const registration = {

            id:
                listenerId,

            listener,

            name:
                options.name
                ||
                listener.name
                ||
                listenerId,

            subscribedAt:
                new Date(),

            metadata:
                this.sanitizeMetadata(
                    options.metadata || {}
                )

        };


        this.listeners.set(
            listenerId,
            registration
        );


        this.metrics?.gauge?.(
            'payment_event_listener_count',
            this.listeners.size
        );


        this.logger?.info?.({

            message:
                'Payment event listener registered',

            listenerId,

            listenerName:
                registration.name,

            listenerCount:
                this.listeners.size

        });


        /**
         * Convenient unsubscribe contract.
         */
        return () =>
            this.unsubscribe(listenerId);


    }


    /**
     * =========================================================================
     * Unsubscribe
     * =========================================================================
     */
    unsubscribe(listenerOrId) {


        let listenerId =
            listenerOrId;


        /**
         * Allow unsubscribe(listenerFunction)
         * as well as unsubscribe(listenerId).
         */
        if (
            typeof listenerOrId === 'function'
        ) {

            for (
                const [
                    id,
                    registration
                ]
                of this.listeners.entries()
            ) {

                if (
                    registration.listener ===
                    listenerOrId
                ) {

                    listenerId = id;

                    break;

                }

            }

        }


        const removed =
            this.listeners.delete(
                listenerId
            );


        if (removed) {

            this.metrics?.gauge?.(
                'payment_event_listener_count',
                this.listeners.size
            );

        }


        return removed;

    }


    /**
     * =========================================================================
     * Publish
     * =========================================================================
     *
     * Existing contract remains:
     *
     * await publisher.publish(event)
     *
     * Returns an enterprise event publication result.
     */
    async publish(event) {


        if (this.shuttingDown) {

            throw new Error(
                'Payment event publisher is shutting down'
            );

        }


        const normalizedEvent =
            this.createEventEnvelope(
                event
            );


        this.statistics.published++;


        const startedAt =
            Date.now();


        this.metrics?.counter?.(
            'payment_domain_event_published_total'
        );


        this.logger?.debug?.({

            message:
                'Payment domain event publishing',

            eventId:
                normalizedEvent.eventId,

            eventType:
                normalizedEvent.eventType,

            tenantId:
                normalizedEvent.tenantId,

            correlationId:
                normalizedEvent.correlationId

        });


        const results = [];

        let failureCount = 0;


        /**
         * Snapshot prevents modifications to the
         * listener registry during publication from
         * affecting the current publication cycle.
         */
        const registrations =
            Array.from(
                this.listeners.values()
            );


        /**
         * ---------------------------------------------------------------------
         * Local listener dispatch
         * ---------------------------------------------------------------------
         *
         * Listeners are isolated.
         *
         * One failed consumer does not prevent other
         * consumers from receiving the event.
         */
        for (
            const registration
            of registrations
        ) {


            const result =
                await this.invokeListener({

                    registration,

                    event:
                        normalizedEvent

                });


            results.push(result);


            if (!result.success) {

                failureCount++;

            }

        }


        /**
         * ---------------------------------------------------------------------
         * Optional downstream event bus
         * ---------------------------------------------------------------------
         */
        if (
            this.eventBus?.publish
        ) {

            try {

                await this.withTimeout(

                    this.eventBus.publish(
                        normalizedEvent
                    ),

                    this.listenerTimeoutMs,

                    'Payment downstream event bus publication timed out'

                );


                results.push({

                    listenerId:
                        'event-bus',

                    success:
                        true

                });


            }
            catch (error) {

                failureCount++;


                results.push({

                    listenerId:
                        'event-bus',

                    success:
                        false,

                    error:
                        this.serializeError(
                            error
                        )

                });


                this.statistics.listenerFailures++;


                this.logger?.error?.({

                    message:
                        'Payment downstream event bus publication failed',

                    eventId:
                        normalizedEvent.eventId,

                    eventType:
                        normalizedEvent.eventType,

                    correlationId:
                        normalizedEvent.correlationId,

                    error:
                        this.serializeError(
                            error
                        )

                });


                this.metrics?.counter?.(
                    'payment_domain_event_bus_failure_total'
                );

            }

        }


        const durationMs =
            Date.now() -
            startedAt;


        this.metrics?.histogram?.(
            'payment_domain_event_publish_duration_ms',
            durationMs
        );


        /**
         * ---------------------------------------------------------------------
         * Publication result
         * ---------------------------------------------------------------------
         */
        if (
            failureCount === 0
        ) {

            this.statistics.successful++;


            this.metrics?.counter?.(
                'payment_domain_event_publish_success_total'
            );


            await this.recordAudit(
                normalizedEvent,
                EVENT_STATUS.PUBLISHED
            );


            return {

                success:
                    true,

                status:
                    EVENT_STATUS.PUBLISHED,

                event:
                    normalizedEvent,

                eventId:
                    normalizedEvent.eventId,

                listenerCount:
                    registrations.length,

                failures:
                    0,

                durationMs

            };

        }


        if (
            failureCount <
            results.length
        ) {

            this.statistics.partialFailures++;


            this.metrics?.counter?.(
                'payment_domain_event_partial_failure_total'
            );


            await this.recordAudit(
                normalizedEvent,
                EVENT_STATUS.PARTIAL_FAILURE
            );


            return {

                success:
                    false,

                status:
                    EVENT_STATUS.PARTIAL_FAILURE,

                event:
                    normalizedEvent,

                eventId:
                    normalizedEvent.eventId,

                listenerCount:
                    registrations.length,

                failures:
                    failureCount,

                results,

                durationMs

            };

        }


        this.statistics.failed++;


        this.metrics?.counter?.(
            'payment_domain_event_publish_failure_total'
        );


        await this.recordAudit(
            normalizedEvent,
            EVENT_STATUS.FAILED
        );


        return {

            success:
                false,

            status:
                EVENT_STATUS.FAILED,

            event:
                normalizedEvent,

            eventId:
                normalizedEvent.eventId,

            listenerCount:
                registrations.length,

            failures:
                failureCount,

            results,

            durationMs

        };

    }


    /**
     * =========================================================================
     * Invoke Listener
     * =========================================================================
     */
    async invokeListener({

        registration,

        event

    }) {


        this.statistics.listenerInvocations++;


        const startedAt =
            Date.now();


        try {


            await this.withTimeout(

                Promise.resolve(
                    registration.listener(
                        event
                    )
                ),

                this.listenerTimeoutMs,

                `Payment event listener timed out: ${registration.id}`

            );


            const durationMs =
                Date.now() -
                startedAt;


            this.metrics?.counter?.(
                'payment_domain_event_listener_success_total'
            );


            this.metrics?.histogram?.(
                'payment_domain_event_listener_duration_ms',
                durationMs
            );


            return {

                listenerId:
                    registration.id,

                listenerName:
                    registration.name,

                success:
                    true,

                durationMs

            };


        }
        catch (error) {


            const durationMs =
                Date.now() -
                startedAt;


            const isTimeout =
                error?.code ===
                'PAYMENT_EVENT_LISTENER_TIMEOUT';


            this.statistics.listenerFailures++;


            if (isTimeout) {

                this.statistics.listenerTimeouts++;


                this.metrics?.counter?.(
                    'payment_domain_event_listener_timeout_total'
                );

            }
            else {

                this.metrics?.counter?.(
                    'payment_domain_event_listener_failure_total'
                );

            }


            this.logger?.error?.({

                message:
                    isTimeout
                        ? 'Payment event listener timed out'
                        : 'Payment event listener failed',

                eventId:
                    event.eventId,

                eventType:
                    event.eventType,

                tenantId:
                    event.tenantId,

                correlationId:
                    event.correlationId,

                listenerId:
                    registration.id,

                listenerName:
                    registration.name,

                durationMs,

                error:
                    this.serializeError(
                        error
                    )

            });


            return {

                listenerId:
                    registration.id,

                listenerName:
                    registration.name,

                success:
                    false,

                durationMs,

                error:
                    this.serializeError(
                        error
                    )

            };

        }

    }


    /**
     * =========================================================================
     * Event Envelope
     * =========================================================================
     */
    createEventEnvelope(event = {}) {


        if (
            !event ||
            typeof event !== 'object'
        ) {

            throw new TypeError(
                'Payment event must be an object'
            );

        }


        const eventType =
            event.eventType
            ||
            event.type;


        if (!eventType) {

            throw new Error(
                'Payment event type is required'
            );

        }


        const eventId =
            event.eventId
            ||
            crypto.randomUUID();


        const correlationId =
            event.correlationId
            ||
            event.context?.correlationId
            ||
            crypto.randomUUID();


        const requestId =
            event.requestId
            ||
            event.context?.requestId
            ||
            null;


        const tenantId =
            event.tenantId
            ||
            event.context?.tenantId
            ||
            null;


        const aggregateId =
            event.aggregateId
            ||
            event.paymentId
            ||
            event.transactionId
            ||
            null;


        const envelope = {

            eventId,

            eventType,

            eventVersion:
                event.eventVersion
                ||
                this.eventVersion,

            provider:
                event.provider
                ||
                PROVIDER,

            service:
                event.service
                ||
                this.serviceName,

            tenantId,

            correlationId,

            requestId,

            aggregateId,

            aggregateType:
                event.aggregateType
                ||
                'PAYMENT',

            occurredAt:
                event.occurredAt
                ||
                new Date(),

            publishedAt:
                new Date(),

            payload:
                this.cloneAndSanitize(
                    event.payload
                    ??
                    event.data
                    ??
                    {}
                ),

            metadata:
                this.cloneAndSanitize(
                    event.metadata
                    ??
                    {}
                )

        };


        /**
         * Prevent accidental mutation after
         * publication preparation.
         */
        return this.deepFreeze(
            envelope
        );

    }


    /**
     * =========================================================================
     * Timeout Protection
     * =========================================================================
     */
    withTimeout(
        promise,
        timeoutMs,
        message
    ) {


        if (
            !Number.isFinite(timeoutMs) ||
            timeoutMs <= 0
        ) {

            return Promise.resolve(
                promise
            );

        }


        let timer;


        const timeout =
            new Promise(
                (_, reject) => {

                    timer =
                        setTimeout(
                            () => {

                                const error =
                                    new Error(
                                        message
                                    );


                                error.code =
                                    'PAYMENT_EVENT_LISTENER_TIMEOUT';


                                reject(error);

                            },
                            timeoutMs
                        );

                }
            );


        return Promise.race([

            Promise.resolve(
                promise
            ),

            timeout

        ]).finally(() => {

            clearTimeout(timer);

        });

    }


    /**
     * =========================================================================
     * Safe Metadata
     * =========================================================================
     */
    sanitizeMetadata(metadata = {}) {


        if (
            !metadata ||
            typeof metadata !== 'object'
        ) {

            return {};

        }


        const sensitiveKeys = new Set([

            'password',

            'secret',

            'clientSecret',

            'client_secret',

            'accessToken',

            'access_token',

            'refreshToken',

            'refresh_token',

            'authorization',

            'apiKey',

            'api_key',

            'token',

            'signature'

        ]);


        const output = {};


        for (
            const [
                key,
                value
            ]
            of Object.entries(metadata)
        ) {


            if (
                sensitiveKeys.has(key)
            ) {

                output[key] =
                    '[REDACTED]';

                continue;

            }


            output[key] =
                this.safeValue(
                    value
                );

        }


        return output;

    }


    /**
     * =========================================================================
     * Clone + Sanitize Payload
     * =========================================================================
     */
    cloneAndSanitize(value) {


        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }


        if (
            typeof value !== 'object'
        ) {

            return value;

        }


        if (
            value instanceof Date
        ) {

            return new Date(
                value.getTime()
            );

        }


        if (
            Array.isArray(value)
        ) {

            return value.map(
                item =>
                    this.cloneAndSanitize(
                        item
                    )
            );

        }


        return this.sanitizeMetadata(
            value
        );

    }


    /**
     * =========================================================================
     * Safe Value
     * =========================================================================
     */
    safeValue(value) {


        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }


        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {

            return value;

        }


        if (
            value instanceof Date
        ) {

            return value.toISOString();

        }


        if (
            Array.isArray(value)
        ) {

            return value.map(
                item =>
                    this.safeValue(
                        item
                    )
            );

        }


        if (
            typeof value === 'object'
        ) {

            return this.sanitizeMetadata(
                value
            );

        }


        return String(value);

    }


    /**
     * =========================================================================
     * Error Serialization
     * =========================================================================
     */
    serializeError(error) {


        if (!error) {

            return {

                message:
                    'Unknown error'

            };

        }


        return {

            name:
                error.name,

            code:
                error.code,

            message:
                error.message,

            retryable:
                error.retryable,

            timestamp:
                error.timestamp

        };

    }


    /**
     * =========================================================================
     * Deep Freeze
     * =========================================================================
     */
    deepFreeze(object) {


        if (
            !object ||
            typeof object !== 'object'
        ) {

            return object;

        }


        Object.freeze(object);


        for (
            const value
            of Object.values(object)
        ) {

            if (
                value &&
                typeof value === 'object' &&
                !Object.isFrozen(value)
            ) {

                this.deepFreeze(value);

            }

        }


        return object;

    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async recordAudit(
        event,
        status
    ) {


        if (
            !this.auditService?.record
        ) {

            return;

        }


        try {

            await this.auditService.record({

                action:
                    `PAYMENT_EVENT_${status}`,

                metadata: {

                    eventId:
                        event.eventId,

                    eventType:
                        event.eventType,

                    eventVersion:
                        event.eventVersion,

                    provider:
                        event.provider,

                    tenantId:
                        event.tenantId,

                    correlationId:
                        event.correlationId,

                    aggregateId:
                        event.aggregateId,

                    status

                }

            });

        }
        catch (error) {

            /**
             * Audit failure must not break payment event
             * publication.
             */
            this.logger?.error?.({

                message:
                    'Payment event audit recording failed',

                eventId:
                    event.eventId,

                eventType:
                    event.eventType,

                error:
                    this.serializeError(
                        error
                    )

            });


            this.metrics?.counter?.(
                'payment_domain_event_audit_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */
    stats() {


        return {

            ...this.statistics,

            activeListeners:
                this.listeners.size,

            listenerTimeoutMs:
                this.listenerTimeoutMs,

            maxListeners:
                this.maxListeners,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {


        const stats =
            this.stats();


        let status =
            'UP';


        if (
            this.shuttingDown
        ) {

            status =
                'DRAINING';

        }
        else if (
            stats.listenerFailures >
            0
        ) {

            status =
                'DEGRADED';

        }


        return {

            provider:
                PROVIDER,

            service:
                this.serviceName,

            status,

            startedAt:
                this.startedAt,

            listenerCount:
                this.listeners.size,

            statistics:
                stats()

        };

    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    snapshot() {


        return {

            service:
                this.serviceName,

            provider:
                PROVIDER,

            shuttingDown:
                this.shuttingDown,

            listeners:
                Array.from(
                    this.listeners.values()
                ).map(
                    registration => ({

                        id:
                            registration.id,

                        name:
                            registration.name,

                        subscribedAt:
                            registration.subscribedAt,

                        metadata:
                            registration.metadata

                    })
                ),

            statistics:
                this.stats(),

            generatedAt:
                new Date()

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */
    async shutdown() {


        this.shuttingDown =
            true;


        this.listeners.clear();


        this.metrics?.gauge?.(
            'payment_event_listener_count',
            0
        );


        this.logger?.info?.({

            message:
                'Payment event publisher shutdown complete',

            service:
                this.serviceName

        });


        return true;

    }

}


module.exports =
    new PaymentEventPublisher();


/**
 * Export class as well so tests, workers and dependency-injection
 * compositions can create isolated publisher instances.
 */
module.exports.PaymentEventPublisher =
    PaymentEventPublisher;


/**
 * Export constants for consumers/tests.
 */
module.exports.EVENT_STATUS =
    EVENT_STATUS;