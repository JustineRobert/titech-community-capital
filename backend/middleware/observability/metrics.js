"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Metrics Middleware
 *
 * Responsibilities:
 *
 * - Collect HTTP metrics
 * - Expose Prometheus-compatible data
 * - Track API performance
 * - Support fintech observability
 * - Support operational dashboards
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Optional Prometheus dependency loader
 */
function loadPromClient(){



    try {


        return require("prom-client");


    }


    catch(error){



        return null;


    }


}









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    collectDefaultMetrics:

        true,



    includeRouteLabels:

        true,



    includeTenantLabels:

        false



};









/**
 * Internal metrics registry
 */
const metricsState = {


    initialized:

        false,


    registry:

        null,


    httpRequests:

        null,


    httpDuration:

        null,


    httpErrors:

        null



};









/**
 * Initialize metrics
 */
function initializeMetrics(

    config = {},

    logger

){



    if(
        metricsState.initialized
    ){

        return metricsState;

    }






    const client =
        loadPromClient();







    if(
        !client
    ){



        if(logger){


            logger.warn(

                "prom-client not installed, metrics disabled"

            );


        }



        return metricsState;


    }









    const registry =

        new client.Registry();








    if(

        config.collectDefaultMetrics !== false

    ){



        client.collectDefaultMetrics({

            register:

                registry


        });



    }









    metricsState.registry =
        registry;







    metricsState.httpRequests =

        new client.Counter({



            name:

                "http_requests_total",



            help:

                "Total HTTP requests",



            labelNames:

                [

                    "method",

                    "route",

                    "status"

                ],



            registers:

                [

                    registry

                ]


        });








    metricsState.httpDuration =

        new client.Histogram({



            name:

                "http_request_duration_seconds",



            help:

                "HTTP request duration",



            labelNames:

                [

                    "method",

                    "route"

                ],



            buckets:

                [

                    0.005,

                    0.01,

                    0.05,

                    0.1,

                    0.5,

                    1,

                    5

                ],



            registers:

                [

                    registry

                ]


        });








    metricsState.httpErrors =

        new client.Counter({



            name:

                "http_errors_total",



            help:

                "HTTP errors by status",



            labelNames:

                [

                    "method",

                    "route",

                    "status"

                ],



            registers:

                [

                    registry

                ]



        });









    metricsState.initialized =
        true;







    return metricsState;


}









/**
 * Metrics middleware factory
 */
function metricsFactory(

    context = {}

){



    const {


        logger,

        runtimeContext = {},

        config = {}


    } =
    context;







    const metricsConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.metrics
            ||
            {}

        )



    };








    const metrics =
        initializeMetrics(

            metricsConfig,

            logger

        );








    return function metricsMiddleware(

        req,

        res,

        next

    ){



        const startTime =
            process.hrtime();








        res.on(

            "finish",

            ()=>{



                try {






                    if(

                        !metrics.initialized

                    ){

                        return;

                    }









                    const duration =

                        process.hrtime(

                            startTime

                        );






                    const seconds =

                        duration[0]

                        +

                        duration[1]

                        /

                        1e9;








                    const route =


                        req.route
                        ?.path

                        ||

                        req.originalUrl;









                    metrics.httpRequests
                        .labels(

                            req.method,

                            route,

                            String(

                                res.statusCode

                            )

                        )

                        .inc();








                    metrics.httpDuration
                        .labels(

                            req.method,

                            route

                        )

                        .observe(

                            seconds

                        );









                    if(

                        res.statusCode >= 400

                    ){



                        metrics.httpErrors
                            .labels(

                                req.method,

                                route,

                                String(

                                    res.statusCode

                                )

                            )

                            .inc();



                    }









                    /**
                     * Runtime event hook
                     */
                    if(

                        runtimeContext
                        ?.eventBus
                        ?.emit

                    ){



                        runtimeContext
                            .eventBus
                            .emit(

                                "metrics.http.recorded",

                                {

                                    method:

                                        req.method,


                                    route,


                                    status:

                                        res.statusCode,


                                    duration:

                                        seconds


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
                                    "metrics"

                            },

                            "Metrics collection failure"

                        );


                    }



                }



            }

        );








        next();



    };


}









/**
 * Metrics registry accessor
 */
function getMetricsRegistry(){


    return (

        metricsState
            .registry

        ||

        null

    );


}









/**
 * Health check
 */
async function healthCheck(){


    return {


        status:

            "healthy",


        initialized:

            metricsState.initialized


    };


}









/**
 * Middleware registry manifest
 */
module.exports = {


    name:

        "metrics",




    version:

        "1.0.0",




    description:

        "Enterprise Prometheus metrics middleware",




    category:

        "observability",




    phase:

        "observability",




    priority:

        210,




    critical:

        false,




    dependencies:

        [

            "httpLogger"

        ],




    factory:

        metricsFactory,




    healthCheck,




    getMetricsRegistry,




    metadata:

        {


            owner:

                "platform-observability",



            tags:

                [

                    "metrics",

                    "prometheus",

                    "monitoring",

                    "sre"

                ]



        }



};