'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Authentication Observability
 * ----------------------------------------------------------
 * Enterprise observability layer for Airtel OAuth lifecycle.
 *
 * Responsibilities
 * ----------------
 * • Authentication telemetry
 * • Token lifecycle metrics
 * • Refresh monitoring
 * • Provider health tracking
 * • Structured event generation
 * • OpenTelemetry span helpers
 * • Prometheus metric hooks
 * • Failure analytics
 * • SLA monitoring hooks
 * • Operational diagnostics
 * • Safe error normalization
 * • Runtime health-state evaluation
 * • Correlation propagation
 * • Bounded diagnostic history
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Authentication execution
 * • OAuth transport
 * • Credential management
 * • Token persistence
 *
 * Security Principles
 * -------------------
 * • Never log access tokens
 * • Never log client secrets
 * • Never persist raw OAuth credentials
 * • Never expose Authorization headers
 * • Avoid unbounded tenant/cardinality labels
 * • Keep observability failures off the auth critical path
 *
 * ==========================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';

const HEALTH_STATUS = Object.freeze({
    UP: 'UP',
    DEGRADED: 'DEGRADED',
    DOWN: 'DOWN'
});

const EVENT_TYPES = Object.freeze({

    AUTH_STARTED:
        'AIRTEL_AUTH_STARTED',

    AUTH_SUCCESS:
        'AIRTEL_AUTH_SUCCESS',

    AUTH_FAILURE:
        'AIRTEL_AUTH_FAILURE',

    TOKEN_REFRESH_STARTED:
        'AIRTEL_TOKEN_REFRESH_STARTED',

    TOKEN_REFRESH_SUCCESS:
        'AIRTEL_TOKEN_REFRESH_SUCCESS',

    TOKEN_REFRESH_FAILURE:
        'AIRTEL_TOKEN_REFRESH_FAILURE',

    HEALTH_DEGRADED:
        'AIRTEL_AUTH_HEALTH_DEGRADED',

    HEALTH_RECOVERED:
        'AIRTEL_AUTH_HEALTH_RECOVERED',

    HEALTH_DOWN:
        'AIRTEL_AUTH_HEALTH_DOWN'
});

const DEFAULTS = Object.freeze({

    serviceName:
        'airtel-auth-service',

    failureHistoryLimit:
        50,

    degradedFailureThreshold:
        3,

    downFailureThreshold:
        10,

    failureWindowMs:
        300000, // 5 minutes

    maxErrorMessageLength:
        500

});


class AirtelAuthObservability {

    constructor({

        logger,

        metrics,

        tracer,

        eventBus,

        auditService,

        serviceName =
            DEFAULTS.serviceName,

        clock =
            Date,

        failureHistoryLimit =
            DEFAULTS.failureHistoryLimit,

        degradedFailureThreshold =
            DEFAULTS.degradedFailureThreshold,

        downFailureThreshold =
            DEFAULTS.downFailureThreshold,

        failureWindowMs =
            DEFAULTS.failureWindowMs,

        enabled = true

    } = {}) {

        this.logger = logger;

        this.metrics = metrics;

        this.tracer = tracer;

        this.eventBus = eventBus;

        this.auditService = auditService;

        this.serviceName =
            serviceName;

        this.clock =
            clock;

        this.enabled =
            enabled !== false;

        this.failureHistoryLimit =
            Math.max(
                1,
                Number(failureHistoryLimit)
            );

        this.degradedFailureThreshold =
            Math.max(
                1,
                Number(degradedFailureThreshold)
            );

        this.downFailureThreshold =
            Math.max(
                this.degradedFailureThreshold,
                Number(downFailureThreshold)
            );

        this.failureWindowMs =
            Math.max(
                1000,
                Number(failureWindowMs)
            );

        this.startedAt =
            new this.clock();

        this.lastHealthStatus =
            HEALTH_STATUS.UP;

        this.lastHealthChangeAt =
            this.startedAt;

        this.lastAuthentication =
            null;

        this.lastRefresh =
            null;

        this.failureHistory =
            [];

        this.sequence =
            0;

        this.statistics = {

            authenticationStarted:
                0,

            authenticationSucceeded:
                0,

            authenticationFailed:
                0,

            refreshStarted:
                0,

            refreshSucceeded:
                0,

            refreshFailed:
                0,

            eventsPublished:
                0,

            eventsFailed:
                0,

            auditsRecorded:
                0,

            auditsFailed:
                0,

            spansStarted:
                0,

            spansFailed:
                0

        };

    }


