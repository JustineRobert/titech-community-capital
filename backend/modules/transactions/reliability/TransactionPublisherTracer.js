'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Publisher Tracer
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionPublisherTracer.js
 *
 * Purpose:
 *   Enterprise tracing abstraction for the transaction publisher and reliability
 *   pipeline.
 *
 * Responsibilities:
 *
 *   • Root transaction publishing spans
 *   • Child spans
 *   • Trace/context propagation
 *   • Safe span lifecycle management
 *   • Span attributes
 *   • Error recording
 *   • Status management
 *   • Publisher timing
 *   • Retry tracing
 *   • Dead-letter tracing
 *   • Circuit-breaker tracing
 *   • Backpressure tracing
 *   • Idempotency tracing
 *   • OpenTelemetry-compatible integration
 *   • Graceful degradation when tracing is unavailable
 *
 * Critical Design Rule:
 *
 *   Tracing is OBSERVABILITY.
 *
 *   It must NEVER become a dependency that can prevent a financial transaction
 *   from completing.
 *
 * =============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,

    strict: false,

    serviceName:
        process.env.SERVICE_NAME ||
        'transaction-service',

    environment:
        process.env.NODE_ENV ||
        'development',

    maxAttributeLength: 250,

    maxAttributes: 32,

    spanPrefix:
        'titech.transaction',

    recordExceptions: true,

    captureStackTrace: true
});

const SPAN_NAMES = Object.freeze({
    PUBLISH:
        'transaction.publish',

    SERIALIZE:
        'transaction.serialize',

    VALIDATE:
        'transaction.validate',

    RETRY:
        'transaction.retry',

    DEAD_LETTER:
        'transaction.dead_letter',

    DEAD_LETTER_RESTORE:
        'transaction.dead_letter.restore',

    CIRCUIT_BREAKER:
        'transaction.circuit_breaker',

    BACKPRESSURE:
        'transaction.backpressure',

    IDEMPOTENCY:
        'transaction.idempotency'
});

const SPAN_STATUS = Object.freeze({
    OK: 'OK',
    ERROR: 'ERROR',
    UNSET: 'UNSET'
});

const RESERVED_HIGH_CARDINALITY_ATTRIBUTES =
    new Set([
        'transactionId',
        'transactionID',
        'correlationId',
        'correlationID',
        'requestId',
        'requestID',
        'executionId',
        'executionID',
        'userId',
        'userID',
        'memberId',
        'memberID',
        'customerId',
        'customerID',
        'accountId',
        'accountID',
        'sessionId',
        'sessionID'
    ]);

