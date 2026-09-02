'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Event Bus Adapter
 * =============================================================================
 *
 * File:
 * backend/modules/transactions/TransactionEventBusAdapter.js
 *
 * Purpose
 * -------
 * Enterprise abstraction boundary between the transaction platform and an
 * external event transport such as:
 *
 *   - Kafka
 *   - RabbitMQ
 *   - Redis Streams
 *   - AWS SNS/SQS
 *   - Internal Event Bus
 *
 * This class intentionally contains NO provider-specific transport logic.
 * Concrete adapters should extend this class and implement:
 *
 *   publish()
 *   health()
 *
 * Optional provider capabilities:
 *
 *   publishBatch()
 *   isReady()
 *   close()
 *
 * Enterprise capabilities
 * -----------------------
 *   - Contract enforcement
 *   - Message validation
 *   - Correlation propagation
 *   - Tenant isolation metadata
 *   - Idempotency metadata
 *   - Timeout protection
 *   - Batch publishing
 *   - Bounded batch concurrency
 *   - Lifecycle management
 *   - Readiness/health checks
 *   - Structured adapter errors
 *   - Metrics hooks
 *   - Logging hooks
 *   - Safe shutdown
 *   - Provider capability discovery
 *
 * Design principle
 * ----------------
 * The adapter is infrastructure-neutral.
 *
 * Business logic MUST NOT depend on Kafka, RabbitMQ, Redis Streams, SNS/SQS,
 * or any other concrete transport.
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const ADAPTER_STATE = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    STOPPING: 'STOPPING',
    STOPPED: 'STOPPED',
    FAILED: 'FAILED'
});

const DEFAULT_CONFIGURATION = Object.freeze({
    enabled: true,

    adapterName: 'transaction-event-bus-adapter',

    publishTimeoutMs: 30000,

    batch: Object.freeze({
        enabled: true,
        concurrency: 10,
        failFast: false
    }),

    health: Object.freeze({
        enabled: true,
        timeoutMs: 5000
    }),

    validation: Object.freeze({
        enabled: true,
        requireEventType: true,
        requireMessageId: false,
        requireTenantId: false
    }),

    observability: Object.freeze({
        loggingEnabled: true,
        metricsEnabled: true
    })
});

const DEFAULT_MESSAGE_VERSION = 1;

/**
 * =============================================================================
 * Error Codes
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    ADAPTER_DISABLED: 'TRANSACTION_EVENT_BUS_ADAPTER_DISABLED',
    ADAPTER_NOT_READY: 'TRANSACTION_EVENT_BUS_ADAPTER_NOT_READY',
    ADAPTER_STOPPED: 'TRANSACTION_EVENT_BUS_ADAPTER_STOPPED',
    ADAPTER_INITIALIZATION_FAILED:
        'TRANSACTION_EVENT_BUS_ADAPTER_INITIALIZATION_FAILED',

    ADAPTER_PUBLISH_FAILED:
        'TRANSACTION_EVENT_BUS_ADAPTER_PUBLISH_FAILED',

    ADAPTER_PUBLISH_TIMEOUT:
        'TRANSACTION_EVENT_BUS_ADAPTER_PUBLISH_TIMEOUT',

    ADAPTER_BATCH_FAILED:
        'TRANSACTION_EVENT_BUS_ADAPTER_BATCH_FAILED',

    INVALID_MESSAGE:
        'TRANSACTION_EVENT_BUS_INVALID_MESSAGE',

    INVALID_BATCH:
        'TRANSACTION_EVENT_BUS_INVALID_BATCH',

    HEALTH_CHECK_FAILED:
        'TRANSACTION_EVENT_BUS_HEALTH_CHECK_FAILED'
});

/**
 * =============================================================================
 * Enterprise Adapter Error
 * =============================================================================
 */

class TransactionEventBusAdapterError extends Error {

