"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise User Context Middleware
 *
 * Responsibilities:
 *
 * - Establish authenticated user identity
 * - Attach runtime user context
 * - Support authorization workflows
 * - Provide audit ownership information
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

        false,



    allowAnonymous:

        true



};









/**
 * Extract authenticated user
 */
function resolveUser(

    req

){



    /**
     * Standard authentication middleware
     */
    if(

        req.user

    ){

        return req.user;


    }








    /**
     * Existing runtime context
     */
    if(

        req.requestContext
        ?.user

    ){

        return req.requestContext.user;


    }








    return null;


}









/**
 * Normalize user identity
 */
function normalizeUser(

    user

){



    if(
        !user
    ){

        return null;

    }








    return {


        id:

            user.id

            ||

            user._id

            ||

            null,



        tenantId:

            user.tenantId

            ||

            null,



        username:

            user.username

            ||

            user.email

            ||

            null,



        email:

            user.email

            ||

            null,



        roles:

            Array.isArray(

                user.roles

            )

            ?

            user.roles

            :

            [],



        permissions:

            Array.isArray(

                user.permissions

            )

            ?

            user.permissions

            :

            [],



        sessionId:

            user.sessionId

            ||

            null



    };


}









/**
 * Validate user context
 */
function validateUser(

    user

){



    if(
        !user
    ){

        return false;

    }








    if(

        !user.id

    ){

        return false;

    }








    return true;


}









/**
 * User context factory
 */
function userContextFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    const userConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.userContext

            ||

            {}

        )



    };








    if(

        typeof userConfig !==
        "object"

    ){

        throw new MiddlewareBootstrapError(

            "Invalid user context configuration"

        );


    }









    return function userContextMiddleware(

        req,

        res,

        next

    ){



        try {





            if(

                userConfig.enabled === false

            ){

                return next();


            }








            const rawUser =

                resolveUser(

                    req

                );








            /**
             * Anonymous access
             */
            if(

                !rawUser

            ){



                if(

                    userConfig.required

                    &&

                    !userConfig.allowAnonymous

                ){



                    const error =
                        new Error(

                            "Authenticated user required"

                        );


                    error.statusCode =
                        401;


                    return next(error);


                }








                req.userContext = {


                    authenticated:

                        false



                };








                return next();


            }









            const user =

                normalizeUser(

                    rawUser

                );








            /**
             * Validate identity
             */
            if(

                !validateUser(

                    user

                )

            ){



                const error =
                    new Error(

                        "Invalid user identity context"

                    );


                error.statusCode =
                    401;


                return next(error);


            }








            /**
             * Attach runtime user context
             */
            req.userContext = {


                authenticated:

                    true,



                userId:

                    user.id,



                tenantId:

                    user.tenantId,



                roles:

                    user.roles,



                permissions:

                    user.permissions,



                sessionId:

                    user.sessionId



            };








            /**
             * Ensure request context has user
             */
            if(

                req.requestContext

            ){



                req.requestContext.user =

                    req.userContext;


            }









            /**
             * Audit context
             */
            req.auditContext = {


                actorId:

                    user.id,



                tenantId:

                    user.tenantId,



                roles:

                    user.roles



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

                        "user.context.created",

                        {


                            requestId:

                                req.requestId,


                            correlationId:

                                req.correlationId,


                            userId:

                                user.id,


                            tenantId:

                                user.tenantId



                        }

                    );



            }









            if(logger){



                logger.debug(

                    {


                        requestId:

                            req.requestId,


                        userId:

                            user.id,


                        tenantId:

                            user.tenantId



                    },

                    "User context established"

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
                            "userContext"

                    },

                    "User context middleware failure"

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

        "userContext",




    version:

        "1.0.0",




    description:

        "Enterprise authenticated user context middleware",




    category:

        "context",




    phase:

        "request-context",




    priority:

        410,




    critical:

        true,




    dependencies:

        [

            "tenantContext"

        ],




    factory:

        userContextFactory,




    healthCheck,




    helpers:

        {


            resolveUser,



            normalizeUser,



            validateUser



        },




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "identity",

                    "authentication",

                    "audit",

                    "rbac"

                ]



        }



};