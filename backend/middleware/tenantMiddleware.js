"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/middleware/tenantMiddleware.js
 * Enterprise Multi-Tenant Context Middleware
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ JWT Authentication Verification
 * ✓ Tenant Resolution
 * ✓ Tenant Validation
 * ✓ Request Context Enrichment
 * ✓ Correlation Tracking
 * ✓ Multi-Tenant Isolation
 * ✓ Enterprise Logging
 * ✓ Security Enforcement
 *
 * Headers Supported
 * ----------------------------------------------------------------------------
 * Authorization: Bearer <token>
 * X-Tenant-ID: <tenant-id>
 * X-Request-ID: <request-id>
 * X-Correlation-ID: <correlation-id>
 * ============================================================================
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const tenantService =
    require("../services/tenantService");

const logger =
    require("../utils/logger");

/* ============================================================================
 * Constants
 * ========================================================================== */

const CONTEXT_HEADERS = Object.freeze({

    TENANT_ID:
        "x-tenant-id",

    REQUEST_ID:
        "x-request-id",

    CORRELATION_ID:
        "x-correlation-id"
});

/* ============================================================================
 * Helpers
 * ========================================================================== */

function createRequestId() {

    return crypto.randomUUID();
}

function createCorrelationId() {

    return crypto.randomUUID();
}

function extractBearerToken(
    authorization
) {

    if (!authorization) {

        return null;
    }

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {

        return null;
    }

    return authorization.split(
        " "
    )[1];
}

function unauthorized(
    res,
    message
) {

    return res.status(401).json({

        success: false,

        code:
            "UNAUTHORIZED",

        message
    });
}

function forbidden(
    res,
    message
) {

    return res.status(403).json({

        success: false,

        code:
            "FORBIDDEN",

        message
    });
}

function badRequest(
    res,
    message
) {

    return res.status(400).json({

        success: false,

        code:
            "BAD_REQUEST",

        message
    });
}

/* ============================================================================
 * Middleware
 * ========================================================================== */

module.exports = async function tenantMiddleware(
    req,
    res,
    next
) {

    try {

        /* -------------------------------------------------------------------
         * Request Context
         * ---------------------------------------------------------------- */

        req.requestId =

            req.requestId ||

            req.headers[
                CONTEXT_HEADERS.REQUEST_ID
            ] ||

            createRequestId();

        req.correlationId =

            req.correlationId ||

            req.headers[
                CONTEXT_HEADERS.CORRELATION_ID
            ] ||

            createCorrelationId();

        /* -------------------------------------------------------------------
         * Authorization
         * ---------------------------------------------------------------- */

        const authorization =
            req.headers.authorization;

        const token =
            extractBearerToken(
                authorization
            );

        if (!token) {

            logger.warn(
                "Authorization token missing",
                {
                    requestId:
                        req.requestId
                }
            );

            return unauthorized(
                res,
                "Authentication token required."
            );
        }

        /* -------------------------------------------------------------------
         * Verify JWT
         * ---------------------------------------------------------------- */

        let decoded;

        try {

            decoded = jwt.verify(
                token,
                process.env.JWT_SECRET,
                {
                    algorithms: ["HS256"],
                    ignoreExpiration: false
                }
            );

        } catch (error) {

            logger.warn(
                "JWT validation failed",
                {
                    requestId:
                        req.requestId,

                    error:
                        error.message
                }
            );

            return unauthorized(
                res,
                "Invalid or expired token."
            );
        }

        /* -------------------------------------------------------------------
         * Claims Validation
         * ---------------------------------------------------------------- */

        if (
            !decoded.tenantId ||
            !decoded.userId
        ) {

            return forbidden(
                res,
                "Required tenant claims are missing."
            );
        }

        /* -------------------------------------------------------------------
         * Tenant Header Validation
         * ---------------------------------------------------------------- */

        const tenantHeader =

            req.headers[
                CONTEXT_HEADERS.TENANT_ID
            ];

        const tenantId =

            tenantHeader ||

            decoded.tenantId;

        if (!tenantId) {

            return badRequest(
                res,
                "Tenant identifier required."
            );
        }

        /* -------------------------------------------------------------------
         * Security Check
         *
         * Prevent cross-tenant access.
         * ---------------------------------------------------------------- */

        if (
            tenantHeader &&
            tenantHeader !== decoded.tenantId
        ) {

            logger.warn(
                "Tenant mismatch detected",
                {
                    requestId:
                        req.requestId,

                    tokenTenant:
                        decoded.tenantId,

                    headerTenant:
                        tenantHeader
                }
            );

            return forbidden(
                res,
                "Tenant access violation detected."
            );
        }

        /* -------------------------------------------------------------------
         * Load Tenant
         * ---------------------------------------------------------------- */

        const tenant =
            await tenantService.findById(
                tenantId
            );

        if (!tenant) {

            return res.status(404).json({

                success: false,

                code:
                    "TENANT_NOT_FOUND",

                message:
                    "Tenant not found."
            });
        }

        if (
            tenant.status &&
            tenant.status !== "ACTIVE"
        ) {

            return forbidden(
                res,
                "Tenant is inactive."
            );
        }

        /* -------------------------------------------------------------------
         * Attach Request Context
         * ---------------------------------------------------------------- */

        req.tenant = tenant;

        req.tenantId =
            tenant.id || tenant._id;

        req.user = {

            id:
                decoded.userId,

            email:
                decoded.email,

            role:
                decoded.role,

            permissions:
                decoded.permissions || []
        };

        req.userId =
            decoded.userId;

        req.role =
            decoded.role;

        req.securityContext = {

            authenticated: true,

            tenantId:
                req.tenantId,

            userId:
                req.userId,

            role:
                req.role
        };

        /* -------------------------------------------------------------------
         * Response Headers
         * ---------------------------------------------------------------- */

        res.setHeader(
            "X-Request-ID",
            req.requestId
        );

        res.setHeader(
            "X-Correlation-ID",
            req.correlationId
        );

        /* -------------------------------------------------------------------
         * Logging
         * ---------------------------------------------------------------- */

        logger.info(
            "Tenant context attached",
            {
                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                role:
                    req.role,

                requestId:
                    req.requestId
            }
        );

        return next();

    } catch (error) {

        logger.error(
            "Tenant middleware error",
            {
                message:
                    error.message,

                stack:
                    error.stack
            }
        );

        return res.status(500).json({

            success: false,

            code:
                "TENANT_MIDDLEWARE_ERROR",

            message:
                "Internal server error."
        });
    }
};