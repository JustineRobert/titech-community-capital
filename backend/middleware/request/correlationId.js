"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Correlation ID Middleware
 *
 * Responsibilities:
 *
 * - Distributed request tracing
 * - Correlate services and events
 * - Preserve trace continuity
 * - Bind request metadata
 * - Support async operations
 *
 */



const crypto =
    require("crypto");


const {
    AsyncLocalStorage
}
=
require("async_hooks");



const {
    MiddlewareConfigurationError
}
=
require("../errors");








/**
 * Async request context storage
 *
 * Allows access from:
 *
 * - services
 * - repositories
 * - queues
 * - events
 */
const correlationStorage =
    new AsyncLocalStorage();









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    header:

        "X-Correlation-ID",



    allowIncoming:

        true,



    maxLength:

        128



};









/**
 * Generate correlation ID
 */
function generateCorrelationId(){



    return (

        "corr_" +

        Date.now()
            .toString(36)

        +

        "_"

        +

        crypto

            .randomBytes(18)

            .toString("hex")

    );


}









/**
 * Validate correlation ID
 */
function validateCorrelationId(

    value,

    maxLength

){



    if(
        typeof value !==
        "string"
    ){

        return false;

    }






    if(

        value.length === 0

        ||

        value.length >
        maxLength

    ){

        return false;

    }






    if(
        /[\r\n]/.test(value)
    ){

        return false;

    }





    return true;


}









/**
 * Retrieve current correlation context
 */
function getCorrelationContext(){



    return correlationStorage.getStore()

        ||

        null;


}









/**
 * Correlation middleware factory
 */
function correlationIdFactory(

    context = {}

){



    const {


        runtimeContext = {},

        config = {},

        logger = null


    } =
    context;






    const correlationConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.correlationId
            ||
            {}

        )



    };







    if(
        !correlationConfig.header
    ){


        throw new MiddlewareConfigurationError(

            "Correlation ID header missing"

        );


    }








    return function correlationIdMiddleware(

        req,

        res,

        next

    ){



        let correlationId;





        try {





            const incoming =

                req.headers[

                    correlationConfig
                        .header
                        .toLowerCase()

                ];








            /**
             * Preserve upstream correlation
             */
            if(

                correlationConfig.allowIncoming

                &&

                validateCorrelationId(

                    incoming,

                    correlationConfig.maxLength

                )

            ){


                correlationId =
                    incoming;


            }








            /**
             * Generate new correlation ID
             */
            if(
                !correlationId
            ){


                correlationId =
                    generateCorrelationId();


            }








            const correlationContext = {


                correlationId,



                requestId:

                    req.requestId
                    ||

                    req.id
                    ||

                    null,



                method:

                    req.method,



                path:

                    req.originalUrl,



                startedAt:

                    new Date(),



                tenantId:

                    req.tenantId
                    ||
                    null



            };








            /**
             * Response propagation
             */
            res.setHeader(

                correlationConfig.header,

                correlationId

            );








            /**
             * Attach request object
             */
            req.correlationId =
                correlationId;







            req.context = {


                ...(req.context || {}),



                correlationId



            };








            /**
             * Runtime Context integration
             */
            if(

                runtimeContext
                    ?.requestContext

            ){


                runtimeContext
                    .requestContext
                    .correlationId =

                        correlationId;


            }








            /**
             * Event bus integration
             */
            if(

                runtimeContext
                    ?.eventBus
                    ?.emit

            ){



                runtimeContext
                    .eventBus
                    .emit(

                        "request.correlation.created",

                        correlationContext

                    );


            }








            /**
             * Async context propagation
             */
            correlationStorage.run(

                correlationContext,

                ()=>{


                    if(logger){


                        logger.debug(

                            {

                                correlationId,


                                requestId:

                                    correlationContext
                                    .requestId


                            },

                            "Correlation ID assigned"

                        );


                    }



                    next();



                }

            );







        }


        catch(error){



            if(logger){


                logger.error(

                    {

                        error,

                        middleware:
                            "correlationId"

                    },

                    "Correlation ID middleware failure"

                );


            }



            next(error);



        }



    };


}









/**
 * Health check
 */
async function healthCheck(){


    return true;


}









/**
 * Middleware registration manifest
 */
module.exports = {


    name:

        "correlationId",




    version:

        "1.0.0",




    description:

        "Enterprise distributed correlation middleware",




    category:

        "request",




    phase:

        "request-context",




    priority:

        110,




    critical:

        true,




    dependencies:

        [

            "requestId"

        ],




    factory:

        correlationIdFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-observability",



            tags:

                [

                    "correlation",

                    "distributed-tracing",

                    "audit",

                    "observability"

                ]



        },





    /**
     * Export context accessor
     */
    getCorrelationContext



};