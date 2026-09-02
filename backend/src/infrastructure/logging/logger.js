"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/infrastructure/logging/logger.js
 * Enterprise Logging Service
 * ============================================================================
 */

const path = require("path");

const winston = require("winston");

require("winston-daily-rotate-file");

const LOG_LEVEL =
    process.env.LOG_LEVEL ||
    "info";

const LOG_DIRECTORY =
    process.env.LOG_DIRECTORY ||
    path.join(
        process.cwd(),
        "logs"
    );

/* ============================================================================
 * Log Format
 * ========================================================================== */

const jsonFormatter =
    winston.format.printf(

        info => {

            return JSON.stringify({

                timestamp:
                    info.timestamp,

                level:
                    info.level,

                message:
                    info.message,

                service:
                    info.service,

                tenantId:
                    info.tenantId,

                userId:
                    info.userId,

                requestId:
                    info.requestId,

                correlationId:
                    info.correlationId,

                operation:
                    info.operation,

                metadata:
                    info.metadata || {},

                stack:
                    info.stack
            });
        }
    );

/* ============================================================================
 * Transports
 * ========================================================================== */

const consoleTransport =
    new winston.transports.Console({

        level:
            LOG_LEVEL,

        format:
            winston.format.combine(

                winston.format.colorize(),

                winston.format.timestamp(),

                winston.format.simple()
            )
    });

const applicationTransport =
    new winston.transports.DailyRotateFile({

        dirname:
            LOG_DIRECTORY,

        filename:
            "application-%DATE%.log",

        datePattern:
            "YYYY-MM-DD",

        maxSize:
            "20m",

        maxFiles:
            "30d",

        zippedArchive:
            true
    });

const errorTransport =
    new winston.transports.DailyRotateFile({

        dirname:
            LOG_DIRECTORY,

        filename:
            "errors-%DATE%.log",

        level:
            "error",

        datePattern:
            "YYYY-MM-DD",

        maxSize:
            "20m",

        maxFiles:
            "90d",

        zippedArchive:
            true
    });

const auditTransport =
    new winston.transports.DailyRotateFile({

        dirname:
            LOG_DIRECTORY,

        filename:
            "audit-%DATE%.log",

        datePattern:
            "YYYY-MM-DD",

        maxSize:
            "20m",

        maxFiles:
            "365d",

        zippedArchive:
            true
    });

/* ============================================================================
 * Winston Logger
 * ========================================================================== */

const loggerInstance =
    winston.createLogger({

        level:
            LOG_LEVEL,

        format:
            winston.format.combine(

                winston.format.timestamp(),

                winston.format.errors({
                    stack: true
                }),

                jsonFormatter
            ),

        defaultMeta: {

            service:
                "titech-platform"
        },

        transports: [

            consoleTransport,

            applicationTransport,

            errorTransport
        ],

        exitOnError:
            false
    });

/* ============================================================================
 * Enterprise Logger
 * ========================================================================== */

class Logger {

    info(
        message,
        metadata = {}
    ) {

        loggerInstance.info(
            message,
            metadata
        );
    }

    warn(
        message,
        metadata = {}
    ) {

        loggerInstance.warn(
            message,
            metadata
        );
    }

    error(
        message,
        metadata = {}
    ) {

        loggerInstance.error(
            message,
            metadata
        );
    }

    debug(
        message,
        metadata = {}
    ) {

        loggerInstance.debug(
            message,
            metadata
        );
    }

    verbose(
        message,
        metadata = {}
    ) {

        loggerInstance.verbose(
            message,
            metadata
        );
    }

    audit(
        action,
        metadata = {}
    ) {

        auditTransport.log({

            level:
                "info",

            message:
                action,

            ...metadata,

            timestamp:
                new Date()
                    .toISOString()
        });
    }

    security(
        action,
        metadata = {}
    ) {

        loggerInstance.warn(

            `[SECURITY] ${action}`,

            metadata
        );
    }

    metric(
        metricName,
        value,
        metadata = {}
    ) {

        loggerInstance.info(

            `[METRIC] ${metricName}`,

            {

                value,

                ...metadata
            }
        );
    }

    exception(
        error,
        metadata = {}
    ) {

        loggerInstance.error(

            error.message,

            {

                stack:
                    error.stack,

                ...metadata
            }
        );
    }

    request(
        req,
        metadata = {}
    ) {

        loggerInstance.info(

            "HTTP Request",

            {

                method:
                    req.method,

                path:
                    req.originalUrl,

                tenantId:
                    req.tenantId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                ip:
                    req.ip,

                ...metadata
            }
        );
    }

    response(
        req,
        res,
        duration,
        metadata = {}
    ) {

        loggerInstance.info(

            "HTTP Response",

            {

                method:
                    req.method,

                path:
                    req.originalUrl,

                status:
                    res.statusCode,

                duration,

                tenantId:
                    req.tenantId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                ...metadata
            }
        );
    }

    child(
        context = {}
    ) {

        return {

            info:
                (message, meta = {}) =>
                    this.info(
                        message,
                        {
                            ...context,
                            ...meta
                        }
                    ),

            warn:
                (message, meta = {}) =>
                    this.warn(
                        message,
                        {
                            ...context,
                            ...meta
                        }
                    ),

            error:
                (message, meta = {}) =>
                    this.error(
                        message,
                        {
                            ...context,
                            ...meta
                        }
                    )
        };
    }

    getDiagnostics() {

        return {

            level:
                LOG_LEVEL,

            directory:
                LOG_DIRECTORY,

            service:
                "logger",

            healthy:
                true,

            timestamp:
                new Date()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Singleton Export
 * ========================================================================== */

const logger =
    new Logger();

module.exports =
    logger;

module.exports.Logger =
    Logger;

module.exports.loggerInstance =
    loggerInstance;