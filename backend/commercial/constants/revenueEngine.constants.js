"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Commercial Revenue Engine Constants
 * backend/commercial/constants/revenueEngine.constants.js
 * =============================================================================
 */

const REVENUE_ENGINES =
    Object.freeze({

        /**
         * Recurring platform subscriptions.
         */
        SAAS:
            "SAAS",

        /**
         * Fees generated from eligible financial/payment events.
         */
        TRANSACTION:
            "TRANSACTION",

        /**
         * Partner commissions/referral/origination/platform revenue.
         */
        FINANCIAL_PRODUCT:
            "FINANCIAL_PRODUCT",

        /**
         * Enterprise API/platform monetization.
         */
        ENTERPRISE_API:
            "ENTERPRISE_API",

        /**
         * White-label licensing/platform monetization.
         */
        WHITE_LABEL:
            "WHITE_LABEL",

    });

const REVENUE_ENGINE_STATUS =
    Object.freeze({

        ACTIVE:
            "ACTIVE",

        INACTIVE:
            "INACTIVE",

        SUSPENDED:
            "SUSPENDED",

    });

const REVENUE_ENGINE_VALUES =
    Object.freeze(
        Object.values(
            REVENUE_ENGINES
        )
    );

const REVENUE_ENGINE_STATUS_VALUES =
    Object.freeze(
        Object.values(
            REVENUE_ENGINE_STATUS
        )
    );

module.exports =
    Object.freeze({

        REVENUE_ENGINES,

        REVENUE_ENGINE_STATUS,

        REVENUE_ENGINE_VALUES,

        REVENUE_ENGINE_STATUS_VALUES,

    });