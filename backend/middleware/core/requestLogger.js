'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/middleware/core/requestLogger.js
 * =============================================================================
 *
 * Enterprise HTTP Request Logger Middleware
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * Automatically logs:
 *
 * • Request received
 * • Response completed
 * • Request latency
 * • HTTP status code
 * • Response payload size
 * • Errors
 * • Request ID tracing
 * • Correlation ID tracing
 * • Tenant context
 * • User context
 *
 *
 * Pipeline
 * -----------------------------------------------------------------------------
 *
 * Request
 *    |
 *    v
 * Request ID
 *    |
 *    v
 * Correlation ID
 *    |
 *    v
 * Request Context
 *    |
 *    v
 * Request Logger
 *    |
 *    v
 * Authentication
 *    |
 *    v
 * Business Logic
 *
 * =============================================================================
 */

const LoggerFactory =
    require('../../shared/logging/LoggerFactory');



/**
 * High-resolution timer.
 */
function now() {

    return process.hrtime.bigint();

}



/**
 * Convert nanoseconds to milliseconds.
 */
function durationMilliseconds(startTime) {


    const elapsed =
        now() - startTime;


    return Number(elapsed) / 1_000_000;

}




/**
 * Enterprise Request Logger Middleware
 *
 * @param {Object} options
 *
 * @param {LoggerFactory} options.loggerFactory
 *
 * @returns {Function}
 */
function requestLogger({

    loggerFactory = new LoggerFactory()

} = {}) {


    return function requestLoggerMiddleware(
        req,
        res,
        next
    ) {


        const startedAt =
            now();



        /*
         * Create request-scoped logger.
         */
        const logger =
            loggerFactory.create(
                req.context || {}
            );



        /*
         * Attach logger.
         *
         * Available for all downstream
         * middleware/controllers.
         */
        req.logger =
            logger;



        if (req.context) {

            req.context.logger =
                logger;

        }



        /**
         * Request received event.
         */
        logger.info(

            'HTTP request received',

            {


                method:
                    req.method,


                url:
                    req.originalUrl,


                path:
                    req.path,


                ip:
                    req.ip,


                userAgent:
                    req.get(
                        'User-Agent'
                    ),


                requestId:
                    req.id,


                correlationId:
                    req.correlationId

            }

        );



        /**
         * Capture response completion.
         */
        res.on(
            'finish',
            () => {


                const duration =
                    durationMilliseconds(
                        startedAt
                    );



                const payloadSize =
                    resolvePayloadSize(
                        res
                    );



                logger.info(

                    'HTTP request completed',

                    {


                        method:
                            req.method,


                        url:
                            req.originalUrl,


                        statusCode:
                            res.statusCode,


                        duration,


                        payloadSize,


                        requestId:
                            req.id,


                        correlationId:
                            req.correlationId

                    }

                );


            }

        );



        /**
         * Capture connection errors.
         */
        res.on(

            'close',

            () => {


                if (!res.writableFinished) {


                    const duration =
                        durationMilliseconds(
                            startedAt
                        );



                    logger.warn(

                        'HTTP request connection closed',

                        {


                            method:
                                req.method,


                            url:
                                req.originalUrl,


                            duration,


                            requestId:
                                req.id,


                            correlationId:
                                req.correlationId


                        }

                    );


                }


            }

        );



        next();

    };

}





/**
 * Express error logging middleware.
 *
 * Must be registered after routes.
 */
function requestErrorLogger({

    loggerFactory = new LoggerFactory()

} = {}) {


    return function errorLogger(
        err,
        req,
        res,
        next
    ) {


        const logger =
            req.logger ||
            loggerFactory.create(
                req.context || {}
            );



        logger.error(

            'HTTP request failed',

            {


                error:

                {

                    name:
                        err.name,


                    message:
                        err.message,


                    stack:
                        err.stack

                },


                method:
                    req.method,


                url:
                    req.originalUrl,


                requestId:
                    req.id,


                correlationId:
                    req.correlationId


            }

        );



        next(err);

    };

}





/**
 * Resolve response payload size.
 */
function resolvePayloadSize(res) {


    const header =
        res.getHeader(
            'content-length'
        );


    if (header) {

        return Number(header);

    }


    return null;

}





module.exports =
    requestLogger;



module.exports.requestErrorLogger =
    requestErrorLogger;



module.exports.durationMilliseconds =
    durationMilliseconds;