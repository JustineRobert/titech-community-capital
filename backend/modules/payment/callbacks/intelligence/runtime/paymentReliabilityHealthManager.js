/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Health Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Unified Platform Health Aggregation
 * • Service Health Scoring
 * • Dependency Health Analysis
 * • Readiness Checks
 * • Liveness Checks
 * • Degraded State Detection
 * • Health Event Publishing
 * • Kubernetes Probe Support
 * • Operational Health APIs
 * • Runtime Availability Monitoring
 * • Intelligence Fabric Health Scoring
 * • Enterprise Observability Integration
 *
 *
 * Purpose
 * -------
 * Provide a centralized health intelligence layer for the payment reliability
 * platform.
 *
 *
 * Health Architecture
 * -------------------
 *
 * Service Health
 *
 *        |
 *        ▼
 *
 * Dependency Health
 *
 *        |
 *        ▼
 *
 * Runtime Health Aggregator
 *
 *        |
 *        ▼
 *
 * Platform Health Decision
 *
 *
 *
 * Health States
 * -------------
 *
 * HEALTHY
 *
 * DEGRADED
 *
 * UNAVAILABLE
 *
 * CRITICAL
 *
 *
 * Consumers
 * ----------
 *
 * Kubernetes
 * Prometheus
 * Grafana
 * Alert Manager
 * Incident Manager
 * Failover Engine
 *
 *
 * Design Principles
 * -----------------
 *
 * • Single Health Source of Truth
 * • Observable Runtime
 * • Failure Transparency
 * • Production Resilience
 *
 * ============================================================================
 */


const {
    randomUUID
} = require("crypto");



class PaymentReliabilityHealthManager {


    constructor({

        lifecycleManager,

        dependencyManager,

        serviceRegistry,

        eventBus,

        logger,

        auditLogger

    } = {}) {


        this.lifecycleManager =
            lifecycleManager;


        this.dependencyManager =
            dependencyManager;


        this.serviceRegistry =
            serviceRegistry;


        this.eventBus =
            eventBus;


        this.logger =
            logger;


        this.auditLogger =
            auditLogger;



        this.healthHistory = [];



        this.lastHealthReport = null;



    }





    /**
     * ------------------------------------------------------------------------
     * Aggregate Platform Health
     * ------------------------------------------------------------------------
     */


    async evaluate() {


        const services =
            await this.#collectServiceHealth();



        const dependencies =
            this.#collectDependencyHealth();



        const runtime =
            this.lifecycleManager
                ?.status();



        const score =
            this.#calculateHealthScore({

                services,

                dependencies,

                runtime

            });



        const status =
            this.#resolveHealthStatus(

                score

            );



        const report = {


            id:

                randomUUID(),


            status,


            score,


            runtime,


            services,


            dependencies,


            degraded:

                status !== "HEALTHY",


            generatedAt:

                new Date()

        };



        this.lastHealthReport =
            report;



        this.healthHistory.push(

            report

        );



        await this.#publishHealthEvent(

            report

        );



        return Object.freeze(

            report

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Kubernetes Readiness Probe
     * ------------------------------------------------------------------------
     */


    async readiness() {


        const health =
            await this.evaluate();



        return {

            ready:

                health.status ===

                "HEALTHY"

                ||

                health.status ===

                "DEGRADED",


            status:

                health.status,


            score:

                health.score

        };

    }





    /**
     * ------------------------------------------------------------------------
     * Kubernetes Liveness Probe
     * ------------------------------------------------------------------------
     */


    async liveness() {


        const runtime =
            this.lifecycleManager
                ?.status();



        return {


            alive:

                runtime?.runtime?.status !==

                "STOPPED",


            state:

                runtime?.runtime?.status

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Service Health Collection
     * ------------------------------------------------------------------------
     */


    async #collectServiceHealth() {


        if (

            !this.serviceRegistry

        ) {


            return {};

        }



        return await this.serviceRegistry.health();


    }





    /**
     * ------------------------------------------------------------------------
     * Dependency Health Collection
     * ------------------------------------------------------------------------
     */


    #collectDependencyHealth() {


        if (

            !this.dependencyManager

        ) {


            return {};

        }



        return {

            topology:

                this.dependencyManager
                    .dependencyMap(),


            validation:

                this.dependencyManager
                    .validateTopology()

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Health Score Calculation
     * ------------------------------------------------------------------------
     */


    #calculateHealthScore({

        services,

        dependencies,

        runtime

    }) {


        let score = 100;



        const serviceValues =

            Object.values(

                services

            );



        for (

            const service

            of serviceValues

        ) {


            if (

                service.healthy === false

            ) {


                score -= 20;

            }

        }



        if (

            dependencies.validation

            &&

            !dependencies.validation.healthy

        ) {


            score -= 30;

        }



        if (

            runtime?.runtime?.status ===

            "DEGRADED"

        ) {


            score -= 20;

        }



        return Math.max(

            0,

            score

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Health Classification
     * ------------------------------------------------------------------------
     */


    #resolveHealthStatus(score) {


        if (

            score >= 90

        ) {


            return "HEALTHY";

        }



        if (

            score >= 60

        ) {


            return "DEGRADED";

        }



        if (

            score >= 30

        ) {


            return "UNAVAILABLE";

        }



        return "CRITICAL";


    }





    /**
     * ------------------------------------------------------------------------
     * Health Event Publishing
     * ------------------------------------------------------------------------
     */


    async #publishHealthEvent(report) {


        if (

            !this.eventBus

        ) {


            return;

        }



        if (

            typeof this.eventBus.publish ===

            "function"

        ) {


            await this.eventBus.publish({

                type:

                    "PAYMENT_RELIABILITY_HEALTH_CHANGED",


                payload:

                    report

            });

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Operational Health API
     * ------------------------------------------------------------------------
     */


    getOperationalState() {


        return Object.freeze({

            current:

                this.lastHealthReport,


            history:

                this.healthHistory.slice(

                    -50

                )

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Audit Logging
     * ------------------------------------------------------------------------
     */


    async #audit(event) {


        if (

            this.auditLogger

        ) {


            await this.auditLogger.log(

                event

            );

        }


    }


}



module.exports =
    PaymentReliabilityHealthManager;