    /**
     * ----------------------------------------------------------
     * Authentication Started
     * ----------------------------------------------------------
     */

    authenticationStarted({

        tenantId,

        correlationId =
            crypto.randomUUID(),

        startedAt =
            new this.clock()

    } = {}) {

        if (!this.enabled) {
            return correlationId;
        }

        this.statistics.authenticationStarted++;

        this.lastAuthentication = {

            status:
                'STARTED',

            tenantId,

            correlationId,

            startedAt,

            completedAt:
                null,

            durationMs:
                null

        };

        this.increment(
            'payment_airtel_auth_started_total'
        );

        this.emit({

            type:
                EVENT_TYPES.AUTH_STARTED,

            tenantId,

            correlationId,

            metadata: {

                startedAt

            }

        });

        return correlationId;
    }


    /**
     * ----------------------------------------------------------
     * Authentication Success
     * ----------------------------------------------------------
     */

    authenticationSucceeded({

        tenantId,

        correlationId,

        startedAt = null,

        durationMs = null,

        metadata = {}

    } = {}) {

        if (!this.enabled) {
            return;
        }

        const completedAt =
            new this.clock();

        const duration =
            this.resolveDuration(
                startedAt,
                durationMs,
                completedAt
            );

        this.statistics.authenticationSucceeded++;

        this.lastAuthentication = {

            status:
                'SUCCESS',

            tenantId,

            correlationId,

            startedAt,

            completedAt,

            durationMs:
                duration

        };

        this.increment(
            'payment_airtel_auth_success_total'
        );

        this.observe(
            'payment_airtel_auth_duration_ms',
            duration
        );

        this.emit({

            type:
                EVENT_TYPES.AUTH_SUCCESS,

            tenantId,

            correlationId,

            metadata: {

                durationMs:
                    duration,

                ...this.safeMetadata(
                    metadata
                )

            }

        });

        this.evaluateRecovery({

            operation:
                'authentication',

            tenantId,

            correlationId

        });
    }


    /**
     * ----------------------------------------------------------
     * Authentication Failure
     * ----------------------------------------------------------
     */

    authenticationFailed({

        tenantId,

        correlationId,

        error,

        startedAt = null,

        durationMs = null,

        metadata = {}

    } = {}) {

        if (!this.enabled) {
            return;
        }

        const completedAt =
            new this.clock();

        const duration =
            this.resolveDuration(
                startedAt,
                durationMs,
                completedAt
            );

        const safeError =
            this.sanitizeError(error);

        this.statistics.authenticationFailed++;

        this.lastAuthentication = {

            status:
                'FAILED',

            tenantId,

            correlationId,

            startedAt,

            completedAt,

            durationMs:
                duration,

            errorCode:
                safeError.code

        };

        this.recordFailure({

            operation:
                'authentication',

            tenantId,

            correlationId,

            error:
                safeError

        });

        this.increment(
            'payment_airtel_auth_failure_total'
        );

        this.observe(
            'payment_airtel_auth_duration_ms',
            duration
        );

        this.logger?.error?.({

            message:
                'Airtel authentication failed',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            error:
                safeError

        });

        this.emit({

            type:
                EVENT_TYPES.AUTH_FAILURE,

            tenantId,

            correlationId,

            error:
                safeError,

            metadata: {

                durationMs:
                    duration,

                ...this.safeMetadata(
                    metadata
                )

            }

        });

        this.updateHealthFromFailure({

            operation:
                'authentication',

            tenantId,

            correlationId

        });
    }


    /**
     * ----------------------------------------------------------
     * Token Refresh Started
     * ----------------------------------------------------------
     */

    refreshStarted({

        tenantId,

        correlationId =
            crypto.randomUUID(),

        startedAt =
            new this.clock()

    } = {}) {

        if (!this.enabled) {
            return correlationId;
        }

        this.statistics.refreshStarted++;

        this.lastRefresh = {

            status:
                'STARTED',

            tenantId,

            correlationId,

            startedAt,

            completedAt:
                null,

            durationMs:
                null

        };

        this.increment(
            'payment_airtel_token_refresh_started_total'
        );

        this.emit({

            type:
                EVENT_TYPES.TOKEN_REFRESH_STARTED,

            tenantId,

            correlationId,

            metadata: {

                startedAt

            }

        });

        return correlationId;
    }