class TransactionPublisherTracer {
    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(tracer, options = {}) {
        this.tracer =
            tracer || null;

        this.logger =
            options.logger ||
            console;

        this.config = Object.freeze({
            ...DEFAULT_CONFIG,
            ...(options.config || {})
        });

        this.startedAt =
            new Date();

        this.internal = {
            spansStarted: 0,
            spansEnded: 0,
            spanErrors: 0,
            tracingErrors: 0,
            lastError: null
        };
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    validateConfiguration() {
        if (
            !Number.isFinite(
                this.config.maxAttributes
            ) ||
            this.config.maxAttributes < 1
        ) {
            throw new Error(
                'TransactionPublisherTracer.maxAttributes must be positive'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Tracer Availability
     * =========================================================================
     */

    isAvailable() {
        return Boolean(
            this.config.enabled &&
            this.tracer &&
            typeof this.tracer.startSpan ===
                'function'
        );
    }

    isHealthy() {
        if (!this.config.enabled) {
            return true;
        }

        if (!this.tracer) {
            return !this.config.strict;
        }

        return (
            typeof this.tracer.startSpan ===
            'function'
        );
    }

    async isReady() {
        return this.isHealthy();
    }

    /**
     * =========================================================================
     * Span Name Normalization
     * =========================================================================
     */

    normalizeSpanName(name) {
        const raw =
            String(
                name ||
                'transaction.operation'
            )
                .trim();

        const normalized =
            raw
                .replace(/[^a-zA-Z0-9._:-]/g, '_')
                .replace(/_+/g, '_');

        const prefix =
            this.config.spanPrefix;

        if (
            normalized.startsWith(
                `${prefix}.`
            )
        ) {
            return normalized;
        }

        return `${prefix}.${normalized}`;
    }

    /**
     * =========================================================================
     * Attribute Normalization
     * =========================================================================
     *
     * High-cardinality transaction identifiers are intentionally excluded from
     * span attributes only when they would create uncontrolled observability
     * cardinality. They remain available to logs through the transaction
     * context.
     */

    normalizeAttributes(
        attributes = {}
    ) {
        if (
            !attributes ||
            typeof attributes !== 'object' ||
            Array.isArray(attributes)
        ) {
            return {};
        }

        const normalized = {};

        for (
            const [key, value]
            of Object.entries(attributes)
        ) {
            if (
                RESERVED_HIGH_CARDINALITY_ATTRIBUTES
                    .has(key)
            ) {
                continue;
            }

            if (
                value === undefined ||
                value === null
            ) {
                continue;
            }

            if (
                Object.keys(normalized).length >=
                this.config.maxAttributes
            ) {
                break;
            }

            const normalizedKey =
                this.normalizeAttributeKey(
                    key
                );

            if (!normalizedKey) {
                continue;
            }

            normalized[normalizedKey] =
                this.normalizeAttributeValue(
                    value
                );
        }

        return {
            'service.name':
                this.config.serviceName,

            'deployment.environment':
                this.config.environment,

            ...normalized
        };
    }

    normalizeAttributeKey(key) {
        return String(key)
            .trim()
            .replace(
                /[^a-zA-Z0-9._:-]/g,
                '_'
            )
            .substring(0, 100);
    }

    normalizeAttributeValue(value) {
        let result;

        if (
            typeof value === 'object'
        ) {
            try {
                result =
                    JSON.stringify(value);
            } catch {
                result =
                    '[object]';
            }
        } else {
            result =
                String(value);
        }

        return result.substring(
            0,
            this.config.maxAttributeLength
        );
    }

    /**
     * =========================================================================
     * Safe Span Start
     * =========================================================================
     *
     * Backward-compatible API:
     *
     *   tracer.start('transaction.publish');
     */

    start(
        name,
        options = {}
    ) {
        if (
            !this.config.enabled
        ) {
            return this.createNoopSpan(
                name
            );
        }

        if (!this.tracer) {
            return this.handleUnavailableTracer(
                name
            );
        }

        if (
            typeof this.tracer.startSpan !==
            'function'
        ) {
            return this.handleUnavailableTracer(
                name
            );
        }

        const spanName =
            this.normalizeSpanName(
                name
            );

        const attributes =
            this.normalizeAttributes(
                options.attributes ||
                {}
            );

        try {
            const span =
                this.tracer.startSpan(
                    spanName,
                    {
                        attributes,

                        kind:
                            options.kind,

                        links:
                            options.links,

                        startTime:
                            options.startTime
                    }
                );

            if (!span) {
                return this.createNoopSpan(
                    spanName
                );
            }

            this.internal.spansStarted++;

            return this.wrapSpan(
                span,
                spanName
            );
        } catch (error) {
            this.recordTracingError(
                error
            );

            if (
                this.config.strict
            ) {
                throw error;
            }

            return this.createNoopSpan(
                spanName
            );
        }
    }

    /**
     * =========================================================================
     * Start Publisher Span
     * =========================================================================
     */

    startPublish(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.PUBLISH,
            options
        );
    }

    /**
     * =========================================================================
     * Start Child Span
     * =========================================================================
     */

    startChild(
        parentSpan,
        name,
        options = {}
    ) {
        const span =
            this.start(
                name,
                options
            );

        if (
            parentSpan &&
            span &&
            typeof span.setParent ===
                'function'
        ) {
            try {
                span.setParent(
                    parentSpan
                );
            } catch {
                // Parent linkage is optional.
            }
        }

        return span;
    }

    /**
     * =========================================================================
     * Execute Inside Span
     * =========================================================================
     */

    async trace(
        name,
        operation,
        options = {}
    ) {
        const span =
            this.start(
                name,
                options
            );

        const startedAt =
            process.hrtime.bigint();

        try {
            const result =
                await operation(
                    span
                );

            this.setStatus(
                span,
                SPAN_STATUS.OK
            );

            return result;
        } catch (error) {
            this.recordError(
                span,
                error
            );

            this.setStatus(
                span,
                SPAN_STATUS.ERROR,
                error?.message
            );

            throw error;
        } finally {
            const endedAt =
                process.hrtime.bigint();

            const durationMs =
                Number(
                    endedAt -
                    startedAt
                ) / 1e6;

            this.setAttribute(
                span,
                'transaction.duration_ms',
                durationMs
            );

            this.end(
                span
            );
        }
    }

    /**
     * =========================================================================
     * Span Wrapper
     * =========================================================================
     */

    wrapSpan(
        span,
        spanName
    ) {
        const tracer =
            this;

        let ended = false;

        return {
            raw:
                span,

            name:
                spanName,

            setAttribute(
                key,
                value
            ) {
                return tracer.setAttribute(
                    span,
                    key,
                    value
                );
            },

            setAttributes(
                attributes
            ) {
                return tracer.setAttributes(
                    span,
                    attributes
                );
            },

            setStatus(
                status,
                message
            ) {
                return tracer.setStatus(
                    span,
                    status,
                    message
                );
            },

            recordError(
                error
            ) {
                return tracer.recordError(
                    span,
                    error
                );
            },

            addEvent(
                eventName,
                attributes
            ) {
                return tracer.addEvent(
                    span,
                    eventName,
                    attributes
                );
            },

            end(
                endTime
            ) {
                if (ended) {
                    return false;
                }

                ended = true;

                return tracer.end(
                    span,
                    endTime
                );
            },

            isEnded() {
                return ended;
            }
        };
    }

    /**
     * =========================================================================
     * Set Attribute
     * =========================================================================
     */

    setAttribute(
        span,
        key,
        value
    ) {
        if (!span) {
            return false;
        }

        try {
            if (
                typeof span.setAttribute !==
                'function'
            ) {
                return false;
            }

            const attributes =
                this.normalizeAttributes({
                    [key]:
                        value
                });

            const normalizedKey =
                Object.keys(
                    attributes
                ).find(
                    attributeKey =>
                        attributeKey !==
                            'service.name' &&
                        attributeKey !==
                            'deployment.environment'
                );

            if (!normalizedKey) {
                return false;
            }

            span.setAttribute(
                normalizedKey,
                attributes[
                    normalizedKey
                ]
            );

            return true;
        } catch (error) {
            this.recordTracingError(
                error
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Set Attributes
     * =========================================================================
     */

    setAttributes(
        span,
        attributes = {}
    ) {
        if (!span) {
            return false;
        }

        const normalized =
            this.normalizeAttributes(
                attributes
            );

        try {
            if (
                typeof span.setAttributes ===
                'function'
            ) {
                span.setAttributes(
                    normalized
                );

                return true;
            }

            for (
                const [
                    key,
                    value
                ]
                of Object.entries(
                    normalized
                )
            ) {
                this.setAttribute(
                    span,
                    key,
                    value
                );
            }

            return true;
        } catch (error) {
            this.recordTracingError(
                error
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Span Event
     * =========================================================================
     */

    addEvent(
        span,
        eventName,
        attributes = {}
    ) {
        if (!span) {
            return false;
        }

        try {
            if (
                typeof span.addEvent !==
                'function'
            ) {
                return false;
            }

            span.addEvent(
                String(eventName),
                this.normalizeAttributes(
                    attributes
                )
            );

            return true;
        } catch (error) {
            this.recordTracingError(
                error
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Span Status
     * =========================================================================
     */

    setStatus(
        span,
        status,
        message
    ) {
        if (!span) {
            return false;
        }

        try {
            if (
                typeof span.setStatus !==
                'function'
            ) {
                return false;
            }

            const normalizedStatus =
                Object.values(
                    SPAN_STATUS
                ).includes(status)
                    ? status
                    : SPAN_STATUS.UNSET;

            const statusObject = {
                code:
                    normalizedStatus
            };

            if (message) {
                statusObject.message =
                    String(message).substring(
                        0,
                        this.config.maxAttributeLength
                    );
            }

            span.setStatus(
                statusObject
            );

            return true;
        } catch (error) {
            this.recordTracingError(
                error
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Error Recording
     * =========================================================================
     */

    recordError(
        span,
        error
    ) {
        if (!span || !error) {
            return false;
        }

        this.internal.spanErrors++;

        try {
            if (
                typeof span.recordException ===
                'function' &&
                this.config.recordExceptions
            ) {
                span.recordException(
                    error
                );
            }

            this.setAttribute(
                span,
                'error.type',
                error.name ||
                    'Error'
            );

            this.setAttribute(
                span,
                'error.message',
                error.message ||
                    String(error)
            );

            if (
                this.config.captureStackTrace &&
                error.stack
            ) {
                this.setAttribute(
                    span,
                    'error.stack',
                    error.stack
                );
            }

            this.addEvent(
                span,
                'exception',
                {
                    'exception.type':
                        error.name ||
                        'Error',

                    'exception.message':
                        error.message ||
                        String(error)
                }
            );

            return true;
        } catch (recordingError) {
            this.recordTracingError(
                recordingError
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Span End
     * =========================================================================
     */

    end(
        span,
        endTime
    ) {
        if (!span) {
            return false;
        }

        try {
            if (
                typeof span.end !==
                'function'
            ) {
                return false;
            }

            if (
                endTime !== undefined
            ) {
                span.end(
                    endTime
                );
            } else {
                span.end();
            }

            this.internal.spansEnded++;

            return true;
        } catch (error) {
            this.recordTracingError(
                error
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * Transaction Publisher Helpers
     * =========================================================================
     */

    startRetry(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.RETRY,
            options
        );
    }

    startDeadLetter(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.DEAD_LETTER,
            options
        );
    }

    startDeadLetterRestore(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.DEAD_LETTER_RESTORE,
            options
        );
    }

    startCircuitBreaker(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.CIRCUIT_BREAKER,
            options
        );
    }

    startBackpressure(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.BACKPRESSURE,
            options
        );
    }

    startIdempotency(
        options = {}
    ) {
        return this.start(
            SPAN_NAMES.IDEMPOTENCY,
            options
        );
    }

    /**
     * =========================================================================
     * Publisher Result
     * =========================================================================
     */

    recordPublishResult(
        span,
        {
            success = false,
            decision,
            retry = false,
            timeout = false,
            duplicate = false,
            error = null
        } = {}
    ) {
        if (!span) {
            return false;
        }

        this.setAttribute(
            span,
            'transaction.publish.success',
            success
        );

        if (decision) {
            this.setAttribute(
                span,
                'transaction.publish.decision',
                decision
            );
        }

        if (retry) {
            this.addEvent(
                span,
                'transaction.publish.retry'
            );
        }

        if (timeout) {
            this.addEvent(
                span,
                'transaction.publish.timeout'
            );
        }

        if (duplicate) {
            this.addEvent(
                span,
                'transaction.publish.duplicate'
            );
        }

        if (error) {
            this.recordError(
                span,
                error
            );

            this.setStatus(
                span,
                SPAN_STATUS.ERROR,
                error.message
            );
        } else if (success) {
            this.setStatus(
                span,
                SPAN_STATUS.OK
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * No-op Span
     * =========================================================================
     *
     * Ensures callers can always safely call:
     *
     *   span.setAttribute()
     *   span.setStatus()
     *   span.end()
     *
     * even when OpenTelemetry is unavailable.
     */

    createNoopSpan(
        name
    ) {
        let ended = false;

        return {
            raw: null,

            name:
                this.normalizeSpanName(
                    name
                ),

            setAttribute() {
                return false;
            },

            setAttributes() {
                return false;
            },

            setStatus() {
                return false;
            },

            recordError() {
                return false;
            },

            addEvent() {
                return false;
            },

            end() {
                if (ended) {
                    return false;
                }

                ended = true;

                return true;
            },

            isEnded() {
                return ended;
            }
        };
    }

    /**
     * =========================================================================
     * Unavailable Tracer Handling
     * =========================================================================
     */

    handleUnavailableTracer(
        name
    ) {
        if (
            this.config.strict
        ) {
            throw new Error(
                'Transaction tracing infrastructure is unavailable'
            );
        }

        return this.createNoopSpan(
            name
        );
    }

    /**
     * =========================================================================
     * Tracing Error Handling
     * =========================================================================
     */

    recordTracingError(
        error
    ) {
        this.internal.tracingErrors++;

        this.internal.lastError = {
            message:
                error?.message ||
                String(error),

            timestamp:
                new Date()
        };

        try {
            this.logger.warn?.(
                {
                    component:
                        'TransactionPublisherTracer',

                    error:
                        error?.message ||
                        String(error)
                },
                'Transaction tracing operation failed'
            );
        } catch {
            // Never propagate observability failures.
        }
    }

    /**
     * =========================================================================
     * Runtime Snapshot
     * =========================================================================
     */

    getSnapshot() {
        return {
            enabled:
                this.config.enabled,

            available:
                this.isAvailable(),

            healthy:
                this.isHealthy(),

            service:
                this.config.serviceName,

            environment:
                this.config.environment,

            startedAt:
                this.startedAt,

            internal: {
                spansStarted:
                    this.internal.spansStarted,

                spansEnded:
                    this.internal.spansEnded,

                spanErrors:
                    this.internal.spanErrors,

                tracingErrors:
                    this.internal.tracingErrors,

                lastError:
                    this.internal.lastError
            }
        };
    }

    /**
     * =========================================================================
     * Runtime Reset
     * =========================================================================
     */

    resetRuntimeState() {
        this.internal.spansStarted = 0;
        this.internal.spansEnded = 0;
        this.internal.spanErrors = 0;
        this.internal.tracingErrors = 0;
        this.internal.lastError = null;

        return true;
    }
}

/**
 * =============================================================================
 * Static Constants
 * =============================================================================
 */

TransactionPublisherTracer.SPAN_NAMES =
    SPAN_NAMES;

TransactionPublisherTracer.SPAN_STATUS =
    SPAN_STATUS;

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

TransactionPublisherTracer.create =
    function create(
        tracer,
        options = {}
    ) {
        return new TransactionPublisherTracer(
            tracer,
            options
        );
    };

/**
 * =============================================================================
 * Module Export
 * =============================================================================
 */

module.exports =
    TransactionPublisherTracer;