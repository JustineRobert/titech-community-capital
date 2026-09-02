"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Feature Context Middleware
 *
 * Responsibilities:
 *
 * - Resolve enabled platform features
 * - Support SaaS plans
 * - Control tenant capabilities
 * - Provide runtime feature decisions
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



    failClosed:

        true,



    defaultFeatures:

        []



};









/**
 * Feature source priority:
 *
 * 1. User overrides
 * 2. Tenant overrides
 * 3. Subscription plan
 * 4. Global defaults
 */
function resolveFeatureState(

    feature,

    context

){



    const {


        userFeatures = {},

        tenantFeatures = {},

        planFeatures = {},

        defaultFeatures = []

    } = context;








    /**
     * User override
     */
    if(

        Object.prototype.hasOwnProperty.call(

            userFeatures,

            feature

        )

    ){

        return Boolean(

            userFeatures[feature]

        );


    }








    /**
     * Tenant override
     */
    if(

        Object.prototype.hasOwnProperty.call(

            tenantFeatures,

            feature

        )

    ){

        return Boolean(

            tenantFeatures[feature]

        );


    }








    /**
     * Subscription plan
     */
    if(

        Object.prototype.hasOwnProperty.call(

            planFeatures,

            feature

        )

    ){

        return Boolean(

            planFeatures[feature]

        );


    }








    /**
     * Default features
     */
    return defaultFeatures.includes(

        feature

    );


}









/**
 * Normalize feature list
 */
function normalizeFeatures(

    features

){



    if(

        Array.isArray(features)

    ){

        return features.reduce(

            (

                result,

                item

            )=>{


                result[item] = true;


                return result;


            },

            {}

        );


    }








    return features || {};



}









/**
 * Feature context factory
 */
function featureContextFactory(

    context = {}

){



    const {


        config = {},

        runtimeContext = {},

        logger = null


    } =
    context;








    const featureConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.featureContext

            ||

            {}

        )



    };








    if(

        typeof featureConfig !==
        "object"

    ){

        throw new MiddlewareBootstrapError(

            "Invalid feature context configuration"

        );


    }









    return function featureContextMiddleware(

        req,

        res,

        next

    ){



        try {





            if(

                featureConfig.enabled === false

            ){

                return next();


            }








            /**
             * Resolve tenant features
             */
            const tenantFeatures =

                normalizeFeatures(

                    req.tenantContext
                    ?.features

                    ||

                    req.tenant
                    ?.features

                );








            /**
             * Resolve user features
             */
            const userFeatures =

                normalizeFeatures(

                    req.userContext
                    ?.features

                );








            /**
             * Resolve subscription features
             */
            const planFeatures =

                normalizeFeatures(

                    req.tenantContext
                    ?.subscription
                    ?.features

                );








            const defaultFeatures =

                featureConfig.defaultFeatures;








            /**
             * Feature evaluator
             */
            const featureContext = {


                tenantId:

                    req.tenantId

                    ||

                    null,



                userId:

                    req.userContext
                    ?.userId

                    ||

                    null,



                plan:

                    req.tenantContext
                    ?.subscription
                    ?.plan

                    ||

                    null,



                enabled:

                    function(feature){

                        return resolveFeatureState(

                            feature,

                            {

                                userFeatures,

                                tenantFeatures,

                                planFeatures,

                                defaultFeatures

                            }

                        );

                    },



                require:

                    function(feature){

                        const enabled =

                            this.enabled(
                                feature
                            );


                        if(

                            !enabled

                            &&

                            featureConfig.failClosed

                        ){



                            const error =
                                new Error(

                                    `Feature disabled: ${feature}`

                                );


                            error.statusCode =
                                403;


                            throw error;


                        }



                        return enabled;


                    }



            };









            req.featureContext =

                featureContext;








            /**
             * Audit enrichment
             */
            req.auditContext = {


                ...(req.auditContext || {}),



                features:

                    {

                        resolved:true

                    }



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

                        "feature.context.created",

                        {


                            requestId:

                                req.requestId,


                            tenantId:

                                req.tenantId,


                            userId:

                                req.userContext
                                ?.userId



                        }

                    );


            }








            if(logger){



                logger.debug(

                    {


                        requestId:

                            req.requestId,


                        tenantId:

                            req.tenantId



                    },

                    "Feature context established"

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
                            "featureContext"

                    },

                    "Feature context middleware failure"

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

        "featureContext",




    version:

        "1.0.0",




    description:

        "Enterprise tenant feature flag and capability context middleware",




    category:

        "context",




    phase:

        "request-context",




    priority:

        430,




    critical:

        false,




    dependencies:

        [

            "authorizationContext"

        ],




    factory:

        featureContextFactory,




    healthCheck,




    helpers:

        {


            resolveFeatureState,



            normalizeFeatures



        },




    metadata:

        {


            owner:

                "platform-platform",



            tags:

                [

                    "feature-flags",

                    "saas",

                    "tenant",

                    "subscription"

                ]



        }



};