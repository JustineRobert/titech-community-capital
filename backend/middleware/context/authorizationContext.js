"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Authorization Context Middleware
 *
 * Responsibilities:
 *
 * - Build authorization runtime context
 * - Resolve permissions
 * - Support RBAC
 * - Enforce tenant security boundaries
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



    requireAuthentication:

        true,



    defaultRole:

        "USER",



    denyByDefault:

        true



};









/**
 * Default role hierarchy
 *
 * Higher roles inherit lower privileges
 */
const ROLE_HIERARCHY = {


    SUPER_ADMIN:

        1000,



    TENANT_ADMIN:

        900,



    ADMIN:

        800,



    MANAGER:

        600,



    LOAN_OFFICER:

        500,



    ACCOUNTANT:

        500,



    MEMBER:

        100,



    USER:

        10



};









/**
 * Resolve roles
 */
function resolveRoles(

    req

){



    return (

        req.userContext
        ?.roles

        ||

        []

    );


}









/**
 * Resolve permissions
 */
function resolvePermissions(

    req

){



    return (

        req.userContext
        ?.permissions

        ||

        []

    );


}









/**
 * Check role permission
 */
function hasRole(

    roles,

    requiredRole

){



    if(

        !requiredRole

    ){

        return true;

    }








    return roles.includes(

        requiredRole

    );



}









/**
 * Check permission
 */
function hasPermission(

    permissions,

    requiredPermission

){



    if(

        !requiredPermission

    ){

        return true;

    }








    return permissions.includes(

        requiredPermission

    );



}









/**
 * Check role hierarchy
 */
function hasMinimumRole(

    roles,

    requiredRole

){



    const requiredLevel =

        ROLE_HIERARCHY[
            requiredRole
        ];








    if(
        !requiredLevel
    ){

        return false;

    }








    return roles.some(

        role => {


            return (

                ROLE_HIERARCHY[role]

                >=

                requiredLevel

            );


        }

    );


}









/**
 * Authorization factory
 */
function authorizationContextFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    const authorizationConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.authorizationContext

            ||

            {}

        )



    };








    if(

        typeof authorizationConfig !==
        "object"

    ){

        throw new MiddlewareBootstrapError(

            "Invalid authorization configuration"

        );


    }









    return function authorizationContextMiddleware(

        req,

        res,

        next

    ){



        try {





            if(

                authorizationConfig.enabled === false

            ){

                return next();


            }








            const authenticated =

                req.userContext
                ?.authenticated;








            /**
             * Authentication requirement
             */
            if(

                authorizationConfig.requireAuthentication

                &&

                !authenticated

            ){



                const error =
                    new Error(

                        "Authentication required"

                    );


                error.statusCode =
                    401;


                return next(error);


            }








            const roles =

                resolveRoles(

                    req

                );








            const permissions =

                resolvePermissions(

                    req

                );









            /**
             * Build authorization context
             */
            req.authorizationContext = {


                authenticated:

                    Boolean(authenticated),



                userId:

                    req.userContext
                    ?.userId

                    ||

                    null,



                tenantId:

                    req.userContext
                    ?.tenantId

                    ||

                    null,



                roles,



                permissions,



                can:

                    function(permission){

                        return hasPermission(

                            permissions,

                            permission

                        );

                    },



                hasRole:

                    function(role){

                        return hasRole(

                            roles,

                            role

                        );

                    },



                hasMinimumRole:

                    function(role){

                        return hasMinimumRole(

                            roles,

                            role

                        );

                    }



            };








            /**
             * Extend audit context
             */
            req.auditContext = {


                ...(req.auditContext || {}),



                roles,



                permissions



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

                        "authorization.context.created",

                        {


                            requestId:

                                req.requestId,


                            userId:

                                req.userContext
                                ?.userId,


                            tenantId:

                                req.userContext
                                ?.tenantId,


                            roles



                        }

                    );



            }








            if(logger){



                logger.debug(

                    {


                        requestId:

                            req.requestId,


                        userId:

                            req.userContext
                            ?.userId,


                        roles



                    },

                    "Authorization context established"

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
                            "authorizationContext"

                    },

                    "Authorization context failure"

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

        "authorizationContext",




    version:

        "1.0.0",




    description:

        "Enterprise RBAC and permission authorization context middleware",




    category:

        "context",




    phase:

        "request-context",




    priority:

        420,




    critical:

        true,




    dependencies:

        [

            "userContext"

        ],




    factory:

        authorizationContextFactory,




    healthCheck,




    helpers:

        {


            hasRole,



            hasPermission,



            hasMinimumRole



        },




    ROLE_HIERARCHY,




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "rbac",

                    "authorization",

                    "permissions",

                    "compliance"

                ]



        }



};