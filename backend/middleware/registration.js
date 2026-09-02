"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Registration Engine
 *
 * Responsibilities:
 *
 * - Instantiate middleware
 * - Inject enterprise dependencies
 * - Register with Express
 * - Track startup state
 *
 */



const {

    MiddlewareBootstrapError

}
=
require("./errors");









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    failFast:

        true,



    enableDiagnostics:

        true



};









/**
 * Validate middleware factory
 */
function validateFactory(

    middleware

){



    if(

        typeof middleware.factory !==
        "function"

    ){



        throw new MiddlewareBootstrapError(

            "Middleware factory missing",

            {

                middleware:

                    middleware.name

            }

        );


    }








    return true;


}









/**
 * Registration Engine
 */
class MiddlewareRegistrationEngine {



    constructor(options = {}){


        this.options = {


            ...DEFAULT_CONFIG,


            ...options


        };




        this.registered = [];



    }









    /**
     * Create dependency injection container
     */
    createInjectionContext(

        context

    ){



        return {


            config:

                context.config || {},



            runtimeContext:

                context.runtimeContext || {},



            serviceRegistry:

                context.serviceRegistry || null,



            logger:

                context.logger || null,



            app:

                context.app || null



        };


    }









    /**
     * Initialize middleware
     */
    async initialize(

        middleware,

        context

    ){



        validateFactory(

            middleware

        );








        const injection =

            this.createInjectionContext(

                context

            );








        try {





            const instance =

                await middleware.factory(

                    injection

                );








            if(

                typeof instance !==
                "function"

            ){



                throw new MiddlewareBootstrapError(

                    "Middleware factory did not return function",

                    {

                        middleware:

                            middleware.name

                    }

                );


            }








            return instance;


        }


        catch(error){



            throw new MiddlewareBootstrapError(

                "Middleware initialization failed",

                {

                    middleware:

                        middleware.name,


                    error:

                        error.message

                }

            );


        }



    }









    /**
     * Attach middleware to Express
     */
    attach(

        app,

        middleware,

        instance

    ){



        try {





            app.use(

                instance

            );








            this.registered.push({

                name:

                    middleware.name,


                phase:

                    middleware.phase,


                priority:

                    middleware.priority || 0,


                attached:

                    true



            });








            return true;


        }


        catch(error){



            throw new MiddlewareBootstrapError(

                "Failed attaching middleware",

                {

                    middleware:

                        middleware.name,


                    error:

                        error.message

                }

            );


        }



    }









    /**
     * Register pipeline
     */
    async register(

        app,

        pipeline,

        context

    ){



        if(

            !app

        ){



            throw new MiddlewareBootstrapError(

                "Express application instance required"

            );


        }








        if(

            !Array.isArray(

                pipeline

            )

        ){



            throw new MiddlewareBootstrapError(

                "Middleware pipeline must be an array"

            );


        }








        for(

            const middleware of pipeline

        ){



            try {



                const instance =

                    await this.initialize(

                        middleware,

                        {

                            ...context,

                            app

                        }

                    );








                this.attach(

                    app,

                    middleware,

                    instance

                );








                /**
                 * Lifecycle event
                 */
                if(

                    context
                        ?.runtimeContext
                        ?.eventBus
                        ?.emit

                ){



                    context
                        .runtimeContext
                        .eventBus
                        .emit(

                            "middleware.registered",

                            {


                                name:

                                    middleware.name



                            }

                        );


                }








            }


            catch(error){



                if(

                    this.options.failFast

                ){



                    throw error;


                }








                if(

                    context.logger

                ){



                    context.logger.error(

                        {

                            error,

                            middleware:

                                middleware.name

                        },

                        "Middleware registration skipped"

                    );


                }


            }



        }








        return this.registered;


    }









    /**
     * Diagnostics
     */
    diagnostics(){



        return {


            count:

                this.registered.length,



            middleware:

                this.registered



        };


    }



}









/**
 * Factory
 */
function createRegistrationEngine(

    options

){



    return new MiddlewareRegistrationEngine(

        options

    );


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


    MiddlewareRegistrationEngine,


    createRegistrationEngine,


    validateFactory,


    healthCheck


};