'use strict';

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Community Savings Platform
 * =============================================================================
 *
 * Enterprise Circuit Breaker Engine
 *
 * File:
 *   backend/middleware/resilience/circuitBreaker.js
 *
 * -----------------------------------------------------------------------------
 * Overview
 * -----------------------------------------------------------------------------
 *
 * Enterprise-grade Circuit Breaker implementation used throughout the
 * Community Savings Platform to protect internal services, external APIs,
 * payment gateways, databases, messaging systems, and third-party providers
 * from cascading failures.
 *
 * This implementation follows the Circuit Breaker pattern popularized by
 * Michael Nygard's "Release It!" and modern cloud-native resilience
 * architectures.
 *
 * The breaker continuously monitors execution outcomes and automatically
 * isolates failing dependencies while allowing healthy services to continue
 * processing requests.
 *
 * -----------------------------------------------------------------------------
 * Enterprise Features
 * -----------------------------------------------------------------------------
 *
 * ✓ CLOSED / OPEN / HALF_OPEN state machine
 * ✓ Rolling failure window
 * ✓ Sliding window failure calculations
 * ✓ Success-based recovery
 * ✓ Automatic timeout protection
 * ✓ Promise-aware execution
 * ✓ Async/Await support
 * ✓ Event-driven lifecycle
 * ✓ Health reporting
 * ✓ Metrics collection
 * ✓ Runtime snapshots
 * ✓ Graceful shutdown
 * ✓ Manual override support
 * ✓ Registry-based circuit management
 * ✓ Production-safe defaults
 * ✓ Configurable thresholds
 * ✓ High-performance implementation
 * ✓ Memory-efficient rolling statistics
 * ✓ Error propagation
 * ✓ Execution isolation
 * ✓ Kubernetes friendly
 * ✓ Cloud-native architecture
 *
 * -----------------------------------------------------------------------------
 * Circuit States
 * -----------------------------------------------------------------------------
 *
 * CLOSED
 *   Requests execute normally.
 *
 * OPEN
 *   Requests fail immediately until the recovery timeout expires.
 *
 * HALF_OPEN
 *   Limited requests are allowed to determine whether the dependency has
 *   recovered.
 *
 * -----------------------------------------------------------------------------
 * Protected Resources
 * -----------------------------------------------------------------------------
 *
 * This breaker may be used for:
 *
 * ✓ MongoDB
 * ✓ Mongoose
 * ✓ Redis
 * ✓ PostgreSQL
 * ✓ MySQL
 * ✓ REST APIs
 * ✓ GraphQL Services
 * ✓ MTN MoMo
 * ✓ Airtel Money
 * ✓ Payment Providers
 * ✓ SMS Providers
 * ✓ Email Providers
 * ✓ BullMQ
 * ✓ Kafka
 * ✓ RabbitMQ
 * ✓ File Storage
 * ✓ Object Storage
 * ✓ Authentication Services
 * ✓ Identity Providers
 * ✓ Microservices
 * ✓ Internal Enterprise APIs
 *
 * -----------------------------------------------------------------------------
 * Enterprise Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Prevent cascading failures
 * • Isolate unhealthy dependencies
 * • Improve platform resilience
 * • Reduce latency amplification
 * • Minimize resource exhaustion
 * • Protect upstream services
 * • Support graceful recovery
 * • Publish lifecycle events
 * • Produce operational metrics
 * • Enable runtime diagnostics
 * • Integrate with enterprise retry policies
 * • Support resilience orchestration
 *
 * -----------------------------------------------------------------------------
 * Events
 * -----------------------------------------------------------------------------
 *
 * open
 * close
 * halfOpen
 * reject
 *
 * -----------------------------------------------------------------------------
 * Metrics
 * -----------------------------------------------------------------------------
 *
 * requests
 * successes
 * failures
 * rejected
 * timeouts
 * opens
 * closes
 * halfOpenTransitions
 *
 * -----------------------------------------------------------------------------
 * Enterprise Integration
 * -----------------------------------------------------------------------------
 *
 * Designed to integrate with:
 *
 * • Retry Runtime
 * • Retry Policies
 * • Retry Metrics
 * • Enterprise Logger
 * • Structured Logging
 * • OpenTelemetry
 * • Prometheus
 * • Grafana
 * • Health Registry
 * • Runtime Bootstrap
 * • Dependency Injection Container
 * • Event Bus
 * • Diagnostics Engine
 * • Observability Platform
 * • Service Registry
 * • Feature Flags
 * • Tenant Context
 *
 * -----------------------------------------------------------------------------
 * Design Goals
 * -----------------------------------------------------------------------------
 *
 * • High throughput
 * • Low memory usage
 * • Lock-free execution
 * • Minimal allocations
 * • Async-safe
 * • Thread-safe execution model
 * • Predictable latency
 * • Enterprise extensibility
 * • Production reliability
 *
 * -----------------------------------------------------------------------------
 * Copyright
 * -----------------------------------------------------------------------------
 *
 * © TITech Community Capital Ltd.
 * All Rights Reserved.
 * =============================================================================
 */


const EventEmitter = require('events');

const DEFAULTS = Object.freeze({
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 30000,
    executionTimeout: 15000,
    rollingWindow: 60000,
    minimumRequests: 10,
    volumeThreshold: 0.5,
    enabled: true
});

const STATES = Object.freeze({
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
});

class CircuitBreaker extends EventEmitter {

