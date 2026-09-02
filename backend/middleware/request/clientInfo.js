"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Client Information Middleware
 *
 * Responsibilities:
 *
 * - Capture request client metadata
 * - Enrich request context
 * - Support security analytics
 * - Support fraud detection pipelines
 * - Support audit traceability
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


    captureHeaders:

        true,



    trustProxyHeaders:

        true,



    maxUserAgentLength:

        512



};









/**
 * Normalize user agent
 */
function normalizeUserAgent(

    userAgent,

    maxLength

){



    if(
        !userAgent
    ){

        return null;

    }






    return userAgent

        .substring(

            0,

            maxLength

        );



}









/**
 * Detect client platform
 */
function detectPlatform(

    req

){



    const platformHeader =

        req.headers[
            "x-client-platform"
        ];



    if(
        platformHeader
    ){

        return platformHeader;

    }







    const userAgent =

        req.headers[
            "user-agent"
        ]
        ||
        "";







    if(

        /android/i.test(
            userAgent
        )

    ){

        return "android";

    }







    if(

        /iphone|ipad|ios/i.test(
            userAgent
        )

    ){

        return "ios";

    }







    if(

        /mozilla|chrome|safari/i.test(
            userAgent
        )

    ){

        return "web";

    }







    return "unknown";


}









/**
 * Detect client type
 */
function detectClientType(

    req

){



    const clientHeader =

        req.headers[
            "x-client-type"
        ];



    if(
        clientHeader
    ){

        return clientHeader;

    }






    const platform =
        detectPlatform(req);





    if(

        platform ===
        "android"

        ||

        platform ===
        "ios"

    ){

        return "mobile";

    }







    if(
        platform ===
        "web"
    ){

        return "browser";

    }






    return "api";



}









/**
 * Resolve originating IP
 */
function resolveClientIp(

    req

){



    if(
        req.ip
    ){

        return req.ip;

    }






    if(

        req.headers[
            "x-forwarded-for"
        ]

    ){



        return (

            req.headers[
                "x-forwarded-for"
            ]

            .split(",")

            [0]

            .trim()

        );


    }






    return (

        req.socket
            ?.remoteAddress

        ||

        null

    );


}









/**
 * Client info middleware factory
 */
function clientInfoFactory(

    context = {}

){



    const {


        runtimeContext = {},

        config = {},

        logger = null


    } =
    context;







    const clientConfig = {


        ...DEFAULT_CONFIG,


        ...(

            config.clientInfo
            ||
            {}

        )



    };









    if(
        !clientConfig
    ){

        throw new MiddlewareConfigurationError(

            "Client information configuration unavailable"

        );

    }








    return function clientInfoMiddleware(

        req,

        res,

        next

    ){



        try {





            const clientInfo = {





                ip:

                    resolveClientIp(
                        req
                    ),







                userAgent:

                    normalizeUserAgent(

                        req.headers[
                            "user-agent"
                        ],

                        clientConfig
                            .maxUserAgentLength

                    ),







                platform:

                    detectPlatform(
                        req
                    ),







                clientType:

                    detectClientType(
                        req
                    ),







                language:

                    req.headers[
                        "accept-language"
                    ]

                    ||

                    null,








                timezone:

                    req.headers[
                        "x-timezone"
                    ]

                    ||

                    null,








                appVersion:

                    req.headers[
                        "x-app-version"
                    ]

                    ||

                    null,








                deviceId:

                    req.headers[
                        "x-device-id"
                    ]

                    ||

                    null,








                apiClient:

                    req.headers[
                        "x-api-client"
                    ]

                    ||

                    null,








                capturedAt:

                    new Date()



            };









            /**
             * Attach request metadata
             */
            req.clientInfo =
                clientInfo;








            /**
             * Enrich request context
             */
            if(
                req.requestContext
            ){


                req.requestContext.client =
                    Object.freeze(

                        clientInfo

                    );


            }








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

                        "request.client.detected",

                        {

                            requestId:

                                req.requestId,


                            client:

                                clientInfo


                        }

                    );


            }









            if(logger){


                logger.debug(

                    {

                        requestId:

                            req.requestId,


                        platform:

                            clientInfo.platform,


                        clientType:

                            clientInfo.clientType


                    },

                    "Client information captured"

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
                            "clientInfo"

                    },

                    "Client information middleware failure"

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

        "clientInfo",




    version:

        "1.0.0",




    description:

        "Enterprise client metadata enrichment middleware",




    category:

        "request",




    phase:

        "request-context",




    priority:

        130,




    critical:

        false,




    dependencies:

        [

            "requestContext"

        ],




    factory:

        clientInfoFactory,




    healthCheck,




    metadata:

        {


            owner:

                "platform-security",



            tags:

                [

                    "client",

                    "security",

                    "fraud",

                    "audit"

                ]



        }



};