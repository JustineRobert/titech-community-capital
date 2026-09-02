"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Commercial Entitlement / Feature Constants
 * backend/commercial/constants/commercialFeature.constants.js
 * =============================================================================
 */

const COMMERCIAL_FEATURES =
    Object.freeze({

        GROUP_MANAGEMENT:
            "GROUP_MANAGEMENT",

        MEMBER_MANAGEMENT:
            "MEMBER_MANAGEMENT",

        SAVINGS:
            "SAVINGS",

        CONTRIBUTIONS:
            "CONTRIBUTIONS",

        LOANS:
            "LOANS",

        WALLET:
            "WALLET",

        MOBILE_MONEY:
            "MOBILE_MONEY",

        ADVANCED_REPORTING:
            "ADVANCED_REPORTING",

        AUDIT_REPORTING:
            "AUDIT_REPORTING",

        BULK_OPERATIONS:
            "BULK_OPERATIONS",

        API_ACCESS:
            "API_ACCESS",

        WEBHOOKS:
            "WEBHOOKS",

        WHITE_LABEL:
            "WHITE_LABEL",

        CUSTOM_DOMAIN:
            "CUSTOM_DOMAIN",

        FINANCIAL_PRODUCTS:
            "FINANCIAL_PRODUCTS",

        ADVANCED_RISK:
            "ADVANCED_RISK",

        ADVANCED_ANALYTICS:
            "ADVANCED_ANALYTICS",

        PRIORITY_SUPPORT:
            "PRIORITY_SUPPORT",

        SLA:
            "SLA",

    });


const COMMERCIAL_FEATURE_VALUES =
    Object.freeze(
        Object.values(
            COMMERCIAL_FEATURES
        )
    );


module.exports =
    Object.freeze({

        COMMERCIAL_FEATURES,

        COMMERCIAL_FEATURE_VALUES,

    });