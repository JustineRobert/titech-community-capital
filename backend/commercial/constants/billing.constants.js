"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * SaaS Billing Constants
 * backend/commercial/constants/billing.constants.js
 * =============================================================================
 */

const BILLING_INTERVALS =
    Object.freeze({

        MONTHLY:
            "MONTHLY",

        QUARTERLY:
            "QUARTERLY",

        ANNUAL:
            "ANNUAL",

    });


const BILLING_PLAN_TIERS =
    Object.freeze({

        STARTER:
            "STARTER",

        PROFESSIONAL:
            "PROFESSIONAL",

        INSTITUTION:
            "INSTITUTION",

        ENTERPRISE:
            "ENTERPRISE",

    });


const SUBSCRIPTION_STATUS =
    Object.freeze({

        TRIALING:
            "TRIALING",

        ACTIVE:
            "ACTIVE",

        PAST_DUE:
            "PAST_DUE",

        SUSPENDED:
            "SUSPENDED",

        CANCELLED:
            "CANCELLED",

        EXPIRED:
            "EXPIRED",

    });


const INVOICE_STATUS =
    Object.freeze({

        DRAFT:
            "DRAFT",

        OPEN:
            "OPEN",

        PARTIALLY_PAID:
            "PARTIALLY_PAID",

        PAID:
            "PAID",

        PAST_DUE:
            "PAST_DUE",

        VOID:
            "VOID",

        UNCOLLECTIBLE:
            "UNCOLLECTIBLE",

        REFUNDED:
            "REFUNDED",

    });


const PAYMENT_STATUS =
    Object.freeze({

        PENDING:
            "PENDING",

        PROCESSING:
            "PROCESSING",

        SUCCESS:
            "SUCCESS",

        FAILED:
            "FAILED",

        REVERSED:
            "REVERSED",

        REFUNDED:
            "REFUNDED",

    });


const BILLING_CURRENCIES =
    Object.freeze([

        "UGX",

        "USD",

        "KES",

        "TZS",

        "RWF",

        "NGN",

        "ZAR",

    ]);


module.exports =
    Object.freeze({

        BILLING_INTERVALS,

        BILLING_PLAN_TIERS,

        SUBSCRIPTION_STATUS,

        INVOICE_STATUS,

        PAYMENT_STATUS,

        BILLING_CURRENCIES,

    });