    /**
     * ----------------------------------------------------------
     * Token Refresh Success
     * ----------------------------------------------------------
     */

    refreshSucceeded({

        tenantId,

        correlationId,

        startedAt = null,

        durationMs = null,

        metadata = {}

    } = {}) {

        if (!this.enabled) {
            return;
        }

        const completedAt =
            new this.clock();

        const duration =
            this.resolveDuration(
                startedAt,
                durationMs,
                completedAt
            );

        this.statistics.refreshSucceeded++;

        this.lastRefresh = {

            status:
                'SUCCESS',

            tenantId,

            correlationId,

            startedAt,

            completedAt,

            durationMs:
                duration

        };

        this.increment(
            'payment_airtel_token_refresh_success_total'
        );

        this.observe(
            'payment_airtel_token_refresh_duration_ms',
            duration
        );

        this.emit({

            type:
                EVENT_TYPES.TOKEN_REFRESH_SUCCESS,

            tenantId,

            correlationId,

            metadata: {

                durationMs:
                    duration,

                ...this.safeMetadata(
                    metadata
                )

            }

        });

        this.evaluateRecovery({

            operation:
                'refresh',

            tenantId,

            correlationId

        });
    }


    /**
     * ----------------------------------------------------------
     * Token Refresh Failure
     * ----------------------------------------------------------
     */

    refreshFailed({

        tenantId,

        correlationId,

        error,

        startedAt = null,

        durationMs = null,

        metadata = {}

    } = {}) {

        if (!this.enabled) {
            return;
        }

        const completedAt =
            new this.clock();

        const duration =
            this.resolveDuration(
                startedAt,
                durationMs,
                completedAt
            );

        const safeError =
            this.sanitizeError(error);

        this.statistics.refreshFailed++;

        this.lastRefresh = {

            status:
                'FAILED',

            tenantId,

            correlationId,

            startedAt,

            completedAt,

            durationMs:
                duration,

            errorCode:
                safeError.code

        };

        this.recordFailure({

            operation:
                'refresh',

            tenantId,

            correlationId,

            error:
                safeError

        });

        this.increment(
            'payment_airtel_token_refresh_failure_total'
        );

        this.observe(
            'payment_airtel_token_refresh_duration_ms',
            duration
        );

        this.logger?.error?.({

            message:
                'Airtel token refresh failed',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            error:
                safeError

        });

        this.emit({

            type:
                EVENT_TYPES.TOKEN_REFRESH_FAILURE,

            tenantId,

            correlationId,

            error:
                safeError,

            metadata: {

                durationMs:
                    duration,

                ...this.safeMetadata(
                    metadata
                )

            }

        });

        this.updateHealthFromFailure({

            operation:
                'refresh',

            tenantId,

            correlationId

        });
    }


    /**
     * ----------------------------------------------------------
     * Generic Operation Timing
     * ----------------------------------------------------------
     */

    measure({

        operation,

        startedAt,

        success = true,

        metadata = {}

    } = {}) {

        const completedAt =
            new this.clock();

        const durationMs =
            this.resolveDuration(
                startedAt,
                null,
                completedAt
            );

        const metricBase =
            this.metricName(
                operation
            );

        this.observe(
            `${metricBase}_duration_ms`,
            durationMs
        );

        this.increment(
            success
                ? `${metricBase}_success_total`
                : `${metricBase}_failure_total`
        );

        this.logger?.debug?.({

            message:
                `Airtel ${operation} operation completed`,

            provider:
                PROVIDER,

            durationMs,

            success,

            metadata:
                this.safeMetadata(metadata)

        });

        return durationMs;
    }


    /**
     * ----------------------------------------------------------
     * Span Creation Helper
     * ----------------------------------------------------------
     */

    startSpan(

        name,

        attributes = {}

    ) {

        if (
            !this.enabled ||
            !this.tracer?.startSpan
        ) {
            return null;
        }

        try {

            const span =
                this.tracer.startSpan(name);

            this.statistics.spansStarted++;

            Object.entries(
                attributes || {}
            ).forEach(([key, value]) => {

                if (
                    value === undefined ||
                    value === null
                ) {
                    return;
                }

                span?.setAttribute?.(
                    key,
                    this.safeSpanValue(value)
                );
            });

            return span;

        }
        catch (error) {

            this.statistics.spansFailed++;

            this.logger?.warn?.({

                message:
                    'Failed to create Airtel observability span',

                provider:
                    PROVIDER,

                spanName:
                    name,

                error:
                    this.sanitizeError(error)

            });

            return null;
        }
    }


