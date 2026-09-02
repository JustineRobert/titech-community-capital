"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise CORS Middleware
 *
 * Responsibilities:
 *
 * - Control cross-origin access
 * - Protect authenticated APIs
 * - Support frontend applications
 * - Support multi-tenant SaaS
 * - Provide secure browser communication
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Optional CORS dependency loader
 */
function loadCors(){



    try {


        return require("cors");


    }


    catch(error){



        throw new MiddlewareConfigurationError(

            "cors package is required",

            {

                package:

                    "cors",


                cause:

                    error.message

            }

        );


    }


}









/**
 * Default enterprise CORS policy
 */
const DEFAULT_CONFIG = {


    enabled:

        true,



    origin:

        [],



    credentials:

        true,



    methods:

        [

            "GET",

            "POST",

            "PUT",

            "PATCH",

            "DELETE",

            "OPTIONS"

        ],



    allowedHeaders:

        [

            "Authorization",

            "Content-Type",

            "X-Request-ID",

            "X-Correlation-ID",

            "X-Tenant-ID"

        ],



    exposedHeaders:

        [

            "X-Request-ID",

            "X-Correlation-ID"

        ],



    maxAge:

        86400



};









/**
 * Normalize origins
 */
function normalizeOrigins(

    origins

){



    if(
        !origins
    ){

        return [];

    }







    if(
        typeof origins ===
        "string"
    ){

        return [

            origins

        ];

    }







    if(
        Array.isArray(origins)
    ){

        return origins;

    }







    return [];



}









/**
 * Create dynamic origin validator
 */
function createOriginValidator(

    allowedOrigins,

    environment,

    logger

){



    return function originValidator(

        origin,

        callback

    ){



        /**
         * Allow non-browser clients
         *
         * Mobile apps, server integrations
         */
        if(
            !origin
        ){



            callback(

                null,

                true

            );


            return;


        }








        /**
         * Development convenience
         */
        if(

            environment !==
            "production"

            &&

            allowedOrigins.length === 0

        ){



            callback(

                null,

                true

            );


            return;


        }









        const allowed =

            allowedOrigins.includes(

                origin

            );









        if(
            !allowed
        ){



            if(logger){


                logger.warn(

                    {

                        origin

                    },

                    "CORS origin rejected"

                );


            }



            callback(

                new Error(

                    "Origin not allowed by CORS policy"

                )

            );



            return;


        }








        callback(

            null,

            true

        );



    };


}









/**
 * CORS middleware factory
 */
function corsFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;







    const cors =
        loadCors();








    const environment =

        runtimeContext
            .environment

        ||

        process.env.NODE_ENV

        ||

        "development";








    const corsConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.cors
            ||

            {}

        )



    };








    const allowedOrigins =

        normalizeOrigins(

            corsConfig.origin

        );









    const options = {


        origin:

            createOriginValidator(

                allowedOrigins,

                environment,

                logger

            ),



        credentials:

            corsConfig.credentials,



        methods:

            corsConfig.methods,



        allowedHeaders:

            corsConfig.allowedHeaders,



        exposedHeaders:

            corsConfig.exposedHeaders,



        maxAge:

            corsConfig.maxAge,



        optionsSuccessStatus:

            204



    };









    if(logger){



        logger.info(

            {

                environment,

                origins:

                    allowedOrigins


            },

            "Enterprise CORS configured"

        );


    }









    const middleware =
        cors(options);








    return function corsMiddleware(

        req,

        res,

        next

    ){



        try {



            req.trafficContext = {


                ...(req.trafficContext || {}),



                cors:

                    {


                        enabled:
                            true,


                        origin:
                            req.headers.origin
                            ||
                            null



                    }



            };








            middleware(

                req,

                res,

                next

            );





        }


        catch(error){



            if(logger){


                logger.error(

                    {

                        error,

                        middleware:
                            "cors"

                    },

                    "CORS middleware failure"

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
 * Middleware registry manifest
 */
module.exports = {


    name:

        "cors",




    version:

        "1.0.0",




    description:

        "Enterprise cross-origin resource sharing middleware",




    category:

        "traffic",




    phase:

        "traffic-control",




    priority:

        300,




    critical:

        true,




    dependencies:

        [

            "tracing"

        ],




    factory:

        corsFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "cors",

                    "security",

                    "api",

                    "browser"

                ]



        }



};