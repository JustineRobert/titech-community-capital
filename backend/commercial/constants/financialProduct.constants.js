"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Financial Product Revenue Constants
 * backend/commercial/constants/financialProduct.constants.js
 * =============================================================================
 */

const FINANCIAL_PRODUCT_TYPES =
    Object.freeze({

        LOAN:
            "LOAN",

        INSURANCE:
            "INSURANCE",

        SAVINGS:
            "SAVINGS",

        INVESTMENT:
            "INVESTMENT",

        CREDIT_SCORING:
            "CREDIT_SCORING",

        PAYMENT:
            "PAYMENT",

        OTHER:
            "OTHER",

    });


const PARTNER_TYPES =
    Object.freeze({

        BANK:
            "BANK",

        MFI:
            "MFI",

        SACCO:
            "SACCO",

        INSURER:
            "INSURER",

        INVESTMENT_MANAGER:
            "INVESTMENT_MANAGER",

        FINTECH:
            "FINTECH",

        TELECOM:
            "TELECOM",

        GOVERNMENT:
            "GOVERNMENT",

        OTHER:
            "OTHER",

    });


const PARTNER_STATUS =
    Object.freeze({

        PENDING:
            "PENDING",

        ACTIVE:
            "ACTIVE",

        SUSPENDED:
            "SUSPENDED",

        TERMINATED:
            "TERMINATED",

    });


const COMMISSION_TYPES =
    Object.freeze({

        FIXED:
            "FIXED",

        PERCENTAGE:
            "PERCENTAGE",

        TIERED:
            "TIERED",

    });


module.exports =
    Object.freeze({

        FINANCIAL_PRODUCT_TYPES,

        PARTNER_TYPES,

        PARTNER_STATUS,

        COMMISSION_TYPES,

    });