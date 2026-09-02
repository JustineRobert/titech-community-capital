"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Request ID Middleware
 *
 * Responsibilities:
 *
 * - Generate unique request identifiers
 * - Preserve upstream request IDs
 * - Prevent request spoofing
 * - Support distributed tracing
 * - Attach request identity context
 * - Integrate with runtime context
 *
 */



const crypto =
    require("crypto");



const {
    MiddlewareConfigurationError
}
=
require("../errors");







/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    header:

        "X-Request-ID",



    allowIncoming:

        true,



    maxLength:

        128



};









/**
 * Generate enterprise request ID
 *
 * Format:
 *
 * req_<timestamp>_<random>
 */
function generateRequestId(){



    const timestamp =
        Date.now()
        .toString(36);




    const random =
        crypto

            .randomBytes(16)

            .toString("hex");





    return (

        "req_" +

        timestamp +

        "_" +

        random

    );


}









/**
 * Validate incoming request ID
 */
function validateRequestId(

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






    /**
     * Prevent header injection
     */
    if(
        /[\r\n]/.test(value)
    ){

        return false;

    }






    return true;


}









/**
 * Request ID middleware factory
 */
function requestIdFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;






    const requestConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.requestId
            ||
            {}

        )



    };







    if(
        !requestConfig.header
    ){


        throw new MiddlewareConfigurationError(

            "Request ID header configuration missing"

        );


    }









    return function requestIdMiddleware(

        req,

        res,

        next

    ){



        try {





            let requestId = null;







            /**
             * Accept upstream ID only
             * when explicitly allowed.
             */
            if(

                requestConfig.allowIncoming

                &&

                validateRequestId(

                    req.headers[

                        requestConfig.header
                            .toLowerCase()

                    ],

                    requestConfig.maxLength

                )

            ){



                requestId =

                    req.headers[

                        requestConfig.header
                            .toLowerCase()

                    ];



            }









            /**
             * Generate internal ID
             */
            if(
                !requestId
            ){


                requestId =
                    generateRequestId();


            }









            /**
             * Attach request identity
             */
            req.id =
                requestId;





            req.requestId =
                requestId;








            /**
             * Response propagation
             */
            res.setHeader(

                requestConfig.header,

                requestId

            );









            /**
             * Runtime request context
             */
            req.context = {


                ...(req.context || {}),



                requestId,



                startedAt:

                    new Date(),



                environment:

                    runtimeContext
                        .environment

                    ||

                    process.env.NODE_ENV



            };








            /**
             * Expose for logging
             */
            if(
                runtimeContext
                ?.requestContext
            ){



                runtimeContext
                    .requestContext
                    .requestId =
                        requestId;


            }








            if(logger){


                logger.debug(

                    {

                        requestId,

                        method:
                            req.method,


                        path:
                            req.originalUrl


                    },

                    "Request ID assigned"

                );


            }







            next();





        }


        catch(error){



            if(logger){


                logger.error(

                    {

                        error,

                        middleware:
                            "requestId"

                    },

                    "Request ID middleware failure"

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

        "requestId",




    version:

        "1.0.0",




    description:

        "Enterprise request identity middleware",




    category:

        "request",




    phase:

        "request-context",




    priority:

        100,




    critical:

        true,




    dependencies:

        [],




    factory:

        requestIdFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-observability",



            tags:

                [

                    "request",

                    "trace",

                    "audit",

                    "observability"

                ]



        }



};