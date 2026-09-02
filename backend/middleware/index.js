"use strict";

/**
 * TITech Community Capital LTD
 * Enterprise Middleware Bootstrap Engine
 *
 * Responsible for:
 *
 * - Middleware registration
 * - Dependency injection
 * - Middleware ordering
 * - Lifecycle management
 * - Runtime context integration
 * - Startup diagnostics
 * - Graceful failure handling
 *
 * This module is the orchestration core
 * for the complete HTTP infrastructure.
 *
 */


const EventEmitter = require("events");

const MiddlewareRegistry =
    require("./registry");


const MiddlewarePipeline =
    require("./pipeline");


const MiddlewareLifecycle =
    require("./lifecycle");


const generateDiagnostics =
    require("./diagnostics");


const {
    MiddlewareBootstrapError
}
=
require("./errors");



/**
 * Enterprise Middleware Engine
 */
class EnterpriseMiddlewareEngine
extends EventEmitter {



    constructor({

        app,

        runtimeContext,

        serviceRegistry,

        metadata,

        config = {},

        logger = null,

        metrics = null

    }) {


        super();



        if(!app){

            throw new MiddlewareBootstrapError(
                "Express application instance is required"
            );

        }



        this.app =
            app;



        this.runtimeContext =
            runtimeContext;



        this.serviceRegistry =
            serviceRegistry;



        this.metadata =
            metadata;



        this.config =
            config;



        this.logger =
            logger;



        this.metrics =
            metrics;



        /**
         * Dependency injection container
         */
        this.container = {


            app,

            runtimeContext,

            serviceRegistry,

            metadata,

            config,

            logger,

            metrics,


            engine:
                this


        };



        /**
         * Middleware registry
         */
        this.registry =
            new MiddlewareRegistry();



        /**
         * Pipeline executor
         */
        this.pipeline =
            new MiddlewarePipeline(
                this.registry
            );



        /**
         * Lifecycle manager
         */
        this.lifecycle =
            new MiddlewareLifecycle();



        this.state =
            "initialized";



        this.installed =
            [];



        this.failed =
            [];



        this.startedAt =
            null;



        this.completedAt =
            null;



        this.registerLifecycleListeners();


    }





    /**
     * Attach lifecycle observers
     */
    registerLifecycleListeners(){


        this.lifecycle.on(
            "starting",
            () => {

                this.state =
                    "starting";


                this.emit(
                    "middleware.starting"
                );


            }
        );



        this.lifecycle.on(
            "started",
            () => {


                this.state =
                    "started";


                this.emit(
                    "middleware.started"
                );


            }
        );



        this.lifecycle.on(
            "failed",
            error => {


                this.state =
                    "failed";


                this.emit(
                    "middleware.failed",
                    error
                );


            }
        );



        this.lifecycle.on(
            "shutdown",
            () => {


                this.state =
                    "shutdown";


                this.emit(
                    "middleware.shutdown"
                );


            }
        );


    }





    /**
     * Register middleware definition
     *
     * Example:
     *
     * engine.register({
     *
     *   name:"security",
     *
     *   priority:10,
     *
     *   factory:(context)=>middleware
     *
     * })
     */
    register(definition){


        try{


            this.registry.register(
                definition
            );



            return this;



        }

        catch(error){


            throw new MiddlewareBootstrapError(

                "Middleware registration failed",

                {

                    middleware:
                        definition?.name,

                    reason:
                        error.message

                }

            );


        }


    }





    /**
     * Register multiple middleware modules
     */
    registerMany(definitions = []){


        for(
            const middleware
            of definitions
        ){

            this.register(
                middleware
            );

        }


        return this;


    }





    /**
     * Validate middleware dependencies
     */
    validateDependencies(middleware){


        if(
            !middleware.dependencies ||
            middleware.dependencies.length === 0
        ){

            return true;

        }



        for(
            const dependency
            of middleware.dependencies
        ){


            const service =
                this.serviceRegistry
                ?.get?.(
                    dependency
                );



            if(!service){


                throw new MiddlewareBootstrapError(

                    `Missing middleware dependency: ${dependency}`,

                    {

                        middleware:
                            middleware.name,

                        dependency

                    }

                );


            }


        }



        return true;


    }





    /**
     * Bootstrap middleware pipeline
     */
    async bootstrap(){


        if(
            this.state === "started"
        ){

            return this.status();

        }



        try{


            this.startedAt =
                new Date();



            this.lifecycle.starting();



            const registered =
                this.registry.list();



            for(
                const middleware
                of registered
            ){

                this.validateDependencies(
                    middleware
                );

            }



            this.emit(
                "middleware.registered",
                {

                    count:
                        registered.length

                }
            );



            this.installed =
                await this.pipeline.execute(
                    this.container
                );



            this.completedAt =
                new Date();



            this.lifecycle.started();



            this.logStartup();



            return this.status();



        }


        catch(error){


            this.failed.push({

                timestamp:
                    new Date(),

                error:
                    error.message


            });



            this.lifecycle.failed(
                error
            );



            if(this.logger){

                this.logger.error(

                    {

                        error,

                        component:
                            "middleware-engine"

                    },

                    "Middleware bootstrap failed"

                );

            }



            throw new MiddlewareBootstrapError(

                "Enterprise middleware initialization failed",

                {

                    cause:
                        error.message,

                    installed:
                        this.installed

                }

            );


        }


    }





    /**
     * Startup logging
     */
    logStartup(){


        const message = {

            component:
                "middleware-engine",


            middleware:
                this.installed,


            count:
                this.installed.length


        };



        if(this.logger){

            this.logger.info(

                message,

                "Enterprise middleware initialized"

            );

        }



    }





    /**
     * Diagnostics
     */
    diagnostics(){


        return generateDiagnostics({

            registry:
                this.registry,


            runtimeContext:
                this.runtimeContext


        });


    }





    /**
     * Engine status
     */
    status(){


        return {


            state:
                this.state,


            installed:
                this.installed,


            failed:
                this.failed,


            diagnostics:
                this.diagnostics(),


            startedAt:
                this.startedAt,


            completedAt:
                this.completedAt


        };


    }





    /**
     * Graceful shutdown
     */
    async shutdown(){


        try{


            this.lifecycle.shutdown();



            this.emit(
                "shutdown"
            );



            this.state =
                "shutdown";



        }


        catch(error){


            if(this.logger){

                this.logger.error(
                    error,
                    "Middleware shutdown failure"
                );

            }


        }


    }



}





/**
 * Factory function
 */
function initializeMiddleware(options){


    return new EnterpriseMiddlewareEngine(
        options
    );


}





module.exports = {


    EnterpriseMiddlewareEngine,


    initializeMiddleware


};