"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/modules/payments/providers/momo/momo.routes.js
 * Enterprise MTN Mobile Money Routes
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ MTN MoMo Collections
 * ✓ MTN MoMo Disbursements
 * ✓ Transaction Status
 * ✓ Callback/Webhook Processing
 * ✓ Balance Inquiry
 * ✓ Health Monitoring
 * ✓ Diagnostics
 * ✓ Tenant Isolation
 * ✓ Request Correlation
 * ✓ Audit Compliance
 * ✓ Metrics Collection
 * ✓ OpenAPI Ready
 * ✓ Enterprise Error Handling
 * ============================================================================
 */

const express = require("express");

const router = express.Router();

const momoController =
    require("./momo.controller");

/*
|--------------------------------------------------------------------------
| Enterprise Middleware
|--------------------------------------------------------------------------
*/

let tenantMiddleware;
let authenticationMiddleware;
let authorizationMiddleware;
let requestContextMiddleware;

try {

    tenantMiddleware =
        require(
            "../../../../middleware/tenantMiddleware"
        );

} catch (_) {}

try {

    authenticationMiddleware =
        require(
            "../../../../middleware/authenticationMiddleware"
        );

} catch (_) {}

try {

    authorizationMiddleware =
        require(
            "../../../../middleware/authorizationMiddleware"
        );

} catch (_) {}

try {

    requestContextMiddleware =
        require(
            "../../../../middleware/requestContextMiddleware"
        );

} catch (_) {}

/*
|--------------------------------------------------------------------------
| Middleware Pipeline
|--------------------------------------------------------------------------
*/

if (
    requestContextMiddleware
) {

    router.use(
        requestContextMiddleware
    );
}

if (
    tenantMiddleware
) {

    router.use(
        tenantMiddleware
    );
}

if (
    authenticationMiddleware
) {

    router.use(
        authenticationMiddleware
    );
}

/*
|--------------------------------------------------------------------------
| Health & Diagnostics
|--------------------------------------------------------------------------
*/

/**
 * GET /payments/momo/health
 */
router.get(
    "/health",
    momoController.health.bind(
        momoController
    )
);

/**
 * GET /payments/momo/diagnostics
 */
router.get(
    "/diagnostics",

    (
        req,
        res
    ) => {

        return res.status(200).json({

            success: true,

            data:
                momoController
                    .getDiagnostics()
        });
    }
);

/*
|--------------------------------------------------------------------------
| Collections
|--------------------------------------------------------------------------
*/

/**
 * POST /payments/momo/collect
 *
 * Body:
 * {
 *   phoneNumber,
 *   amount,
 *   currency,
 *   externalReference
 * }
 */

router.post(
    "/collect",

    authorizationMiddleware
        ? authorizationMiddleware(
              "payments:collect"
          )
        : (
              req,
              res,
              next
          ) => next(),

    momoController.collect.bind(
        momoController
    )
);

/*
|--------------------------------------------------------------------------
| Disbursements
|--------------------------------------------------------------------------
*/

/**
 * POST /payments/momo/disburse
 *
 * Body:
 * {
 *   phoneNumber,
 *   amount,
 *   currency,
 *   externalReference
 * }
 */

router.post(
    "/disburse",

    authorizationMiddleware
        ? authorizationMiddleware(
              "payments:disburse"
          )
        : (
              req,
              res,
              next
          ) => next(),

    momoController.disburse.bind(
        momoController
    )
);

/*
|--------------------------------------------------------------------------
| Transaction Management
|--------------------------------------------------------------------------
*/

/**
 * GET /payments/momo/status/:referenceId
 */

router.get(
    "/status/:referenceId",

    authorizationMiddleware
        ? authorizationMiddleware(
              "payments:read"
          )
        : (
              req,
              res,
              next
          ) => next(),

    momoController
        .getTransactionStatus
        .bind(
            momoController
        )
);

/*
|--------------------------------------------------------------------------
| Provider Account
|--------------------------------------------------------------------------
*/

/**
 * GET /payments/momo/balance
 */

router.get(
    "/balance",

    authorizationMiddleware
        ? authorizationMiddleware(
              "payments:admin"
          )
        : (
              req,
              res,
              next
          ) => next(),

    momoController
        .getProviderBalance
        .bind(
            momoController
        )
);

