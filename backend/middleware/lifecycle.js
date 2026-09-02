"use strict";

/**
 * TITech Community Capital LTD
 * Enterprise Middleware Lifecycle Manager
 *
 * Responsible for:
 *
 * - Middleware startup lifecycle
 * - Shutdown lifecycle
 * - State management
 * - Event propagation
 * - Failure handling
 * - Health tracking
 * - Runtime diagnostics
 *
 */


const EventEmitter =
    require("events");


const {
    MiddlewareBootstrapError
}
=
require("./errors");





class MiddlewareLifecycle
extends EventEmitter {



    constructor({

        runtimeContext = null,

        logger = null

    } = {}) {



        super();



        this.runtimeContext =
            runtimeContext;



        this.logger =
            logger;



        /**
         * Lifecycle state
         */
        this.state =
            "initialized";



        /**
         * Startup information
         */
        this.startedAt =
            null;


        this.completedAt =
            null;


        this.shutdownAt =
            null;



        /**
         * Registered middleware
         */
        this.middleware = [];



        /**
         * Errors
         */
        this.errors = [];



        /**
         * State history
         */
        this.history = [];


        this.allowedTransitions = {


            initialized:
                [

                    "starting",

                    "failed"

                ],



            starting:
                [

                    "started",

                    "failed"

                ],



            started:
                [

                    "stopping",

                    "failed"

                ],



            stopping:
                [

                    "stopped",

                    "failed"

                ],



            stopped:
                [],



            failed:
                [

                    "stopping"

                ]

        };


    }






    /**
     * Transition lifecycle state
     */
    transition(
        nextState
    ) {



        const allowed =
            this.allowedTransitions[
                this.state
            ];



        if(
            !allowed.includes(
                nextState
            )
        ) {



            throw new MiddlewareBootstrapError(

                `Invalid lifecycle transition ${this.state} -> ${nextState}`

            );


        }



        const previous =
            this.state;



        this.state =
            nextState;



        const event = {


            previous,

            current:
                nextState,


            timestamp:
                new Date()


        };



        this.history.push(
            event
        );



        this.emit(

            "state.changed",

            event

        );



        this.publishRuntimeEvent(

            "middleware.lifecycle.changed",

            event

        );



        return this;



    }






    /**
     * Begin startup
     */
    starting() {



        if(
            this.state !==
            "initialized"
        ) {

            return this;

        }



        this.startedAt =
            new Date();



        this.transition(
            "starting"
        );



        this.emit(
            "starting"
        );



        return this;


    }






    /**
     * Startup complete
     */
    started(
        metadata = {}
    ) {



        this.completedAt =
            new Date();



        this.transition(
            "started"
        );



        this.emit(

            "started",

            {

                metadata,

                duration:
                    this.duration()

            }

        );



        return this;


    }






    /**
     * Register middleware instance
     */
    registerMiddleware(
        middleware
    ) {



        if(
            !middleware
        ) {

            return this;

        }



        this.middleware.push({

            name:
                middleware.name,


            registeredAt:
                new Date(),


            status:
                "registered"

        });



        return this;


    }






    /**
     * Mark middleware healthy
     */
    markHealthy(
        name
    ) {



        const item =
            this.middleware.find(

                middleware =>
                    middleware.name === name

            );



        if(item){

            item.status =
                "healthy";

        }



        this.emit(

            "middleware.healthy",

            name

        );


        return this;


    }






    /**
     * Mark middleware failed
     */
    markFailed(

        name,

        error

    ) {



        const item =
            this.middleware.find(

                middleware =>
                    middleware.name === name

            );



        if(item){

            item.status =
                "failed";


            item.error =
                error.message;

        }



        this.errors.push({

            middleware:
                name,


            error:
                error.message,


            timestamp:
                new Date()


        });



        this.emit(

            "middleware.failed",

            {

                name,

                error

            }

        );



        return this;


    }






    /**
     * Global lifecycle failure
     */
    failed(
        error
    ) {



        this.errors.push({

            error:
                error.message,


            timestamp:
                new Date()

        });



        this.transition(
            "failed"
        );



        this.emit(

            "failed",

            error

        );



        if(this.logger){


            this.logger.error(

                {

                    error,

                    component:
                        "middleware-lifecycle"

                },

                "Middleware lifecycle failure"

            );


        }



        return this;


    }








    /**
     * Begin shutdown
     */
    stopping() {



        if(
            this.state ===
            "stopped"
        ){

            return this;

        }



        this.transition(
            "stopping"
        );



        this.emit(
            "stopping"
        );



        return this;


    }







    /**
     * Shutdown completed
     */
    stopped() {



        this.shutdownAt =
            new Date();



        this.transition(
            "stopped"
        );



        this.emit(
            "stopped"
        );



        return this;


    }







    /**
     * Duration helper
     */
    duration() {



        if(
            !this.startedAt
        ){

            return 0;

        }



        const end =
            this.completedAt ||
            new Date();



        return (

            end.getTime()
            -
            this.startedAt.getTime()

        );


    }








    /**
     * Publish to runtime event bus
     */
    publishRuntimeEvent(

        event,

        payload

    ) {



        try {



            if(
                this.runtimeContext
                ?.eventBus
                ?.emit
            ){



                this.runtimeContext
                    .eventBus
                    .emit(

                        event,

                        payload

                    );


            }



        }


        catch(error){


            if(this.logger){

                this.logger.warn(

                    error,

                    "Runtime lifecycle event failed"

                );

            }


        }



    }








    /**
     * Diagnostics
     */
    diagnostics() {



        return {


            state:
                this.state,


            startedAt:
                this.startedAt,


            completedAt:
                this.completedAt,


            shutdownAt:
                this.shutdownAt,


            duration:
                this.duration(),


            middleware:
                this.middleware,


            errors:
                this.errors,


            history:
                this.history



        };


    }







    /**
     * Health status
     */
    health() {


        return {


            healthy:
                this.state ===
                "started",


            state:
                this.state,


            middlewareCount:
                this.middleware.length,


            failures:
                this.errors.length


        };


    }



}



module.exports =
    MiddlewareLifecycle;