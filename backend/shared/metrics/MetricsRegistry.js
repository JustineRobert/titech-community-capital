'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/metrics/MetricsRegistry.js
 *
 * Enterprise Metrics Registry
 *
 * Responsibilities:
 *
 * - Manage multiple metric providers
 * - Centralize application observability
 * - Provide exporter-ready snapshots
 * - Support Prometheus/OpenTelemetry adapters
 *
 *
 * Supported Metrics:
 *
 * ✓ HTTP Request Metrics
 * ✓ Database Metrics
 * ✓ Redis Metrics
 * ✓ Queue Metrics
 * ✓ Payment Provider Metrics
 * ✓ Ledger Processing Metrics
 * ✓ Background Job Metrics
 *
 *
 * Characteristics:
 *
 * - No Prometheus dependency
 * - Framework independent
 * - Provider based architecture
 * - Immutable registry interface
 * - Production monitoring foundation
 *
 * =============================================================================
 */



/**
 * Default service identity.
 */
const DEFAULT_SERVICE =
    'titech-community-capital';





/**
 * Supported metric domains.
 */
const METRIC_TYPES = Object.freeze({

    REQUEST:

        'request',


    DATABASE:

        'database',


    REDIS:

        'redis',


    QUEUE:

        'queue',


    PAYMENT:

        'payment',


    LEDGER:

        'ledger',


    JOB:

        'job'

});






class MetricsRegistry {


    constructor({

        service =
            DEFAULT_SERVICE


    } = {}) {


        this.service =
            service;



        /**
         * Registered metric providers.
         *
         * Example:
         *
         * {
         *    request: RequestMetrics,
         *    database: DatabaseMetrics
         * }
         */
        this.providers =
            new Map();



        /**
         * Registry metadata.
         */
        this.metadata = {


            createdAt:
                new Date(),


            hostname:
                require('os')
                    .hostname()

        };



        Object.freeze(this.metadata);

        Object.freeze(this);

    }







    /**
     * Register metrics provider.
     *
     * Example:
     *
     * registry.register(
     *    "request",
     *    requestMetrics
     * );
     */
    register(

        name,

        provider

    ) {



        if (!name) {

            throw new Error(
                'Metric provider name required.'
            );

        }



        if (!provider) {

            throw new Error(
                'Metric provider instance required.'
            );

        }



        if (
            typeof provider.snapshot !== 'function'
        ) {


            throw new Error(

                `Metric provider ${name} must implement snapshot().`

            );

        }



        this.providers.set(

            name,

            provider

        );



        return this;

    }








    /**
     * Remove metrics provider.
     */
    unregister(name) {


        return this.providers.delete(
            name
        );


    }








    /**
     * Retrieve provider.
     */
    get(name) {


        return this.providers.get(
            name
        );


    }








    /**
     * Check provider existence.
     */
    has(name) {


        return this.providers.has(
            name
        );


    }








    /**
     * Generate complete metrics snapshot.
     *
     * Exporters consume this.
     */
    snapshot() {


        const metrics = {};



        for (
            const [
                name,
                provider
            ]
            of this.providers
        ) {


            try {


                metrics[name] =
                    provider.snapshot();



            }

            catch(error) {


                metrics[name] = {


                    error:

                        error.message,


                    healthy:

                        false


                };


            }


        }






        return {


            service:
                this.service,


            timestamp:
                new Date()
                    .toISOString(),


            metadata:
                this.metadata,


            metrics


        };


    }








    /**
     * Return provider health.
     */
    health() {


        const result = {};



        for (
            const [
                name,
                provider
            ]
            of this.providers
        ) {



            result[name] = {


                registered:

                    true,


                healthy:

                    typeof provider.snapshot ===
                    'function'


            };


        }



        return result;

    }








    /**
     * Export metrics for monitoring systems.
     *
     * Future exporters:
     *
     * - Prometheus
     * - OpenTelemetry
     * - Datadog
     * - CloudWatch
     */
    export() {


        return this.snapshot();


    }








    /**
     * Clear all providers.
     *
     * Testing only.
     */
    clear() {


        this.providers.clear();


    }


}







/**
 * Singleton registry.
 *
 * Enterprise applications normally use
 * one global metrics registry.
 */
const globalRegistry =
    new MetricsRegistry();







/**
 * Prevent prototype mutation.
 */
Object.freeze(
    MetricsRegistry.prototype
);





module.exports =
    MetricsRegistry;



module.exports.globalRegistry =
    globalRegistry;



module.exports.METRIC_TYPES =
    METRIC_TYPES;