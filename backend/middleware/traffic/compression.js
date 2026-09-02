"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Compression Middleware
 *
 * Responsibilities:
 *
 * - Optimize HTTP responses
 * - Reduce bandwidth usage
 * - Improve mobile API performance
 * - Support scalable deployments
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Optional compression dependency loader
 */
function loadCompression(){



    try {


        return require(
            "compression"
        );


    }


    catch(error){



        throw new MiddlewareConfigurationError(

            "compression package required",

            {

                package:

                    "compression",

                cause:

                    error.message

            }

        );


    }


}









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    enabled:

        true,



    threshold:

        1024,



    level:

        6,



    brotli:

        true



};









/**
 * Content types suitable for compression
 */
const COMPRESSIBLE_TYPES = [


    "application/json",

    "application/javascript",

    "application/xml",

    "text/plain",

    "text/html",

    "text/css",

    "text/csv"



];









/**
 * Sensitive response paths
 *
 * Avoid compression where required
 */
const EXCLUDED_PATHS = [


    "/health",

    "/metrics"



];









/**
 * Check if response should compress
 */
function shouldCompress(

    req,

    res

){



    const path =
        req.originalUrl;






    if(

        EXCLUDED_PATHS.some(

            item =>

                path.startsWith(item)

        )

    ){

        return false;

    }








    const contentType =

        res.getHeader(
            "Content-Type"
        );








    if(
        !contentType
    ){

        return true;

    }








    return COMPRESSIBLE_TYPES.some(

        type =>

            contentType.includes(type)

    );



}









/**
 * Compression middleware factory
 */
function compressionFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    const compression =
        loadCompression();








    const compressionConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.compression

            ||

            {}

        )



    };









    if(

        compressionConfig.enabled === false

    ){



        return function disabledCompression(

            req,

            res,

            next

        ){

            next();


        };


    }









    const middleware =
        compression({




            threshold:

                compressionConfig.threshold,



            level:

                compressionConfig.level,









            filter:

                (

                    req,

                    res

                )=>{



                    return shouldCompress(

                        req,

                        res

                    );



                },









            brotli:

                compressionConfig.brotli

                ?

                {

                    enabled:true

                }

                :

                undefined





        });









    return function compressionMiddleware(

        req,

        res,

        next

    ){



        try {





            const originalSend =
                res.send;









            /**
             * Compression diagnostics
             */
            res.on(

                "finish",

                ()=>{



                    try {



                        const encoding =

                            res.getHeader(
                                "Content-Encoding"
                            );








                        if(logger){



                            logger.debug(

                                {


                                    requestId:

                                        req.requestId,



                                    correlationId:

                                        req.correlationId,



                                    encoding:



                                        encoding
                                        ||

                                        "identity"



                                },

                                "Response compression completed"

                            );


                        }








                        if(

                            runtimeContext
                                ?.eventBus
                                ?.emit

                        ){



                            runtimeContext
                                .eventBus
                                .emit(

                                    "http.compression.completed",

                                    {


                                        requestId:

                                            req.requestId,


                                        encoding

                                    }

                                );



                        }





                    }


                    catch(error){



                        if(logger){


                            logger.error(

                                {

                                    error,

                                    middleware:
                                        "compression"

                                },

                                "Compression diagnostics failure"

                            );


                        }



                    }



                }

            );









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
                            "compression"

                    },

                    "Compression middleware failure"

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

        "compression",




    version:

        "1.0.0",




    description:

        "Enterprise HTTP response compression middleware",




    category:

        "traffic",




    phase:

        "traffic-control",




    priority:

        320,




    critical:

        false,




    dependencies:

        [

            "rateLimiter"

        ],




    factory:

        compressionFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-performance",



            tags:

                [

                    "compression",

                    "performance",

                    "http",

                    "optimization"

                ]



        }



};