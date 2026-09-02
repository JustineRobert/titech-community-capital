'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collections Module
 * ============================================================================
 *
 * Purpose
 * -------
 * Public entry point for Airtel Money collection operations.
 *
 * Responsibilities
 * ----------------
 * • Payment request orchestration
 * • Collection status lookup
 * • Callback processing delegation
 * • Provider health reporting
 * • Configuration validation
 * • Audit integration
 * • Metrics
 * • Tracing
 *
 * This module intentionally contains NO provider HTTP logic.
 * All provider communication belongs inside provider services.
 *
 * ============================================================================
 */

const crypto = require('crypto');

class AirtelCollections {

    constructor({

        collectionService,

        callbackProcessor,

        configuration,

        logger,

        metrics,

        tracer,

        auditService

    } = {}) {

        if (!collectionService) {
            throw new Error(
                'collectionService is required'
            );
        }

        this.collectionService =
            collectionService;

        this.callbackProcessor =
            callbackProcessor;

        this.configuration =
            configuration;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.auditService =
            auditService;

        this.startedAt =
            new Date();
    }

    /**
     * ------------------------------------------------------------------------
     * Initialize
     * ------------------------------------------------------------------------
     */

    async initialize() {

        this.configuration?.validate?.();

        this.logger?.info?.({

            message:
                'Airtel Collections initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_collections_initialized_total'
        );

        return true;

    }

    /**
     * ------------------------------------------------------------------------
     * Request To Pay
     * ------------------------------------------------------------------------
     */

    async collect(request = {}) {

        const correlationId =
            request.correlationId ||
            crypto.randomUUID();

        const span =
            this.tracer?.startSpan?.(
                'airtel.collections.collect'
            );

        const started =
            Date.now();

        try {

            this.logger?.info?.({

                message:
                    'Starting Airtel collection',

                correlationId,

                tenantId:
                    request.tenantId,

                amount:
                    request.amount

            });

            const response =
                await this.collectionService.collect({

                    ...request,

                    correlationId

                });

            this.metrics?.counter?.(
                'payment_airtel_collection_success_total'
            );

            this.metrics?.histogram?.(

                'payment_airtel_collection_duration_ms',

                Date.now() - started

            );

            await this.auditService?.record({

                action:
                    'AIRTEL_COLLECTION_CREATED',

                tenantId:
                    request.tenantId,

                reference:
                    response.reference ||
                    response.externalId,

                correlationId

            });

            return response;

        }

        catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_collection_failure_total'
            );

            this.logger?.error?.({

                message:
                    'Airtel collection failed',

                correlationId,

                error:
                    error.toJSON?.() || error

            });

            throw error;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Query Collection
     * ------------------------------------------------------------------------
     */

    async query(reference, options = {}) {

        return this.collectionService.query({

            reference,

            ...options

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Process Callback
     * ------------------------------------------------------------------------
     */

    async processCallback(callback = {}) {

        if (!this.callbackProcessor) {

            throw new Error(
                'callbackProcessor not configured'
            );

        }

        return this.callbackProcessor.process(
            callback
        );

    }

    /**
     * ------------------------------------------------------------------------
     * Health
     * ------------------------------------------------------------------------
     */

    async health() {

        const serviceHealth =
            this.collectionService?.health
                ? await this.collectionService.health()
                : {
                    status: 'UNKNOWN'
                };

        return {

            provider: 'AIRTEL',

            module: 'collections',

            status:
                serviceHealth.status || 'UP',

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {

                collectionService:
                    !!this.collectionService,

                callbackProcessor:
                    !!this.callbackProcessor,

                configuration:
                    !!this.configuration

            },

            service:
                serviceHealth

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Capability Discovery
     * ------------------------------------------------------------------------
     */

    capabilities() {

        return Object.freeze({

            provider:
                'AIRTEL',

            collections: true,

            callbacks:
                !!this.callbackProcessor,

            reconciliation: false,

            settlement: false,

            supportsAsyncCallbacks: true,

            supportsStatusQuery: true

        });

    }

}

module.exports = AirtelCollections;