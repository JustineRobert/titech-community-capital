'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Tracer
 * ============================================================================
 *
 * Production-grade distributed tracing infrastructure for financial workflows.
 *
 * Design Goals
 * ----------------------------------------------------------------------------
 * • OpenTelemetry compatible
 * • No-op fallback when OpenTelemetry is unavailable
 * • Transaction / tenant / request / provider correlation
 * • Parent / child span relationships
 * • Async operation tracing
 * • Error recording and span status management
 * • Trace context propagation
 * • Provider, database and messaging tracing
 * • Safe attribute and event handling
 * • Sensitive data filtering
 * • Circular-safe serialization
 * • Metrics hooks
 * • Audit lifecycle publishing
 * • Active span cleanup
 * • Double-end protection
 * • Graceful shutdown
 * • Deterministic testing support
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SpanStatus = Object.freeze({
    OK: 'OK',
    ERROR: 'ERROR',
    UNSET: 'UNSET'
});

const OTEL_STATUS_CODES = Object.freeze({
    UNSET: 0,
    OK: 1,
    ERROR: 2
});

const DEFAULTS = Object.freeze({
    maxAttributes: 100,
    maxEvents: 100,
    maxAttributeStringLength: 2048,
    maxArrayLength: 50,
    maxObjectDepth: 8,
    maxActiveSpanAgeMs: 60 * 60 * 1000,
    enableAuditPublishing: true,
    shutdownSpanStatus: SpanStatus.UNSET
});

const SENSITIVE_ATTRIBUTE_PATTERNS = Object.freeze([
    'password',
    'passwd',
    'token',
    'access_token',
    'accessToken',
    'refresh_token',
    'refreshToken',
    'secret',
    'api_key',
    'apiKey',
    'authorization',
    'cookie',
    'pin',
    'otp',
    'card',
    'card_number',
    'cardNumber',
    'cvv',
    'cvc',
    'security_code',
    'securityCode',
    'private_key',
    'privateKey'
]);

