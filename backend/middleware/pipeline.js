"use strict";

/**
 * TITech Community Capital LTD
 * Enterprise Middleware Pipeline Manager
 *
 * Responsible for:
 *
 * - Resolving middleware execution order
 * - Dependency validation
 * - Phase execution
 * - Middleware installation
 * - Startup rollback
 * - Lifecycle management
 * - Health verification
 *
 */


const {
    MiddlewareBootstrapError
}
=
require("./errors");



class MiddlewarePipeline {



    constructor(

        registry,

        {

            timeout =
                30000,

            logger =
                null

        } = {}

    ){


        if(!registry){

            throw new MiddlewareBootstrapError(

                "Middleware registry required"

            );

        }



        this.registry =
            registry;



        this.timeout =
            timeout;



        this.logger =
            logger;



        this.executionHistory =
            [];



        this.installed =
            [];



        this.failed =
            [];



    }






    /**
     * Execute middleware pipeline
     */
    async execute(context = {}){


        const started =
            new Date();



        const executable =
            this.resolveExecutionOrder();



        const transaction = {

            started,

            installed: []

        };



        try {



            for(
                const middleware
                of executable
            ){



                await this.installMiddleware(

                    middleware,

                    context,

                    transaction

                );


            }



            this.executionHistory.push({

                status:
                    "completed",

                started,

                completed:
                    new Date(),

                installed:
                    transaction.installed


            });



            return transaction.installed;



        }


        catch(error){



            await this.rollback(

                transaction,

                context

            );



            this.executionHistory.push({

                status:
                    "failed",

                error:
                    error.message,


                timestamp:
                    new Date()


            });



            throw error;



        }



    }







    /**
     * Resolve execution order
     *
     * Dependency first
     * Then priority
     */
    resolveExecutionOrder(){



        const middleware =
            this.registry
                .getExecutable();



        return this.topologicalSort(

            middleware

        );



    }






    /**
     * Dependency graph ordering
     */
    topologicalSort(items){



        const result = [];

        const visited =
            new Set();


        const visiting =
            new Set();




        const lookup =
            new Map(

                items.map(

                    item =>

                    [

                        item.name,

                        item

                    ]

                )

            );






        const visit =
            (item)=>{


                if(
                    visited.has(
                        item.name
                    )
                ){

                    return;

                }




                if(
                    visiting.has(
                        item.name
                    )
                ){

                    throw new MiddlewareBootstrapError(

                        `Circular middleware dependency detected: ${item.name}`

                    );

                }




                visiting.add(
                    item.name
                );




                for(
                    const dependency
                    of item.dependencies
                ){



                    const dependencyItem =
                        lookup.get(
                            dependency
                        );



                    if(dependencyItem){

                        visit(
                            dependencyItem
                        );

                    }



                }




                visiting.delete(
                    item.name
                );



                visited.add(
                    item.name
                );



                result.push(
                    item
                );



            };





        items
            .sort(

                (a,b)=>

                    a.priority -
                    b.priority

            )
            .forEach(
                visit
            );



        return result;



    }







    /**
     * Install single middleware
     */
    async installMiddleware(

        middleware,

        context,

        transaction

    ){



        const started =
            Date.now();



        try {



            await this.executeHook(

                middleware,

                "beforeRegister",

                context

            );





            const instance =
                await this.withTimeout(

                    Promise.resolve(

                        middleware.factory(

                            context

                        )

                    ),

                    this.timeout,

                    middleware.name

                );







            if(
                typeof instance !==
                "function"
            ){


                throw new MiddlewareBootstrapError(

                    `Invalid middleware factory result: ${middleware.name}`

                );


            }





            context.app.use(
                instance
            );





            this.installed.push(

                middleware.name

            );



            transaction.installed.push(

                middleware.name

            );





            await this.executeHook(

                middleware,

                "afterRegister",

                context

            );






            await this.verifyHealth(

                middleware,

                context

            );






            this.executionHistory.push({

                middleware:
                    middleware.name,


                status:
                    "installed",


                duration:
                    Date.now() -
                    started,


                timestamp:
                    new Date()


            });







        }


        catch(error){



            this.failed.push({

                middleware:
                    middleware.name,


                error:
                    error.message,


                timestamp:
                    new Date()


            });





            if(
                middleware.critical
            ){


                throw new MiddlewareBootstrapError(

                    `Critical middleware failed: ${middleware.name}`,

                    {

                        cause:
                            error.message

                    }

                );


            }





            if(this.logger){


                this.logger.warn(

                    {

                        middleware:
                            middleware.name,

                        error

                    },

                    "Non-critical middleware skipped"

                );


            }





        }



    }








    /**
     * Execute lifecycle hook
     */
    async executeHook(

        middleware,

        hook,

        context

    ){



        const handler =
            middleware.hooks?.[hook];



        if(
            typeof handler ===
            "function"
        ){

            await handler(
                context
            );

        }



    }







    /**
     * Health verification
     */
    async verifyHealth(

        middleware,

        context

    ){



        if(
            typeof middleware.healthCheck !==
            "function"
        ){

            return;

        }



        const healthy =
            await middleware.healthCheck(

                context

            );



        if(
            healthy === false
        ){

            throw new MiddlewareBootstrapError(

                `Middleware health check failed: ${middleware.name}`

            );

        }



    }







    /**
     * Timeout wrapper
     */
    withTimeout(

        promise,

        timeout,

        name

    ){



        return Promise.race([


            promise,



            new Promise(

                (_,reject)=>

                    setTimeout(

                        ()=>reject(

                            new MiddlewareBootstrapError(

                                `Middleware timeout: ${name}`

                            )

                        ),

                        timeout

                    )

            )


        ]);



    }








    /**
     * Rollback installed middleware
     *
     * Express cannot physically remove
     * middleware easily, therefore we execute
     * shutdown hooks and cleanup handlers.
     */
    async rollback(

        transaction,

        context

    ){



        for(
            const name
            of transaction.installed.reverse()
        ){



            const middleware =
                this.registry.get(
                    name
                );



            if(
                middleware
                ?.hooks
                ?.onRollback
            ){



                try{


                    await middleware
                        .hooks
                        .onRollback(

                            context

                        );


                }

                catch(error){


                    if(this.logger){

                        this.logger.error(

                            error,

                            "Middleware rollback failure"

                        );

                    }


                }


            }


        }



    }







    /**
     * Shutdown pipeline
     */
    async shutdown(context){



        const installed =
            [
                ...this.installed
            ]
            .reverse();




        for(
            const name
            of installed
        ){



            const middleware =
                this.registry.get(
                    name
                );



            if(
                middleware
                ?.hooks
                ?.onShutdown
            ){



                await middleware
                    .hooks
                    .onShutdown(

                        context

                    );


            }



        }


    }







    /**
     * Diagnostics
     */
    diagnostics(){


        return {


            installed:
                this.installed,


            failed:
                this.failed,


            history:
                this.executionHistory


        };


    }



}



module.exports =
    MiddlewarePipeline;