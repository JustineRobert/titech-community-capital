'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/shared/logging/StructuredLogger.js
 * =============================================================================
 *
 * Enterprise Structured Logger
 *
 * Architecture:
 *
 * Application
 *      |
 *      v
 * StructuredLogger
 *      |
 *      +----------------+
 *      |                |
 *      v                v
 * Transport        Formatter
 *
 *
 * Features
 * -----------------------------------------------------------------------------
 * • Transport-based logging
 * • Immutable logger instance
 * • JSON-first output
 * • Request-context aware
 * • Distributed tracing support
 * • Automatic secret masking
 * • OpenTelemetry compatible fields
 * • Express independent
 * • Worker/job compatible
 * • Production safe
 *
 * =============================================================================
 */


const DEFAULT_LEVEL = 'info';


const LOG_LEVELS = Object.freeze({

    fatal: 0,

    error: 1,

    warn: 2,

    info: 3,

    debug: 4,

    trace: 5

});


const DEFAULT_SECRET_KEYS = Object.freeze([

    'password',

    'secret',

    'token',

    'accessToken',

    'refreshToken',

    'privateKey',

    'apiKey',

    'authorization',

    'credential',

    'clientSecret',

    'databaseUrl',

    'mongoUri',

    'jwt'

]);



/**
 * Deep clone and redact sensitive values.
 */
function sanitize(value, secrets = DEFAULT_SECRET_KEYS) {


    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }



    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                sanitize(
                    item,
                    secrets
                )
        );

    }



    const output = {};



    for (
        const [key, item]
        of Object.entries(value)
    ) {


        const sensitive =
            secrets.some(
                secret =>
                    key
                        .toLowerCase()
                        .includes(
                            secret.toLowerCase()
                        )
            );


        if (sensitive) {

            output[key] =
                '***REDACTED***';

            continue;

        }



        output[key] =
            sanitize(
                item,
                secrets
            );

    }



    return output;

}





/**
 * Default stdout transport.
 *
 * Future transports:
 *
 * - Winston
 * - Pino
 * - Datadog
 * - CloudWatch
 * - Loki
 * - Elasticsearch
 */
class ConsoleTransport {


    write(entry) {


        process.stdout.write(
            `${JSON.stringify(entry)}\n`
        );

    }


}



class StructuredLogger {


    constructor({

        level = DEFAULT_LEVEL,

        transport = new ConsoleTransport(),

        context = {},

        service = 'titech-community-capital',

        environment =
            process.env.NODE_ENV || 'development'

    } = {}) {


        this.level =
            level;


        this.transport =
            transport;


        this.context =
            sanitize(
                context
            );


        this.service =
            service;


        this.environment =
            environment;



        Object.freeze(this.context);

        Object.freeze(this);

    }




    /**
     * Create child logger.
     *
     * Useful for request-scoped logging.
     */
    child(context = {}) {


        return new StructuredLogger({

            level:
                this.level,


            transport:
                this.transport,


            service:
                this.service,


            environment:
                this.environment,


            context:
                {

                    ...this.context,

                    ...sanitize(
                        context
                    )

                }

        });


    }





    /**
     * Core logging method.
     */
    log(

        level,

        message,

        metadata = {}

    ) {


        if (
            !this.shouldLog(level)
        ) {

            return;

        }



        const entry = {

            timestamp:
                new Date()
                    .toISOString(),


            level,


            service:
                this.service,


            environment:
                this.environment,


            message,


            ...this.context,


            ...sanitize(
                metadata
            )

        };



        this.transport.write(
            Object.freeze(entry)
        );

    }





    shouldLog(level) {


        return (
            LOG_LEVELS[level] <=
            LOG_LEVELS[this.level]
        );

    }





    fatal(message, metadata) {

        this.log(
            'fatal',
            message,
            metadata
        );

    }





    error(message, metadata) {

        this.log(
            'error',
            message,
            metadata
        );

    }





    warn(message, metadata) {

        this.log(
            'warn',
            message,
            metadata
        );

    }





    info(message, metadata) {

        this.log(
            'info',
            message,
            metadata
        );

    }





    debug(message, metadata) {

        this.log(
            'debug',
            message,
            metadata
        );

    }





    trace(message, metadata) {

        this.log(
            'trace',
            message,
            metadata
        );

    }





    /**
     * Request lifecycle helper.
     */
    requestCompleted({

        requestId,

        correlationId,

        tenant,

        user,

        duration,

        statusCode,

        method,

        path

    }) {


        this.info(

            'Request completed',

            {

                requestId,

                correlationId,

                tenant,

                user,

                duration,

                statusCode,

                method,

                path

            }

        );


    }




    /**
     * Database operation helper.
     */
    databaseOperation(

        operation,

        duration,

        metadata = {}

    ) {


        this.debug(

            'Database operation completed',

            {

                operation,

                duration,

                ...metadata

            }

        );


    }




    /**
     * Security event helper.
     */
    securityEvent(

        event,

        metadata = {}

    ) {


        this.warn(

            'Security event',

            {

                event,

                ...metadata

            }

        );


    }


}



/**
 * Prevent prototype mutation.
 */
Object.freeze(
    StructuredLogger.prototype
);



module.exports =
    StructuredLogger;



module.exports.ConsoleTransport =
    ConsoleTransport;



module.exports.LOG_LEVELS =
    LOG_LEVELS;