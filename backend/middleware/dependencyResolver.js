"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Dependency Resolver
 *
 * Responsibilities:
 *
 * - Build middleware dependency graph
 * - Resolve startup ordering
 * - Detect dependency problems
 * - Generate execution plans
 *
 */



const {

    MiddlewareBootstrapError

}
=
require("./errors");









/**
 * Dependency Resolver
 */
class MiddlewareDependencyResolver {



    constructor(options = {}){


        this.options = {


            strict:

                true,



            allowOptional:

                true,



            ...options


        };




        this.nodes =
            new Map();




        this.sorted =
            [];



    }









    /**
     * Register middleware nodes
     */
    register(

        middlewareList = []

    ){



        for(

            const middleware of middlewareList

        ){



            if(

                !middleware.name

            ){

                throw new MiddlewareBootstrapError(

                    "Middleware missing name"

                );


            }








            this.nodes.set(

                middleware.name,

                {

                    ...middleware,


                    dependencies:

                        middleware.dependencies || []

                }

            );


        }








        return this;


    }









    /**
     * Validate dependencies
     */
    validateDependencies(){



        const errors = [];








        for(

            const [

                name,

                middleware

            ]

            of this.nodes

        ){



            for(

                const dependency of middleware.dependencies

            ){



                const optional =

                    dependency.endsWith("?");








                const dependencyName =

                    optional

                    ?

                    dependency.slice(

                        0,

                        -1

                    )

                    :

                    dependency;








                if(

                    !this.nodes.has(

                        dependencyName

                    )

                    &&

                    !optional

                ){



                    errors.push({

                        middleware:

                            name,


                        missingDependency:

                            dependencyName


                    });


                }



            }


        }








        if(

            errors.length

        ){



            throw new MiddlewareBootstrapError(

                "Missing middleware dependencies",

                {

                    errors

                }

            );


        }





        return true;


    }









    /**
     * Depth first dependency traversal
     */
    visit(

        name,

        temporary,

        permanent,

        result

    ){



        if(

            permanent.has(

                name

            )

        ){

            return;


        }








        if(

            temporary.has(

                name

            )

        ){



            throw new MiddlewareBootstrapError(

                "Circular middleware dependency detected",

                {

                    middleware:

                        name

                }

            );


        }








        temporary.add(

            name

        );








        const middleware =

            this.nodes.get(

                name

            );








        if(

            !middleware

        ){

            return;

        }








        for(

            const dependency of middleware.dependencies

        ){



            const optional =

                dependency.endsWith("?");








            const dependencyName =

                optional

                ?

                dependency.slice(

                    0,

                    -1

                )

                :

                dependency;








            if(

                this.nodes.has(

                    dependencyName

                )

            ){



                this.visit(

                    dependencyName,

                    temporary,

                    permanent,

                    result

                );


            }



        }








        temporary.delete(

            name

        );








        permanent.add(

            name

        );








        result.push(

            middleware

        );


    }









    /**
     * Resolve execution order
     */
    resolve(){



        this.validateDependencies();








        const temporary =
            new Set();




        const permanent =
            new Set();




        const result = [];








        for(

            const name of this.nodes.keys()

        ){



            this.visit(

                name,

                temporary,

                permanent,

                result

            );


        }








        this.sorted =

            result;








        return result;


    }









    /**
     * Find middleware dependencies
     */
    dependenciesOf(

        name

    ){



        const middleware =

            this.nodes.get(

                name

            );








        if(

            !middleware

        ){

            return [];

        }








        return middleware.dependencies;


    }









    /**
     * Generate pipeline plan
     */
    plan(){



        return this.sorted.map(

            middleware => ({


                name:

                    middleware.name,



                phase:

                    middleware.phase || "default",



                priority:

                    middleware.priority || 0,



                dependencies:

                    middleware.dependencies || [],



                critical:

                    Boolean(

                        middleware.critical

                    )



            })

        );


    }









    /**
     * Diagnostics
     */
    diagnostics(){



        return {


            registered:

                this.nodes.size,



            resolved:

                this.sorted.length,



            pipeline:

                this.sorted.map(

                    middleware =>

                        middleware.name

                )



        };


    }



}









/**
 * Factory
 */
function createDependencyResolver(

    options

){



    return new MiddlewareDependencyResolver(

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


    MiddlewareDependencyResolver,


    createDependencyResolver,


    healthCheck


};