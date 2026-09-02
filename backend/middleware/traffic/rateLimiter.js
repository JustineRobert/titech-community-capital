"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Rate Limiter Middleware
 *
 * Responsibilities:
 *
 * - Protect API resources
 * - Prevent abuse
 * - Support distributed deployments
 * - Support tenant isolation
 * - Protect financial workflows
 *
 */



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Optional dependency loader
 */
function loadRateLimiter(){



    try {


        return require(
            "express-rate-limit"
        );


    }


    catch(error){



        throw new MiddlewareConfigurationError(

            "express-rate-limit package required",

            {

                package:
                    "express-rate-limit",

                cause:
                    error.message

            }

        );


    }


}









/**
 * Optional Redis store loader
 */
function loadRedisStore(){



    try {


        return require(
            "rate-limit-redis"
        );


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



    windowMs:

        15 * 60 * 1000,



    max:

        300,



    standardHeaders:

        true,



    legacyHeaders:

        false,



    skipHealthChecks:

        true



};









/**
 * Determine limiter key
 *
 * Priority:
 *
 * 1. Authenticated user
 * 2. Tenant
 * 3. IP
 */
function resolveClientKey(

    req

){



    if(
        req.user
        ?.id
    ){

        return (

            "user:" +

            req.user.id

        );


    }








    if(
        req.tenantId
    ){

        return (

            "tenant:" +

            req.tenantId

        );


    }








    return (

        "ip:" +

        (

            req.ip

            ||

            req.socket
                ?.remoteAddress

        )

    );



}









/**
 * Endpoint policy resolver
 */
function resolveEndpointPolicy(

    req,

    config

){



    const policies =

        config.policies
        ||

        {};







    for(
        const route of Object.keys(
            policies
        )
    ){



        if(
            req.path.startsWith(
                route
            )
        ){

            return policies[route];

        }


    }







    return {

        windowMs:

            config.windowMs,


        max:

            config.max


    };


}









/**
 * Rate limiter factory
 */
function rateLimiterFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;







    const limiter =
        loadRateLimiter();







    const rateConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.rateLimiter

            ||

            {}

        )



    };








    if(
        rateConfig.enabled === false
    ){



        return function disabledRateLimiter(

            req,

            res,

            next

        ){

            next();


        };


    }








    let store = null;








    /**
     * Redis support
     */
    if(

        rateConfig.redis

        &&

        runtimeContext
            ?.redis

    ){



        const RedisStore =
            loadRedisStore();







        if(
            RedisStore
        ){



            store =
                new RedisStore({

                    sendCommand:

                        (...args)=>

                            runtimeContext
                                .redis
                                .call(

                                    ...args

                                )


                });



        }



    }









    const middleware =
        limiter({




            windowMs:

                rateConfig.windowMs,



            max:

                rateConfig.max,



            standardHeaders:

                rateConfig.standardHeaders,



            legacyHeaders:

                rateConfig.legacyHeaders,



            store,








            keyGenerator:

                resolveClientKey,








            skip:

                req => {



                    if(

                        rateConfig.skipHealthChecks

                        &&

                        req.path.startsWith(
                            "/health"
                        )

                    ){

                        return true;


                    }





                    return false;


                },









            handler:

                (req,res)=>{





                    if(logger){


                        logger.warn(

                            {

                                requestId:

                                    req.requestId,


                                correlationId:

                                    req.correlationId,


                                key:

                                    resolveClientKey(
                                        req
                                    ),


                                path:

                                    req.path


                            },

                            "Rate limit exceeded"

                        );


                    }








                    res.status(429)

                    .json({

                        success:false,


                        message:

                            "Too many requests, please retry later",



                        requestId:

                            req.requestId,



                        correlationId:

                            req.correlationId


                    });


                }






        });









    return function rateLimiterMiddleware(

        req,

        res,

        next

    ){



        try {





            const policy =

                resolveEndpointPolicy(

                    req,

                    rateConfig

                );









            req.trafficContext = {


                ...(req.trafficContext || {}),



                rateLimit:

                    {


                        policy


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
                            "rateLimiter"

                    },

                    "Rate limiter failure"

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

        "rateLimiter",




    version:

        "1.0.0",




    description:

        "Enterprise distributed API rate limiting middleware",




    category:

        "traffic",




    phase:

        "traffic-control",




    priority:

        310,




    critical:

        true,




    dependencies:

        [

            "cors"

        ],




    factory:

        rateLimiterFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "security",

                    "rate-limit",

                    "redis",

                    "abuse-prevention"

                ]



        }



};