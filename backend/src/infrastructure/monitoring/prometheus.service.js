"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Infrastructure Monitoring
 * Prometheus Service
 * ============================================================================
 */

const promClient =
    require("prom-client");

/* ============================================================================
 * Registry
 * ========================================================================== */

const register =
    new promClient.Registry();

promClient.collectDefaultMetrics({
    register
});

/* ============================================================================
 * Common Labels
 * ========================================================================== */

register.setDefaultLabels({

    application:
        "titech-community-capital",

    environment:
        process.env.NODE_ENV || "development"
});

/* ============================================================================
 * HTTP REQUESTS
 * ========================================================================== */

const httpRequestsTotal =
    new promClient.Counter({

        name:
            "titech_http_requests_total",

        help:
            "Total HTTP requests",

        labelNames: [

            "method",
            "route",
            "status"
        ]
    });

/* ============================================================================
 * REQUEST DURATION
 * ========================================================================== */

const httpRequestDuration =
    new promClient.Histogram({

        name:
            "titech_http_request_duration_seconds",

        help:
            "HTTP request duration",

        labelNames: [

            "method",
            "route"
        ],

        buckets: [

            0.05,
            0.1,
            0.3,
            0.5,
            1,
            2,
            5
        ]
    });

/* ============================================================================
 * SAVINGS METRICS
 * ========================================================================== */

const savingsTransactions =
    new promClient.Counter({

        name:
            "titech_savings_transactions_total",

        help:
            "Savings transactions",

        labelNames: [

            "tenantId",
            "type"
        ]
    });

const savingsBalanceGauge =
    new promClient.Gauge({

        name:
            "titech_savings_balance_total",

        help:
            "Total savings balance",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * LOAN METRICS
 * ========================================================================== */

const loanApplications =
    new promClient.Counter({

        name:
            "titech_loan_applications_total",

        help:
            "Loan applications",

        labelNames: [

            "tenantId",
            "status"
        ]
    });

const loanPortfolioValue =
    new promClient.Gauge({

        name:
            "titech_loan_portfolio_total",

        help:
            "Loan portfolio value",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * BILLING METRICS
 * ========================================================================== */

const invoicesGenerated =
    new promClient.Counter({

        name:
            "titech_billing_invoices_total",

        help:
            "Billing invoices generated",

        labelNames: [

            "tenantId"
        ]
    });

const billingRevenue =
    new promClient.Gauge({

        name:
            "titech_billing_revenue_total",

        help:
            "Total billed revenue",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * MOBILE MONEY
 * ========================================================================== */

const mobileMoneyTransactions =
    new promClient.Counter({

        name:
            "titech_mobile_money_transactions_total",

        help:
            "Mobile money transactions",

        labelNames: [

            "tenantId",
            "provider"
        ]
    });

/* ============================================================================
 * USSD
 * ========================================================================== */

const ussdRequests =
    new promClient.Counter({

        name:
            "titech_ussd_requests_total",

        help:
            "USSD requests",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * AUDIT
 * ========================================================================== */

const auditEvents =
    new promClient.Counter({

        name:
            "titech_audit_events_total",

        help:
            "Audit events",

        labelNames: [

            "action"
        ]
    });

/* ============================================================================
 * AML
 * ========================================================================== */

const amlAlerts =
    new promClient.Counter({

        name:
            "titech_aml_alerts_total",

        help:
            "AML alerts",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * FRAUD
 * ========================================================================== */

const fraudAlerts =
    new promClient.Counter({

        name:
            "titech_fraud_alerts_total",

        help:
            "Fraud alerts",

        labelNames: [

            "tenantId"
        ]
    });

/* ============================================================================
 * ERRORS
 * ========================================================================== */

const applicationErrors =
    new promClient.Counter({

        name:
            "titech_application_errors_total",

        help:
            "Application errors",

        labelNames: [

            "service",
            "operation"
        ]
    });

/* ============================================================================
 * REGISTER METRICS
 * ========================================================================== */

register.registerMetric(
    httpRequestsTotal
);

register.registerMetric(
    httpRequestDuration
);

register.registerMetric(
    savingsTransactions
);

register.registerMetric(
    savingsBalanceGauge
);

register.registerMetric(
    loanApplications
);

register.registerMetric(
    loanPortfolioValue
);

register.registerMetric(
    invoicesGenerated
);

register.registerMetric(
    billingRevenue
);

register.registerMetric(
    mobileMoneyTransactions
);

register.registerMetric(
    ussdRequests
);

register.registerMetric(
    auditEvents
);

register.registerMetric(
    amlAlerts
);

register.registerMetric(
    fraudAlerts
);

register.registerMetric(
    applicationErrors
);

/* ============================================================================
 * PROMETHEUS SERVICE
 * ========================================================================== */

class PrometheusService {

    async metrics() {

        return register.metrics();
    }

    contentType() {

        return register.contentType;
    }

    incrementHttpRequest(
        method,
        route,
        status
    ) {

        httpRequestsTotal.inc({

            method,
            route,
            status
        });
    }

    observeHttpDuration(
        method,
        route,
        seconds
    ) {

        httpRequestDuration.observe(

            {
                method,
                route
            },

            seconds
        );
    }

    incrementSavingsTransaction(
        tenantId,
        type
    ) {

        savingsTransactions.inc({

            tenantId,
            type
        });
    }

    updateSavingsBalance(
        tenantId,
        amount
    ) {

        savingsBalanceGauge.set(

            {
                tenantId
            },

            amount
        );
    }

    incrementLoanApplication(
        tenantId,
        status
    ) {

        loanApplications.inc({

            tenantId,
            status
        });
    }

    updateLoanPortfolio(
        tenantId,
        amount
    ) {

        loanPortfolioValue.set(

            {
                tenantId
            },

            amount
        );
    }

    incrementInvoice(
        tenantId
    ) {

        invoicesGenerated.inc({

            tenantId
        });
    }

    updateRevenue(
        tenantId,
        amount
    ) {

        billingRevenue.set(

            {
                tenantId
            },

            amount
        );
    }

    incrementMobileMoney(
        tenantId,
        provider
    ) {

        mobileMoneyTransactions.inc({

            tenantId,
            provider
        });
    }

    incrementUSSD(
        tenantId
    ) {

        ussdRequests.inc({

            tenantId
        });
    }

    incrementAudit(
        action
    ) {

        auditEvents.inc({

            action
        });
    }

    incrementAMLAlert(
        tenantId
    ) {

        amlAlerts.inc({

            tenantId
        });
    }

    incrementFraudAlert(
        tenantId
    ) {

        fraudAlerts.inc({

            tenantId
        });
    }

    incrementError(
        service,
        operation
    ) {

        applicationErrors.inc({

            service,
            operation
        });
    }
}

/* ============================================================================
 * EXPORT
 * ========================================================================== */

const prometheusService =
    new PrometheusService();

module.exports =
    prometheusService;

module.exports.PrometheusService =
    PrometheusService;

module.exports.register =
    register;