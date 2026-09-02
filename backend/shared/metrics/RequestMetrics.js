'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/metrics/RequestMetrics.js
 *
 * Enterprise Request Metrics Engine
 *
 * Features Summary
 * -----------------------------------------------------------------------------
 *
 * Tracks:
 *
 * • Request count
 * • Active requests
 * • Average latency
 * • Minimum latency
 * • Maximum latency
 * • HTTP status codes
 * • HTTP methods
 *
 *
 * Architecture:
 *
 * Application
 *      |
 *      v
 * RequestMetrics
 *      |
 *      +--------------------+
 *      |                    |
 *      v                    v
 * Prometheus Exporter   OpenTelemetry Exporter
 *
 *
 * Characteristics:
 *
 * • No Prometheus dependency
 * • Exporter abstraction ready
 * • Framework independent
 * • Production safe
 * • Immutable API
 * • High performance
 *
 * =============================================================================
 */


/**
 * Supported metric status groups.
 */
const STATUS_GROUPS = Object.freeze({

    INFORMATIONAL: '1xx',

    SUCCESS: '2xx',

    REDIRECTION: '3xx',

    CLIENT_ERROR: '4xx',

    SERVER_ERROR: '5xx'

});





class RequestMetrics {


    constructor({

        service =
            'titech-community-capital'


    } = {}) {


        this.service =
            service;



        this.metrics = {


            /**
             * Total requests received.
             */
            requestCount:
                0,



            /**
             * Currently processing.
             */
            activeRequests:
                0,



            /**
             * Latency statistics.
             */
            latency:

            {

                total:
                    0,


                count:
                    0,


                minimum:
                    null,


                maximum:
                    0

            },



            /**
             * HTTP status tracking.
             */
            statusCodes:
                {},



            /**
             * HTTP method tracking.
             */
            methods:
                {}

        };



        Object.freeze(this);

    }





    /**
     * Record incoming request.
     *
     * Called when request starts.
     */
    requestStarted({

        method = 'UNKNOWN'

    } = {}) {



        this.metrics.requestCount++;


        this.metrics.activeRequests++;



        this.incrementCounter(

            this.metrics.methods,

            method.toUpperCase()

        );


    }







    /**
     * Record completed request.
     *
     * @param {Object} data
     */
    requestCompleted({

        method = 'UNKNOWN',

        statusCode = 200,

        latency = 0


    } = {}) {



        this.metrics.activeRequests--;



        this.recordLatency(
            latency
        );



        this.incrementCounter(

            this.metrics.statusCodes,

            String(statusCode)

        );



        this.incrementCounter(

            this.metrics.methods,

            method.toUpperCase()

        );


    }








    /**
     * Record failed request.
     */
    requestFailed({

        statusCode = 500,

        latency = 0


    } = {}) {



        this.metrics.activeRequests--;



        this.recordLatency(
            latency
        );



        this.incrementCounter(

            this.metrics.statusCodes,

            String(statusCode)

        );


    }









    /**
     * Track latency.
     */
    recordLatency(value) {


        const latency =
            Number(value);



        if (
            Number.isNaN(latency)
        ) {

            return;

        }



        const latencyData =
            this.metrics.latency;



        latencyData.total += latency;


        latencyData.count++;



        if (

            latencyData.minimum === null ||
            latency < latencyData.minimum

        ) {

            latencyData.minimum =
                latency;

        }



        if (
            latency >
            latencyData.maximum
        ) {

            latencyData.maximum =
                latency;

        }


    }








    /**
     * Increment metric counter.
     */
    incrementCounter(

        collection,

        key

    ) {


        collection[key] =

            (
                collection[key] || 0
            ) + 1;


    }








    /**
     * Return metrics snapshot.
     *
     * Used by exporters.
     */
    snapshot() {


        const latency =
            this.metrics.latency;



        return {


            service:
                this.service,



            requestCount:
                this.metrics.requestCount,



            activeRequests:
                this.metrics.activeRequests,



            latency:

            {


                average:

                    latency.count
                        ?
                        latency.total /
                        latency.count
                        :
                        0,


                minimum:
                    latency.minimum,


                maximum:
                    latency.maximum

            },



            statusCodes:

                {
                    ...this.metrics.statusCodes
                },



            methods:

                {
                    ...this.metrics.methods
                }


        };


    }








    /**
     * Export-friendly format.
     */
    toJSON() {


        return this.snapshot();


    }








    /**
     * Reset metrics.
     *
     * Mainly useful for tests.
     */
    reset() {


        this.metrics.requestCount = 0;


        this.metrics.activeRequests = 0;


        this.metrics.latency = {

            total:0,

            count:0,

            minimum:null,

            maximum:0

        };


        this.metrics.statusCodes = {};


        this.metrics.methods = {};


    }


}






/**
 * Prevent prototype mutation.
 */
Object.freeze(
    RequestMetrics.prototype
);



module.exports =
    RequestMetrics;



module.exports.STATUS_GROUPS =
    STATUS_GROUPS;