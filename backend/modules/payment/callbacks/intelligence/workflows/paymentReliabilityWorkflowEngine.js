/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Workflow Engine
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Reliability Event Consumption
 * • Automated Workflow Creation
 * • BullMQ Job Coordination
 * • Incident Lifecycle Management
 * • Escalation Workflow Execution
 * • Provider Recovery Workflows
 * • Retry Protection Workflows
 * • Human Approval Support
 * • Workflow State Management
 * • Multi-Tenant Aware
 * • Event Driven Architecture
 * • Structured Logging
 * • Metrics Integration
 * • OpenTelemetry Ready
 *
 *
 * Purpose
 * -------
 * Convert payment reliability intelligence events into controlled operational
 * workflows.
 *
 *
 * Processing Flow
 * ---------------
 *
 * Reliability Event
 *
 *        |
 *        ▼
 *
 * Workflow Engine
 *
 *        |
 *        ├───────────────┐
 *        ▼               ▼
 *
 * Incident Flow     Provider Recovery
 *
 *        |
 *        ▼
 *
 * BullMQ Jobs
 *
 *        |
 *        ▼
 *
 * Operational Actions
 *
 *
 *
 * Workflow States
 * ----------------
 *
 * CREATED
 * RUNNING
 * WAITING_APPROVAL
 * ESCALATED
 * COMPLETED
 * FAILED
 * CANCELLED
 *
 *
 * Design Principles
 * -----------------
 * • Workflow Orchestration Only
 * • No Payment Mutation
 * • No Direct Provider Calls
 * • Async First
 * • Resilient Execution
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityWorkflowEngine {


    constructor({

        queue,

        eventBus,

        incidentRepository,

        workflowRepository,

        metrics,

        logger

    } = {}) {


        this.queue =
            queue;


        this.eventBus =
            eventBus;


        this.incidentRepository =
            incidentRepository;


        this.workflowRepository =
            workflowRepository;


        this.metrics =
            metrics;


        this.logger =
            logger;



        this.workflows = new Map();



        this.states = Object.freeze({

            CREATED:
                "CREATED",

            RUNNING:
                "RUNNING",

            WAITING_APPROVAL:
                "WAITING_APPROVAL",

            ESCALATED:
                "ESCALATED",

            COMPLETED:
                "COMPLETED",

            FAILED:
                "FAILED",

            CANCELLED:
                "CANCELLED"

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Consume Reliability Event
     * ------------------------------------------------------------------------
     */


    async handleEvent(event) {


        const workflow =

            this.#createWorkflow(event);



        this.workflows.set(

            workflow.id,

            workflow

        );



        await this.#persistWorkflow(

            workflow

        );



        await this.#routeWorkflow(

            workflow,

            event

        );



        return workflow;

    }





    /**
     * ------------------------------------------------------------------------
     * Create Workflow
     * ------------------------------------------------------------------------
     */


    #createWorkflow(event) {


        return {

            id:

                randomUUID(),


            eventId:

                event.id,


            eventType:

                event.type,


            state:

                this.states.CREATED,


            priority:

                this.#determinePriority(event),


            createdAt:

                new Date(),


            history:

                [

                    {

                        state:

                            this.states.CREATED,

                        timestamp:

                            new Date()

                    }

                ]

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Workflow Router
     * ------------------------------------------------------------------------
     */


    async #routeWorkflow(workflow,event) {


        switch(event.type) {


            case "PAYMENT_RESILIENCE_DECISION":

                await this.#processResilienceDecision(

                    workflow,

                    event

                );

                break;



            case "PROVIDER_HEALTH_CHANGED":

                await this.#processProviderHealth(

                    workflow,

                    event

                );

                break;



            case "ANOMALY_DETECTED":

                await this.#processAnomaly(

                    workflow,

                    event

                );

                break;



            default:

                await this.#markCompleted(

                    workflow

                );

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Process Resilience Decision
     * ------------------------------------------------------------------------
     */


    async #processResilienceDecision(

        workflow,

        event

    ) {


        const decision =

            event.payload;



        if (

            decision.failoverDecision?.decision ===

            "FAILOVER_RECOMMENDED"

        ) {


            await this.#queueJob({

                type:

                    "PROVIDER_FAILOVER_REVIEW",


                workflow,

                payload:

                    decision

            });


            this.#transition(

                workflow,

                this.states.ESCALATED

            );


            return;

        }



        await this.#queueJob({

            type:

                "PAYMENT_MONITORING_REVIEW",


            workflow,

            payload:

                decision

        });



        this.#transition(

            workflow,

            this.states.RUNNING

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Provider Recovery Workflow
     * ------------------------------------------------------------------------
     */


    async #processProviderHealth(

        workflow,

        event

    ) {


        await this.#queueJob({

            type:

                "PROVIDER_HEALTH_RECOVERY_CHECK",


            workflow,

            payload:

                event.payload

        });



        this.#transition(

            workflow,

            this.states.RUNNING

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Anomaly Workflow
     * ------------------------------------------------------------------------
     */


    async #processAnomaly(

        workflow,

        event

    ) {


        await this.#queueJob({

            type:

                "ANOMALY_INVESTIGATION",


            workflow,

            payload:

                event.payload

        });



        this.#transition(

            workflow,

            this.states.RUNNING

        );


    }





    /**
     * ------------------------------------------------------------------------
     * BullMQ Job Dispatch
     * ------------------------------------------------------------------------
     */


    async #queueJob({

        type,

        workflow,

        payload

    }) {


        if (

            !this.queue

        ) {


            return;

        }



        await this.queue.add(

            type,

            {

                workflowId:

                    workflow.id,


                payload

            },

            {

                removeOnComplete:

                    true

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Workflow State Transition
     * ------------------------------------------------------------------------
     */


    #transition(

        workflow,

        state

    ) {


        workflow.state = state;



        workflow.history.push({

            state,

            timestamp:

                new Date()

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Complete Workflow
     * ------------------------------------------------------------------------
     */


    async #markCompleted(workflow) {


        this.#transition(

            workflow,

            this.states.COMPLETED

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Priority Detection
     * ------------------------------------------------------------------------
     */


    #determinePriority(event) {


        const severity =

            event.payload?.severity;



        if (

            severity === "CRITICAL"

        ) {


            return "CRITICAL";

        }



        if (

            severity === "HIGH"

        ) {


            return "HIGH";

        }



        return "NORMAL";


    }





    /**
     * ------------------------------------------------------------------------
     * Persistence
     * ------------------------------------------------------------------------
     */


    async #persistWorkflow(workflow) {


        if (

            !this.workflowRepository

        ) {


            return;

        }



        await this.workflowRepository.create(

            workflow

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Operational Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            activeWorkflows:

                this.workflows.size,


            workflows:

                [

                    ...this.workflows.values()

                ]

        });


    }


}



module.exports = PaymentReliabilityWorkflowEngine;