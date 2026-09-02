"use strict";

/**
 * TITech Community Capital LTD
 *
 * Enterprise Middleware Error Hierarchy
 *
 * Provides standardized errors for:
 *
 * - Middleware registration
 * - Middleware bootstrap
 * - Dependency failures
 * - Lifecycle failures
 * - Health failures
 * - Timeout failures
 * - Shutdown failures
 *
 */



/**
 * Base Middleware Error
 */
class MiddlewareError extends Error {



    constructor(

        message,

        {

            code =
                "MIDDLEWARE_ERROR",


            details =
                {},


            cause =
                null,


            severity =
                "ERROR",


            retryable =
                false,


            operational =
                true,


            statusCode =
                500


        } = {}

    ) {



        super(message);



        this.name =
            this.constructor.name;



        this.code =
            code;



        this.details =
            details;



        this.cause =
            cause;



        this.severity =
            severity;



        this.retryable =
            retryable;



        this.operational =
            operational;



        this.statusCode =
            statusCode;



        this.timestamp =
            new Date();



        Error.captureStackTrace(

            this,

            this.constructor

        );


    }






    /**
     * Convert error for logging/API responses
     */
    toJSON(){


        return {


            name:
                this.name,


            code:
                this.code,


            message:
                this.message,


            severity:
                this.severity,


            retryable:
                this.retryable,


            operational:
                this.operational,


            statusCode:
                this.statusCode,


            details:
                this.details,


            timestamp:
                this.timestamp



        };


    }



}








/**
 * Middleware bootstrap failure
 */
class MiddlewareBootstrapError
extends MiddlewareError {


    constructor(

        message,

        details = {},

        cause = null

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_BOOTSTRAP_FAILED",


                details,


                cause,


                severity:
                    "CRITICAL",


                operational:
                    true


            }

        );


    }


}








/**
 * Middleware registration failure
 */
class MiddlewareRegistrationError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_REGISTRATION_FAILED",


                details,


                severity:
                    "ERROR"


            }

        );


    }


}








/**
 * Missing middleware dependency
 */
class MiddlewareDependencyError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_DEPENDENCY_FAILED",


                details,


                severity:
                    "CRITICAL"


            }

        );


    }


}








/**
 * Middleware execution timeout
 */
class MiddlewareTimeoutError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_TIMEOUT",


                details,


                severity:
                    "WARNING",


                retryable:
                    true


            }

        );


    }


}








/**
 * Middleware health verification failure
 */
class MiddlewareHealthCheckError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_HEALTH_FAILED",


                details,


                severity:
                    "CRITICAL"


            }

        );


    }


}








/**
 * Lifecycle state failure
 */
class MiddlewareLifecycleError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_LIFECYCLE_FAILED",


                details,


                severity:
                    "ERROR"


            }

        );


    }


}








/**
 * Middleware shutdown failure
 */
class MiddlewareShutdownError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_SHUTDOWN_FAILED",


                details,


                severity:
                    "WARNING"


            }

        );


    }


}








/**
 * Middleware configuration error
 */
class MiddlewareConfigurationError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_CONFIGURATION_ERROR",


                details,


                severity:
                    "ERROR",


                operational:
                    false


            }

        );


    }


}








/**
 * Middleware security failure
 */
class MiddlewareSecurityError
extends MiddlewareError {


    constructor(

        message,

        details = {}

    ){


        super(

            message,

            {

                code:
                    "MIDDLEWARE_SECURITY_ERROR",


                details,


                severity:
                    "CRITICAL"


            }

        );


    }


}








/**
 * Helper:
 *
 * Detect middleware error
 */
function isMiddlewareError(
    error
){


    return (

        error instanceof MiddlewareError

    );


}








/**
 * Helper:
 *
 * Normalize unknown errors
 */
function normalizeMiddlewareError(

    error,

    details = {}

){



    if(
        error instanceof MiddlewareError
    ){

        return error;

    }



    return new MiddlewareError(

        error.message ||
        "Unknown middleware error",

        {

            code:
                "UNKNOWN_MIDDLEWARE_ERROR",


            details,


            cause:
                error,


            severity:
                "ERROR"

        }

    );


}








module.exports = {


    MiddlewareError,


    MiddlewareBootstrapError,


    MiddlewareRegistrationError,


    MiddlewareDependencyError,


    MiddlewareTimeoutError,


    MiddlewareHealthCheckError,


    MiddlewareLifecycleError,


    MiddlewareShutdownError,


    MiddlewareConfigurationError,


    MiddlewareSecurityError,


    isMiddlewareError,


    normalizeMiddlewareError


};