"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Performance Monitoring Middleware
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * • High-resolution request timing
 * • Slow request detection
 * • Performance metrics collection
 * • Runtime diagnostics
 * • Event publishing
 * • Structured logging
 * • Request context enrichment
 * • Metrics integration hooks
 *
 * ============================================================================
 */

const { MiddlewareBootstrapError } = require("../errors");

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    slowRequestThresholdMs: 1000,
    captureResponseSize: true,
    publishEvents: true,
    enableMetrics: true,
    logAllRequests: false
});

/**
 * Convert hrtime bigint to milliseconds
 */
function durationMs(start) {
    return Number(process.hrtime.bigint() - start) / 1e6;
}

/**
 * Parse response content length
 */
function responseSize(res) {
    const value = res.getHeader("Content-Length");

    if (!value) {
        return 0;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : 0;
}

/**
 * Enterprise factory
 */
function performanceFactory(context = {}) {

    const config = {
        ...DEFAULT_CONFIG,
        ...(context.config?.performance || {})
    };

    const logger =
        context.logger;

    const runtimeContext =
        context.runtimeContext;

    const serviceRegistry =
        context.serviceRegistry;

    return function performanceMiddleware(req, res, next) {

        if (!config.enabled) {
            return next();
        }

        const start =
            process.hrtime.bigint();

        req.performance = {

            startedAt:
                Date.now(),

            highResolutionStart:
                start,

            durationMs:
                0,

            slow:
                false
        };

        /**
         * Response completed
         */
        res.once("finish", () => {

            try {

                const elapsed =
                    durationMs(start);

                const slow =
                    elapsed >= config.slowRequestThresholdMs;

                req.performance.durationMs =
                    elapsed;

                req.performance.slow =
                    slow;

                req.performance.statusCode =
                    res.statusCode;

                req.performance.responseSize =
                    config.captureResponseSize
                        ? responseSize(res)
                        : undefined;

                /**
                 * Enrich request context
                 */
                if (req.requestContext) {

                    req.requestContext.performance = {

                        durationMs:
                            elapsed,

                        slow,

                        statusCode:
                            res.statusCode
                    };

                }

                /**
                 * Metrics integration
                 */
                if (
                    config.enableMetrics &&
                    serviceRegistry?.has?.("metrics")
                ) {

                    const metrics =
                        serviceRegistry.get("metrics");

                    metrics?.observeHttpDuration?.({
                        method: req.method,
                        route: req.route?.path || req.path,
                        status: res.statusCode,
                        durationMs: elapsed
                    });

                }

                /**
                 * Publish runtime event
                 */
                if (
                    config.publishEvents &&
                    runtimeContext?.eventBus?.emit
                ) {

                    runtimeContext.eventBus.emit(
                        "http.performance.completed",
                        {
                            requestId: req.requestId,
                            correlationId: req.correlationId,
                            tenantId: req.tenantId,
                            userId: req.userContext?.userId,
                            method: req.method,
                            path: req.originalUrl,
                            statusCode: res.statusCode,
                            durationMs: elapsed,
                            slow
                        }
                    );

                }

                /**
                 * Structured logging
                 */
                if (logger) {

                    const payload = {

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,

                        tenantId:
                            req.tenantId,

                        method:
                            req.method,

                        path:
                            req.originalUrl,

                        statusCode:
                            res.statusCode,

                        durationMs:
                            Number(elapsed.toFixed(2)),

                        responseSize:
                            req.performance.responseSize,

                        slow
                    };

                    if (slow) {

                        logger.warn(
                            payload,
                            "Slow HTTP request detected"
                        );

                    } else if (config.logAllRequests) {

                        logger.info(
                            payload,
                            "HTTP request performance"
                        );

                    }

                }

            } catch (error) {

                logger?.error?.(
                    {
                        error,
                        middleware: "performance"
                    },
                    "Performance middleware failure"
                );

            }

        });

        next();

    };

}

/**
 * Health check
 */
async function healthCheck() {

    return {
        status: "healthy",
        component: "performance"
    };

}

module.exports = {

    name: "performance",

    version: "1.0.0",

    description:
        "Enterprise HTTP performance monitoring middleware",

    category: "observability",

    phase: "observability",

    priority: 330,

    critical: false,

    dependencies: [
        "requestContext",
        "metrics?"
    ],

    factory: performanceFactory,

    healthCheck,

    metadata: {

        owner:
            "platform-observability",

        tags: [
            "performance",
            "latency",
            "metrics",
            "observability",
            "monitoring"
        ]

    }

};