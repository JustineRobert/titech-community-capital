/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Event Bus
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Resilience Event Publishing
 * • Provider Health Event Distribution
 * • Fraud System Notifications
 * • Risk System Integration
 * • Workflow Trigger Support
 * • BullMQ Integration Ready
 * • Prometheus Metrics Hooks
 * • OpenTelemetry Trace Support
 * • Event Subscription Management
 * • Event Replay Support Ready
 * • Dead Letter Queue Ready
 * • Structured Logging
 * • Multi-Tenant Awareness
 *
 *
 * Purpose
 * -------
 * Provide an event-driven communication layer between payment reliability
 * intelligence components and enterprise operational systems.
 *
 *
 * Event Flow
 * ----------
 *
 * Payment Reliability Decision
 *
 *              |
 *              ▼
 *
 *       Event Bus
 *
 *              |
 *     ┌────────┼────────┐
 *     ▼        ▼        ▼
 *
 * Fraud   Operations  Workflow
 *
 *
 *
 * Supported Events
 * ----------------
 *
 * PAYMENT_RESILIENCE_DECISION
 *
 * PROVIDER_HEALTH_CHANGED
 *
 * FAILOVER_RECOMMENDATION
 *
 * ANOMALY_DETECTED
 *
 * SETTLEMENT_RISK_DETECTED
 *
 *
 * Design Principles
 * -----------------
 * • Event Driven
 * • Loose Coupling
 * • Async Friendly
 * • Provider Independent
 * • Observable
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityEventBus {


    constructor({

        queue,

        metrics,

        tracer,

        logger

    } = {}) {


        this.queue =
            queue;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.logger =
            logger;



        this.subscribers = new Map();



        this.eventHistory = [];

    }





    /**
     * ------------------------------------------------------------------------
     * Publish Event
     * ------------------------------------------------------------------------
     */


    async publish({

        type,

        payload,

        tenantId,

        metadata = {}

    }) {


        const event = Object.freeze({


            id:

                randomUUID(),


            type,


            payload,


            tenantId,


            metadata,


            createdAt:

                new Date()


        });



        this.eventHistory.push(event);



        this.metrics?.increment?.(

            "paymentReliabilityEventsPublished"

        );



        this.logger?.info?.(

            "Payment reliability event published",

            {

                eventId:

                    event.id,


                type

            }

        );



        await this.#notifySubscribers(

            event

        );



        await this.#publishQueueEvent(

            event

        );



        return event;


    }





    /**
     * ------------------------------------------------------------------------
     * Subscribe To Event
     * ------------------------------------------------------------------------
     */


    subscribe(

        eventType,

        handler

    ) {


        if (

            !this.subscribers.has(eventType)

        ) {


            this.subscribers.set(

                eventType,

                []

            );

        }



        this.subscribers

            .get(eventType)

            .push(handler);



        return handler;

    }





    /**
     * ------------------------------------------------------------------------
     * Remove Subscriber
     * ------------------------------------------------------------------------
     */


    unsubscribe(

        eventType,

        handler

    ) {


        const handlers =

            this.subscribers.get(

                eventType

            );



        if (!handlers) {


            return false;

        }



        const index =

            handlers.indexOf(

                handler

            );



        if (

            index === -1

        ) {


            return false;

        }



        handlers.splice(

            index,

            1

        );



        return true;

    }





    /**
     * ------------------------------------------------------------------------
     * Publish Resilience Decision
     * ------------------------------------------------------------------------
     */


    async publishResilienceDecision(decision) {


        return this.publish({

            type:

                "PAYMENT_RESILIENCE_DECISION",


            payload:

                decision


        });


    }





    /**
     * ------------------------------------------------------------------------
     * Publish Provider Health Change
     * ------------------------------------------------------------------------
     */


    async publishProviderHealthChange({

        provider,

        previousHealth,

        currentHealth

    }) {


        return this.publish({

            type:

                "PROVIDER_HEALTH_CHANGED",


            payload:

                {

                    provider,

                    previousHealth,

                    currentHealth

                }

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Publish Anomaly Event
     * ------------------------------------------------------------------------
     */


    async publishAnomaly(anomaly) {


        return this.publish({

            type:

                "ANOMALY_DETECTED",


            payload:

                anomaly


        });


    }





    /**
     * ------------------------------------------------------------------------
     * Event History Snapshot
     * ------------------------------------------------------------------------
     */


    getHistory() {


        return Object.freeze([

            ...this.eventHistory

        ]);

    }





    /**
     * ------------------------------------------------------------------------
     * Notify Local Subscribers
     * ------------------------------------------------------------------------
     */


    async #notifySubscribers(event) {


        const handlers =

            this.subscribers.get(

                event.type

            )

            || [];



        for (const handler of handlers) {


            await handler(event);

        }


    }





    /**
     * ------------------------------------------------------------------------
     * BullMQ / Workflow Publishing
     * ------------------------------------------------------------------------
     */


    async #publishQueueEvent(event) {


        if (

            !this.queue

        ) {


            return;

        }



        await this.queue.add(

            "payment-reliability-event",

            event,

            {

                removeOnComplete:

                    true,


                removeOnFail:

                    false

            }

        );


    }


}



module.exports = PaymentReliabilityEventBus;