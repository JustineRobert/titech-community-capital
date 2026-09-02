"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Bootstrap Coordinator
 *
 * Responsibilities:
 *
 * - Assemble middleware infrastructure
 * - Coordinate startup lifecycle
 * - Build executable pipeline
 * - Register middleware into Express
 *
 */



const {

    MiddlewareBootstrapError

}
=
require("./errors");



const {

    createMiddlewareLoader

}
=
require("./loader");



const {

    createDependencyResolver

}
=
require("./dependencyResolver");



const {

    createOrderingEngine

}
=
require("./ordering");



const {

    createRegistrationEngine

}
=
require("./registration");









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    enabled:

        true,



    failFast:

        true,



    diagnostics:

        true



};









/**
 * Middleware Bootstrap Coordinator
 */
class MiddlewareBootstrap {



    constructor(options = {}){


        this.config = {


            ...DEFAULT_CONFIG,


            ...options.config


        };




        this.logger =
            options.logger || null;




        this.runtimeContext =
            options.runtimeContext || null;




        this.serviceRegistry =
            options.serviceRegistry || null;




        this.app =
            options.app || null;





        this.state = {


            started:

                false,



            middlewareCount:

                0,



            duration:

                0



        };





        this.pipeline = [];



        this.components = {};



    }









    /**
     * Publish lifecycle event
     */
    emit(

        event,

        payload = {}

    ){



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









    /**
     * Start bootstrap process
     */
    async bootstrap(){



        const startedAt =
            Date.now();








        try {





            this.emit(

                "middleware.bootstrap.started"

            );








            /**
             * Load middleware
             */
            const loader =

                createMiddlewareLoader({

                    directory:

                        this.config.directory


                });








            const middlewareList =

                loader.load();








            /**
             * Resolve dependencies
             */
            const resolver =

                createDependencyResolver({

                    strict:true

                });








            resolver.register(

                middlewareList

            );








            const dependencyPipeline =

                resolver.resolve();








            /**
             * Apply ordering
             */
            const ordering =

                createOrderingEngine();








            this.pipeline =

                ordering.order(

                    dependencyPipeline

                );








            /**
             * Register into Express
             */
            const registration =

                createRegistrationEngine({

                    failFast:

                        this.config.failFast

                });








            await registration.register(

                this.app,

                this.pipeline,

                {


                    config:

                        this.config,


                    runtimeContext:

                        this.runtimeContext,


                    serviceRegistry:

                        this.serviceRegistry,


                    logger:

                        this.logger



                }

            );








            this.components = {


                loader,


                resolver,


                ordering,


                registration



            };








            this.state = {


                started:

                    true,



                middlewareCount:

                    this.pipeline.length,



                duration:

                    Date.now()

                    -

                    startedAt



            };








            this.emit(

                "middleware.bootstrap.completed",

                this.state

            );








            if(this.logger){



                this.logger.info(

                    {

                        middlewareCount:

                            this.state.middlewareCount,


                        duration:

                            this.state.duration



                    },

                    "Enterprise middleware bootstrap completed"

                );


            }








            return this.state;


        }


        catch(error){



            this.emit(

                "middleware.bootstrap.failed",

                {

                    error:

                        error.message

                }

            );








            if(this.logger){



                this.logger.error(

                    {

                        error

                    },

                    "Enterprise middleware bootstrap failed"

                );


            }








            if(

                error instanceof MiddlewareBootstrapError

            ){

                throw error;

            }








            throw new MiddlewareBootstrapError(

                "Middleware bootstrap failed",

                {

                    error:

                        error.message

                }

            );



        }



    }









    /**
     * Get pipeline
     */
    getPipeline(){



        return this.pipeline;


    }









    /**
     * Diagnostics
     */
    diagnostics(){



        return {


            state:

                this.state,



            pipeline:

                this.pipeline.map(

                    middleware => ({


                        name:

                            middleware.name,


                        phase:

                            middleware.phase,


                        priority:

                            middleware.priority



                    })

                ),



            components:

                Object.keys(

                    this.components

                )



        };


    }



}









/**
 * Bootstrap helper
 */
async function bootstrapMiddleware(

    options = {}

){



    const bootstrap =

        new MiddlewareBootstrap(

            options

        );








    await bootstrap.bootstrap();








    return bootstrap;


}









/**
 * Health check
 */
async function healthCheck(){


    return {


        status:

            "healthy"



    };


}









module.exports = {


    MiddlewareBootstrap,


    bootstrapMiddleware,


    healthCheck


};