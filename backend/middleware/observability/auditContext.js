"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Audit Context Middleware
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * • Build immutable audit context
 * • Capture request identity
 * • Capture tenant & user identity
 * • Capture authorization snapshot
 * • Capture client metadata
 * • Provide audit enrichment helpers
 * • Publish lifecycle events
 * • Support downstream audit logging
 * *
 * NOTE:
 * This middleware DOES NOT persist audit logs.
 * It only prepares immutable audit metadata.
 * ============================================================================
 */

const crypto = require("crypto");

const { MiddlewareBootstrapError } = require("../errors");

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    publishEvents: true,
    freezeContext: true,
    includeHeaders: false
});

/**
 * Deep freeze helper
 */
function deepFreeze(value) {

    if (
        value &&
        typeof value === "object" &&
        !Object.isFrozen(value)
    ) {

        Object.freeze(value);

        Object.getOwnPropertyNames(value)
            .forEach((property) => {

                deepFreeze(value[property]);

            });

    }

    return value;

}

/**
 * Create immutable audit identifier
 */
function createAuditId() {

    return crypto.randomUUID();

}

/**
 * Build audit context
 */
function buildAuditContext(req) {

    const context = {

        auditId:
            createAuditId(),

        timestamp:
            new Date().toISOString(),

        requestId:
            req.requestId || null,

        correlationId:
            req.correlationId || null,

        traceId:
            req.traceId || null,

        tenantId:
            req.tenantContext?.tenantId ||
            req.tenantId ||
            null,

        tenantCode:
            req.tenantContext?.tenantCode ||
            null,

        userId:
            req.userContext?.userId ||
            null,

        username:
            req.userContext?.username ||
            null,

        roles:
            [...(req.authorizationContext?.roles || [])],

        permissions:
            [...(req.authorizationContext?.permissions || [])],

        authenticated:
            Boolean(req.authorizationContext?.authenticated),

        method:
            req.method,

        path:
            req.originalUrl,

        route:
            req.route?.path || null,

        ip:
            req.ip,

        protocol:
            req.protocol,

        hostname:
            req.hostname,

        userAgent:
            req.get("user-agent"),

        featurePlan:
            req.featureContext?.plan || null,

        requestStartedAt:
            req.performance?.startedAt || Date.now()

    };

    return context;

}

/**
 * Enterprise factory
 */
function auditContextFactory(context = {}) {

    const config = {
        ...DEFAULT_CONFIG,
        ...(context.config?.auditContext || {})
    };

    const logger =
        context.logger;

    const runtimeContext =
        context.runtimeContext;

    return function auditContextMiddleware(req, res, next) {

        try {

            if (!config.enabled) {
                return next();
            }

            let auditContext =
                buildAuditContext(req);

            /**
             * Optional headers
             */
            if (config.includeHeaders) {

                auditContext.headers = {
                    ...req.headers
                };

            }

            /**
             * Immutable context
             */
            if (config.freezeContext) {

                auditContext =
                    deepFreeze(auditContext);

            }

            /**
             * Helper methods
             */
            req.auditContext = auditContext;

            req.createAuditEvent = function createAuditEvent(event = {}) {

                return {

                    ...auditContext,

                    eventId:
                        crypto.randomUUID(),

                    occurredAt:
                        new Date().toISOString(),

                    ...event

                };

            };

            req.createChildAuditContext =
                function createChildAuditContext(operation) {

                    return {

                        ...auditContext,

                        operation,

                        parentAuditId:
                            auditContext.auditId,

                        childAuditId:
                            crypto.randomUUID()

                    };

                };

            /**
             * Runtime lifecycle event
             */
            if (
                config.publishEvents &&
                runtimeContext?.eventBus?.emit
            ) {

                runtimeContext.eventBus.emit(
                    "audit.context.created",
                    {
                        requestId: auditContext.requestId,
                        correlationId: auditContext.correlationId,
                        tenantId: auditContext.tenantId,
                        userId: auditContext.userId
                    }
                );

            }

            logger?.debug?.(
                {
                    requestId: auditContext.requestId,
                    tenantId: auditContext.tenantId,
                    userId: auditContext.userId
                },
                "Audit context established"
            );

            next();

        } catch (error) {

            logger?.error?.(
                {
                    error,
                    middleware: "auditContext"
                },
                "Audit context middleware failure"
            );

            next(
                error instanceof MiddlewareBootstrapError
                    ? error
                    : new MiddlewareBootstrapError(
                        "Failed to establish audit context",
                        {
                            error: error.message
                        }
                    )
            );

        }

    };

}

/**
 * Health check
 */
async function healthCheck() {

    return {

        status: "healthy",

        component: "auditContext"

    };

}

module.exports = {

    name: "auditContext",

    version: "1.0.0",

    description:
        "Enterprise immutable audit context middleware",

    category: "observability",

    phase: "observability",

    priority: 340,

    critical: true,

    dependencies: [

        "requestContext",

        "clientInfo",

        "tenantContext?",

        "userContext?",

        "authorizationContext?",

        "featureContext?",

        "performance?"

    ],

    factory: auditContextFactory,

    healthCheck,

    metadata: {

        owner:
            "platform-audit",

        tags: [

            "audit",

            "compliance",

            "traceability",

            "fintech",

            "observability"

        ]

    }

};