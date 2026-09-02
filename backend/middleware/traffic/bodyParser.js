"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Body Parser Middleware
 *
 * Responsibilities:
 *
 * - Safely parse incoming payloads
 * - Protect API resources
 * - Support payment webhooks
 * - Prevent malformed requests
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    jsonLimit:

        "1mb",



    urlEncodedLimit:

        "1mb",



    extended:

        false,



    preserveRawBody:

        false



};









/**
 * Optional express dependency validation
 */
function validateExpress(){



    if(

        typeof require("express")
            .json !==
            "function"

    ){



        throw new MiddlewareConfigurationError(

            "Express JSON parser unavailable"

        );


    }


}









/**
 * Protected object keys
 */
const BLOCKED_KEYS = [


    "__proto__",


    "prototype",


    "constructor"



];









/**
 * Detect prototype pollution
 */
function containsUnsafeKeys(

    value

){



    if(
        !value
    ){

        return false;

    }








    if(

        typeof value !==
        "object"

    ){

        return false;

    }








    for(
        const key of Object.keys(value)
    ){



        if(
            BLOCKED_KEYS.includes(key)
        ){

            return true;

        }







        if(

            typeof value[key] ===
            "object"

            &&

            containsUnsafeKeys(

                value[key]

            )

        ){

            return true;

        }



    }







    return false;


}









/**
 * Body parser factory
 */
function bodyParserFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    validateExpress();







    const express =
        require("express");








    const parserConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.bodyParser

            ||

            {}

        )



    };








    /**
     * JSON parser
     */
    const jsonParser =

        express.json({

            limit:

                parserConfig.jsonLimit,



            strict:

                true,



            verify:

                parserConfig.preserveRawBody

                ?

                function verifyRawBody(

                    req,

                    res,

                    buffer

                ){



                    req.rawBody =
                        buffer;



                }

                :

                undefined



        });









    /**
     * URL encoded parser
     */
    const urlEncodedParser =

        express.urlencoded({

            limit:

                parserConfig.urlEncodedLimit,



            extended:

                parserConfig.extended



        });









    return function bodyParserMiddleware(

        req,

        res,

        next

    ){



        try {





            /**
             * JSON parsing
             */
            jsonParser(

                req,

                res,

                function jsonCompleted(error){





                    if(error){



                        return next(error);


                    }







                    /**
                     * Prototype pollution protection
                     */
                    if(

                        containsUnsafeKeys(

                            req.body

                        )

                    ){



                        const securityError =

                            new Error(

                                "Unsafe request payload detected"

                            );



                        securityError.statusCode =
                            400;



                        return next(
                            securityError
                        );



                    }








                    /**
                     * URL encoded parsing
                     */
                    urlEncodedParser(

                        req,

                        res,

                        function urlCompleted(

                            urlError

                        ){



                            if(urlError){



                                return next(
                                    urlError
                                );


                            }








                            req.trafficContext = {


                                ...(req.trafficContext || {}),



                                bodyParser:

                                    {


                                        parsed:

                                            true,


                                        rawBody:

                                            Boolean(

                                                req.rawBody

                                            )


                                    }



                            };









                            /**
                             * Runtime lifecycle event
                             */
                            if(

                                runtimeContext
                                    ?.eventBus
                                    ?.emit

                            ){



                                runtimeContext
                                    .eventBus
                                    .emit(

                                        "request.body.parsed",

                                        {


                                            requestId:

                                                req.requestId,


                                            size:

                                                req.headers[
                                                    "content-length"
                                                ]

                                                ||

                                                0


                                        }

                                    );



                            }








                            next();



                        }

                    );





                }

            );





        }


        catch(error){



            if(logger){


                logger.error(

                    {

                        error,

                        middleware:
                            "bodyParser"

                    },

                    "Body parser middleware failure"

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


    return {


        status:

            "healthy"


    };


}









/**
 * Middleware registry manifest
 */
module.exports = {


    name:

        "bodyParser",




    version:

        "1.0.0",




    description:

        "Enterprise secure HTTP request body parser middleware",




    category:

        "traffic",




    phase:

        "traffic-control",




    priority:

        330,




    critical:

        true,




    dependencies:

        [

            "compression"

        ],




    factory:

        bodyParserFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "payload",

                    "security",

                    "webhooks",

                    "api"

                ]



        }



};