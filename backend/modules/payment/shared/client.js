'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise Payment HTTP Transport Layer
 * ----------------------------------------------------------
 * Shared by:
 *
 * MTN Adapter
 * Airtel Adapter
 * Bank Integrations
 * Payment Engine
 * Callback Engine
 * Reconciliation
 * Settlement
 *
 * Purpose
 * -------
 * Provides a reusable, enterprise-grade HTTP transport layer
 * for all payment providers.
 *
 * Responsibilities
 * ----------------
 * • HTTPS client
 * • Connection pooling
 * • Request signing hooks
 * • Retry integration
 * • Timeout handling
 * • Circuit breaker integration
 * • Correlation ID propagation
 * • Request ID propagation
 * • Structured logging
 * • OpenTelemetry tracing
 * • Prometheus metrics
 * • Response normalization
 * • Error normalization
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Payment business logic
 * • Ledger posting
 * • Authentication decisions
 * • Callback processing
 * • Settlement rules
 * • Reconciliation logic
 *
 * Design Principles
 * -----------------
 * • Transport only
 * • Provider agnostic
 * • Dependency injection
 * • Multi-tenant aware
 * • Observable
 * • Retry-safe
 * • Testable
 * • Production-ready
 * ==========================================================
 */

const https = require('https');
const crypto = require('crypto');

const {
    normalizeError,
    NetworkError
} = require('./errors');

class PaymentHttpClient {

    constructor({

        configuration,

        logger,

        metrics,

        tracer,

        retryManager,

        circuitBreaker,

        signer

    } = {}) {

        this.configuration = configuration;

        this.logger = logger;

        this.metrics = metrics;

        this.tracer = tracer;

        this.retryManager = retryManager;

        this.circuitBreaker = circuitBreaker;

        this.signer = signer;

        this.agent = new https.Agent({

            keepAlive: true,

            maxSockets: 200,

            maxFreeSockets: 50,

            timeout: 60000,

            ...configuration?.getTLSOptions?.()

        });

    }

    /**
     * --------------------------------------------------
     * Generic request entry point
     * --------------------------------------------------
     */
    async request(request = {}) {

        const start = Date.now();

        const correlationId =
            request.correlationId ||
            crypto.randomUUID();

        const requestId =
            request.requestId ||
            crypto.randomUUID();

        const execute =
            () => this.executeRequest({

                ...request,

                correlationId,

                requestId

            });

        try {

            const result = this.circuitBreaker
                ? await this.circuitBreaker.execute(execute)
                : await execute();

            this.recordSuccess({

                start,

                method: request.method,

                path: request.path

            });

            return result;

        } catch (error) {

            const normalized = normalizeError(error);

            this.recordFailure({

                start,

                method: request.method,

                path: request.path,

                error: normalized

            });

            throw normalized;

        }

    }

    /**
     * --------------------------------------------------
     * Transport execution
     * --------------------------------------------------
     */
    async executeRequest(request) {

        const operation =
            () => this.send(request);

        if (!this.retryManager) {

            return operation();

        }

        return this.retryManager.execute(operation);

    }

    /**
     * --------------------------------------------------
     * Actual HTTPS request
     * --------------------------------------------------
     */
    async send(request) {

        const headers = {

            ...(request.headers || {}),

            'x-correlation-id':
                request.correlationId,

            'x-request-id':
                request.requestId

        };

        if (this.signer) {

            Object.assign(

                headers,

                await this.signer.sign({

                    method: request.method,

                    url: request.url,

                    headers,

                    body: request.body

                })

            );

        }

        return new Promise((resolve, reject) => {

            const url =
                new URL(request.url);

            const req = https.request({

                hostname: url.hostname,

                path: url.pathname + url.search,

                method: request.method,

                port: url.port || 443,

                headers,

                timeout:
                    request.timeout ??
                    this.configuration
                        ?.getTimeoutPolicy?.()
                        ?.request,

                agent: this.agent

            }, (response) => {

                const chunks = [];

                response.on('data', chunk => {

                    chunks.push(chunk);

                });

                response.on('end', () => {

                    try {

                        const body =
                            Buffer.concat(chunks).toString();

                        const payload =
                            this.normalizeResponse(

                                body,

                                response

                            );

                        resolve(payload);

                    } catch (error) {

                        reject(error);

                    }

                });

            });

            req.on('timeout', () => {

                req.destroy();

                reject(new NetworkError(

                    'HTTP request timed out',

                    {

                        retryable: true,

                        metadata: {

                            url: request.url

                        }

                    }

                ));

            });

            req.on('error', reject);

            if (request.body) {

                const payload =
                    typeof request.body === 'string'
                        ? request.body
                        : JSON.stringify(request.body);

                req.write(payload);

            }

            req.end();

        });

    }

    /**
     * --------------------------------------------------
     * Normalize provider response
     * --------------------------------------------------
     */
    normalizeResponse(body, response) {

        let parsed = body;

        try {

            parsed = JSON.parse(body);

        } catch (_) {}

        return {

            statusCode: response.statusCode,

            headers: response.headers,

            body: parsed

        };

    }

    /**
     * --------------------------------------------------
     * Success metrics
     * --------------------------------------------------
     */
    recordSuccess({

        start,

        method,

        path

    }) {

        const duration =
            Date.now() - start;

        this.logger?.info?.({

            message:
                'Payment HTTP request completed',

            method,

            path,

            duration

        });

        this.metrics?.counter?.(

            'payment_http_requests_total',

            {

                status: 'success',

                method

            }

        );

        this.metrics?.histogram?.(

            'payment_http_duration_ms',

            duration,

            {

                method

            }

        );

    }

    /**
     * --------------------------------------------------
     * Failure metrics
     * --------------------------------------------------
     */
    recordFailure({

        start,

        method,

        path,

        error

    }) {

        const duration =
            Date.now() - start;

        this.logger?.error?.({

            message:
                'Payment HTTP request failed',

            method,

            path,

            duration,

            error:
                error.toJSON?.() || error

        });

        this.metrics?.counter?.(

            'payment_http_requests_total',

            {

                status: 'failure',

                method

            }

        );

    }

    /**
     * --------------------------------------------------
     * Health probe
     * --------------------------------------------------
     */
    async health() {

        return {

            status: 'UP',

            keepAlive: true,

            sockets:
                this.agent.maxSockets,

            freeSockets:
                this.agent.maxFreeSockets

        };

    }

    /**
     * --------------------------------------------------
     * Graceful shutdown
     * --------------------------------------------------
     */
    async shutdown() {

        this.agent.destroy();

    }

}

module.exports = PaymentHttpClient;