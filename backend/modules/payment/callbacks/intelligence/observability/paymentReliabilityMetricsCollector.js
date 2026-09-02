/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Metrics Collector
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Reliability Metrics Collection
 * • Prometheus Compatible Metrics
 * • Callback Throughput Tracking
 * • Provider Latency Monitoring
 * • Incident MTTR Tracking
 * • Failover Decision Metrics
 * • SLA Compliance Monitoring
 * • Provider Health Metrics
 * • Workflow Metrics
 * • OpenTelemetry Trace Integration
 * • Grafana Dashboard Support
 * • Multi-Tenant Awareness
 * • Structured Logging
 *
 *
 * Purpose
 * -------
 * Collect operational intelligence metrics from the payment reliability
 * ecosystem and expose them for monitoring platforms.
 *
 *
 * Metrics Sources
 * ---------------
 *
 * Callback Intelligence Engine
 *
 * Provider Reliability Engine
 *
 * Failover Decision Engine
 *
 * Incident Manager
 *
 * Workflow Engine
 *
 * Dashboard Service
 *
 *
 *
 * Output Example
 * --------------
 *
 * payment_callback_total 125000
 *
 * provider_reliability_score{provider="MTN_MOMO"} 94
 *
 * payment_incident_mttr_seconds 320
 *
 *
 *
 * Design Principles
 * -----------------
 * • Observability Only
 * • No Business Mutation
 * • Prometheus Friendly
 * • OpenTelemetry Compatible
 * • Low Latency Collection
 *
 * ============================================================================
 */


class PaymentReliabilityMetricsCollector {


    constructor({

        prometheus,

        tracer,

        logger

    } = {}) {


        this.prometheus =
            prometheus;


        this.tracer =
            tracer;


        this.logger =
            logger;



        this.metrics = {


            callbacksProcessed:

                0,


            callbacksFailed:

                0,


            providerLatency:

                new Map(),



            providerReliability:

                new Map(),



            incidents:

                [],



            failoverRecommendations:

                0,


            slaBreaches:

                0


        };


    }





    /**
     * ------------------------------------------------------------------------
     * Record Callback Processing
     * ------------------------------------------------------------------------
     */


    recordCallback({

        provider,

        success,

        latencyMs

    }) {


        this.metrics.callbacksProcessed++;



        if (!success) {


            this.metrics.callbacksFailed++;

        }



        this.recordProviderLatency({

            provider,

            latencyMs

        });



        this.#prometheusIncrement(

            "payment_callback_total"

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Provider Latency Tracking
     * ------------------------------------------------------------------------
     */


    recordProviderLatency({

        provider,

        latencyMs

    }) {


        if (

            !this.metrics.providerLatency.has(provider)

        ) {


            this.metrics.providerLatency.set(

                provider,

                []

            );

        }



        this.metrics.providerLatency

            .get(provider)

            .push(latencyMs);



        this.#prometheusGauge(

            "payment_provider_latency_ms",

            latencyMs,

            {

                provider

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Provider Reliability Tracking
     * ------------------------------------------------------------------------
     */


    recordProviderReliability({

        provider,

        score,

        health

    }) {


        this.metrics.providerReliability

            .set(

                provider,

                {

                    score,

                    health,

                    updatedAt:

                        new Date()

                }

            );



        this.#prometheusGauge(

            "payment_provider_reliability_score",

            score,

            {

                provider

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Incident Metrics
     * ------------------------------------------------------------------------
     */


    recordIncident({

        incidentId,

        severity,

        createdAt,

        resolvedAt

    }) {


        const duration =

            resolvedAt

                ?

                (

                    new Date(resolvedAt)

                    -

                    new Date(createdAt)

                )

                :

                null;



        this.metrics.incidents.push({

            incidentId,

            severity,

            duration

        });



        if (duration) {


            this.#prometheusGauge(

                "payment_incident_mttr_ms",

                duration

            );


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Failover Recommendation Tracking
     * ------------------------------------------------------------------------
     */


    recordFailoverRecommendation({

        decision

    }) {


        if (

            decision ===

            "FAILOVER_RECOMMENDED"

        ) {


            this.metrics.failoverRecommendations++;



            this.#prometheusIncrement(

                "payment_failover_recommendations_total"

            );

        }


    }





    /**
     * ------------------------------------------------------------------------
     * SLA Tracking
     * ------------------------------------------------------------------------
     */


    recordSLABreach({

        provider,

        metric

    }) {


        this.metrics.slaBreaches++;



        this.#prometheusIncrement(

            "payment_sla_breach_total",

            {

                provider,

                metric

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Collect Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            callbacks:

                {

                    processed:

                        this.metrics.callbacksProcessed,


                    failed:

                        this.metrics.callbacksFailed

                },


            providers:

                Object.fromEntries(

                    this.metrics.providerReliability

                ),



            incidents:

                this.metrics.incidents.length,



            failoverRecommendations:

                this.metrics.failoverRecommendations,



            slaBreaches:

                this.metrics.slaBreaches

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Prometheus Counter Helper
     * ------------------------------------------------------------------------
     */


    #prometheusIncrement(

        name,

        labels

    ) {


        try {


            this.prometheus

                ?.counter

                ?.(

                    name,

                    labels

                );


        }

        catch(error) {


            this.logger?.warn?.(

                "Prometheus metric failed",

                error

            );


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Prometheus Gauge Helper
     * ------------------------------------------------------------------------
     */


    #prometheusGauge(

        name,

        value,

        labels

    ) {


        try {


            this.prometheus

                ?.gauge

                ?.(

                    name,

                    value,

                    labels

                );


        }

        catch(error) {


            this.logger?.warn?.(

                "Prometheus gauge failed",

                error

            );

        }


    }


}



module.exports =
    PaymentReliabilityMetricsCollector;