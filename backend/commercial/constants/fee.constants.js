"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Transaction Revenue / Fee Constants
 * backend/commercial/constants/fee.constants.js
 * =============================================================================
 */

const FEE_TYPES =
    Object.freeze({

        FIXED:
            "FIXED",

        PERCENTAGE:
            "PERCENTAGE",

        FIXED_PLUS_PERCENTAGE:
            "FIXED_PLUS_PERCENTAGE",

        TIERED:
            "TIERED",

    });


const FEE_APPLIES_TO =
    Object.freeze({

        CONTRIBUTION:
            "CONTRIBUTION",

        PAYMENT:
            "PAYMENT",

        DISBURSEMENT:
            "DISBURSEMENT",

        WITHDRAWAL:
            "WITHDRAWAL",

        SETTLEMENT:
            "SETTLEMENT",

        TRANSFER:
            "TRANSFER",

        REFUND:
            "REFUND",

    });


const FEE_STATUS =
    Object.freeze({

        DRAFT:
            "DRAFT",

        ACTIVE:
            "ACTIVE",

        SUSPENDED:
            "SUSPENDED",

        EXPIRED:
            "EXPIRED",

    });


const FEE_PAYER =
    Object.freeze({

        CUSTOMER:
            "CUSTOMER",

        MERCHANT:
            "MERCHANT",

        TENANT:
            "TENANT",

        PARTNER:
            "PARTNER",

        SPLIT:
            "SPLIT",

    });


module.exports =
    Object.freeze({

        FEE_TYPES,

        FEE_APPLIES_TO,

        FEE_STATUS,

        FEE_PAYER,

    });