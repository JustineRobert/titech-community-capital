"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/services/billingEngine.js
 * Enterprise Billing Engine
 * ============================================================================
 */

const auditService =
    require("./auditService");

const metricsService =
    require("./metricsService");

const logger =
    require("../utils/logger");

class BillingEngine {

    constructor() {

        this.defaultPricing = {

            deposit: {
                type: "PERCENTAGE",
                rate: 0.01,
                minimumFee: 500,
                maximumFee: 50000
            },

            withdrawal: {
                type: "FIXED",
                fee: 2000
            },

            loan: {
                type: "PERCENTAGE",
                rate: 0.02,
                minimumFee: 5000
            },

            mobileMoneyDeposit: {
                type: "PERCENTAGE",
                rate: 0.015,
                minimumFee: 1000
            },

            mobileMoneyWithdrawal: {
                type: "PERCENTAGE",
                rate: 0.02,
                minimumFee: 1500
            }
        };
    }

    /* ===================================================================== */
    /* MAIN BILLING ENTRY                                                    */
    /* ===================================================================== */

    async calculateFee(
        payload = {}
    ) {

        const {

            tenantId,

            type,

            amount,

            requestId,

            correlationId,

            metadata = {}
        } = payload;

        if (
            !type ||
            !Number.isFinite(amount) ||
            amount < 0
        ) {

            throw new Error(
                "Invalid billing request."
            );
        }

        const pricing =
            this.getPricingRule(
                type
            );

        const fee =
            this.computeFee(
                pricing,
                amount
            );

        const vat =
            this.calculateVAT(
                fee
            );

        const totalFee =
            fee + vat;

        await this.recordBillingEvent({

            tenantId,

            type,

            amount,

            fee,

            vat,

            totalFee,

            requestId,

            correlationId
        });

        return {

            transactionType:
                type,

            amount,

            fee,

            vat,

            totalFee,

            currency:
                "UGX",

            calculatedAt:
                new Date().toISOString(),

            metadata
        };
    }

    /* ===================================================================== */
    /* PRICING RULES                                                         */
    /* ===================================================================== */

    getPricingRule(
        transactionType
    ) {

        const rule =
            this.defaultPricing[
                transactionType
            ];

        if (!rule) {

            return {

                type: "FIXED",

                fee: 0
            };
        }

        return rule;
    }

    /* ===================================================================== */
    /* FEE CALCULATION                                                       */
    /* ===================================================================== */

    computeFee(
        rule,
        amount
    ) {

        let fee = 0;

        if (
            rule.type === "FIXED"
        ) {

            fee =
                rule.fee || 0;
        }

        if (
            rule.type === "PERCENTAGE"
        ) {

            fee =
                amount *
                rule.rate;

            if (
                rule.minimumFee &&
                fee < rule.minimumFee
            ) {

                fee =
                    rule.minimumFee;
            }

            if (
                rule.maximumFee &&
                fee > rule.maximumFee
            ) {

                fee =
                    rule.maximumFee;
            }
        }

        return Math.round(
            fee
        );
    }

    /* ===================================================================== */
    /* VAT CALCULATION                                                       */
    /* ===================================================================== */

    calculateVAT(
        amount
    ) {

        const VAT_RATE =
            Number(
                process.env.VAT_RATE
            ) || 0.18;

        return Math.round(
            amount *
            VAT_RATE
        );
    }

    /* ===================================================================== */
    /* BILLING EVENT                                                         */
    /* ===================================================================== */

    async recordBillingEvent(
        payload
    ) {

        try {

            await auditService.log({

                action:
                    "BILLING_CALCULATED",

                tenantId:
                    payload.tenantId,

                transactionType:
                    payload.type,

                amount:
                    payload.amount,

                fee:
                    payload.fee,

                vat:
                    payload.vat,

                totalFee:
                    payload.totalFee,

                requestId:
                    payload.requestId,

                correlationId:
                    payload.correlationId
            });

            metricsService.increment(
                `titech.billing.${payload.type}`
            );

        } catch (error) {

            logger.error(
                "Billing event recording failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* SACCO OVERRIDE SUPPORT                                                */
    /* ===================================================================== */

    calculateWithCustomPricing(
        pricing,
        amount
    ) {

        return this.computeFee(
            pricing,
            amount
        );
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            service:
                "BillingEngine",

            version:
                "1.0.0",

            supportedTransactions: [

                "deposit",

                "withdrawal",

                "loan",

                "mobileMoneyDeposit",

                "mobileMoneyWithdrawal"
            ]
        };
    }
}

const billingEngine =
    new BillingEngine();

module.exports =
    billingEngine;

module.exports.BillingEngine =
    BillingEngine;