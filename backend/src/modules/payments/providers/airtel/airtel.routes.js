"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: airtel.routes.js
 * Enterprise Airtel Money Routes
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Airtel Collections
 * ✓ Airtel Disbursements
 * ✓ Transaction Status
 * ✓ Webhook Processing
 * ✓ Provider Balance Inquiry
 * ✓ Health Monitoring
 * ✓ Diagnostics
 * ✓ Tenant Isolation
 * ✓ Authentication
 * ✓ Authorization
 * ✓ Audit Logging
 * ✓ Metrics Collection
 * ✓ Route Discovery
 * ✓ OpenAPI Ready
 * ============================================================================
 */

const express = require("express");

const router = express.Router();

const airtelController =
    require("./airtel.controller");

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

if (requestContextMiddleware) {

    router.use(
        requestContextMiddleware
    );
}

if (tenantMiddleware) {

    router.use(
        tenantMiddleware
    );
}

if (authenticationMiddleware) {

    router.use(
        authenticationMiddleware
    );
}

/*
|--------------------------------------------------------------------------
| Health & Diagnostics
|--------------------------------------------------------------------------
*/

router.get(
    "/health",
    airtelController.health.bind(
        airtelController
    )
);

router.get(
    "/diagnostics",

    (
        req,
        res
    ) => {

        return res.status(200).json({

            success: true,

            data:
                airtelController
                    .getDiagnostics()
        });
    }
);

/*
|--------------------------------------------------------------------------
| Collections
|--------------------------------------------------------------------------
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

    airtelController.collect.bind(
        airtelController
    )
);

/*
|--------------------------------------------------------------------------
| Disbursements
|--------------------------------------------------------------------------
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

    airtelController.disburse.bind(
        airtelController
    )
);

/*
|--------------------------------------------------------------------------
| Transaction Status
|--------------------------------------------------------------------------
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

    airtelController
        .getTransactionStatus
        .bind(
            airtelController
        )
);

/*
|--------------------------------------------------------------------------
| Provider Balance
|--------------------------------------------------------------------------
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

    airtelController
        .getProviderBalance
        .bind(
            airtelController
        )
);

/*
|--------------------------------------------------------------------------
| Webhook Callback Endpoint
|--------------------------------------------------------------------------
|
| Authentication intentionally bypassed.
| Airtel Money platform posts directly.
|
*/

router.post(

    "/webhook",

    airtelController.webhook.bind(
        airtelController
    )
);

/*
|--------------------------------------------------------------------------
| Route Discovery
|--------------------------------------------------------------------------
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
                "AIRTEL_MONEY",

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
| Enterprise Error Handler
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
                "AIRTEL_ROUTE_ERROR",

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
        "/payments/airtel",

    router,

    metadata: {

        name:
            "Airtel Money",

        provider:
            "AIRTEL_MONEY",

        category:
            "payments",

        description:
            "Enterprise Airtel Money integration supporting collections, disbursements, transaction management, reconciliation, compliance, audit logging and monitoring.",

        supports: [

            /* Core Payments */

            "collections",
            "disbursements",
            "transaction-status",
            "balance-inquiry",
            "webhooks",

            /* Enterprise Operations */

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
            "aml-validation",
            "fraud-detection",

            /* Monitoring */

            "metrics-monitoring",
            "prometheus-integration",

            /* Architecture */

            "multi-tenant-saas",
            "request-correlation",
            "distributed-tracing"
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