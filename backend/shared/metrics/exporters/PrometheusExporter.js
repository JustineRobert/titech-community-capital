'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/metrics/exporters/PrometheusExporter.js
 *
 * Enterprise Prometheus Metrics Exporter
 *
 * Responsibilities:
 *
 * - Convert MetricsRegistry snapshots into Prometheus exposition format
 * - Provide /metrics compatible output
 * - Keep metrics providers vendor neutral
 * - Support Grafana dashboards
 * - Support Kubernetes monitoring
 *
 *
 * Architecture:
 *
 * Metrics Providers
 *
 *      |
 *      v
 *
 * MetricsRegistry
 *
 *      |
 *      v
 *
 * PrometheusExporter
 *
 *      |
 *      v
 *
 * /metrics
 *
 *      |
 *      v
 *
 * Prometheus / Grafana
 *
 *
 * =============================================================================
 */



const os =
    require('os');



const DEFAULT_SERVICE =
    'titech-community-capital';



const PROMETHEUS_CONTENT_TYPE =
    'text/plain; version=0.0.4; charset=utf-8';





class PrometheusExporter {


    constructor({

        registry,

        service =
            DEFAULT_SERVICE


    } = {}) {


        if (!registry) {

            throw new Error(

                'Metrics registry is required.'

            );

        }



        this.registry =
            registry;



        this.service =
            service;



        Object.freeze(this);

    }








    /**
     * Generate Prometheus exposition format.
     *
     * @returns {String}
     */
    metrics() {


        const snapshot =
            this.registry.snapshot();



        const lines = [];



        this.appendMetadata(

            lines,

            snapshot

        );



        this.walkMetrics(

            lines,

            snapshot.metrics

        );



        return lines.join('\n');

    }








    /**
     * Add exporter metadata.
     */
    appendMetadata(

        lines,

        snapshot

    ) {



        lines.push(

            '# HELP application_info Application metadata'

        );


        lines.push(

            '# TYPE application_info gauge'

        );


        lines.push(

            `application_info{service="${this.escape(
                snapshot.service
            )}",hostname="${this.escape(
                os.hostname()
            )}"} 1`

        );


        lines.push('');

    }








    /**
     * Recursively convert metrics.
     */
    walkMetrics(

        lines,

        metrics,

        prefix = ''

    ) {



        if (!metrics) {

            return;

        }



        Object.entries(metrics)

            .forEach(

                ([key,value]) => {


                    const metricName =
                        this.normalizeName(

                            prefix
                                ? `${prefix}_${key}`
                                : key

                        );



                    if (

                        typeof value === 'number'

                    ) {


                        this.writeMetric(

                            lines,

                            metricName,

                            value

                        );


                    }



                    else if (

                        typeof value === 'object'

                    ) {



                        this.walkMetrics(

                            lines,

                            value,

                            metricName

                        );

                    }



                }

            );


    }








    /**
     * Write single metric.
     */
    writeMetric(

        lines,

        name,

        value

    ) {


        lines.push(

            `# TYPE ${name} gauge`

        );


        lines.push(

            `${name} ${value}`

        );


        lines.push('');

    }








    /**
     * Express middleware helper.
     *
     * Usage:
     *
     * app.get(
     *   '/metrics',
     *   exporter.middleware()
     * )
     */
    middleware() {


        return (

            req,

            res

        ) => {



            res.setHeader(

                'Content-Type',

                PROMETHEUS_CONTENT_TYPE

            );



            res.end(

                this.metrics()

            );


        };


    }








    /**
     * Normalize metric names.
     */
    normalizeName(name) {


        return name

            .replace(
                /[^a-zA-Z0-9_]/g,
                '_'
            )

            .toLowerCase();


    }








    /**
     * Escape Prometheus labels.
     */
    escape(value) {


        return String(value)

            .replace(
                /\\/g,
                '\\\\'
            )

            .replace(
                /"/g,
                '\\"'
            );


    }


}






/**
 * Prometheus content type.
 */
PrometheusExporter.CONTENT_TYPE =
    PROMETHEUS_CONTENT_TYPE;






module.exports =
    PrometheusExporter;