const TRACE_CARRIER_KEYS = Object.freeze({
    traceId: 'traceId',
    spanId: 'spanId',
    parentSpanId: 'parentSpanId'
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function safeString(value, maxLength = 2048) {

    if (value === null || value === undefined) {
        return value;
    }

    const stringValue = String(value);

    if (stringValue.length <= maxLength) {
        return stringValue;
    }

    return `${stringValue.slice(0, maxLength)}...`;
}

function normalizeError(error, maxLength = 2048) {

    if (!error) {
        return null;
    }

    if (typeof error !== 'object') {
        return {
            name: 'Error',
            message: safeString(error, maxLength),
            code: null,
            status: null
        };
    }

    return {
        name: error.name || 'Error',
        message: safeString(
            error.message || 'Unknown error',
            maxLength
        ),
        code: error.code || null,
        status: error.status || null
    };
}

function isPlainObject(value) {

    if (!value || typeof value !== 'object') {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeAttributeKey(key) {

    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[.\-:/\\]/g, '_')
        .toLowerCase();
}

function isSensitiveAttributeKey(key) {

    const normalized =
        normalizeAttributeKey(key);

    const segments =
        normalized.split('_');

    return SENSITIVE_ATTRIBUTE_PATTERNS
        .some(pattern => {

            const normalizedPattern =
                normalizeAttributeKey(pattern);

            return (
                normalized === normalizedPattern ||
                normalized.includes(normalizedPattern) ||
                segments.includes(normalizedPattern)
            );
        });
}

/**
 * ============================================================================
 * Transaction Tracer
 * ============================================================================
 */

class TransactionTracer {

    constructor(options = {}) {

        this.tracer =
            options.tracer || null;

        this.logger =
            options.logger || console;

        this.metrics =
            options.metrics || null;

        this.auditPublisher =
            options.auditPublisher || null;

        this.serviceName =
            options.serviceName ||
            'transaction-service';

        this.environment =
            options.environment ||
            process.env.NODE_ENV ||
            'development';

        this.config = {
            ...DEFAULTS,
            ...options
        };

        this.clock =
            options.clock || Date;

        this.activeSpans =
            new Map();

        this.statistics = {
            created: 0,
            completed: 0,
            failed: 0,
            errors: 0,
            expired: 0,
            auditFailures: 0
        };

        this.shuttingDown = false;
        this.shutdownComplete = false;
    }

    /**
     * ========================================================================
     * Transaction Trace
     * ========================================================================
     */

    startTransaction(context = {}) {

        return this.startSpan(
            'transaction',
            {
                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                tenantId:
                    context.tenantId,

                userId:
                    context.userId,

                provider:
                    context.provider,

                operation:
                    context.operation,

                traceId:
                    context.traceId,

                parentSpanId:
                    context.parentSpanId
            },
            {
                parentContext:
                    context.parentContext ||
                    context.otelContext ||
                    null
            }
        );
    }

    /**
     * ========================================================================
     * Start Span
     * ========================================================================
     */

    startSpan(
        name,
        attributes = {},
        options = {}
    ) {

        if (
            !name ||
            typeof name !== 'string'
        ) {

            throw new TypeError(
                'Span name must be a non-empty string'
            );
        }

        if (this.shutdownComplete) {

            this.safeLog(
                'warn',
                '[TransactionTracer] Span creation attempted after shutdown',
                { name }
            );

            return this.createNoopSpan(
                name,
                attributes
            );
        }

        const spanId =
            crypto.randomUUID();

        const traceId =
            attributes.traceId ||
            crypto.randomUUID();

        const parentSpanId =
            attributes.parentSpanId ||
            null;

        const startTime =
            this.now();

        const sanitizedAttributes =
            this.buildAttributes(
                attributes
            );

        let otelSpan = null;

        if (
            this.tracer &&
            typeof this.tracer.startSpan === 'function'
        ) {

            try {

                const spanOptions = {
                    attributes:
                        sanitizedAttributes
                };

                if (options.parentContext) {

                    otelSpan =
                        this.tracer.startSpan(
                            name,
                            spanOptions,
                            options.parentContext
                        );

                }
                else {

                    otelSpan =
                        this.tracer.startSpan(
                            name,
                            spanOptions
                        );
                }

            }
            catch (error) {

                this.safeLog(
                    'warn',
                    '[TransactionTracer] OpenTelemetry span creation failed',
                    {
                        name,
                        error:
                            normalizeError(
                                error,
                                this.config.maxAttributeStringLength
                            )
                    }
                );
            }
        }

        const span = {
            id: spanId,

            traceId,

            parentSpanId,

            name,

            startTime,

            endTime: null,

            durationMs: null,

            status:
                SpanStatus.UNSET,

            attributes:
                sanitizedAttributes,

            events: [],

            error: null,

            ended: false,

            ending: false,

            errorRecorded: false,

            otelErrorRecorded: false,

            otelSpan,

            createdAt:
                this.nowDate()
        };

        this.activeSpans.set(
            spanId,
            span
        );

        this.statistics.created++;

        this.safeMetricIncrement(
            'transaction_trace_spans_created_total',
            {
                operation: name
            }
        );

        this.publishAuditEvent(
            'transaction.trace.started',
            span
        );

        return span;
    }

    /**
     * ========================================================================
     * End Span
     * ========================================================================
     */

    endSpan(span, result = {}) {

        if (!span) {
            return null;
        }

        if (
            span.ended ||
            span.ending
        ) {

            return span;
        }

        span.ending = true;

        try {

            if (result.attributes) {

                this.addAttributes(
                    span,
                    result.attributes
                );
            }

            if (result.error) {

                this.recordError(
                    span,
                    result.error
                );
            }
            else if (
                result.status &&
                Object.values(SpanStatus)
                    .includes(result.status)
            ) {

                span.status =
                    result.status;

            }
            else if (
                span.status ===
                SpanStatus.UNSET
            ) {

                span.status =
                    SpanStatus.OK;
            }

            const endTime =
                this.now();

            span.endTime =
                endTime;

            span.durationMs =
                Math.max(
                    0,
                    endTime - span.startTime
                );

            this.finalizeOtelSpan(
                span
            );

            span.ended = true;

            this.activeSpans.delete(
                span.id
            );

            this.statistics.completed++;

            if (
                span.status ===
                SpanStatus.ERROR
            ) {

                this.statistics.failed++;
            }

            this.safeMetricObserve(
                'transaction_trace_duration_ms',
                span.durationMs,
                {
                    operation:
                        span.name,

                    status:
                        span.status
                }
            );

            this.safeMetricIncrement(
                'transaction_trace_spans_completed_total',
                {
                    operation:
                        span.name,

                    status:
                        span.status
                }
            );

            this.publishAuditEvent(
                'transaction.trace.completed',
                span
            );

            return span;

        }
        finally {

            span.ending = false;
        }
    }

    /**
     * ========================================================================
     * Trace Async Operation
     * ========================================================================
     */

    async trace(
        name,
        operation,
        attributes = {},
        options = {}
    ) {

        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(
                'Trace operation must be a function'
            );
        }

        const span =
            this.startSpan(
                name,
                attributes,
                options
            );

        try {

            const result =
                await operation(
                    span,
                    this.getContext(span)
                );

            this.endSpan(
                span,
                {
                    status:
                        SpanStatus.OK
                }
            );

            return result;

        }
        catch (error) {

            this.endSpan(
                span,
                {
                    error
                }
            );

            throw error;
        }
    }

    /**
     * ========================================================================
     * Transaction Operation Trace
     * ========================================================================
     */

    async traceOperation(
        operationName,
        operation,
        context = {}
    ) {

        return this.trace(
            `transaction.${operationName}`,
            operation,
            {
                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                tenantId:
                    context.tenantId,

                userId:
                    context.userId,

                provider:
                    context.provider,

                operation:
                    operationName,

                traceId:
                    context.traceId,

                parentSpanId:
                    context.parentSpanId
            },
            {
                parentContext:
                    context.parentContext ||
                    context.otelContext ||
                    null
            }
        );
    }

    /**
     * ========================================================================
     * Provider Trace
     * ========================================================================
     */

    async traceProviderCall(
        provider,
        operation,
        callback,
        context = {}
    ) {

        return this.trace(
            `provider.${provider}.${operation}`,
            callback,
            {
                provider,

                operation,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                tenantId:
                    context.tenantId,

                traceId:
                    context.traceId,

                parentSpanId:
                    context.parentSpanId
            },
            {
                parentContext:
                    context.parentContext ||
                    context.otelContext ||
                    null
            }
        );
    }

    /**
     * ========================================================================
     * Database Trace
     * ========================================================================
     */

    async traceDatabaseOperation(
        operation,
        callback,
        context = {}
    ) {

        return this.trace(
            `database.${operation}`,
            callback,
            {
                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                tenantId:
                    context.tenantId,

                operation,

                database:
                    context.database || null,

                collection:
                    context.collection || null,

                traceId:
                    context.traceId,

                parentSpanId:
                    context.parentSpanId
            },
            {
                parentContext:
                    context.parentContext ||
                    context.otelContext ||
                    null
            }
        );
    }

    /**
     * ========================================================================
     * Messaging Trace
     * ========================================================================
     */

    async traceMessagingOperation(
        operation,
        callback,
        context = {}
    ) {

        return this.trace(
            `messaging.${operation}`,
            callback,
            {
                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                tenantId:
                    context.tenantId,

                operation,

                topic:
                    context.topic || null,

                provider:
                    context.provider || null,

                traceId:
                    context.traceId,

                parentSpanId:
                    context.parentSpanId
            },
            {
                parentContext:
                    context.parentContext ||
                    context.otelContext ||
                    null
            }
        );
    }

    /**
     * ========================================================================
     * Transaction Lifecycle
     * ========================================================================
     */

    transactionStarted(context = {}) {

        const span =
            this.startTransaction({
                ...context,
                operation:
                    'transaction.started'
            });

        this.addEvent(
            span,
            'transaction.started'
        );

        return span;
    }

    transactionCommitted(span) {

        if (!span) {
            return null;
        }

        this.addEvent(
            span,
            'transaction.committed'
        );

        return this.endSpan(
            span,
            {
                status:
                    SpanStatus.OK
            }
        );
    }

    transactionFailed(
        span,
        error
    ) {

        if (!span) {
            return null;
        }

        this.addEvent(
            span,
            'transaction.failed',
            {
                code:
                    error?.code || null
            }
        );

        return this.endSpan(
            span,
            {
                error
            }
        );
    }

    /**
     * ========================================================================
     * Retry Trace
     * ========================================================================
     */

    retryAttempt(
        span,
        attempt,
        delay,
        error = null
    ) {

        if (!span) {
            return;
        }

        this.addEvent(
            span,
            'transaction.retry',
            {
                attempt,
                delayMs: delay,
                errorCode:
                    error?.code || null
            }
        );

        this.safeMetricIncrement(
            'transaction_trace_retry_total',
            {
                operation:
                    span.name
            }
        );
    }

    /**
     * ========================================================================
     * Timeout Trace
     * ========================================================================
     */

    timeout(
        span,
        timeoutMs
    ) {

        if (!span) {
            return;
        }

        this.addEvent(
            span,
            'transaction.timeout',
            {
                timeoutMs
            }
        );

        this.addAttribute(
            span,
            'transaction.timeout',
            true
        );
    }

    /**
     * ========================================================================
     * State Transition Trace
     * ========================================================================
     */

    stateTransition(
        span,
        from,
        to,
        metadata = {}
    ) {

        if (!span) {
            return;
        }

        this.addEvent(
            span,
            'transaction.state.changed',
            {
                from,
                to,
                ...metadata
            }
        );

        this.addAttribute(
            span,
            'transaction.state',
            to
        );
    }

    /**
     * ========================================================================
     * Error Recording
     * ========================================================================
     */

    recordError(
        span,
        error
    ) {

        if (
            !span ||
            !error ||
            span.ended
        ) {

            return;
        }

        if (span.errorRecorded) {
            return;
        }

        const normalized =
            normalizeError(
                error,
                this.config.maxAttributeStringLength
            );

        span.status =
            SpanStatus.ERROR;

        span.error =
            normalized;

        span.errorRecorded =
            true;

        this.statistics.errors++;

        this.addAttributes(
            span,
            {
                'error.type':
                    normalized.name,

                'error.message':
                    normalized.message,

                'error.code':
                    normalized.code
            }
        );

        this.addEvent(
            span,
            'exception',
            {
                type:
                    normalized.name,

                message:
                    normalized.message,

                code:
                    normalized.code
            }
        );

        this.recordOtelError(
            span,
            error,
            normalized
        );
    }

    /**
     * ========================================================================
     * Attribute Handling
     * ========================================================================
     */

    addAttribute(
        span,
        key,
        value
    ) {

        if (
            !span ||
            !key ||
            span.ended
        ) {

            return false;
        }

        if (
            isSensitiveAttributeKey(key)
        ) {

            return false;
        }

        const exists =
            Object.prototype.hasOwnProperty.call(
                span.attributes,
                key
            );

        if (
            !exists &&
            Object.keys(span.attributes).length >=
            this.config.maxAttributes
        ) {

            return false;
        }

        const sanitized =
            this.sanitizeAttributeValue(
                value
            );

        span.attributes[key] =
            sanitized;

        try {

            span.otelSpan?.setAttribute?.(
                key,
                sanitized
            );

        }
        catch (error) {

            this.safeLog(
                'debug',
                '[TransactionTracer] Failed to set OTel attribute',
                {
                    key,
                    error:
                        normalizeError(error)
                }
            );
        }

        return true;
    }

    addAttributes(
        span,
        attributes = {}
    ) {

        if (
            !attributes ||
            typeof attributes !== 'object'
        ) {

            return;
        }

        for (
            const [key, value]
            of Object.entries(attributes)
        ) {

            this.addAttribute(
                span,
                key,
                value
            );
        }
    }

    /**
     * ========================================================================
     * Event Handling
     * ========================================================================
     */

    addEvent(
        span,
        name,
        attributes = {}
    ) {

        if (
            !span ||
            !name ||
            span.ended
        ) {

            return false;
        }

        if (
            span.events.length >=
            this.config.maxEvents
        ) {

            return false;
        }

        const event = {
            name,

            attributes:
                this.sanitizeAttributes(
                    attributes
                ),

            timestamp:
                this.nowDate()
        };

        span.events.push(event);

        try {

            span.otelSpan?.addEvent?.(
                name,
                event.attributes
            );

        }
        catch (error) {

            this.safeLog(
                'debug',
                '[TransactionTracer] Failed to add OTel event',
                {
                    name,
                    error:
                        normalizeError(error)
                }
            );
        }

        return true;
    }

    /**
     * ========================================================================
     * Context
     * ========================================================================
     */

    getContext(span) {

        if (!span) {
            return null;
        }

        return Object.freeze({
            traceId:
                span.traceId,

            spanId:
                span.id,

            parentSpanId:
                span.parentSpanId,

            transactionId:
                span.attributes
                    ?.transactionId ||
                null,

            correlationId:
                span.attributes
                    ?.correlationId ||
                null,

            requestId:
                span.attributes
                    ?.requestId ||
                null,

            tenantId:
                span.attributes
                    ?.tenantId ||
                null,

            provider:
                span.attributes
                    ?.provider ||
                null
        });
    }

    injectContext(
        span,
        carrier = {}
    ) {

        if (
            !carrier ||
            typeof carrier !== 'object'
        ) {

            throw new TypeError(
                'Trace carrier must be an object'
            );
        }

        const context =
            this.getContext(span);

        if (!context) {
            return carrier;
        }

        carrier[
            TRACE_CARRIER_KEYS.traceId
        ] = context.traceId;

        carrier[
            TRACE_CARRIER_KEYS.spanId
        ] = context.spanId;

        if (context.parentSpanId) {

            carrier[
                TRACE_CARRIER_KEYS.parentSpanId
            ] = context.parentSpanId;
        }

        return carrier;
    }

    extractContext(carrier = {}) {

        if (
            !carrier ||
            typeof carrier !== 'object'
        ) {

            return {
                traceId: null,
                parentSpanId: null
            };
        }

        return {
            traceId:
                carrier[
                    TRACE_CARRIER_KEYS.traceId
                ] || null,

            parentSpanId:
                carrier[
                    TRACE_CARRIER_KEYS.spanId
                ] ||
                carrier[
                    TRACE_CARRIER_KEYS.parentSpanId
                ] ||
                null
        };
    }

    /**
     * ========================================================================
     * Attribute Sanitization
     * ========================================================================
     */

    buildAttributes(
        attributes = {}
    ) {

        return {
            service:
                this.serviceName,

            environment:
                this.environment,

            ...this.sanitizeAttributes(
                attributes
            )
        };
    }

    sanitizeAttributes(
        attributes = {}
    ) {

        if (
            !attributes ||
            typeof attributes !== 'object'
        ) {

            return {};
        }

        const output = {};

        for (
            const [key, value]
            of Object.entries(attributes)
        ) {

            if (
                isSensitiveAttributeKey(key)
            ) {

                continue;
            }

            output[key] =
                this.sanitizeAttributeValue(
                    value
                );
        }

        return output;
    }

    sanitizeAttributeValue(
        value,
        depth = 0,
        seen = new WeakSet()
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;
        }

        if (
            depth >=
            this.config.maxObjectDepth
        ) {

            return '[MaxDepthExceeded]';
        }

        if (value instanceof Error) {

            return JSON.stringify({
                name:
                    safeString(
                        value.name,
                        this.config.maxAttributeStringLength
                    ),

                message:
                    safeString(
                        value.message,
                        this.config.maxAttributeStringLength
                    ),

                code:
                    value.code || null
            });
        }

        if (value instanceof Date) {

            return value.toISOString();
        }

        if (typeof value === 'string') {

            return safeString(
                value,
                this.config.maxAttributeStringLength
            );
        }

        if (
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {

            return value;
        }

        if (typeof value === 'bigint') {

            return value.toString();
        }

        if (typeof value === 'symbol') {

            return value.toString();
        }

        if (typeof value === 'function') {

            return '[Function]';
        }

        if (Array.isArray(value)) {

            return value
                .slice(
                    0,
                    this.config.maxArrayLength
                )
                .map(item =>
                    this.sanitizeAttributeValue(
                        item,
                        depth + 1,
                        seen
                    )
                );
        }

        if (typeof value === 'object') {

            if (seen.has(value)) {
                return '[Circular]';
            }

            seen.add(value);

            const output = {};

            const source =
                isPlainObject(value)
                    ? value
                    : Object.assign({}, value);

            for (
                const [key, nestedValue]
                of Object.entries(source)
            ) {

                if (
                    isSensitiveAttributeKey(key)
                ) {

                    continue;
                }

                output[key] =
                    this.sanitizeAttributeValue(
                        nestedValue,
                        depth + 1,
                        seen
                    );
            }

            try {

                return JSON.stringify(output);

            }
            catch (error) {

                return '[UnserializableObject]';
            }
        }

        return safeString(
            value,
            this.config.maxAttributeStringLength
        );
    }

    /**
     * ========================================================================
     * OpenTelemetry Finalization
     * ========================================================================
     */

    recordOtelError(
        span,
        error,
        normalized
    ) {

        if (
            !span?.otelSpan ||
            span.otelErrorRecorded
        ) {

            return;
        }

        try {

            span.otelSpan.recordException?.(
                error
            );

            span.otelSpan.setStatus?.({
                code:
                    OTEL_STATUS_CODES.ERROR,

                message:
                    normalized.message
            });

            span.otelErrorRecorded = true;

        }
        catch (otelError) {

            this.safeLog(
                'warn',
                '[TransactionTracer] OpenTelemetry error recording failed',
                {
                    spanId:
                        span.id,

                    error:
                        normalizeError(otelError)
                }
            );
        }
    }

    finalizeOtelSpan(span) {

        if (!span?.otelSpan) {
            return;
        }

        try {

            if (
                span.status ===
                SpanStatus.ERROR
            ) {

                span.otelSpan.setStatus?.({
                    code:
                        OTEL_STATUS_CODES.ERROR,

                    message:
                        span.error?.message ||
                        'Transaction span failed'
                });

            }
            else if (
                span.status ===
                SpanStatus.OK
            ) {

                span.otelSpan.setStatus?.({
                    code:
                        OTEL_STATUS_CODES.OK
                });

            }
            else {

                span.otelSpan.setStatus?.({
                    code:
                        OTEL_STATUS_CODES.UNSET
                });
            }

            span.otelSpan.end?.();

        }
        catch (error) {

            this.safeLog(
                'warn',
                '[TransactionTracer] OpenTelemetry span finalization failed',
                {
                    spanId:
                        span.id,

                    error:
                        normalizeError(error)
                }
            );
        }
    }

    /**
     * ========================================================================
     * Active Span Management
     * ========================================================================
     */

    getActiveSpans() {

        return Array.from(
            this.activeSpans.values()
        ).map(span =>
            this.snapshotSpan(span)
        );
    }

    getSpan(spanId) {

        const span =
            this.activeSpans.get(spanId);

        return span
            ? this.snapshotSpan(span)
            : null;
    }

    cleanupExpiredSpans(
        maxAgeMs =
            this.config.maxActiveSpanAgeMs
    ) {

        const now =
            this.now();

        let cleaned = 0;

        for (
            const span
            of this.activeSpans.values()
        ) {

            if (
                span.ended ||
                now - span.startTime <= maxAgeMs
            ) {

                continue;
            }

            this.addEvent(
                span,
                'transaction.trace.expired',
                {
                    maxAgeMs
                }
            );

            this.endSpan(
                span,
                {
                    status:
                        SpanStatus.ERROR,

                    attributes: {
                        'transaction.trace.expired':
                            true
                    }
                }
            );

            cleaned++;
            this.statistics.expired++;
        }

        return cleaned;
    }

    snapshotSpan(span) {

        return Object.freeze({
            id:
                span.id,

            traceId:
                span.traceId,

            parentSpanId:
                span.parentSpanId,

            name:
                span.name,

            startTime:
                span.startTime,

            endTime:
                span.endTime,

            durationMs:
                span.durationMs,

            status:
                span.status,

            attributes:
                Object.freeze({
                    ...span.attributes
                }),

            events:
                Object.freeze(
                    span.events.map(event =>
                        Object.freeze({
                            ...event,

                            attributes:
                                Object.freeze({
                                    ...event.attributes
                                })
                        })
                    )
                ),

            error:
                span.error
                    ? Object.freeze({
                        ...span.error
                    })
                    : null,

            ended:
                span.ended
        });
    }

    /**
     * ========================================================================
     * Statistics
     * ========================================================================
     */

    getStatistics() {

        return {
            ...this.statistics,

            active:
                this.activeSpans.size,

            otelEnabled:
                Boolean(this.tracer),

            shuttingDown:
                this.shuttingDown,

            shutdownComplete:
                this.shutdownComplete,

            service:
                this.serviceName,

            environment:
                this.environment
        };
    }

    /**
     * ========================================================================
     * Audit Publishing
     * ========================================================================
     */

    publishAuditEvent(
        eventName,
        span
    ) {

        if (
            !this.config.enableAuditPublishing ||
            !this.auditPublisher ||
            !span
        ) {

            return;
        }

        const payload = {
            eventName,

            service:
                this.serviceName,

            environment:
                this.environment,

            traceId:
                span.traceId,

            spanId:
                span.id,

            parentSpanId:
                span.parentSpanId,

            transactionId:
                span.attributes
                    ?.transactionId ||
                null,

            correlationId:
                span.attributes
                    ?.correlationId ||
                null,

            requestId:
                span.attributes
                    ?.requestId ||
                null,

            tenantId:
                span.attributes
                    ?.tenantId ||
                null,

            operation:
                span.name,

            status:
                span.status,

            durationMs:
                span.durationMs,

            timestamp:
                this.nowDate()
        };

        try {

            const publish =
                this.auditPublisher.publish ||
                this.auditPublisher.emit ||
                this.auditPublisher.record;

            if (
                typeof publish !== 'function'
            ) {

                return;
            }

            const result =
                publish.call(
                    this.auditPublisher,
                    eventName,
                    payload
                );

            Promise
                .resolve(result)
                .catch(error => {

                    this.statistics.auditFailures++;

                    this.safeLog(
                        'warn',
                        '[TransactionTracer] Audit publishing failed',
                        {
                            eventName,

                            error:
                                normalizeError(error)
                        }
                    );
                });

        }
        catch (error) {

            this.statistics.auditFailures++;

            this.safeLog(
                'warn',
                '[TransactionTracer] Audit publishing failed',
                {
                    eventName,

                    error:
                        normalizeError(error)
                }
            );
        }
    }

    /**
     * ========================================================================
     * Metrics Safety
     * ========================================================================
     */

    safeMetricIncrement(
        metric,
        labels = {}
    ) {

        try {

            this.metrics?.increment?.(
                metric,
                labels
            );

        }
        catch (error) {

            this.safeLog(
                'debug',
                '[TransactionTracer] Metric increment failed',
                {
                    metric,
                    error:
                        normalizeError(error)
                }
            );
        }
    }

    safeMetricObserve(
        metric,
        value,
        labels = {}
    ) {

        try {

            this.metrics?.observe?.(
                metric,
                value,
                labels
            );

        }
        catch (error) {

            this.safeLog(
                'debug',
                '[TransactionTracer] Metric observation failed',
                {
                    metric,
                    error:
                        normalizeError(error)
                }
            );
        }
    }

    /**
     * ========================================================================
     * Logging Safety
     * ========================================================================
     */

    safeLog(
        level,
        message,
        metadata = {}
    ) {

        try {

            const logger =
                this.logger?.[level];

            if (
                typeof logger === 'function'
            ) {

                logger.call(
                    this.logger,
                    message,
                    metadata
                );
            }

        }
        catch (_) {

            // Observability must never break financial processing.
        }
    }

    /**
     * ========================================================================
     * Time
     * ========================================================================
     */

    now() {

        return this.clock.now();
    }

    nowDate() {

        return new Date(
            this.now()
        );
    }

    /**
     * ========================================================================
     * No-op Span
     * ========================================================================
     */

    createNoopSpan(
        name,
        attributes = {}
    ) {

        return {
            id:
                crypto.randomUUID(),

            traceId:
                attributes.traceId ||
                crypto.randomUUID(),

            parentSpanId:
                attributes.parentSpanId ||
                null,

            name,

            startTime:
                this.now(),

            endTime:
                this.now(),

            durationMs: 0,

            status:
                SpanStatus.UNSET,

            attributes:
                this.buildAttributes(
                    attributes
                ),

            events: [],

            error: null,

            ended: true,

            ending: false,

            errorRecorded: false,

            otelErrorRecorded: false,

            otelSpan: null,

            noop: true
        };
    }

    /**
     * ========================================================================
     * Shutdown
     * ========================================================================
     */

    shutdown() {

        if (this.shutdownComplete) {
            return;
        }

        this.shuttingDown = true;

        const spans =
            Array.from(
                this.activeSpans.values()
            );

        for (const span of spans) {

            if (span.ended) {
                continue;
            }

            this.addEvent(
                span,
                'transaction.tracer.shutdown'
            );

            this.endSpan(
                span,
                {
                    status:
                        this.config.shutdownSpanStatus
                }
            );
        }

        this.activeSpans.clear();

        this.shutdownComplete = true;
        this.shuttingDown = false;
    }

    /**
     * ========================================================================
     * Factory
     * ========================================================================
     */

    static create(options = {}) {

        return new TransactionTracer(
            options
        );
    }
}

/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

TransactionTracer.Status =
    SpanStatus;

TransactionTracer.normalizeError =
    normalizeError;

TransactionTracer.isSensitiveAttributeKey =
    isSensitiveAttributeKey;

module.exports =
    TransactionTracer;