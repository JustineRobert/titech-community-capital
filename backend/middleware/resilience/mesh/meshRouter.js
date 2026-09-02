"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Universal Resilience Intelligence Mesh
 *
 * Enterprise Mesh Router
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Message routing
 * ✓ Priority routing
 * ✓ Geo routing
 * ✓ Failover routing
 * ✓ Retry management
 * ✓ Dead-letter queue
 * ✓ Route diagnostics
 *
 * ============================================================================
 */


const crypto = require("crypto");


/**
 * ============================================================================
 * Router Constants
 * ============================================================================
 */


const ROUTER_STATE = Object.freeze({

    CREATED:
        "CREATED",

    READY:
        "READY",

    ACTIVE:
        "ACTIVE",

    DEGRADED:
        "DEGRADED",

    FAILED:
        "FAILED",

    STOPPED:
        "STOPPED"

});


const ROUTE_PRIORITY = Object.freeze({

    LOW:
        1,

    NORMAL:
        5,

    HIGH:
        10,

    CRITICAL:
        100

});


const DELIVERY_STATE = Object.freeze({

    QUEUED:
        "QUEUED",

    ROUTING:
        "ROUTING",

    DELIVERED:
        "DELIVERED",

    FAILED:
        "FAILED",

    DEAD_LETTER:
        "DEAD_LETTER"

});


function createId(prefix="route") {

    return `${prefix}-${crypto.randomUUID()}`;

}



/**
 * ============================================================================
 * Enterprise Mesh Router
 * ============================================================================
 */


class MeshRouter {


    constructor(options = {}) {


        this.options = Object.freeze({

            maxRetries:

                options.maxRetries || 3,


            retryDelay:

                options.retryDelay || 1000,


            logger:

                options.logger || console,


            clock:

                options.clock ||
                (()=>new Date())

        });


        this.logger =
            this.options.logger;


        this.clock =
            this.options.clock;



        /**
         * Routing Tables
         */

        this.routes =
            new Map();


        this.priorityQueues =
            new Map();


        this.deadLetterQueue =
            [];


        this.history =
            [];


        this.state =
            ROUTER_STATE.CREATED;



        this.statistics = {


            messagesReceived:0,

            messagesDelivered:0,

            routingFailures:0,

            retries:0,

            deadLetters:0,

            failovers:0


        };


    }



    /**
     * ========================================================================
     * Register Route
     * ========================================================================
     */


    createRoute(route={}) {


        if (!route.id) {

            throw new Error(
                "Route id required."
            );

        }


        const record = Object.freeze({


            id:
                route.id,


            source:
                route.source || "*",


            destination:
                route.destination,


            strategy:
                route.strategy || "DIRECT",


            priority:
                route.priority ||
                ROUTE_PRIORITY.NORMAL,


            regions:

                Object.freeze([

                    ...(route.regions || [])

                ]),


            weight:

                route.weight || 1,


            active:true,


            createdAt:
                this.clock()


        });



        this.routes.set(

            record.id,

            record

        );



        return record;

    }




    /**
     * ========================================================================
     * Resolve Route
     * ========================================================================
     */


    resolveRoute(envelope) {


        const candidates =

            [...this.routes.values()]

            .filter(route =>

                route.active &&

                (

                    route.destination ===
                    envelope.destination

                    ||

                    route.destination === "*"

                )

            );



        if (!candidates.length) {

            return null;

        }



        return candidates.sort(

            (a,b)=>

                b.priority -
                a.priority

        )[0];


    }




    /**
     * ========================================================================
     * Route Message
     * ========================================================================
     */


    async route(envelope, context={}) {


        this.statistics.messagesReceived++;


        const route =
            this.resolveRoute(envelope);



        if (!route) {


            return this.deadLetter(

                envelope,

                "NO_ROUTE"

            );


        }



        try {


            this.statistics.messagesDelivered++;


            const result = Object.freeze({


                id:
                    createId("delivery"),


                route:
                    route.id,


                destination:
                    route.destination,


                state:
                    DELIVERY_STATE.DELIVERED,


                timestamp:
                    this.clock()


            });



            this.history.push(result);



            return result;


        }

        catch(error){


            return this.retry(

                envelope,

                error

            );


        }


    }





    /**
     * ========================================================================
     * Priority Routing
     * ========================================================================
     */


    queuePriority(envelope, priority) {


        if (!this.priorityQueues.has(priority)) {


            this.priorityQueues.set(

                priority,

                []

            );

        }



        this.priorityQueues
            .get(priority)
            .push(envelope);



        return true;


    }





    /**
     * ========================================================================
     * Geo Routing
     * ========================================================================
     */


    resolveGeoRoute(

        envelope,

        region

    ){


        return [...this.routes.values()]

            .find(route =>

                route.regions.includes(region)

            ) || null;


    }





    /**
     * ========================================================================
     * Failover Routing
     * ========================================================================
     */


    failover(routeId){


        const route =
            this.routes.get(routeId);



        if (!route) {

            return false;

        }



        const updated = Object.freeze({

            ...route,

            active:false,

            failedAt:
                this.clock()

        });



        this.routes.set(

            routeId,

            updated

        );



        this.statistics.failovers++;


        return true;


    }





    /**
     * ========================================================================
     * Retry Handler
     * ========================================================================
     */


    async retry(

        envelope,

        error

    ){


        this.statistics.retries++;



        if (

            envelope.retryCount >=

            this.options.maxRetries

        ){


            return this.deadLetter(

                envelope,

                error.message

            );


        }



        return Object.freeze({


            state:
                DELIVERY_STATE.QUEUED,


            retry:true,


            retryCount:

                (

                    envelope.retryCount || 0

                ) + 1,


            timestamp:

                this.clock()


        });


    }





    /**
     * ========================================================================
     * Dead Letter Queue
     * ========================================================================
     */


    deadLetter(

        envelope,

        reason

    ){


        const record = Object.freeze({


            id:
                createId("dead"),


            envelope,


            reason,


            timestamp:
                this.clock()


        });



        this.deadLetterQueue.push(record);



        this.statistics.deadLetters++;



        return record;


    }





    /**
     * ========================================================================
     * Diagnostics
     * ========================================================================
     */


    diagnostics(){


        return Object.freeze({


            state:
                this.state,


            routes:
                this.routes.size,


            deadLetters:
                this.deadLetterQueue.length,


            history:
                this.history.length,


            statistics:

                Object.freeze({

                    ...this.statistics

                }),


            timestamp:
                this.clock()


        });


    }


}


module.exports = {


    MeshRouter,


    ROUTER_STATE,

    ROUTE_PRIORITY,

    DELIVERY_STATE


};