"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Commercial Platform Domain
 * =============================================================================
 *
 * File:
 *   backend/commercial/index.js
 *
 * Purpose:
 *   Canonical entry point for the TITech Commercial Platform.
 *
 * Revenue Engines:
 *
 *   1. SaaS
 *   2. Transaction Revenue
 *   3. Financial Products
 *   4. Enterprise API
 *   5. White-Label
 *
 * Architectural rule:
 *
 *   The commercial domain NEVER becomes the authoritative source of customer
 *   financial balances.
 *
 *   Customer money remains authoritative in the existing TITech financial
 *   transaction / ledger architecture.
 *
 * Commercial responsibilities:
 *
 *   - Pricing
 *   - Billing
 *   - Fees
 *   - Revenue
 *   - Financial-product commissions
 *   - API monetization
 *   - White-label licensing
 *
 * Non-responsibilities:
 *
 *   - Customer balance ownership
 *   - Ledger authority
 *   - Payment-provider settlement authority
 *   - Authentication authority
 *   - Tenant identity authority
 *
 * =============================================================================
 */

const {
    REVENUE_ENGINES,
    REVENUE_ENGINE_STATUS,
} =
    require(
        "./constants/revenueEngine.constants"
    );

/**
 * =============================================================================
 * Commercial Domain Metadata
 * =============================================================================
 */

const COMMERCIAL_DOMAIN =
    Object.freeze({

        name:
            "TITech Commercial Platform",

        version:
            "1.0.0",

        company:
            "TITech Community Capital LTD",

        platform:
            "TITech Community Capital",

        status:
            REVENUE_ENGINE_STATUS.ACTIVE,

        revenueEngines:
            Object.freeze([
                REVENUE_ENGINES.SAAS,
                REVENUE_ENGINES.TRANSACTION,
                REVENUE_ENGINES.FINANCIAL_PRODUCT,
                REVENUE_ENGINES.ENTERPRISE_API,
                REVENUE_ENGINES.WHITE_LABEL,
            ]),

    });

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        COMMERCIAL_DOMAIN,

        REVENUE_ENGINES,

        REVENUE_ENGINE_STATUS,

    });