    /**
     * ----------------------------------------------------------
     * Mark Span Success
     * ----------------------------------------------------------
     */

    endSpan(

        span,

        {

            success = true,

            error = null,

            attributes = {}

        } = {}

    ) {

        if (!span) {
            return;
        }

        try {

            Object.entries(
                attributes || {}
            ).forEach(([key, value]) => {

                if (
                    value === undefined ||
                    value === null
                ) {
                    return;
                }

                span.setAttribute?.(
                    key,
                    this.safeSpanValue(value)
                );
            });

            if (!success && error) {

                const safeError =
                    this.sanitizeError(error);

                span.recordException?.(
                    safeError
                );

                span.setAttribute?.(
                    'error.type',
                    safeError.code
                        || 'AIRTEL_AUTH_ERROR'
                );
            }

            span.setStatus?.({

                code:
                    success
                        ? 1
                        : 2

            });

        }
        catch (error) {

            this.logger?.debug?.({

                message:
                    'Failed to finalize Airtel observability span',

                error:
                    this.sanitizeError(error)

            });

        }
        finally {

            try {
                span.end?.();
            }
            catch (_) {
                // Never allow tracing failures
                // to affect authentication.
            }

        }
    }


    /**
     * ----------------------------------------------------------
     * Provider Health
     * ----------------------------------------------------------
     */

    health() {

        const status =
            this.calculateHealthStatus();

        return {

            provider:
                PROVIDER,

            service:
                this.serviceName,

            status,

            enabled:
                this.enabled,

            startedAt:
                this.startedAt,

            uptimeMs:
                this.now().getTime()
                -
                this.startedAt.getTime(),

            lastHealthChangeAt:
                this.lastHealthChangeAt,

            lastAuthentication:
                this.safeOperationSnapshot(
                    this.lastAuthentication
                ),

            lastRefresh:
                this.safeOperationSnapshot(
                    this.lastRefresh
                ),

            recentFailureCount:
                this.getRecentFailureCount(),

            statistics:
                {
                    ...this.statistics
                }

        };
    }


    /**
     * ----------------------------------------------------------
     * Dynamic Health Calculation
     * ----------------------------------------------------------
     */

    calculateHealthStatus() {

        const failures =
            this.getRecentFailureCount();

        if (
            failures >=
            this.downFailureThreshold
        ) {
            return HEALTH_STATUS.DOWN;
        }

        if (
            failures >=
            this.degradedFailureThreshold
        ) {
            return HEALTH_STATUS.DEGRADED;
        }

        return HEALTH_STATUS.UP;
    }


    /**
     * ----------------------------------------------------------
     * Record Failure
     * ----------------------------------------------------------
     */

    recordFailure({

        operation,

        tenantId,

        correlationId,

        error

    }) {

        const now =
            this.now();

        this.failureHistory.push({

            operation,

            tenantId,

            correlationId,

            timestamp:
                now,

            errorCode:
                error?.code
                || null,

            errorMessage:
                error?.message
                || null

        });

        this.pruneFailureHistory();

        this.gauge(
            'payment_airtel_auth_recent_failures',
            this.getRecentFailureCount()
        );

    }


    /**
     * ----------------------------------------------------------
     * Recent Failure Count
     * ----------------------------------------------------------
     */

    getRecentFailureCount() {

        this.pruneFailureHistory();

        return this.failureHistory.length;
    }


    /**
     * ----------------------------------------------------------
     * Failure History Cleanup
     * ----------------------------------------------------------
     */

    pruneFailureHistory() {

        const cutoff =
            this.now().getTime()
            -
            this.failureWindowMs;

        this.failureHistory =
            this.failureHistory.filter(
                failure =>
                    new Date(
                        failure.timestamp
                    ).getTime() >= cutoff
            );

        if (
            this.failureHistory.length >
            this.failureHistoryLimit
        ) {

            this.failureHistory =
                this.failureHistory.slice(
                    -this.failureHistoryLimit
                );
        }
    }


