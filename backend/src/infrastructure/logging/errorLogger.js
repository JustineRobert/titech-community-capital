"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/infrastructure/logging/errorLogger.js
 * Enterprise Error Logger
 * ============================================================================
 */

const crypto = require("crypto");

const logger =
    require("./logger");

let prometheusService;
let auditLogger;

try {

    prometheusService =
        require(
            "../monitoring/prometheus.service"
        );

} catch (_) {

    prometheusService = null;
}

try {

    auditLogger =
        require(
            "./auditLogger"
        );

} catch (_) {

    auditLogger = null;
}

/* ============================================================================
 * Constants
 * ========================================================================== */

const ERROR_SEVERITY = Object.freeze({

    LOW:
        "LOW",

    MEDIUM:
        "MEDIUM",

    HIGH:
        "HIGH",

    CRITICAL:
        "CRITICAL"
});

const ERROR_CATEGORY = Object.freeze({

    APPLICATION:
        "APPLICATION",

    DATABASE:
        "DATABASE",

    HTTP:
        "HTTP",

    VALIDATION:
        "VALIDATION",

    SECURITY:
        "SECURITY",

    AML:
        "AML",

    FRAUD:
        "FRAUD",

    BILLING:
        "BILLING",

    SAVINGS:
        "SAVINGS",

    LOANS:
        "LOANS",

    MOBILE_MONEY:
        "MOBILE_MONEY",

    EXTERNAL_SERVICE:
        "EXTERNAL_SERVICE"
});

/* ============================================================================
 * Error Logger
 * ========================================================================== */

class ErrorLogger {

    /* ===================================================================== */
    /* ERROR ID                                                              */
    /* ===================================================================== */

    generateErrorId() {

        return crypto.randomUUID();
    }

    /* ===================================================================== */
    /* FINGERPRINT                                                           */
    /* ===================================================================== */

    generateFingerprint(
        error
    ) {

        return crypto
            .createHash("sha256")
            .update(

                `${error.name}:${error.message}`

            )
            .digest("hex");
    }

    /* ===================================================================== */
    /* SANITIZATION                                                          */
    /* ===================================================================== */

    sanitizeMetadata(
        metadata = {}
    ) {

        const clone = {

            ...metadata
        };

        const sensitiveFields = [

            "password",
            "pin",
            "token",
            "jwt",
            "secret",
            "accessToken",
            "refreshToken"
        ];

        sensitiveFields.forEach(

            field => {

                if (
                    clone[field]
                ) {

                    clone[field] =
                        "[REDACTED]";
                }
            }
        );

        return clone;
    }

    /* ===================================================================== */
    /* BUILD ERROR EVENT                                                     */
    /* ===================================================================== */

    buildErrorEvent(
        error,
        context = {}
    ) {

        return {

            errorId:
                this.generateErrorId(),

            fingerprint:
                this.generateFingerprint(
                    error
                ),

            timestamp:
                new Date()
                    .toISOString(),

            category:
                context.category ||

                ERROR_CATEGORY
                    .APPLICATION,

            severity:
                context.severity ||

                ERROR_SEVERITY
                    .MEDIUM,

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            service:
                context.service,

            operation:
                context.operation,

            statusCode:
                context.statusCode,

            errorName:
                error.name,

            message:
                error.message,

            stack:
                error.stack,

            metadata:
                this.sanitizeMetadata(
                    context.metadata
                )
        };
    }

    /* ===================================================================== */
    /* CORE ERROR LOGGING                                                    */
    /* ===================================================================== */

    async log(
        error,
        context = {}
    ) {

        const event =
            this.buildErrorEvent(
                error,
                context
            );

        logger.error(

            event.message,

            event
        );

        try {

            prometheusService
                ?.incrementError?.(

                    context.service ||

                    "application",

                    context.operation ||

                    "unknown"
                );

        } catch (_) {}

        if (
            event.severity ===
            ERROR_SEVERITY.CRITICAL
        ) {

            try {

                await auditLogger?.security?.({

                    tenantId:
                        event.tenantId,

                    userId:
                        event.userId,

                    requestId:
                        event.requestId,

                    correlationId:
                        event.correlationId,

                    action:
                        "CRITICAL_ERROR",

                    metadata: {

                        errorId:
                            event.errorId,

                        category:
                            event.category
                    }
                });

            } catch (_) {}
        }

        return event;
    }

    /* ===================================================================== */
    /* REQUEST ERRORS                                                       */
    /* ===================================================================== */

    async fromRequest(
        req,
        error,
        context = {}
    ) {

        return this.log(

            error,

            {

                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                ip:
                    req.ip,

                userAgent:
                    req.headers[
                        "user-agent"
                    ],

                ...context
            }
        );
    }

    /* ===================================================================== */
    /* DATABASE ERRORS                                                      */
    /* ===================================================================== */

    async database(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .DATABASE,

                severity:
                    ERROR_SEVERITY
                        .HIGH,

                service:
                    "database",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* VALIDATION ERRORS                                                    */
    /* ===================================================================== */

    async validation(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .VALIDATION,

                severity:
                    ERROR_SEVERITY
                        .LOW,

                service:
                    "validation",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* SECURITY ERRORS                                                      */
    /* ===================================================================== */

    async security(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .SECURITY,

                severity:
                    ERROR_SEVERITY
                        .CRITICAL,

                service:
                    "security",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* AML ERRORS                                                           */
    /* ===================================================================== */

    async aml(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .AML,

                severity:
                    ERROR_SEVERITY
                        .HIGH,

                service:
                    "aml",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* FRAUD ERRORS                                                         */
    /* ===================================================================== */

    async fraud(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .FRAUD,

                severity:
                    ERROR_SEVERITY
                        .CRITICAL,

                service:
                    "fraud",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* BILLING ERRORS                                                       */
    /* ===================================================================== */

    async billing(
        error,
        metadata = {}
    ) {

        return this.log(

            error,

            {

                category:
                    ERROR_CATEGORY
                        .BILLING,

                severity:
                    ERROR_SEVERITY
                        .HIGH,

                service:
                    "billing",

                ...metadata
            }
        );
    }

    /* ===================================================================== */
    /* METADATA                                                             */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            service:
                "error-logger",

            timestamp:
                new Date()
                    .toISOString(),

            supportedCategories:
                Object.keys(
                    ERROR_CATEGORY
                ),

            supportedSeverities:
                Object.keys(
                    ERROR_SEVERITY
                )
        };
    }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

const errorLogger =
    new ErrorLogger();

module.exports =
    errorLogger;

module.exports.ErrorLogger =
    ErrorLogger;

module.exports.ERROR_CATEGORY =
    ERROR_CATEGORY;

module.exports.ERROR_SEVERITY =
    ERROR_SEVERITY;