    constructor(message, options = {}) {

        super(message);

        this.name = 'TransactionEventBusAdapterError';

        this.code =
            options.code ||
            ERROR_CODES.ADAPTER_PUBLISH_FAILED;

        this.cause =
            options.cause || null;

        this.adapterName =
            options.adapterName || null;

        this.messageId =
            options.messageId || null;

        this.eventType =
            options.eventType || null;

        this.transactionId =
            options.transactionId || null;

        this.correlationId =
            options.correlationId || null;

        this.tenantId =
            options.tenantId || null;

        this.retryable =
            options.retryable !== undefined
                ? Boolean(options.retryable)
                : true;

        this.details =
            options.details || null;

        this.timestamp =
            new Date();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(
                this,
                TransactionEventBusAdapterError
            );
        }
    }
}

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function isObject(value) {

    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}


function toPositiveInteger(value, fallback) {

    const number = Number(value);

    if (
        Number.isInteger(number) &&
        number > 0
    ) {
        return number;
    }

    return fallback;
}


function sanitizeConfiguration(configuration = {}) {

    const config = {
        ...DEFAULT_CONFIGURATION,
        ...configuration,

        batch: {
            ...DEFAULT_CONFIGURATION.batch,
            ...(configuration.batch || {})
        },

        health: {
            ...DEFAULT_CONFIGURATION.health,
            ...(configuration.health || {})
        },

        validation: {
            ...DEFAULT_CONFIGURATION.validation,
            ...(configuration.validation || {})
        },

        observability: {
            ...DEFAULT_CONFIGURATION.observability,
            ...(configuration.observability || {})
        }
    };

    config.publishTimeoutMs =
        toPositiveInteger(
            config.publishTimeoutMs,
            DEFAULT_CONFIGURATION.publishTimeoutMs
        );

    config.batch.concurrency =
        toPositiveInteger(
            config.batch.concurrency,
            DEFAULT_CONFIGURATION.batch.concurrency
        );

    config.health.timeoutMs =
        toPositiveInteger(
            config.health.timeoutMs,
            DEFAULT_CONFIGURATION.health.timeoutMs
        );

    return Object.freeze(config);
}


function generateMessageId() {

    if (typeof crypto.randomUUID === 'function') {
        return `msg_${crypto.randomUUID()}`;
    }

    return `msg_${Date.now()}_${crypto
        .randomBytes(16)
        .toString('hex')}`;
}


function now() {

    return new Date();
}


function elapsedMilliseconds(start) {

    return Number(
        process.hrtime.bigint() -
        start
    ) / 1e6;
}

/**
 * =============================================================================
 * Transaction Event Bus Adapter
 * =============================================================================
 */

class TransactionEventBusAdapter {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {

        this.config =
            sanitizeConfiguration(
                options.config || {}
            );

        this.client =
            options.client || null;

        this.logger =
            options.logger || console;

        this.metrics =
            options.metrics || null;

        this.tracer =
            options.tracer || null;

        this.adapterName =
            options.adapterName ||
            this.config.adapterName;

        this.provider =
            options.provider ||
            'unknown';

        this.instanceId =
            options.instanceId ||
            this.generateInstanceId();

        this.state =
            ADAPTER_STATE.CREATED;

        this.initialized =
            false;

        this.startedAt =
            null;

        this.stoppedAt =
            null;

        this.lastError =
            null;

        this.lastSuccessfulPublishAt =
            null;

        this.lastFailedPublishAt =
            null;

        this.totalPublished =
            0;

        this.totalFailed =
            0;

        this.totalBatches =
            0;

        this.activePublishes =
            0;

        this.activeBatches =
            0;

        this.inFlight =
            new Set();

        this._initializationPromise =
            null;

        this._shutdownPromise =
            null;

        this.assertConfiguration();
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    assertConfiguration() {

        if (!this.adapterName) {

            throw new TransactionEventBusAdapterError(
                'Event bus adapter name is required',
                {
                    code:
                        ERROR_CODES.ADAPTER_INITIALIZATION_FAILED,

                    adapterName:
                        this.adapterName
                }
            );
        }

        if (
            !this.provider ||
            typeof this.provider !== 'string'
        ) {

            throw new TransactionEventBusAdapterError(
                'Event bus provider must be a non-empty string',
                {
                    code:
                        ERROR_CODES.ADAPTER_INITIALIZATION_FAILED,

                    adapterName:
                        this.adapterName
                }
            );
        }
    }

    /**
     * =========================================================================
     * Instance Identity
     * =========================================================================
     */

