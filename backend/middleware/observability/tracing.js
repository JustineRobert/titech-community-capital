"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Distributed Tracing Middleware
 *
 * Responsibilities:
 *
 * - Create HTTP trace spans
 * - Integrate OpenTelemetry
 * - Propagate trace context
 * - Correlate business operations
 * - Support fintech observability
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Optional OpenTelemetry loader
 */
function loadTracingDependencies(){



    try {



        const api =
            require("@opentelemetry/api");



        return {


            api


        };


    }


    catch(error){



        return null;


    }


}









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    enabled:

        true,



    serviceName:

        "titech-community-capital-api",



    captureHeaders:

        false



};









/**
 * Trace context accessor
 */
let tracingApi = null;









/**
 * Initialize tracing
 */
function initializeTracing(

    config,

    logger

){



    const dependencies =
        loadTracingDependencies();






    if(
        !dependencies
    ){



        if(logger){


            logger.warn(

                "OpenTelemetry not installed, tracing disabled"

            );


        }



        return null;


    }








    tracingApi =
        dependencies.api;






    return tracingApi;


}









/**
 * Extract current trace information
 */
function getTraceMetadata(

){



    if(
        !tracingApi
    ){

        return null;

    }







    const span =

        tracingApi
            .trace
            .getActiveSpan();







    if(
        !span
    ){

        return null;

    }







    const context =

        span
            .spanContext();







    return {


        traceId:

            context.traceId,



        spanId:

            context.spanId



    };


}









/**
 * Tracing middleware factory
 */
function tracingFactory(

    context = {}

){



    const {


        logger,

        runtimeContext = {},

        config = {}


    } =
    context;







    const tracingConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.tracing
            ||
            {}

        )



    };








    if(
        tracingConfig.enabled === false
    ){


        return function disabledTracing(

            req,

            res,

            next

        ){

            next();


        };


    }








    const api =
        initializeTracing(

            tracingConfig,

            logger

        );









    /**
     * Graceful mode:
     *
     * Application continues
     * without tracing.
     */
    if(
        !api
    ){


        return function tracingDisabled(

            req,

            res,

            next

        ){


            req.traceContext = {


                enabled:

                    false


            };



            next();



        };


    }









    return function tracingMiddleware(

        req,

        res,

        next

    ){



        try {





            const tracer =

                api.trace.getTracer(

                    tracingConfig
                        .serviceName

                );








            const span =

                tracer.startSpan(

                    `${req.method} ${req.path}`,

                    {


                        attributes:

                            {


                                "http.method":

                                    req.method,



                                "http.route":

                                    req.path,



                                "http.url":

                                    req.originalUrl,



                                "request.id":

                                    req.requestId
                                    ||
                                    null,



                                "correlation.id":

                                    req.correlationId
                                    ||
                                    null,



                                "tenant.id":

                                    req.requestContext
                                    ?.tenant
                                    ?.tenantId

                                    ||
                                    null



                            }


                    }

                );








            /**
             * Attach trace context
             */
            req.traceContext = {


                enabled:

                    true,



                span


            };









            res.on(

                "finish",

                ()=>{





                    try {





                        span.setAttribute(

                            "http.status_code",

                            res.statusCode

                        );








                        if(

                            res.statusCode >= 400

                        ){



                            span.recordException(

                                new Error(

                                    `HTTP ${res.statusCode}`

                                )

                            );



                        }








                        span.end();








                        const trace =

                            span.spanContext();








                        const metadata = {


                            traceId:

                                trace.traceId,



                            spanId:

                                trace.spanId,



                            requestId:

                                req.requestId,



                            correlationId:

                                req.correlationId



                        };









                        /**
                         * Runtime event
                         */
                        if(

                            runtimeContext
                            ?.eventBus
                            ?.emit

                        ){



                            runtimeContext
                                .eventBus
                                .emit(

                                    "trace.completed",

                                    metadata

                                );


                        }






                    }


                    catch(error){



                        if(logger){


                            logger.error(

                                {

                                    error,

                                    middleware:
                                        "tracing"

                                },

                                "Trace completion failure"

                            );


                        }



                    }



                }

            );








            next();





        }


        catch(error){



            if(logger){


                logger.error(

                    {

                        error,

                        middleware:
                            "tracing"

                    },

                    "Tracing middleware failure"

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

            "healthy",



        tracing:

            Boolean(

                tracingApi

            )


    };


}









/**
 * Middleware registry manifest
 */
module.exports = {


    name:

        "tracing",




    version:

        "1.0.0",




    description:

        "Enterprise distributed tracing middleware",




    category:

        "observability",




    phase:

        "observability",




    priority:

        220,




    critical:

        false,




    dependencies:

        [

            "metrics"

        ],




    factory:

        tracingFactory,




    healthCheck,




    getTraceMetadata,




    metadata:

        {


            owner:

                "platform-observability",



            tags:

                [

                    "tracing",

                    "opentelemetry",

                    "distributed-systems",

                    "sre"

                ]



        }



};