'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/events/EventBus.js
 *
 * Enterprise Event Bus
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Domain event publishing
 * • Audit event publishing
 * • Payment events
 * • Ledger events
 * • Notification events
 * • Background workflow events
 * • BullMQ integration foundation
 * • Distributed tracing propagation
 * • Metrics integration
 * • Logger enrichment
 * *
 * Characteristics
 * -----------------------------------------------------------------------------
 * ✓ Singleton
 * ✓ Async
 * ✓ High performance
 * ✓ Immutable events
 * ✓ Event versioning
 * ✓ Wildcard subscriptions
 * ✓ Fault isolation
 * ✓ Framework independent
 * =============================================================================
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

let TraceContext = null;

try {
    TraceContext = require('../tracing/TraceContext');
} catch (_) {
    TraceContext = null;
}

/**
 * Default configuration.
 */
const DEFAULT_OPTIONS = Object.freeze({

    service: 'titech-community-capital',

    version: 1,

    maxListeners: 200

});

/**
 * Enterprise Event Bus.
 */
class EventBus {

    constructor(options = {}) {

        this.options = Object.freeze({

            ...DEFAULT_OPTIONS,

            ...options

        });

        this.emitter = new EventEmitter();

        this.emitter.setMaxListeners(
            this.options.maxListeners
        );

        this.logger =
            options.logger || null;

        this.metrics =
            options.metrics || null;

        Object.freeze(this);
    }

    /**
     * Publish an event.
     *
     * @param {String} type
     * @param {Object} payload
     * @param {Object} metadata
     */
    async publish(
        type,
        payload = {},
        metadata = {}
    ) {

        if (!type || typeof type !== 'string') {
            throw new TypeError(
                'Event type must be a non-empty string.'
            );
        }

        const trace =
            TraceContext &&
            typeof TraceContext.current === 'function'
                ? TraceContext.current()
                : {};

        const envelope = Object.freeze({

            id: crypto.randomUUID(),

            type,

            version: this.options.version,

            service: this.options.service,

            timestamp: new Date().toISOString(),

            requestId:
                metadata.requestId ??
                trace?.requestId ??
                null,

            correlationId:
                metadata.correlationId ??
                trace?.correlationId ??
                null,

            traceId:
                metadata.traceId ??
                trace?.traceId ??
                null,

            spanId:
                metadata.spanId ??
                trace?.spanId ??
                null,

            tenant:
                metadata.tenant ??
                trace?.tenant ??
                null,

            user:
                metadata.user ??
                trace?.user ??
                null,

            payload: Object.freeze({

                ...payload

            }),

            metadata: Object.freeze({

                ...metadata

            })

        });

        if (
            this.metrics &&
            typeof this.metrics.incrementCounter === 'function'
        ) {
            this.metrics.incrementCounter(
                'eventsPublished',
                type
            );
        }

        if (this.logger) {
            this.logger.info(
                'Event published',
                {
                    eventId: envelope.id,
                    type,
                    traceId: envelope.traceId,
                    correlationId: envelope.correlationId
                }
            );
        }

        const handlers = [

            ...this.emitter.listeners(type),

            ...this.emitter.listeners('*')

        ];

        const results = await Promise.allSettled(

            handlers.map(handler =>
                Promise.resolve(handler(envelope))
            )

        );

        if (this.logger) {

            results
                .filter(r => r.status === 'rejected')
                .forEach(result => {

                    this.logger.error(
                        'Event handler failed',
                        {
                            eventType: type,
                            error: result.reason
                        }
                    );

                });

        }

        return envelope;
    }

    /**
     * Subscribe to an event.
     *
     * Returns an unsubscribe function.
     */
    subscribe(type, handler) {

        if (typeof handler !== 'function') {
            throw new TypeError(
                'Handler must be a function.'
            );
        }

        this.emitter.on(type, handler);

        return () => {

            this.unsubscribe(
                type,
                handler
            );

        };
    }

    /**
     * Subscribe once.
     */
    once(type, handler) {

        this.emitter.once(
            type,
            handler
        );

    }

    /**
     * Remove handler.
     */
    unsubscribe(type, handler) {

        this.emitter.off(
            type,
            handler
        );

    }

    /**
     * Remove every listener.
     */
    removeAll(type) {

        this.emitter.removeAllListeners(
            type
        );

    }

    /**
     * Registered events.
     */
    eventNames() {

        return this.emitter.eventNames();

    }

    /**
     * Listener count.
     */
    listenerCount(type) {

        return this.emitter.listenerCount(
            type
        );

    }

    /**
     * Diagnostics.
     */
    diagnostics() {

        const events = {};

        for (const name of this.eventNames()) {

            events[name] = this.listenerCount(
                name
            );

        }

        return Object.freeze({

            service:
                this.options.service,

            version:
                this.options.version,

            registeredEvents:
                events,

            totalEventTypes:
                Object.keys(events).length

        });

    }

    /**
     * Health.
     */
    health() {

        return Object.freeze({

            healthy: true,

            eventTypes:
                this.eventNames().length,

            listeners:
                this.eventNames()
                    .reduce(
                        (count, name) =>
                            count +
                            this.listenerCount(name),
                        0
                    )

        });

    }

}

/**
 * Singleton instance.
 */
const globalEventBus =
    new EventBus();

/**
 * Freeze prototype.
 */
Object.freeze(
    EventBus.prototype
);

module.exports = EventBus;

module.exports.globalEventBus =
    globalEventBus;