    generateInstanceId() {

        if (typeof crypto.randomUUID === 'function') {

            return `${this.adapterName}-${crypto.randomUUID()}`;
        }

        return [
            this.adapterName,
            process.pid,
            Date.now(),
            crypto.randomBytes(8).toString('hex')
        ].join('-');
    }

    /**
     * =========================================================================
     * Lifecycle Initialization
     * =========================================================================
     *
     * Concrete adapters may override initialize(), but should call
     * super.initialize().
     */

    async initialize() {

        if (
            this.state === ADAPTER_STATE.READY
        ) {
            return this.getHealthSnapshot();
        }

        if (
            this.state === ADAPTER_STATE.STOPPED ||
            this.state === ADAPTER_STATE.STOPPING
        ) {

            throw this.createError(
                'Adapter cannot be initialized after shutdown',
                ERROR_CODES.ADAPTER_STOPPED,
                {
                    retryable: false
                }
            );
        }

        if (this._initializationPromise) {
            return this._initializationPromise;
        }

        this._initializationPromise =
            this._initializeInternal();

        try {

            return await this._initializationPromise;

        }
        finally {

            this._initializationPromise =
                null;
        }
    }

    async _initializeInternal() {

        this.state =
            ADAPTER_STATE.INITIALIZING;

        this.startedAt =
            now();

        try {

            /*
             * Provider-specific subclasses can override
             * initializeClient() to establish their connection.
             */

            if (
                typeof this.initializeClient === 'function'
            ) {

                await this.initializeClient();
            }

            this.initialized =
                true;

            this.state =
                ADAPTER_STATE.READY;

            this.log(
                'info',
                'Transaction event bus adapter initialized',
                {
                    adapterName:
                        this.adapterName,

                    provider:
                        this.provider,

                    instanceId:
                        this.instanceId
                }
            );

            this.incrementMetric(
                'transaction_event_bus_adapter_initialized'
            );

            return this.getHealthSnapshot();

        }
        catch (error) {

            this.state =
                ADAPTER_STATE.FAILED;

            this.lastError =
                this.serializeError(error);

            this.log(
                'error',
                'Transaction event bus adapter initialization failed',
                {
                    adapterName:
                        this.adapterName,

                    provider:
                        this.provider,

                    error:
                        this.lastError
                }
            );

            throw this.createError(
                'Event bus adapter initialization failed',
                ERROR_CODES.ADAPTER_INITIALIZATION_FAILED,
                {
                    cause: error,
                    retryable: true
                }
            );
        }
    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    isReady() {

        return (
            this.config.enabled === true &&
            this.state === ADAPTER_STATE.READY
        );
    }

    /**
     * =========================================================================
     * Provider Capability Discovery
     * =========================================================================
     */

    getCapabilities() {

        return Object.freeze({

            publish:
                typeof this.publish === 'function',

            publishBatch:
                typeof this.publishBatch === 'function',

            health:
                typeof this.health === 'function',

            initialize:
                typeof this.initialize === 'function',

            close:
                typeof this.close === 'function',

            provider:
                this.provider,

            adapterName:
                this.adapterName
        });
    }

    /**
     * =========================================================================
     * Publish
     * =========================================================================
     *
     * Abstract method.
     *
     * Concrete providers MUST implement this method.
     */

    async publish(message) {

        throw this.createError(
            'publish() must be implemented by a concrete event bus adapter',
            ERROR_CODES.ADAPTER_PUBLISH_FAILED,
            {
                retryable: false
            }
        );
    }

    /**
     * =========================================================================
     * Protected Provider Publish Wrapper
     * =========================================================================
     *
     * Concrete adapters should preferably implement:
     *
     *   publishMessage(message)
     *
     * rather than overriding the public publish() method.
     *
     * This wrapper provides enterprise validation, timeout protection,
     * observability and lifecycle accounting.
     */

    async publishWithProtection(message) {

        this.assertPublishAllowed();

        const normalizedMessage =
            this.normalizeMessage(message);

        const started =
            process.hrtime.bigint();

        this.activePublishes++;

        const operationId =
            generateMessageId();

        this.inFlight.add(
            operationId
        );

        try {

            const result =
                await this.withTimeout(
                    () =>
                        this.publishMessage(
                            normalizedMessage
                        ),
                    this.config.publishTimeoutMs
                );

            const duration =
                elapsedMilliseconds(
                    started
                );

            this.totalPublished++;

            this.lastSuccessfulPublishAt =
                now();

            this.incrementMetric(
                'transaction_event_bus_messages_published'
            );

            this.observeMetric(
                'transaction_event_bus_publish_duration_ms',
                duration
            );

            return result;

        }
        catch (error) {

            const duration =
                elapsedMilliseconds(
                    started
                );

            this.totalFailed++;

            this.lastFailedPublishAt =
                now();

            this.lastError =
                this.serializeError(error);

            this.incrementMetric(
                'transaction_event_bus_messages_failed'
            );

            this.observeMetric(
                'transaction_event_bus_publish_duration_ms',
                duration
            );

            if (
                error instanceof TransactionEventBusAdapterError
            ) {
                throw error;
            }

            throw this.createError(
                'Transaction event publication failed',
                ERROR_CODES.ADAPTER_PUBLISH_FAILED,
                {
                    cause: error,
                    messageId:
                        normalizedMessage.messageId,

                    eventType:
                        normalizedMessage.eventType,

                    transactionId:
                        normalizedMessage.transactionId,

                    correlationId:
                        normalizedMessage.correlationId,

                    tenantId:
                        normalizedMessage.tenantId,

                    retryable: true
                }
            );

        }
        finally {

            this.activePublishes--;

            this.inFlight.delete(
                operationId
            );
        }
    }

    /**
     * =========================================================================
     * Provider Publish Hook
     * =========================================================================
     *
     * Concrete adapters implement this method.
     */

    async publishMessage(message) {

        throw this.createError(
            'publishMessage() must be implemented by a concrete adapter',
            ERROR_CODES.ADAPTER_PUBLISH_FAILED,
            {
                retryable: false
            }
        );
    }

    /**
     * =========================================================================
     * Batch Publishing
     * =========================================================================
     *
     * The default implementation provides bounded concurrency.
     *
     * Concrete providers may override this method when the underlying
     * transport provides a native batch API.
     */

    async publishBatch(messages, options = {}) {

        this.assertPublishAllowed();

        if (!Array.isArray(messages)) {

            throw this.createError(
                'messages must be an array',
                ERROR_CODES.INVALID_BATCH,
                {
                    retryable: false
                }
            );
        }

        if (messages.length === 0) {
            return [];
        }

        if (
            this.config.batch.enabled !== true
        ) {

            throw this.createError(
                'Batch publishing is disabled',
                ERROR_CODES.ADAPTER_DISABLED,
                {
                    retryable: false
                }
            );
        }

        const concurrency =
            toPositiveInteger(
                options.concurrency,
                this.config.batch.concurrency
            );

        const failFast =
            options.failFast !== undefined
                ? Boolean(options.failFast)
                : this.config.batch.failFast;

        const normalizedMessages =
            messages.map(
                message =>
                    this.normalizeMessage(
                        message
                    )
            );

        const batchId =
            options.batchId ||
            this.generateBatchId();

        this.activeBatches++;

        this.totalBatches++;

        try {

            this.incrementMetric(
                'transaction_event_bus_batches_started'
            );

            const results =
                new Array(
                    normalizedMessages.length
                );

            let cursor = 0;

            const worker = async () => {

                while (true) {

                    const index =
                        cursor++;

                    if (
                        index >=
                        normalizedMessages.length
                    ) {
                        return;
                    }

                    try {

                        results[index] =
                            await this.publishWithProtection(
                                {
                                    ...normalizedMessages[index],

                                    batchId
                                }
                            );

                    }
                    catch (error) {

                        results[index] = {
                            success: false,
                            error:
                                this.serializeError(
                                    error
                                ),
                            index
                        };

                        if (failFast) {
                            throw error;
                        }
                    }
                }
            };

            const workers =
                Array.from(
                    {
                        length:
                            Math.min(
                                concurrency,
                                normalizedMessages.length
                            )
                    },
                    () => worker()
                );

            try {

                await Promise.all(
                    workers
                );

            }
            catch (error) {

                if (failFast) {
                    throw this.createError(
                        'Transaction event batch publication failed',
                        ERROR_CODES.ADAPTER_BATCH_FAILED,
                        {
                            cause: error,
                            retryable: true,
                            details: {
                                batchId,
                                size:
                                    normalizedMessages.length
                            }
                        }
                    );
                }
            }

            return results;

        }
        finally {

            this.activeBatches--;
        }
    }

    /**
     * =========================================================================
     * Publish Permission Validation
     * =========================================================================
     */

    assertPublishAllowed() {

        if (
            this.config.enabled !== true
        ) {

            throw this.createError(
                'Transaction event bus adapter is disabled',
                ERROR_CODES.ADAPTER_DISABLED,
                {
                    retryable: false
                }
            );
        }

        if (
            this.state === ADAPTER_STATE.STOPPED ||
            this.state === ADAPTER_STATE.STOPPING
        ) {

            throw this.createError(
                'Transaction event bus adapter is stopped',
                ERROR_CODES.ADAPTER_STOPPED,
                {
                    retryable: false
                }
            );
        }

        if (
            !this.isReady()
        ) {

            throw this.createError(
                'Transaction event bus adapter is not ready',
                ERROR_CODES.ADAPTER_NOT_READY,
                {
                    retryable: true
                }
            );
        }
    }

    /**
     * =========================================================================
     * Message Normalization
     * =========================================================================
     */

    normalizeMessage(message) {

        if (
            !isObject(message)
        ) {

            throw this.createError(
                'Event bus message must be an object',
                ERROR_CODES.INVALID_MESSAGE,
                {
                    retryable: false
                }
            );
        }

        const normalized = {
            ...message,

            messageId:
                message.messageId ||
                generateMessageId(),

            version:
                message.version ||
                DEFAULT_MESSAGE_VERSION,

            timestamp:
                message.timestamp
                    ? new Date(message.timestamp)
                    : now(),

            publishedAt:
                message.publishedAt || null,

            adapterName:
                this.adapterName,

            provider:
                this.provider,

            publisherInstanceId:
                this.instanceId
        };

        if (
            this.config.validation.enabled
        ) {

            this.validateMessage(
                normalized
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Message Validation
     * =========================================================================
     */

    validateMessage(message) {

        const errors = [];

        if (
            this.config.validation.requireEventType &&
            !message.eventType
        ) {

            errors.push(
                'eventType is required'
            );
        }

        if (
            this.config.validation.requireMessageId &&
            !message.messageId
        ) {

            errors.push(
                'messageId is required'
            );
        }

        if (
            this.config.validation.requireTenantId &&
            !message.tenantId
        ) {

            errors.push(
                'tenantId is required'
            );
        }

        if (
            message.transactionId !== undefined &&
            message.transactionId !== null &&
            typeof message.transactionId !== 'string'
        ) {

            errors.push(
                'transactionId must be a string'
            );
        }

        if (
            message.correlationId !== undefined &&
            message.correlationId !== null &&
            typeof message.correlationId !== 'string'
        ) {

            errors.push(
                'correlationId must be a string'
            );
        }

        if (
            message.tenantId !== undefined &&
            message.tenantId !== null &&
            typeof message.tenantId !== 'string'
        ) {

            errors.push(
                'tenantId must be a string'
            );
        }

        if (
            errors.length > 0
        ) {

            throw this.createError(
                'Invalid transaction event bus message',
                ERROR_CODES.INVALID_MESSAGE,
                {
                    retryable: false,
                    details: {
                        errors
                    }
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Timeout Protection
     * =========================================================================
     */

    async withTimeout(operation, timeoutMs) {

        let timer;

        try {

            return await Promise.race([

                Promise.resolve()
                    .then(operation),

                new Promise(
                    (_, reject) => {

                        timer =
                            setTimeout(
                                () => {

                                    reject(
                                        this.createError(
                                            `Event publication timed out after ${timeoutMs}ms`,
                                            ERROR_CODES.ADAPTER_PUBLISH_TIMEOUT,
                                            {
                                                retryable: true
                                            }
                                        )
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
                    }
                )
            ]);

        }
        finally {

            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     *
     * Concrete adapters may override health(), but the base implementation
     * provides a safe transport-independent result.
     */

    async health() {

        return {
            status:
                this.isReady()
                    ? 'READY'
                    : this.state,

            ready:
                this.isReady(),

            adapterName:
                this.adapterName,

            provider:
                this.provider,

            instanceId:
                this.instanceId,

            state:
                this.state,

            checkedAt:
                now(),

            activePublishes:
                this.activePublishes,

            activeBatches:
                this.activeBatches,

            totalPublished:
                this.totalPublished,

            totalFailed:
                this.totalFailed,

            lastSuccessfulPublishAt:
                this.lastSuccessfulPublishAt,

            lastFailedPublishAt:
                this.lastFailedPublishAt
        };
    }

    /**
     * =========================================================================
     * Safe Health Check With Timeout
     * =========================================================================
     */

    async checkHealth() {

        if (
            !this.config.health.enabled
        ) {

            return {
                status: 'DISABLED',
                ready: false
            };
        }

        try {

            const result =
                await this.withTimeout(
                    () =>
                        this.health(),
                    this.config.health.timeoutMs
                );

            return {
                ...result,
                healthy: true
            };

        }
        catch (error) {

            this.lastError =
                this.serializeError(error);

            return {
                status: 'UNHEALTHY',
                ready: false,
                healthy: false,
                adapterName:
                    this.adapterName,
                provider:
                    this.provider,
                error:
                    this.serializeError(
                        error
                    ),
                checkedAt:
                    now()
            };
        }
    }

    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async close() {

        if (
            this.state === ADAPTER_STATE.STOPPED
        ) {
            return true;
        }

        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }

        this._shutdownPromise =
            this._closeInternal();

        try {

            return await this._shutdownPromise;

        }
        finally {

            this._shutdownPromise =
                null;
        }
    }

    async _closeInternal() {

        this.state =
            ADAPTER_STATE.STOPPING;

        try {

            /*
             * Provider-specific cleanup hook.
             */

            if (
                typeof this.closeClient === 'function'
            ) {

                await this.closeClient();
            }

            this.initialized =
                false;

            this.state =
                ADAPTER_STATE.STOPPED;

            this.stoppedAt =
                now();

            this.log(
                'info',
                'Transaction event bus adapter stopped',
                {
                    adapterName:
                        this.adapterName,

                    provider:
                        this.provider,

                    instanceId:
                        this.instanceId
                }
            );

            this.incrementMetric(
                'transaction_event_bus_adapter_stopped'
            );

            return true;

        }
        catch (error) {

            this.state =
                ADAPTER_STATE.FAILED;

            this.lastError =
                this.serializeError(error);

            this.log(
                'error',
                'Transaction event bus adapter shutdown failed',
                {
                    adapterName:
                        this.adapterName,

                    provider:
                        this.provider,

                    error:
                        this.lastError
                }
            );

            throw this.createError(
                'Event bus adapter shutdown failed',
                ERROR_CODES.ADAPTER_PUBLISH_FAILED,
                {
                    cause: error,
                    retryable: true
                }
            );
        }
    }

    /**
     * =========================================================================
     * Drain In-Flight Operations
     * =========================================================================
     */

    async drain(options = {}) {

        const timeoutMs =
            toPositiveInteger(
                options.timeoutMs,
                30000
            );

        const started =
            Date.now();

        while (
            this.activePublishes > 0 ||
            this.activeBatches > 0
        ) {

            if (
                Date.now() - started >=
                timeoutMs
            ) {

                return {
                    drained: false,

                    remainingPublishes:
                        this.activePublishes,

                    remainingBatches:
                        this.activeBatches
                };
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        25
                    )
            );
        }

        return {
            drained: true,

            remainingPublishes: 0,

            remainingBatches: 0
        };
    }

    /**
     * =========================================================================
     * Runtime Snapshot
     * =========================================================================
     */

    getHealthSnapshot() {

        return {
            adapterName:
                this.adapterName,

            provider:
                this.provider,

            instanceId:
                this.instanceId,

            state:
                this.state,

            ready:
                this.isReady(),

            initialized:
                this.initialized,

            startedAt:
                this.startedAt,

            stoppedAt:
                this.stoppedAt,

            activePublishes:
                this.activePublishes,

            activeBatches:
                this.activeBatches,

            totalPublished:
                this.totalPublished,

            totalFailed:
                this.totalFailed,

            totalBatches:
                this.totalBatches,

            lastSuccessfulPublishAt:
                this.lastSuccessfulPublishAt,

            lastFailedPublishAt:
                this.lastFailedPublishAt,

            lastError:
                this.lastError
        };
    }

    /**
     * =========================================================================
     * Structured Error Factory
     * =========================================================================
     */

    createError(message, code, options = {}) {

        return new TransactionEventBusAdapterError(
            message,
            {
                ...options,

                code,

                adapterName:
                    this.adapterName
            }
        );
    }

    /**
     * =========================================================================
     * Error Serialization
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
                error.code || null,

            retryable:
                error.retryable !== undefined
                    ? error.retryable
                    : null,

            stack:
                error.stack || null
        };
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(name, value = 1) {

        if (
            !this.config.observability.metricsEnabled
        ) {
            return;
        }

        try {

            if (
                this.metrics &&
                typeof this.metrics.increment ===
                    'function'
            ) {

                this.metrics.increment(
                    name,
                    value,
                    {
                        adapter:
                            this.adapterName,

                        provider:
                            this.provider
                    }
                );
            }

        }
        catch (error) {

            this.log(
                'warn',
                'Transaction event bus metric failed',
                {
                    metric:
                        name,

                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * =========================================================================
     * Metrics Observation
     * =========================================================================
     */

    observeMetric(name, value) {

        if (
            !this.config.observability.metricsEnabled
        ) {
            return;
        }

        try {

            if (
                this.metrics &&
                typeof this.metrics.observe ===
                    'function'
            ) {

                this.metrics.observe(
                    name,
                    value,
                    {
                        adapter:
                            this.adapterName,

                        provider:
                            this.provider
                    }
                );
            }

        }
        catch (error) {

            this.log(
                'warn',
                'Transaction event bus metric observation failed',
                {
                    metric:
                        name,

                    error:
                        this.serializeError(
                            error
                        )
                }
            );
        }
    }

    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    log(level, message, metadata = {}) {

        if (
            !this.config.observability.loggingEnabled
        ) {
            return;
        }

        const payload = {
            timestamp:
                now().toISOString(),

            component:
                'TransactionEventBusAdapter',

            adapterName:
                this.adapterName,

            provider:
                this.provider,

            instanceId:
                this.instanceId,

            ...metadata
        };

        try {

            const loggerMethod =
                this.logger?.[level] ||
                this.logger?.log;

            if (
                typeof loggerMethod ===
                'function'
            ) {

                loggerMethod.call(
                    this.logger,
                    payload,
                    message
                );
            }

        }
        catch (_) {

            /*
             * Logging must never break financial transaction execution.
             */
        }
    }

    /**
     * =========================================================================
     * Batch ID
     * =========================================================================
     */

    generateBatchId() {

        if (
            typeof crypto.randomUUID ===
            'function'
        ) {

            return `batch_${crypto.randomUUID()}`;
        }

        return [
            'batch',
            Date.now(),
            crypto
                .randomBytes(8)
                .toString('hex')
        ].join('_');
    }

    /**
     * =========================================================================
     * Adapter Metadata
     * =========================================================================
     */

    getMetadata() {

        return Object.freeze({

            adapterName:
                this.adapterName,

            provider:
                this.provider,

            instanceId:
                this.instanceId,

            environment:
                process.env.NODE_ENV ||
                'development',

            service:
                process.env.SERVICE_NAME ||
                'transaction-service',

            processId:
                process.pid,

            nodeVersion:
                process.version
        });
    }
}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 *
 * Backwards-compatible default export:
 *
 *   const Adapter = require('./TransactionEventBusAdapter');
 *
 * Extended named exports:
 *
 *   const {
 *       TransactionEventBusAdapter,
 *       TransactionEventBusAdapterError,
 *       ADAPTER_STATE,
 *       ERROR_CODES
 *   } = require('./TransactionEventBusAdapter');
 *
 * =============================================================================
 */

module.exports =
    TransactionEventBusAdapter;

module.exports.TransactionEventBusAdapter =
    TransactionEventBusAdapter;

module.exports.TransactionEventBusAdapterError =
    TransactionEventBusAdapterError;

module.exports.ADAPTER_STATE =
    ADAPTER_STATE;

module.exports.ERROR_CODES =
    ERROR_CODES;