    /**
     * ----------------------------------------------------------
     * Health Transition After Failure
     * ----------------------------------------------------------
     */

    updateHealthFromFailure({

        operation,

        tenantId,

        correlationId

    }) {

        const previous =
            this.lastHealthStatus;

        const current =
            this.calculateHealthStatus();

        if (current === previous) {
            return;
        }

        this.lastHealthStatus =
            current;

        this.lastHealthChangeAt =
            this.now();

        this.gauge(
            'payment_airtel_auth_health',
            current === HEALTH_STATUS.UP
                ? 1
                : 0
        );

        const eventType =
            current === HEALTH_STATUS.DOWN
                ? EVENT_TYPES.HEALTH_DOWN
                : EVENT_TYPES.HEALTH_DEGRADED;

        this.emit({

            type:
                eventType,

            tenantId,

            correlationId,

            metadata: {

                operation,

                previousStatus:
                    previous,

                currentStatus:
                    current

            }

        });
    }


    /**
     * ----------------------------------------------------------
     * Recovery Detection
     * ----------------------------------------------------------
     */

    evaluateRecovery({

        operation,

        tenantId,

        correlationId

    }) {

        const previous =
            this.lastHealthStatus;

        this.pruneFailureHistory();

        const current =
            this.calculateHealthStatus();

        if (
            current === HEALTH_STATUS.UP &&
            previous !== HEALTH_STATUS.UP
        ) {

            this.lastHealthStatus =
                HEALTH_STATUS.UP;

            this.lastHealthChangeAt =
                this.now();

            this.gauge(
                'payment_airtel_auth_health',
                1
            );

            this.emit({

                type:
                    EVENT_TYPES.HEALTH_RECOVERED,

                tenantId,

                correlationId,

                metadata: {

                    operation,

                    previousStatus:
                        previous,

                    currentStatus:
                        HEALTH_STATUS.UP

                }

            });

            return;
        }

        this.lastHealthStatus =
            current;
    }


    /**
     * ----------------------------------------------------------
     * Event Publishing
     * ----------------------------------------------------------
     *
     * Observability must never become part of the
     * authentication critical path.
     */

    emit(payload = {}) {

        if (!this.enabled) {
            return null;
        }

        const event = Object.freeze({

            eventId:
                crypto.randomUUID(),

            sequence:
                ++this.sequence,

            provider:
                PROVIDER,

            service:
                this.serviceName,

            type:
                payload.type,

            tenantId:
                payload.tenantId,

            correlationId:
                payload.correlationId,

            timestamp:
                this.now(),

            metadata:
                this.safeMetadata(
                    payload.metadata
                ),

            error:
                payload.error
                    ? this.sanitizeError(
                        payload.error
                    )
                    : undefined

        });

        this.publishEvent(event);

        this.recordAudit(event);

        return event;
    }


    /**
     * ----------------------------------------------------------
     * Safe Event Publication
     * ----------------------------------------------------------
     */

    publishEvent(event) {

        if (
            !this.eventBus?.publish
        ) {
            return;
        }

        try {

            const result =
                this.eventBus.publish(
                    event
                );

            this.statistics.eventsPublished++;

            if (
                result &&
                typeof result.then === 'function'
            ) {

                result.catch(error => {

                    this.statistics.eventsFailed++;

                    this.logger?.warn?.({

                        message:
                            'Airtel observability event publication failed',

                        provider:
                            PROVIDER,

                        eventType:
                            event.type,

                        correlationId:
                            event.correlationId,

                        error:
                            this.sanitizeError(
                                error
                            )

                    });

                });
            }

        }
        catch (error) {

            this.statistics.eventsFailed++;

            this.logger?.warn?.({

                message:
                    'Airtel observability event publication failed',

                provider:
                    PROVIDER,

                eventType:
                    event.type,

                error:
                    this.sanitizeError(
                        error
                    )

            });
        }
    }


    /**
     * ----------------------------------------------------------
     * Safe Audit Recording
     * ----------------------------------------------------------
     */