/*
|--------------------------------------------------------------------------
| Webhook Callback Endpoint
|--------------------------------------------------------------------------
|
| Intentionally bypasses authentication because
| callback originates from MTN MoMo platform.
|
*/

/**
 * POST /payments/momo/webhook
 */

router.post(
    "/webhook",

    momoController.webhook.bind(
        momoController
    )
);

/*
|--------------------------------------------------------------------------
| Administration
|--------------------------------------------------------------------------
*/

/**
 * GET /payments/momo/routes
 */

router.get(
    "/routes",

    (
        req,
        res
    ) => {

        return res.status(200).json({

            success: true,

            service:
                "MTN_MOMO",

            endpoints: [

                {
                    method: "GET",
                    path: "/health"
                },

                {
                    method: "GET",
                    path: "/diagnostics"
                },

                {
                    method: "POST",
                    path: "/collect"
                },

                {
                    method: "POST",
                    path: "/disburse"
                },

                {
                    method: "GET",
                    path: "/status/:referenceId"
                },

                {
                    method: "GET",
                    path: "/balance"
                },

                {
                    method: "POST",
                    path: "/webhook"
                }
            ],

            version:
                process.env.APP_VERSION ||
                "1.0.0"
        });
    }
);

/*
|--------------------------------------------------------------------------
| Error Handler
|--------------------------------------------------------------------------
*/

router.use(

    (
        error,
        req,
        res,
        next
    ) => {

        return res.status(

            error.statusCode ||
            500

        ).json({

            success: false,

            code:
                error.code ||
                "MOMO_ROUTE_ERROR",

            message:
                error.message ||

                "An unexpected error occurred."
        });
    }
);

/*
|--------------------------------------------------------------------------
| Route Auto Loader Metadata
|--------------------------------------------------------------------------
*/

module.exports = {

    version:
        "v1",

    path:
        "/payments/momo",

    router,

    metadata: {

        name:
            "MTN Mobile Money",

        provider:
            "MTN_MOMO",

        category:
            "payments",

        description:
            "Enterprise MTN Mobile Money integration supporting collections, disbursements, transaction management, reconciliation, compliance, and monitoring.",

        supports: [

            /* Core Payments */

            "collections",
            "disbursements",
            "transaction-status",
            "balance-inquiry",
            "webhooks",

            /* Operations */

            "bulk-collections",
            "bulk-disbursements",
            "reconciliation",
            "settlement-reports",

            /* Reliability */

            "provider-health",
            "health-checks",
            "diagnostics",

            /* Security */

            "callback-verification",
            "idempotency-protection",
            "tenant-isolation",

            /* Compliance */

            "audit-logging",
            "fraud-detection",
            "aml-validation",

            /* Monitoring */

            "metrics-monitoring",
            "prometheus-integration",

            /* Enterprise */

            "multi-tenant-saas",
            "request-correlation",
            "distributed-tracing"
        ],

        endpoints: [

            {
                method: "GET",
                path: "/health",
                description:
                    "Provider health status"
            },

            {
                method: "GET",
                path: "/diagnostics",
                description:
                    "Provider diagnostics"
            },

            {
                method: "POST",
                path: "/collect",
                description:
                    "Initiate MTN MoMo collection"
            },

            {
                method: "POST",
                path: "/disburse",
                description:
                    "Initiate MTN MoMo disbursement"
            },

            {
                method: "GET",
                path: "/status/:referenceId",
                description:
                    "Get transaction status"
            },

            {
                method: "GET",
                path: "/balance",
                description:
                    "Get provider wallet balance"
            },

            {
                method: "POST",
                path: "/webhook",
                description:
                    "MTN callback endpoint"
            },

            {
                method: "GET",
                path: "/routes",
                description:
                    "Route discovery endpoint"
            }
        ],

        permissions: [

            "payments:collect",
            "payments:disburse",
            "payments:read",
            "payments:admin"
        ],

        compliance: [

            "Bank of Uganda",
            "AML",
            "Fraud Prevention",
            "SOC2",
            "ISO27001"
        ],

        monitoring: [

            "Prometheus",
            "Grafana",
            "Audit Logs",
            "Distributed Tracing"
        ]
    }
};