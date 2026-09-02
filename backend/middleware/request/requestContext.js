"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Request Context Middleware
 *
 * Responsibilities:
 *
 * - Build immutable request execution context
 * - Propagate request metadata
 * - Support tenant isolation
 * - Support audit and ledger tracing
 * - Provide async context access
 *
 */



const {

    AsyncLocalStorage

}
=
require("async_hooks");



const crypto =
    require("crypto");



const {

    MiddlewareConfigurationError

}
=
require("../errors");









/**
 * Async context storage
 *
 * Allows access from:
 *
 * - services
 * - repositories
 * - jobs
 * - events
 */
const requestContextStorage =
    new AsyncLocalStorage();









/**
 * Context version
 */
const CONTEXT_VERSION =
    "1.0";









/**
 * Generate context identifier
 */
function generateContextId(){


    return (

        "ctx_"

        +

        crypto

            .randomBytes(12)

            .toString("hex")

    );


}









/**
 * Freeze context recursively
 */
function freezeContext(

    object

){



    Object.freeze(
        object
    );



    return object;


}









/**
 * Get current request context
 */
function getRequestContext(){


    return (

        requestContextStorage
            .getStore()

        ||

        null

    );


}









/**
 * Request context factory
 */
function requestContextFactory(

    context = {}

){



    const {


        runtimeContext = {},

        logger = null,

        config = {}


    } =
    context;







    if(
        !runtimeContext
    ){

        throw new MiddlewareConfigurationError(

            "Runtime context required"

        );

    }








    return async function requestContextMiddleware(

        req,

        res,

        next

    ){



        try {





            const startedAt =
                new Date();








            const requestContext = freezeContext({




                /**
                 * Context metadata
                 */
                contextId:

                    generateContextId(),



                version:

                    CONTEXT_VERSION,






                /**
                 * Request identity
                 */
                request:

                    freezeContext({

                        requestId:

                            req.requestId
                            ||

                            req.id
                            ||

                            null,



                        correlationId:

                            req.correlationId
                            ||

                            null,



                        method:

                            req.method,



                        path:

                            req.originalUrl,



                        startedAt


                    }),







                /**
                 * Tenant context
                 */
                tenant:

                    freezeContext({

                        tenantId:

                            req.tenantId
                            ||

                            null,


                        tenantResolved:

                            Boolean(
                                req.tenantId
                            )


                    }),







                /**
                 * Authentication context
                 */
                user:

                    freezeContext({

                        userId:

                            req.user
                            ?.id

                            ||

                            null,



                        role:

                            req.user
                            ?.role

                            ||

                            null,



                        authenticated:

                            Boolean(
                                req.user
                            )


                    }),







                /**
                 * Client metadata
                 */
                client:

                    freezeContext({

                        ip:

                            req.ip
                            ||

                            null,



                        userAgent:

                            req.headers[
                                "user-agent"
                            ]

                            ||

                            null,



                        platform:

                            req.headers[
                                "x-client-platform"
                            ]

                            ||

                            null


                    }),







                /**
                 * Audit information
                 */
                audit:

                    freezeContext({

                        createdAt:
                            startedAt,


                        source:

                            "http"


                    }),







                /**
                 * Environment
                 */
                environment:

                    runtimeContext
                        .environment

                    ||

                    process.env.NODE_ENV



            });








            /**
             * Attach request context
             */
            req.requestContext =
                requestContext;







            /**
             * Response metadata
             */
            res.setHeader(

                "X-Context-ID",

                requestContext.contextId

            );









            /**
             * Runtime context integration
             */
            if(

                runtimeContext
                    .requestContext

            ){



                runtimeContext
                    .requestContext
                    =
                    requestContext;


            }









            /**
             * Publish lifecycle event
             */
            if(

                runtimeContext
                    ?.eventBus
                    ?.emit

            ){



                runtimeContext
                    .eventBus
                    .emit(

                        "request.context.created",

                        {

                            contextId:

                                requestContext
                                .contextId,


                            requestId:

                                requestContext
                                .request
                                .requestId


                        }

                    );


            }









            /**
             * Async propagation
             */
            requestContextStorage.run(

                requestContext,

                ()=>{


                    if(logger){


                        logger.debug(

                            {

                                contextId:

                                    requestContext
                                    .contextId,


                                requestId:

                                    requestContext
                                    .request
                                    .requestId


                            },

                            "Request context created"

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
                            "requestContext"

                    },

                    "Request context creation failed"

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

        "requestContext",




    version:

        "1.0.0",




    description:

        "Enterprise immutable request execution context middleware",




    category:

        "request",




    phase:

        "request-context",




    priority:

        120,




    critical:

        true,




    dependencies:

        [

            "requestId",

            "correlationId"

        ],




    factory:

        requestContextFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-core",



            tags:

                [

                    "context",

                    "tenant",

                    "audit",

                    "trace"

                ]



        },




    getRequestContext

};