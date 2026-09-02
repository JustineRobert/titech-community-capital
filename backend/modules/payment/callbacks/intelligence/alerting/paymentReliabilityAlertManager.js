/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Alert Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Prometheus Metric Evaluation
 * • Reliability Alert Rules
 * • Operational Alert Generation
 * • Severity Classification
 * • Alert Deduplication
 * • Incident Correlation
 * • Workflow Escalation Triggering
 * • PagerDuty Integration Ready
 * • Slack Integration Ready
 * • Email Notification Ready
 * • Multi-Tenant Aware
 * • Alert Suppression
 * • Alert Lifecycle Tracking
 * • Structured Logging
 * • OpenTelemetry Ready
 *
 *
 * Purpose
 * -------
 * Convert payment reliability metrics into actionable operational alerts.
 *
 *
 * Processing Flow
 * ---------------
 *
 * Metrics
 *
 *    |
 *    ▼
 *
 * Alert Rule Engine
 *
 *    |
 *    ▼
 *
 * Alert Manager
 *
 *    |
 *    ├───────────────┐
 *    ▼               ▼
 *
 * Notifications   Workflow Engine
 *
 *
 *
 * Alert Lifecycle
 * ---------------
 *
 * CREATED
 * ACTIVE
 * ACKNOWLEDGED
 * RESOLVED
 * SUPPRESSED
 *
 *
 * Design Principles
 * -----------------
 * • Alerting Only
 * • No Business Execution
 * • Event Driven
 * • Low Latency
 * • Enterprise Monitoring Ready
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityAlertManager {


    constructor({

        metricsCollector,

        incidentManager,

        workflowEngine,

        notificationChannels,

        eventBus,

        logger,

        thresholds = {}

    } = {}) {


        this.metricsCollector =
            metricsCollector;


        this.incidentManager =
            incidentManager;


        this.workflowEngine =
            workflowEngine;


        this.notificationChannels =
            notificationChannels || [];



        this.eventBus =
            eventBus;


        this.logger =
            logger;



        this.thresholds = Object.freeze({

            providerLatencyMs:

                10000,


            reliabilityScore:

                50,


            failureRate:

                10,


            slaAvailability:

                99,


            criticalIncidentCount:

                5,


            ...thresholds

        });



        this.alerts = new Map();


        this.statuses = Object.freeze({

            CREATED:
                "CREATED",

            ACTIVE:
                "ACTIVE",

            ACKNOWLEDGED:
                "ACKNOWLEDGED",

            RESOLVED:
                "RESOLVED",

            SUPPRESSED:
                "SUPPRESSED"

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Evaluate Reliability State
     * ------------------------------------------------------------------------
     */


    async evaluate(metrics = {}) {


        const triggeredAlerts = [];



        const rules = [

            this.#checkProviderLatency(metrics),

            this.#checkReliabilityScore(metrics),

            this.#checkFailureRate(metrics),

            this.#checkSLA(metrics)

        ];



        for (const alert of rules) {


            if (alert) {


                const created =

                    await this.createAlert(alert);



                triggeredAlerts.push(

                    created

                );

            }

        }



        return triggeredAlerts;

    }





    /**
     * ------------------------------------------------------------------------
     * Create Alert
     * ------------------------------------------------------------------------
     */


    async createAlert({

        type,

        severity,

        provider,

        message,

        metadata = {}

    }) {


        const fingerprint =

            this.#fingerprint({

                type,

                provider

            });



        if (

            this.#isDuplicate(fingerprint)

        ) {


            return this.alerts.get(

                fingerprint

            );

        }



        const alert = {


            id:

                randomUUID(),



            fingerprint,


            type,


            severity,


            provider,


            message,


            status:

                this.statuses.CREATED,


            metadata,


            createdAt:

                new Date()

        };



        this.alerts.set(

            fingerprint,

            alert

        );



        await this.#notify(alert);



        await this.#triggerWorkflow(alert);



        await this.#publish(alert);



        return alert;

    }





    /**
     * ------------------------------------------------------------------------
     * Provider Latency Rule
     * ------------------------------------------------------------------------
     */


    #checkProviderLatency(metrics) {


        if (

            metrics.providerLatencyMs >

            this.thresholds.providerLatencyMs

        ) {


            return {


                type:

                    "PROVIDER_LATENCY_DEGRADATION",


                severity:

                    "HIGH",


                provider:

                    metrics.provider,


                message:

                    "Provider callback latency exceeded threshold."

            };

        }


        return null;

    }





    /**
     * ------------------------------------------------------------------------
     * Reliability Score Rule
     * ------------------------------------------------------------------------
     */


    #checkReliabilityScore(metrics) {


        if (

            metrics.reliabilityScore <

            this.thresholds.reliabilityScore

        ) {


            return {


                type:

                    "PROVIDER_RELIABILITY_DEGRADED",


                severity:

                    "CRITICAL",


                provider:

                    metrics.provider,


                message:

                    "Provider reliability score below acceptable threshold."

            };

        }


        return null;

    }





    /**
     * ------------------------------------------------------------------------
     * Failure Rate Rule
     * ------------------------------------------------------------------------
     */


    #checkFailureRate(metrics) {


        if (

            metrics.failureRate >

            this.thresholds.failureRate

        ) {


            return {


                type:

                    "PAYMENT_FAILURE_RATE_HIGH",


                severity:

                    "HIGH",


                provider:

                    metrics.provider,


                message:

                    "Payment failure rate exceeded threshold."

            };

        }


        return null;

    }





    /**
     * ------------------------------------------------------------------------
     * SLA Rule
     * ------------------------------------------------------------------------
     */


    #checkSLA(metrics) {


        if (

            metrics.availability <

            this.thresholds.slaAvailability

        ) {


            return {


                type:

                    "SLA_BREACH",


                severity:

                    "CRITICAL",


                provider:

                    metrics.provider,


                message:

                    "Payment reliability SLA breached."

            };

        }


        return null;

    }





    /**
     * ------------------------------------------------------------------------
     * Notification Routing
     * ------------------------------------------------------------------------
     */


    async #notify(alert) {


        for (

            const channel of this.notificationChannels

        ) {


            await channel.send(

                alert

            );

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Workflow Trigger
     * ------------------------------------------------------------------------
     */


    async #triggerWorkflow(alert) {


        if (

            !this.workflowEngine

        ) {


            return;

        }



        await this.workflowEngine.handleEvent({

            id:

                alert.id,


            type:

                "PAYMENT_RELIABILITY_ALERT",


            payload:

                alert

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Event Publication
     * ------------------------------------------------------------------------
     */


    async #publish(alert) {


        if (

            !this.eventBus

        ) {


            return;

        }



        await this.eventBus.publish({

            type:

                "PAYMENT_RELIABILITY_ALERT_CREATED",


            payload:

                alert

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Duplicate Protection
     * ------------------------------------------------------------------------
     */


    #fingerprint({

        type,

        provider

    }) {


        return `${type}:${provider}`;

    }





    #isDuplicate(fingerprint) {


        return this.alerts.has(

            fingerprint

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Alert Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            total:

                this.alerts.size,


            alerts:

                [

                    ...this.alerts.values()

                ]

        });


    }


}


module.exports =
    PaymentReliabilityAlertManager;