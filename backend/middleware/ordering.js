"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Ordering Engine
 *
 * Responsibilities:
 *
 * - Build deterministic middleware order
 * - Enforce execution phases
 * - Resolve priority conflicts
 * - Prepare Express pipeline sequence
 *
 */



const {

    MiddlewareBootstrapError

}
=
require("./errors");









/**
 * Enterprise middleware phases
 *
 * Lower number executes first
 */
const PHASE_ORDER = {


    bootstrap:

        10,



    security:

        20,



    request:

        30,



    observability:

        40,



    traffic:

        50,



    "request-context":

        60,



    authorization:

        70,



    routes:

        80,



    error:

        100



};









/**
 * Default priority values
 */
const DEFAULT_PRIORITY = {


    first:

        0,



    normal:

        500,



    last:

        1000



};









/**
 * Normalize middleware priority
 */
function normalizePriority(

    middleware

){



    if(

        typeof middleware.priority ===

        "number"

    ){

        return middleware.priority;


    }








    return DEFAULT_PRIORITY.normal;


}









/**
 * Normalize phase weight
 */
function getPhaseWeight(

    middleware

){



    return (

        PHASE_ORDER[

            middleware.phase

        ]

        ||

        PHASE_ORDER.request

    );


}









/**
 * Validate middleware item
 */
function validateMiddleware(

    middleware

){



    if(

        !middleware.name

    ){

        throw new MiddlewareBootstrapError(

            "Middleware missing name"

        );


    }








    return true;


}









/**
 * Stable middleware comparison
 */
function compareMiddleware(

    a,

    b

){



    const phaseDifference =


        getPhaseWeight(a)

        -

        getPhaseWeight(b);








    if(

        phaseDifference !== 0

    ){

        return phaseDifference;


    }








    const priorityDifference =


        normalizePriority(a)

        -

        normalizePriority(b);








    if(

        priorityDifference !== 0

    ){

        return priorityDifference;


    }








    /**
     * Stable alphabetical fallback
     */
    return a.name.localeCompare(

        b.name

    );


}









/**
 * Check ordering conflicts
 */
function validateOrdering(

    middlewareList

){



    const names =

        new Set();








    for(

        const middleware of middlewareList

    ){



        validateMiddleware(

            middleware

        );








        if(

            names.has(

                middleware.name

            )

        ){



            throw new MiddlewareBootstrapError(

                "Duplicate middleware in ordering pipeline",

                {

                    name:

                        middleware.name

                }

            );


        }








        names.add(

            middleware.name

        );


    }








    return true;


}









/**
 * Middleware Ordering Engine
 */
class MiddlewareOrderingEngine {



    constructor(options = {}){


        this.options = {


            enforceSecurityFirst:

                true,



            enforceContextOrder:

                true,



            ...options


        };




        this.pipeline = [];



    }









    /**
     * Order middleware
     */
    order(

        middlewareList = []

    ){



        validateOrdering(

            middlewareList

        );








        const ordered =

            [...middlewareList]

            .sort(

                compareMiddleware

            );








        this.pipeline =

            this.applyEnterpriseRules(

                ordered

            );








        return this.pipeline;


    }









    /**
     * Apply enterprise rules
     */
    applyEnterpriseRules(

        pipeline

    ){



        let result =

            [...pipeline];








        /**
         * Security always first
         */
        if(

            this.options.enforceSecurityFirst

        ){



            result =

                result.sort(

                    (

                        a,

                        b

                    )=>{



                        if(

                            a.phase ===

                            "security"

                        ){

                            return -1;

                        }








                        if(

                            b.phase ===

                            "security"

                        ){

                            return 1;

                        }








                        return compareMiddleware(

                            a,

                            b

                        );


                    }

                );


        }








        /**
         * Context dependency order
         */
        if(

            this.options.enforceContextOrder

        ){



            result =

                this.enforceContextSequence(

                    result

                );


        }








        return result;


    }









    /**
     * Ensure runtime context order
     */
    enforceContextSequence(

        pipeline

    ){



        const preferredOrder = [


            "requestContext",


            "tenantContext",


            "userContext",


            "authorizationContext",


            "featureContext"



        ];








        const weight =

            name => {


                const index =

                    preferredOrder.indexOf(

                        name

                    );



                return index === -1

                    ?

                    999

                    :

                    index;



            };








        return pipeline.sort(

            (

                a,

                b

            )=>{



                if(

                    weight(a.name)

                    !==

                    weight(b.name)

                ){

                    return (

                        weight(a.name)

                        -

                        weight(b.name)

                    );


                }








                return compareMiddleware(

                    a,

                    b

                );


            }

        );


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


            count:

                this.pipeline.length,



            middleware:

                this.pipeline.map(

                    item => ({


                        name:

                            item.name,


                        phase:

                            item.phase,


                        priority:

                            item.priority



                    })

                )



        };


    }



}









/**
 * Factory
 */
function createOrderingEngine(

    options

){



    return new MiddlewareOrderingEngine(

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


    MiddlewareOrderingEngine,


    createOrderingEngine,


    PHASE_ORDER,


    DEFAULT_PRIORITY,


    validateOrdering,


    healthCheck


};