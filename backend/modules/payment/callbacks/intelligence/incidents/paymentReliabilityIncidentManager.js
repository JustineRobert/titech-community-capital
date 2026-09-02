/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Incident Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Structured Incident Creation
 * • Incident Lifecycle Management
 * • Provider Incident Linking
 * • Tenant Impact Tracking
 * • Callback Correlation
 * • Settlement Impact Tracking
 * • Escalation Management
 * • Incident Severity Classification
 * • Resolution Timeline Tracking
 * • Incident Metrics
 * • Operations Dashboard Integration Ready
 * • Event Driven Architecture
 * • Multi-Tenant Aware
 * • Audit Trail Support
 * • Structured Logging
 *
 *
 * Purpose
 * -------
 * Manage the complete lifecycle of payment reliability incidents generated
 * from callback intelligence, provider failures, anomaly detection, and
 * resilience decisions.
 *
 *
 * Incident Lifecycle
 * ------------------
 *
 * DETECTED
 *    |
 *    ▼
 * CREATED
 *    |
 *    ▼
 * INVESTIGATING
 *    |
 *    ▼
 * MITIGATING
 *    |
 *    ▼
 * RESOLVED
 *    |
 *    ▼
 * CLOSED
 *
 *
 * Design Principles
 * -----------------
 * • Incident Management Only
 * • No Payment Mutation
 * • No Provider Execution
 * • Immutable Incident Events
 * • Enterprise Operations Ready
 *
 * ============================================================================
 */


const {
    randomUUID
} = require("crypto");



class PaymentReliabilityIncidentManager {


    constructor({

        repository,

        eventBus,

        metrics,

        logger

    } = {}) {


        this.repository =
            repository;


        this.eventBus =
            eventBus;


        this.metrics =
            metrics;


        this.logger =
            logger;



        this.incidents = new Map();



        this.statuses = Object.freeze({

            DETECTED:
                "DETECTED",

            CREATED:
                "CREATED",

            INVESTIGATING:
                "INVESTIGATING",

            MITIGATING:
                "MITIGATING",

            RESOLVED:
                "RESOLVED",

            CLOSED:
                "CLOSED"

        });



        this.severity = Object.freeze({

            LOW:
                "LOW",

            MEDIUM:
                "MEDIUM",

            HIGH:
                "HIGH",

            CRITICAL:
                "CRITICAL"

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Create Incident
     * ------------------------------------------------------------------------
     */


    async createIncident({

        provider,

        tenantId,

        callbackIds = [],

        settlementReferences = [],

        anomaly,

        reliabilityDecision,

        metadata = {}

    }) {


        const incident = {


            id:

                randomUUID(),


            provider,


            tenantId,


            status:

                this.statuses.CREATED,


            severity:

                this.#calculateSeverity({

                    anomaly,

                    reliabilityDecision

                }),



            impact:

                this.#calculateImpact({

                    callbackIds,

                    settlementReferences

                }),



            references: {


                callbacks:

                    callbackIds,


                settlements:

                    settlementReferences

            },



            anomaly,



            reliabilityDecision,



            metadata,



            timeline: [


                {

                    state:

                        this.statuses.CREATED,


                    timestamp:

                        new Date()

                }

            ],



            createdAt:

                new Date()



        };



        this.incidents.set(

            incident.id,

            incident

        );



        await this.#persist(

            incident

        );



        await this.#publish(

            "PAYMENT_INCIDENT_CREATED",

            incident

        );



        this.metrics?.increment?.(

            "paymentIncidentsCreated"

        );



        return Object.freeze(

            incident

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Update Incident Status
     * ------------------------------------------------------------------------
     */


    async updateStatus({

        incidentId,

        status,

        note

    }) {


        const incident =

            this.incidents.get(

                incidentId

            );



        if (!incident) {


            throw new Error(

                `Incident ${incidentId} not found`

            );

        }



        incident.status = status;



        incident.timeline.push({

            state:

                status,


            note,


            timestamp:

                new Date()

        });



        if (

            status === this.statuses.RESOLVED

        ) {


            incident.resolvedAt =

                new Date();

        }



        await this.#persist(

            incident

        );



        return incident;

    }





    /**
     * ------------------------------------------------------------------------
     * Escalate Incident
     * ------------------------------------------------------------------------
     */


    async escalate({

        incidentId,

        level,

        reason

    }) {


        const incident =

            this.incidents.get(

                incidentId

            );



        if (!incident) {


            throw new Error(

                "Incident does not exist"

            );

        }



        incident.escalation = {


            level,


            reason,


            escalatedAt:

                new Date()

        };



        incident.status =

            this.statuses.INVESTIGATING;



        await this.#publish(

            "PAYMENT_INCIDENT_ESCALATED",

            incident

        );



        return incident;


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Incident Impact
     * ------------------------------------------------------------------------
     */


    #calculateImpact({

        callbackIds,

        settlementReferences

    }) {


        return {


            affectedCallbacks:

                callbackIds.length,


            affectedSettlements:

                settlementReferences.length,


            impactScore:

                (

                    callbackIds.length * 2

                )

                +

                (

                    settlementReferences.length * 5

                )

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Calculate Severity
     * ------------------------------------------------------------------------
     */


    #calculateSeverity({

        anomaly = {},

        reliabilityDecision = {}

    }) {


        if (

            anomaly.severity === "CRITICAL"

        ) {


            return this.severity.CRITICAL;

        }



        if (

            reliabilityDecision.reliabilityScore < 40

        ) {


            return this.severity.HIGH;

        }



        if (

            anomaly.score > 50

        ) {


            return this.severity.MEDIUM;

        }



        return this.severity.LOW;


    }





    /**
     * ------------------------------------------------------------------------
     * Retrieve Incident
     * ------------------------------------------------------------------------
     */


    getIncident(id) {


        return this.incidents.get(id) || null;

    }





    /**
     * ------------------------------------------------------------------------
     * Incident Dashboard Snapshot
     * ------------------------------------------------------------------------
     */


    dashboardSnapshot() {


        const incidents =

            Array.from(

                this.incidents.values()

            );



        return Object.freeze({

            total:

                incidents.length,


            active:

                incidents.filter(

                    incident =>

                        ![

                            this.statuses.RESOLVED,

                            this.statuses.CLOSED

                        ]

                        .includes(

                            incident.status

                        )

                ).length,



            critical:

                incidents.filter(

                    incident =>

                        incident.severity ===

                        this.severity.CRITICAL

                ).length

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Persistence
     * ------------------------------------------------------------------------
     */


    async #persist(incident) {


        if (

            !this.repository

        ) {


            return;

        }



        await this.repository.save(

            incident

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Publish Event
     * ------------------------------------------------------------------------
     */


    async #publish(type,payload) {


        if (

            !this.eventBus

        ) {


            return;

        }



        await this.eventBus.publish({

            type,

            payload

        });


    }


}


module.exports = PaymentReliabilityIncidentManager;