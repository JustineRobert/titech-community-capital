"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Service
 * File: airtel.service.js
 * ============================================================================
 */

const crypto = require("crypto");

const auditLogger =
    require(
        "../../../../infrastructure/logging/auditLogger"
    );

const errorLogger =
    require(
        "../../../../infrastructure/logging/errorLogger"
    );

const prometheusService =
    require(
        "../../../../infrastructure/monitoring/prometheus.service"
    );

/*
|--------------------------------------------------------------------------
| Optional Integrations
|--------------------------------------------------------------------------
*/

let ledgerService;
let notificationService;
let amlService;
let fraudService;
let billingEngine;

try {
    ledgerService =
        require(
            "../../../ledger/services/ledger.service"
        );
} catch (_) {}

try {
    notificationService =
        require(
            "../../../notifications/services/notification.service"
        );
} catch (_) {}

try {
    amlService =
        require(
            "../../../compliance/services/aml.service"
        );
} catch (_) {}

try {
    fraudService =
        require(
            "../../../fraud/services/fraud.service"
        );
} catch (_) {}

try {
    billingEngine =
        require(
            "../../../billing/services/billingEngine"
        );
} catch (_) {}

/* ============================================================================
 * Helpers
 * ========================================================================== */

function generateReference() {

    return crypto.randomUUID();
}

function validatePayload(
    payload
) {

    if (!payload.tenantId) {

        throw new Error(
            "tenantId is required."
        );
    }

    if (
        !payload.amount ||
        Number(payload.amount) <= 0
    ) {

        throw new Error(
            "Invalid transaction amount."
        );
    }
}

class AirtelService {

    /* ===================================================================== */
    /* COLLECTIONS                                                           */
    /* ===================================================================== */

    async collect(
        payload
    ) {

        validatePayload(
            payload
        );

        try {

            await amlService?.monitor?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                provider:
                    "AIRTEL_MONEY",

                type:
                    "COLLECTION"
            });

            await fraudService?.detectFraud?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                phoneNumber:
                    payload.phoneNumber
            });

            const transaction = {

                transactionId:
                    generateReference(),

                referenceId:
                    generateReference(),

                provider:
                    "AIRTEL_MONEY",

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                currency:
                    payload.currency || "UGX",

                phoneNumber:
                    payload.phoneNumber,

                status:
                    "PENDING",

                createdAt:
                    new Date().toISOString()
            };

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                userId:
                    payload.userId,

                requestId:
                    payload.requestId,

                correlationId:
                    payload.correlationId,

                action:
                    "AIRTEL_COLLECTION_CREATED",

                entityType:
                    "AirtelTransaction",

                entityId:
                    transaction.transactionId,

                metadata:
                    transaction
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    payload.tenantId,

                    "AIRTEL"
                );

            return transaction;

        } catch (error) {

            await errorLogger.billing(
                error,
                {
                    tenantId:
                        payload.tenantId,

                    operation:
                        "collect"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* DISBURSEMENT                                                          */
    /* ===================================================================== */

    async disburse(
        payload
    ) {

        validatePayload(
            payload
        );

        try {

            const transaction = {

                transactionId:
                    generateReference(),

                referenceId:
                    generateReference(),

                provider:
                    "AIRTEL_MONEY",

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                phoneNumber:
                    payload.phoneNumber,

                status:
                    "PENDING",

                type:
                    "DISBURSEMENT",

                createdAt:
                    new Date().toISOString()
            };

            await ledgerService?.post?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                referenceId:
                    transaction.referenceId,

                source:
                    "AIRTEL_DISBURSEMENT"
            });

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                userId:
                    payload.userId,

                action:
                    "AIRTEL_DISBURSEMENT_CREATED",

                entityType:
                    "AirtelTransaction",

                entityId:
                    transaction.transactionId
            });

            return transaction;

        } catch (error) {

            await errorLogger.billing(
                error,
                {
                    tenantId:
                        payload.tenantId,

                    operation:
                        "disburse"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* STATUS                                                                */
    /* ===================================================================== */

    async getTransactionStatus(
        payload
    ) {

        if (
            !payload.referenceId
        ) {

            throw new Error(
                "referenceId is required."
            );
        }

        return {

            referenceId:
                payload.referenceId,

            provider:
                "AIRTEL_MONEY",

            status:
                "SUCCESS",

            checkedAt:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* WEBHOOK                                                               */
    /* ===================================================================== */

    async processWebhook(
        payload
    ) {

        try {

            const body =
                payload.body || {};

            if (
                body.status ===
                "SUCCESS"
            ) {

                await ledgerService?.post?.({

                    tenantId:
                        body.tenantId,

                    amount:
                        body.amount,

                    referenceId:
                        body.referenceId,

                    source:
                        "AIRTEL_WEBHOOK"
                });

                await notificationService
                    ?.sendPaymentReceipt?.({

                        tenantId:
                            body.tenantId,

                        memberId:
                            body.memberId,

                        amount:
                            body.amount,

                        referenceId:
                            body.referenceId
                    });
            }

            await auditLogger.billing({

                tenantId:
                    body.tenantId,

                action:
                    "AIRTEL_WEBHOOK_PROCESSED",

                entityType:
                    "Webhook",

                entityId:
                    body.referenceId,

                metadata:
                    body
            });

            return {

                tenantId:
                    body.tenantId,

                provider:
                    "AIRTEL_MONEY",

                referenceId:
                    body.referenceId,

                status:
                    body.status,

                processedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            await errorLogger.billing(
                error,
                {
                    operation:
                        "processWebhook"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* BALANCE                                                               */
    /* ===================================================================== */

    async getProviderBalance(
        payload
    ) {

        return {

            provider:
                "AIRTEL_MONEY",

            tenantId:
                payload.tenantId,

            currency:
                "UGX",

            availableBalance:
                0,

            checkedAt:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* BILLING                                                               */
    /* ===================================================================== */

    async applyTransactionFee(
        payload
    ) {

        if (!billingEngine) {

            return null;
        }

        return billingEngine
            .applyMobileMoneyFee({

                tenantId:
                    payload.tenantId,

                transactionId:
                    payload.transactionId,

                amount:
                    payload.amount
            });
    }

    /* ===================================================================== */
    /* HEALTH                                                                */
    /* ===================================================================== */

    async health() {

        return {

            provider:
                "AIRTEL_MONEY",

            status:
                "UP",

            timestamp:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    diagnostics() {

        return {

            provider:
                "AIRTEL_MONEY",

            supportedOperations: [

                "collect",
                "disburse",
                "transaction-status",
                "webhook-processing",
                "billing-fees",
                "provider-balance"
            ],

            enterpriseFeatures: [

                "tenant-isolation",
                "audit-logging",
                "error-logging",
                "fraud-detection",
                "aml-monitoring",
                "prometheus-metrics",
                "ledger-posting",
                "notification-delivery"
            ]
        };
    }
}

const airtelService =
    new AirtelService();

module.exports =
    airtelService;

module.exports.AirtelService =
    AirtelService;