"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Tenant Context Middleware
 *
 * Responsibilities:
 *
 * - Establish tenant identity
 * - Enforce tenant isolation
 * - Attach tenant runtime context
 * - Support multi-tenant SaaS operations
 *
 */



const {

    MiddlewareBootstrapError

}
=
require("../errors");









/**
 * Default configuration
 */
const DEFAULT_CONFIG = {


    enabled:

        true,



    required:

        true,



    headerName:

        "x-tenant-id",



    allowQueryFallback:

        false,



    allowAnonymous:

        false



};









/**
 * Tenant sources priority
 *
 * 1. Existing authentication context
 * 2. Request header
 * 3. Query fallback
 */
function resolveTenantId(

    req,

    config

){



    /**
     * Authentication context
     */
    if(

        req.user
        ?.tenantId

    ){

        return req.user.tenantId;


    }








    /**
     * Existing request context
     */
    if(

        req.requestContext
        ?.tenantId

    ){

        return req.requestContext.tenantId;


    }








    /**
     * Header source
     */
    const headerTenant =

        req.headers[
            config.headerName
        ];








    if(

        headerTenant

    ){

        return headerTenant;


    }








    /**
     * Query fallback
     */
    if(

        config.allowQueryFallback

        &&

        req.query
        ?.tenantId

    ){

        return req.query.tenantId;


    }








    return null;


}









/**
 * Validate tenant identifier
 */
function validateTenantId(

    tenantId

){



    if(

        typeof tenantId !==
        "string"

    ){

        return false;

    }








    if(

        tenantId.trim().length < 3

    ){

        return false;

    }








    /**
     * Prevent injection characters
     */
    if(

        /[^a-zA-Z0-9_-]/.test(

            tenantId

        )

    ){

        return false;

    }








    return true;


}









/**
 * Tenant context factory
 */
function tenantContextFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    const tenantConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.tenantContext

            ||

            {}

        )



    };








    if(

        typeof tenantConfig !==
        "object"

    ){

        throw new MiddlewareBootstrapError(

            "Invalid tenant context configuration"

        );


    }









    return function tenantContextMiddleware(

        req,

        res,

        next

    ){



        try {





            if(

                tenantConfig.enabled === false

            ){

                return next();


            }








            const tenantId =

                resolveTenantId(

                    req,

                    tenantConfig

                );








            /**
             * Missing tenant handling
             */
            if(

                !tenantId

            ){



                if(

                    tenantConfig.required

                ){



                    const error =
                        new Error(

                            "Tenant context required"

                        );


                    error.statusCode =
                        400;


                    return next(error);


                }








                return next();


            }








            /**
             * Validate tenant
             */
            if(

                !validateTenantId(

                    tenantId

                )

            ){



                const error =
                    new Error(

                        "Invalid tenant identifier"

                    );


                error.statusCode =
                    400;


                return next(error);


            }








            /**
             * Attach request tenant context
             */
            req.tenantId =
                tenantId;








            req.tenantContext = {


                tenantId,



                resolved:

                    true,



                source:

                    req.user?.tenantId

                    ?

                    "user"

                    :

                    "header"



            };








            /**
             * Extend runtime request context
             */
            if(

                req.requestContext

            ){



                req.requestContext.tenant = {


                    tenantId



                };


            }









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

                        "tenant.context.created",

                        {


                            requestId:

                                req.requestId,


                            correlationId:

                                req.correlationId,


                            tenantId



                        }

                    );


            }









            /**
             * Tenant-aware logging
             */
            if(logger){



                logger.debug(

                    {


                        requestId:

                            req.requestId,


                        tenantId



                    },

                    "Tenant context established"

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
                            "tenantContext"

                    },

                    "Tenant context middleware failure"

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

        "tenantContext",




    version:

        "1.0.0",




    description:

        "Enterprise multi-tenant context middleware",




    category:

        "context",




    phase:

        "request-context",




    priority:

        400,




    critical:

        true,




    dependencies:

        [

            "requestContext"

        ],




    factory:

        tenantContextFactory,




    healthCheck,




    helpers:

        {


            resolveTenantId,



            validateTenantId



        },




    metadata:

        {


            owner:

                "platform-architecture",



            tags:

                [

                    "multi-tenant",

                    "isolation",

                    "saas",

                    "security"

                ]



        }



};