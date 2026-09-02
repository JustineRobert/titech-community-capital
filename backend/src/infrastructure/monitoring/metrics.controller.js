"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/infrastructure/monitoring/metrics.controller.js
 * Enterprise Metrics Controller
 * ============================================================================
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 * GET /metrics
 * GET /metrics/summary
 * GET /metrics/business
 * GET /metrics/tenant/:tenantId
 *
 * Supports
 * ----------------------------------------------------------------------------
 * ✓ Prometheus
 * ✓ Grafana
 * ✓ Azure Monitor
 * ✓ CloudWatch
 * ✓ Kubernetes
 * ============================================================================
 */

const os = require("os");

const prometheusService =
    require("./prometheus.service");

const logger =
    require("../../utils/logger");

/* ============================================================================
 * Metrics Controller
 * ========================================================================== */

class MetricsController {

    constructor() {

        this.startedAt =
            new Date();
    }

    /* ===================================================================== */
    /* RAW PROMETHEUS METRICS                                                */
    /* ===================================================================== */

    async metrics(
        req,
        res
    ) {

        try {

            res.set(

                "Content-Type",

                prometheusService.contentType()
            );

            return res.end(

                await prometheusService.metrics()
            );

        } catch (error) {

            logger.error(
                "Metrics endpoint failed",
                {
                    error:
                        error.message
                }
            );

            return res.status(500).json({

                success: false,

                message:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* SUMMARY METRICS                                                       */
    /* ===================================================================== */

    async summary(
        req,
        res
    ) {

        try {

            return res.status(200).json({

                success: true,

                service:
                    "metrics",

                timestamp:
                    new Date().toISOString(),

                uptimeSeconds:
                    process.uptime(),

                memory:
                    process.memoryUsage(),

                platform:
                    os.platform(),

                version:
                    process.env.APP_VERSION ||
                    "1.0.0"
            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* BUSINESS METRICS                                                      */
    /* ===================================================================== */

    async businessMetrics(
        req,
        res
    ) {

        try {

            return res.status(200).json({

                success: true,

                generatedAt:
                    new Date().toISOString(),

                businessMetrics: {

                    savings: {

                        metric:
                            "titech_savings_transactions_total"
                    },

                    loans: {

                        metric:
                            "titech_loan_applications_total"
                    },

                    billing: {

                        metric:
                            "titech_billing_invoices_total"
                    },

                    mobileMoney: {

                        metric:
                            "titech_mobile_money_transactions_total"
                    },

                    ussd: {

                        metric:
                            "titech_ussd_requests_total"
                    }
                }
            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* TENANT METRICS                                                        */
    /* ===================================================================== */

    async tenantMetrics(
        req,
        res
    ) {

        try {

            const tenantId =
                req.params.tenantId;

            return res.status(200).json({

                success: true,

                tenantId,

                generatedAt:
                    new Date().toISOString(),

                note:
                    "Tenant-specific metrics are collected through Prometheus labels."
            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* SAVINGS METRICS                                                       */
    /* ===================================================================== */

    async savingsMetrics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            metrics: [

                "titech_savings_transactions_total",

                "titech_savings_balance_total"
            ]
        });
    }

    /* ===================================================================== */
    /* LOAN METRICS                                                          */
    /* ===================================================================== */

    async loanMetrics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            metrics: [

                "titech_loan_applications_total",

                "titech_loan_portfolio_total"
            ]
        });
    }

    /* ===================================================================== */
    /* BILLING METRICS                                                       */
    /* ===================================================================== */

    async billingMetrics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            metrics: [

                "titech_billing_invoices_total",

                "titech_billing_revenue_total"
            ]
        });
    }

    /* ===================================================================== */
    /* MOBILE MONEY METRICS                                                  */
    /* ===================================================================== */

    async mobileMoneyMetrics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            metrics: [

                "titech_mobile_money_transactions_total"
            ]
        });
    }

    /* ===================================================================== */
    /* COMPLIANCE METRICS                                                    */
    /* ===================================================================== */

    async complianceMetrics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            metrics: [

                "titech_audit_events_total",

                "titech_aml_alerts_total",

                "titech_fraud_alerts_total"
            ]
        });
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    async diagnostics(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            service:
                "metrics-controller",

            uptime:
                process.uptime(),

            pid:
                process.pid,

            memory:
                process.memoryUsage(),

            cpuCores:
                os.cpus().length,

            timestamp:
                new Date().toISOString()
        });
    }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

const metricsController =
    new MetricsController();

module.exports =
    metricsController;

module.exports.MetricsController =
    MetricsController;