    recordAudit(event) {

        if (
            !this.auditService?.record
        ) {
            return;
        }

        try {

            const result =
                this.auditService.record({

                    action:
                        event.type,

                    provider:
                        PROVIDER,

                    tenantId:
                        event.tenantId,

                    correlationId:
                        event.correlationId,

                    metadata:
                        event

                });

            if (
                result &&
                typeof result.then === 'function'
            ) {

                result.then(() => {

                    this.statistics.auditsRecorded++;

                }).catch(error => {

                    this.statistics.auditsFailed++;

                    this.logger?.warn?.({

                        message:
                            'Airtel authentication audit recording failed',

                        provider:
                            PROVIDER,

                        correlationId:
                            event.correlationId,

                        error:
                            this.sanitizeError(
                                error
                            )

                    });

                });

            }
            else {

                this.statistics.auditsRecorded++;

            }

        }
        catch (error) {

            this.statistics.auditsFailed++;

            this.logger?.warn?.({

                message:
                    'Airtel authentication audit recording failed',

                provider:
                    PROVIDER,

                correlationId:
                    event.correlationId,

                error:
                    this.sanitizeError(
                        error
                    )

            });
        }
    }


    /**
     * ----------------------------------------------------------
     * Safe Error Normalization
     * ----------------------------------------------------------
     */

    sanitizeError(error) {

        if (!error) {

            return {

                code:
                    'UNKNOWN_ERROR',

                message:
                    'Unknown error'

            };
        }

        let code =
            error.code
            ||
            error.name
            ||
            'AIRTEL_AUTH_ERROR';

        let message =
            error.message
            ||
            String(error);

        message =
            String(message)
                .replace(
                    /client[_-]?secret\s*[:=]\s*[^,\s]+/gi,
                    'client_secret=[REDACTED]'
                )
                .replace(
                    /access[_-]?token\s*[:=]\s*[^,\s]+/gi,
                    'access_token=[REDACTED]'
                )
                .replace(
                    /authorization\s*[:=]\s*[^\s]+/gi,
                    'authorization=[REDACTED]'
                )
                .replace(
                    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
                    'Bearer [REDACTED]'
                )
                .substring(
                    0,
                    DEFAULTS.maxErrorMessageLength
                );

        const result = {

            code:
                String(code)
                    .substring(0, 100),

            message

        };

        if (
            error.statusCode !== undefined
        ) {

            result.statusCode =
                Number(error.statusCode);

        }

        if (
            error.providerCode
        ) {

            result.providerCode =
                String(
                    error.providerCode
                ).substring(0, 100);

        }

        return result;
    }


    /**
     * ----------------------------------------------------------
     * Metadata Sanitization
     * ----------------------------------------------------------
     */

    safeMetadata(metadata = {}) {

        if (
            !metadata ||
            typeof metadata !== 'object'
        ) {
            return {};
        }

        const blocked =
            new Set([

                'accessToken',

                'access_token',

                'clientSecret',

                'client_secret',

                'subscriptionKey',

                'subscription_key',

                'authorization',

                'password',

                'secret',

                'token'

            ]);

        const result = {};

        Object.entries(metadata)
            .forEach(([key, value]) => {

                if (
                    blocked.has(key)
                ) {
                    result[key] =
                        '[REDACTED]';

                    return;
                }

                if (
                    value instanceof Error
                ) {

                    result[key] =
                        this.sanitizeError(
                            value
                        );

                    return;
                }

                if (
                    typeof value === 'string' &&
                    value.length > 1000
                ) {

                    result[key] =
                        value.substring(
                            0,
                            1000
                        );

                    return;
                }

                result[key] =
                    value;

            });

        return result;
    }


    /**
     * ----------------------------------------------------------
     * Safe Span Value
     * ----------------------------------------------------------
     */

    safeSpanValue(value) {

        if (
            typeof value === 'string'
        ) {

            return value.length > 500
                ? value.substring(0, 500)
                : value;
        }

        if (
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value;
        }

        return String(value);
    }


    /**
     * ----------------------------------------------------------
     * Operation Snapshot
     * ----------------------------------------------------------
     */

    safeOperationSnapshot(operation) {

        if (!operation) {
            return null;
        }

        return {

            status:
                operation.status,

            tenantId:
                operation.tenantId,

            correlationId:
                operation.correlationId,

            startedAt:
                operation.startedAt,

            completedAt:
                operation.completedAt,

            durationMs:
                operation.durationMs,

            errorCode:
                operation.errorCode

        };
    }


    /**
     * ----------------------------------------------------------
     * Duration Resolver
     * ----------------------------------------------------------
     */

