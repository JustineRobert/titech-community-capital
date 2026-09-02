"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise HTTP Logger Middleware
 *
 * Responsibilities:
 *
 * - Capture HTTP request lifecycle events
 * - Produce structured logs
 * - Correlate requests
 * - Support observability pipelines
 * - Support audit investigations
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


    includeHeaders:

        false,



    includeBody:

        false,



    slowRequestThreshold:

        1000,



    logHealthChecks:

        false



};









/**
 * Sensitive headers removed
 */
const SENSITIVE_HEADERS = [


    "authorization",

    "cookie",

    "set-cookie",

    "x-api-key"



];









/**
 * Sanitize headers
 */
function sanitizeHeaders(

    headers

){



    const result = {};




    Object.entries(
        headers
    )
    .forEach(

        ([key,value])=>{


            if(

                SENSITIVE_HEADERS.includes(

                    key.toLowerCase()

                )

            ){

                result[key] =
                    "[REDACTED]";


                return;

            }





            result[key] =
                value;



        }

    );





    return result;


}









/**
 * Determine log level
 */
function resolveLogLevel(

    statusCode

){



    if(
        statusCode >= 500
    ){

        return "error";

    }






    if(
        statusCode >= 400
    ){

        return "warn";

    }






    return "info";


}









/**
 * HTTP Logger Factory
 */
function httpLoggerFactory(

    context = {}

){



    const {


        logger,

        runtimeContext = {},

        config = {}


    } =
    context;







    if(
        !logger
    ){

        throw new MiddlewareConfigurationError(

            "Logger dependency required for httpLogger middleware"

        );

    }









    const loggerConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.httpLogger
            ||
            {}

        )



    };








    return function httpLoggerMiddleware(

        req,

        res,

        next

    ){



        const startTime =
            process.hrtime.bigint();






        const startedAt =
            new Date();








        const requestContext =

            req.requestContext
            ||

            {};









        /**
         * Request started log
         */
        if(

            loggerConfig.logHealthChecks

            ||

            !req.originalUrl.startsWith(
                "/health"
            )

        ){



            logger.debug(

                {


                    event:

                        "http.request.started",




                    requestId:

                        req.requestId,




                    correlationId:

                        req.correlationId,




                    method:

                        req.method,




                    path:

                        req.originalUrl,




                    ip:

                        req.clientInfo
                        ?.ip,




                    tenantId:

                        requestContext
                        ?.tenant
                        ?.tenantId



                },

                "HTTP request started"

            );



        }









        /**
         * Response completion handler
         */
        res.on(

            "finish",

            ()=>{





                const duration =

                    Number(

                        process.hrtime.bigint()

                    -

                        startTime

                    )

                    /

                    1000000;







                const logPayload = {




                    event:

                        "http.request.completed",




                    requestId:

                        req.requestId,




                    correlationId:

                        req.correlationId,




                    method:

                        req.method,




                    path:

                        req.originalUrl,




                    statusCode:

                        res.statusCode,




                    durationMs:

                        Number(

                            duration.toFixed(2)

                        ),




                    startedAt,




                    completedAt:

                        new Date(),




                    tenantId:

                        requestContext
                        ?.tenant
                        ?.tenantId
                        ||

                        null,




                    userId:

                        requestContext
                        ?.user
                        ?.userId
                        ||

                        null,




                    client:

                        req.clientInfo
                        || 
                        null



                };









                if(

                    loggerConfig.includeHeaders

                ){



                    logPayload.headers =

                        sanitizeHeaders(

                            req.headers

                        );


                }









                const level =

                    resolveLogLevel(

                        res.statusCode

                    );









                if(

                    duration >

                    loggerConfig
                        .slowRequestThreshold

                ){



                    logPayload.slowRequest =
                        true;



                }









                logger[level](

                    logPayload,

                    "HTTP request completed"

                );








                /**
                 * Runtime metrics hook
                 */
                if(

                    runtimeContext
                    ?.eventBus
                    ?.emit

                ){



                    runtimeContext
                        .eventBus
                        .emit(

                            "http.request.completed",

                            logPayload

                        );



                }





            }

        );









        next();



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

        "httpLogger",




    version:

        "1.0.0",




    description:

        "Enterprise HTTP structured logging middleware",




    category:

        "observability",




    phase:

        "observability",




    priority:

        200,




    critical:

        true,




    dependencies:

        [

            "clientInfo"

        ],




    factory:

        httpLoggerFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-observability",



            tags:

                [

                    "logging",

                    "audit",

                    "metrics",

                    "tracing"

                ]



        }



};