    constructor(name, options = {}) {

        super();

        this.name = name;

        this.options = {
            ...DEFAULTS,
            ...options
        };

        this.state = STATES.CLOSED;

        this.nextAttempt = 0;

        this.successCount = 0;

        this.failures = [];

        this.metrics = {
            requests: 0,
            successes: 0,
            failures: 0,
            rejected: 0,
            timeouts: 0,
            opens: 0,
            halfOpen: 0,
            closes: 0
        };
    }

    async execute(operation, context = {}) {

        if (!this.options.enabled) {
            return operation();
        }

        this.metrics.requests++;

        this.#cleanupFailures();

        if (this.state === STATES.OPEN) {

            if (Date.now() < this.nextAttempt) {

                this.metrics.rejected++;

                const error = new Error(
                    `Circuit "${this.name}" is OPEN`
                );

                error.code = 'CIRCUIT_OPEN';

                this.emit('reject', {
                    circuit: this.name,
                    context
                });

                throw error;
            }

            this.state = STATES.HALF_OPEN;

            this.successCount = 0;

            this.metrics.halfOpen++;

            this.emit('halfOpen', this.snapshot());
        }

        try {

            const result = await this.#executeWithTimeout(operation);

            return this.#onSuccess(result);

        } catch (error) {

            return this.#onFailure(error);
        }
    }

    async #executeWithTimeout(operation) {

        return Promise.race([

            Promise.resolve().then(operation),

            new Promise((_, reject) => {

                const timer = setTimeout(() => {

                    clearTimeout(timer);

                    const error = new Error(
                        'Circuit execution timeout'
                    );

                    error.code = 'CIRCUIT_TIMEOUT';

                    reject(error);

                }, this.options.executionTimeout);

            })
        ]);
    }

    #onSuccess(result) {

        this.metrics.successes++;

        if (this.state === STATES.HALF_OPEN) {

            this.successCount++;

            if (
                this.successCount >=
                this.options.successThreshold
            ) {

                this.close();
            }
        }

        return result;
    }

    #onFailure(error) {

        this.metrics.failures++;

        if (error.code === 'CIRCUIT_TIMEOUT') {
            this.metrics.timeouts++;
        }

        this.failures.push(Date.now());

        if (
            this.state === STATES.HALF_OPEN
        ) {

            this.open();

        } else if (
            this.shouldOpen()
        ) {

            this.open();
        }

        throw error;
    }

    shouldOpen() {

        const total = this.metrics.successes + this.metrics.failures;

        if (
            total <
            this.options.minimumRequests
        ) {
            return false;
        }

        const ratio =
            this.failures.length / total;

        return (
            this.failures.length >=
                this.options.failureThreshold &&
            ratio >=
                this.options.volumeThreshold
        );
    }

    open() {

        this.state = STATES.OPEN;

        this.nextAttempt =
            Date.now() +
            this.options.resetTimeout;

        this.metrics.opens++;

        this.emit('open', this.snapshot());
    }

    close() {

        this.state = STATES.CLOSED;

        this.successCount = 0;

        this.failures = [];

        this.metrics.closes++;

        this.emit('close', this.snapshot());
    }

    forceOpen() {

        this.open();
    }

    forceClose() {

        this.close();
    }

    reset() {

        this.state = STATES.CLOSED;

        this.nextAttempt = 0;

        this.successCount = 0;

        this.failures = [];

        this.metrics.requests = 0;
        this.metrics.successes = 0;
        this.metrics.failures = 0;
        this.metrics.rejected = 0;
        this.metrics.timeouts = 0;
        this.metrics.opens = 0;
        this.metrics.halfOpen = 0;
        this.metrics.closes = 0;
    }

    #cleanupFailures() {

        const cutoff =
            Date.now() -
            this.options.rollingWindow;

        while (
            this.failures.length &&
            this.failures[0] < cutoff
        ) {
            this.failures.shift();
        }
    }

    snapshot() {

        return {

            name: this.name,

            state: this.state,

            nextAttempt: this.nextAttempt,

            failures: this.failures.length,

            successCount: this.successCount,

            metrics: {
                ...this.metrics
            },

            options: {
                ...this.options
            }
        };
    }

    health() {

        return {

            circuit: this.name,

            healthy:
                this.state !== STATES.OPEN,

            state: this.state,

            rejected: this.metrics.rejected,

            failures: this.metrics.failures,

            successes: this.metrics.successes
        };
    }

    shutdown() {

        this.removeAllListeners();

        this.reset();
    }
}

class CircuitBreakerRegistry {

    constructor() {

        this.circuits = new Map();
    }

    register(name, options = {}) {

        if (!this.circuits.has(name)) {

            this.circuits.set(
                name,
                new CircuitBreaker(name, options)
            );
        }

        return this.circuits.get(name);
    }

    get(name) {

        return this.circuits.get(name);
    }

    remove(name) {

        const breaker = this.circuits.get(name);

        if (breaker) {
            breaker.shutdown();
        }

        return this.circuits.delete(name);
    }

    snapshot() {

        return Array.from(
            this.circuits.values()
        ).map(circuit => circuit.snapshot());
    }

    health() {

        return Array.from(
            this.circuits.values()
        ).map(circuit => circuit.health());
    }

    shutdown() {

        for (const circuit of this.circuits.values()) {
            circuit.shutdown();
        }

        this.circuits.clear();
    }
}

const registry = new CircuitBreakerRegistry();

module.exports = {
    CircuitBreaker,
    CircuitBreakerRegistry,
    registry,
    STATES
};