    resolveDuration(
        startedAt,
        durationMs,
        completedAt
    ) {

        if (
            Number.isFinite(
                Number(durationMs)
            )
        ) {
            return Math.max(
                0,
                Number(durationMs)
            );
        }

        if (!startedAt) {
            return 0;
        }

        return Math.max(

            0,

            completedAt.getTime()
            -
            new Date(
                startedAt
            ).getTime()

        );
    }


    /**
     * ----------------------------------------------------------
     * Metric Helpers
     * ----------------------------------------------------------
     */

    increment(
        name,
        value = 1
    ) {

        try {

            this.metrics?.counter?.(
                name,
                value
            );

        }
        catch (error) {

            this.logger?.debug?.({

                message:
                    'Airtel metrics counter failed',

                metric:
                    name,

                error:
                    this.sanitizeError(
                        error
                    )

            });
        }
    }


    gauge(
        name,
        value
    ) {

        try {

            this.metrics?.gauge?.(
                name,
                value
            );

        }
        catch (error) {

            this.logger?.debug?.({

                message:
                    'Airtel metrics gauge failed',

                metric:
                    name,

                error:
                    this.sanitizeError(
                        error
                    )

            });
        }
    }


    observe(
        name,
        value
    ) {

        try {

            this.metrics?.histogram?.(
                name,
                value
            );

        }
        catch (error) {

            this.logger?.debug?.({

                message:
                    'Airtel metrics histogram failed',

                metric:
                    name,

                error:
                    this.sanitizeError(
                        error
                    )

            });
        }
    }


    metricName(operation) {

        const normalized =
            String(
                operation || 'operation'
            )
                .toLowerCase()
                .replace(
                    /[^a-z0-9_]/g,
                    '_'
                );

        return `payment_airtel_${normalized}`;
    }


    /**
     * ----------------------------------------------------------
     * Current Time
     * ----------------------------------------------------------
     */

    now() {

        return new this.clock();
    }


    /**
     * ----------------------------------------------------------
     * Runtime Diagnostics Snapshot
     * ----------------------------------------------------------
     */

    snapshot() {

        this.pruneFailureHistory();

        return {

            provider:
                PROVIDER,

            service:
                this.serviceName,

            enabled:
                this.enabled,

            startedAt:
                this.startedAt,

            uptimeMs:
                this.now().getTime()
                -
                this.startedAt.getTime(),

            health:
                this.calculateHealthStatus(),

            lastHealthChangeAt:
                this.lastHealthChangeAt,

            lastAuthentication:
                this.safeOperationSnapshot(
                    this.lastAuthentication
                ),

            lastRefresh:
                this.safeOperationSnapshot(
                    this.lastRefresh
                ),

            recentFailureCount:
                this.failureHistory.length,

            recentFailures:
                this.failureHistory.map(
                    failure => ({
                        operation:
                            failure.operation,

                        tenantId:
                            failure.tenantId,

                        correlationId:
                            failure.correlationId,

                        timestamp:
                            failure.timestamp,

                        errorCode:
                            failure.errorCode,

                        errorMessage:
                            failure.errorMessage
                    })
                ),

            statistics:
                {
                    ...this.statistics
                },

            generatedAt:
                this.now()

        };
    }


    /**
     * ----------------------------------------------------------
     * Reset Runtime Diagnostics
     * ----------------------------------------------------------
     */

    resetStatistics() {

        this.statistics = {

            authenticationStarted:
                0,

            authenticationSucceeded:
                0,

            authenticationFailed:
                0,

            refreshStarted:
                0,

            refreshSucceeded:
                0,

            refreshFailed:
                0,

            eventsPublished:
                0,

            eventsFailed:
                0,

            auditsRecorded:
                0,

            auditsFailed:
                0,

            spansStarted:
                0,

            spansFailed:
                0

        };

        this.failureHistory = [];

        this.lastHealthStatus =
            HEALTH_STATUS.UP;

        this.lastHealthChangeAt =
            this.now();

        return true;
    }


    /**
     * ----------------------------------------------------------
     * Shutdown
     * ----------------------------------------------------------
     */

    shutdown() {

        this.failureHistory = [];

        this.lastAuthentication =
            null;

        this.lastRefresh =
            null;

        return true;
    }

}


module.exports = {

    AirtelAuthObservability,

    EVENT_TYPES,

    HEALTH_STATUS

};