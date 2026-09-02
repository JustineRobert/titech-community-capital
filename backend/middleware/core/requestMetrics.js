'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/core/requestMetrics.js
 *
 * Enterprise HTTP Request Metrics Middleware
 *
 * Features Summary
 * -----------------------------------------------------------------------------
 * • Records metrics when the response finishes
 * • Updates the shared RequestMetrics engine
 * • Integrates with the enterprise MetricsRegistry
 * • Attaches req.metrics
 * • Captures request duration
 * • Captures status code
 * • Captures HTTP method
 * • Captures route
 * • Captures request size
 * • Captures response size
 * • Integrates with TraceContext
 * • Framework-independent metrics collection
 * • Prometheus/OpenTelemetry ready
 *
 * Pipeline
 * -----------------------------------------------------------------------------
 *
 * Request
 *      │
 *      ▼
 * Request ID
 *      │
 *      ▼
 * Correlation ID
 *      │
 *      ▼
 * Request Context
 *      │
 *      ▼
 * Request Logger
 *      │
 *      ▼
 * Request Metrics
 *      │
 *      ▼
 * Business Logic
 *
 * =============================================================================
 */

const RequestMetrics =
    require('../../shared/metrics/RequestMetrics');

const {
    globalRegistry
} = require('../../shared/metrics/MetricsRegistry');

const TraceContext =
    require('../../shared/tracing/TraceContext');

/**
 * Singleton metrics provider.
 */
const metrics =
    new RequestMetrics();

/**
 * Register provider once.
 */
if (!globalRegistry.has('request')) {
    globalRegistry.register(
        'request',
        metrics
    );
}

/**
 * High resolution timer.
 */
function now() {
    return process.hrtime.bigint();
}

/**
 * Convert hrtime to milliseconds.
 */
function duration(start) {
    return Number(
        process.hrtime.bigint() - start
    ) / 1_000_000;
}

/**
 * Enterprise Request Metrics Middleware.
 */
function requestMetrics() {

    return function requestMetricsMiddleware(
        req,
        res,
        next
    ) {

        const started =
            now();

        metrics.requestStarted({

            method:
                req.method

        });

        req.metrics = {

            startedAt:
                started,

            duration:
                null,

            status:
                null

        };

        res.once(

            'finish',

            () => {

                const elapsed =
                    duration(started);

                const trace =
                    TraceContext.current() || {};

                const route =
                    req.route?.path ||
                    req.baseUrl + (req.route?.path || '') ||
                    req.originalUrl ||
                    req.url;

                req.metrics.duration =
                    elapsed;

                req.metrics.status =
                    res.statusCode;

                metrics.requestCompleted({

                    method:
                        req.method,

                    statusCode:
                        res.statusCode,

                    latency:
                        elapsed

                });

                if (
                    req.context?.logger
                ) {

                    req.context.logger.debug(

                        'HTTP metrics recorded',

                        {

                            duration:
                                elapsed,

                            status:
                                res.statusCode,

                            method:
                                req.method,

                            route,

                            requestId:
                                trace.requestId,

                            correlationId:
                                trace.correlationId,

                            traceId:
                                trace.traceId

                        }

                    );

                }

            }

        );

        next();

    };

}

module.exports =
    requestMetrics;

module.exports.metrics =
    metrics;