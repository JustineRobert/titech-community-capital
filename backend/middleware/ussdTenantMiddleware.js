"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/middleware/ussdTenantMiddleware.js
 * Enterprise USSD Tenant Resolution Middleware
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Tenant Resolution
 * ✓ Service Code Mapping
 * ✓ Tenant Validation
 * ✓ Request Correlation
 * ✓ Feature Flag Validation
 * ✓ Provider Validation
 * ✓ Multi-Tenant Enforcement
 * ✓ Observability Integration
 * ✓ Enterprise Logging
 * ============================================================================
 */

const crypto = require("crypto");

const tenantService =
    require("../services/tenantService");

const featureFlagService =
    require("../services/featureFlagService");

const metricsService =
    require("../services/metricsService");

const logger =
    require("../utils/logger");

/* ============================================================================
 * Constants
 * ========================================================================== */

const HEADERS = Object.freeze({

    TENANT_ID:
        "x-tenant-id",

    REQUEST_ID:
        "x-request-id",

    CORRELATION_ID:
        "x-correlation-id",

    PROVIDER:
        "x-ussd-provider"
});

const SUPPORTED_PROVIDERS = [

    "AFRICASTALKING",

    "MTN",

    "AIRTEL"
];

/* ============================================================================
 * Helpers
 * ========================================================================== */

function createRequestId() {

    return crypto.randomUUID();
}

function createCorrelationId() {

    return crypto.randomUUID();
}

function endResponse(
    res,
    status,
    message
) {

    return res
        .status(status)
        .type("text/plain")
        .send(`END ${message}`);
}

/* ============================================================================
 * Tenant Resolution
 * ========================================================================== */

async function resolveTenant(
    req
) {

    const tenantHeader =

        req.headers[
            HEADERS.TENANT_ID
        ];

    if (tenantHeader) {

        return tenantService.findById(
            tenantHeader
        );
    }

    const serviceCode =
        req.body?.serviceCode;

    if (serviceCode) {

        if (
            typeof tenantService
                .findByServiceCode ===
            "function"
        ) {

            return tenantService
                .findByServiceCode(
                    serviceCode
                );
        }
    }

    return null;
}

/* ============================================================================
 * Provider Validation
 * ========================================================================== */

function validateProvider(
    req
) {

    const provider =
        String(

            req.headers[
                HEADERS.PROVIDER
            ] ||

            "UNKNOWN"

        ).toUpperCase();

    if (
        provider === "UNKNOWN"
    ) {

        return true;
    }

    return SUPPORTED_PROVIDERS.includes(
        provider
    );
}

/* ============================================================================
 * Tenant Middleware
 * ========================================================================== */

module.exports = async function ussdTenantMiddleware(
    req,
    res,
    next
) {

    const startedAt =
        Date.now();

    try {

        /* -------------------------------------------------------------------
         * Request Context
         * ---------------------------------------------------------------- */

        req.requestId =

            req.requestId ||

            req.headers[
                HEADERS.REQUEST_ID
            ] ||

            createRequestId();

        req.correlationId =

            req.correlationId ||

            req.headers[
                HEADERS.CORRELATION_ID
            ] ||

            createCorrelationId();

        /* -------------------------------------------------------------------
         * Provider Validation
         * ---------------------------------------------------------------- */

        if (
            !validateProvider(req)
        ) {

            logger.warn(
                "Unsupported USSD provider",
                {
                    requestId:
                        req.requestId
                }
            );

            return endResponse(
                res,
                403,
                "Provider not supported."
            );
        }

        /* -------------------------------------------------------------------
         * Resolve Tenant
         * ---------------------------------------------------------------- */

        const tenant =
            await resolveTenant(
                req
            );

        if (!tenant) {

            metricsService?.increment?.(
                "titech.ussd.tenant.not_found"
            );

            logger.warn(
                "USSD tenant not found",
                {
                    requestId:
                        req.requestId,

                    serviceCode:
                        req.body?.serviceCode
                }
            );

            return endResponse(
                res,
                404,
                "Tenant unavailable."
            );
        }

        /* -------------------------------------------------------------------
         * Tenant Status Validation
         * ---------------------------------------------------------------- */

        const tenantStatus =

            String(
                tenant.status || ""
            ).toUpperCase();

        if (

            tenantStatus &&
            tenantStatus !== "ACTIVE"

        ) {

            metricsService?.increment?.(
                "titech.ussd.tenant.inactive"
            );

            logger.warn(
                "Inactive tenant access",
                {
                    tenantId:
                        tenant.id
                }
            );

            return endResponse(
                res,
                403,
                "Service unavailable."
            );
        }

        /* -------------------------------------------------------------------
         * USSD Feature Flag
         * ---------------------------------------------------------------- */

        if (
            typeof featureFlagService
                .isEnabled === "function"
        ) {

            const enabled =

                await featureFlagService
                    .isEnabled(

                        "ussd",

                        tenant.id
                    );

            if (!enabled) {

                return endResponse(
                    res,
                    403,
                    "USSD service disabled."
                );
            }
        }

        /* -------------------------------------------------------------------
         * Attach Tenant Context
         * ---------------------------------------------------------------- */

        req.tenant = tenant;

        req.tenantId =
            tenant.id ||
            tenant._id;

        req.tenantContext = {

            id:
                req.tenantId,

            code:
                tenant.code,

            name:
                tenant.name,

            status:
                tenant.status,

            tier:
                tenant.subscriptionTier,

            region:
                tenant.region
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

        res.setHeader(
            "X-Tenant-ID",
            req.tenantId
        );

        /* -------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------- */

        metricsService?.increment?.(
            "titech.ussd.tenant.resolved"
        );

        /* -------------------------------------------------------------------
         * Logging
         * ---------------------------------------------------------------- */

        logger.info(
            "USSD tenant resolved",
            {

                tenantId:
                    req.tenantId,

                tenantName:
                    tenant.name,

                serviceCode:
                    req.body?.serviceCode,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId
            }
        );

        /* -------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------- */

        req.ussdDiagnostics = {

            middleware:
                "ussdTenantMiddleware",

            resolvedAt:
                new Date()
                    .toISOString(),

            durationMs:
                Date.now() -
                startedAt
        };

        return next();

    } catch (error) {

        metricsService?.increment?.(
            "titech.ussd.tenant.error"
        );

        logger.error(
            "USSD tenant resolution failed",
            {
                error:
                    error.message,

                stack:
                    error.stack
            }
        );

        return endResponse(
            res,
            500,
            "Service temporarily unavailable."
        );
    }
};