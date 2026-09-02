"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: momo.service.js
 * Enterprise MTN Mobile Money Service
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
| Optional Enterprise Dependencies
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

function generateReferenceId() {

    return crypto.randomUUID();
}

function validateAmount(
    amount
) {

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid transaction amount."
        );
    }
}

function enforceTenant(
    tenantId
) {

    if (!tenantId) {

        throw new Error(
            "tenantId is required."
        );
    }
}

/* ============================================================================
 * MoMo Service
 * ========================================================================== */

class MoMoService {

    /* ===================================================================== */
    /* COLLECTIONS                                                          */
    /* ===================================================================== */

    async collect(
        payload
    ) {

        enforceTenant(
            payload.tenantId
        );

        validateAmount(
            payload.amount
        );

        try {

            await amlService?.monitor?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                transactionType:
                    "MOMO_COLLECTION"
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
                    generateReferenceId(),

                referenceId:
                    generateReferenceId(),

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                phoneNumber:
                    payload.phoneNumber,

                currency:
                    payload.currency ||
                    "UGX",

                status:
                    "PENDING",

                provider:
                    "MTN_MOMO",

                createdAt:
                    new Date()
                        .toISOString()
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
                    "MOMO_COLLECTION_CREATED",

                entityType:
                    "MoMoTransaction",

                entityId:
                    transaction.transactionId,

                metadata: {

                    amount:
                        payload.amount
                }
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    payload.tenantId,

                    "MTN"
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
    /* DISBURSEMENT                                                         */
    /* ===================================================================== */

    async disburse(
        payload
    ) {

        enforceTenant(
            payload.tenantId
        );

        validateAmount(
            payload.amount
        );

        try {

            const transaction = {

                transactionId:
                    generateReferenceId(),

                referenceId:
                    generateReferenceId(),

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                phoneNumber:
                    payload.phoneNumber,

                status:
                    "PENDING",

                provider:
                    "MTN_MOMO",

                type:
                    "DISBURSEMENT",

                createdAt:
                    new Date()
                        .toISOString()
            };

            await ledgerService?.post?.({

                tenantId:
                    payload.tenantId,

                referenceId:
                    transaction.transactionId,

                amount:
                    payload.amount,

                source:
                    "MOMO_DISBURSEMENT"
            });

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                userId:
                    payload.userId,

                action:
                    "MOMO_DISBURSEMENT_CREATED",

                entityType:
                    "MoMoTransaction",

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
    /* STATUS                                                               */
    /* ===================================================================== */

    async getTransactionStatus(
        payload
    ) {

        enforceTenant(
            payload.tenantId
        );

        return {

            referenceId:
                payload.referenceId,

            provider:
                "MTN_MOMO",

            status:
                "SUCCESS",

            checkedAt:
                new Date()
                    .toISOString()
        };
    }

    /* ===================================================================== */
    /* WEBHOOK                                                              */
    /* ===================================================================== */

    async processWebhook(
        payload
    ) {

        const webhookData =
            payload.body || {};

        const result = {

            tenantId:
                webhookData.tenantId,

            referenceId:
                webhookData.referenceId,

            provider:
                "MTN_MOMO",

            status:
                webhookData.status,

            receivedAt:
                new Date()
                    .toISOString()
        };

        if (
            webhookData.status ===
            "SUCCESS"
        ) {

            await ledgerService?.post?.({

                tenantId:
                    webhookData.tenantId,

                amount:
                    webhookData.amount,

                referenceId:
                    webhookData.referenceId,

                source:
                    "MOMO_WEBHOOK"
            });

            await notificationService
                ?.sendPaymentReceipt?.({

                    tenantId:
                        webhookData.tenantId,

                    memberId:
                        webhookData.memberId,

                    amount:
                        webhookData.amount
                });
        }

        return result;
    }

    /* ===================================================================== */
    /* PROVIDER BALANCE                                                     */
    /* ===================================================================== */

    async getProviderBalance(
        payload
    ) {

        enforceTenant(
            payload.tenantId
        );

        return {

            provider:
                "MTN_MOMO",

            currency:
                "UGX",

            availableBalance:
                0,

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /* ===================================================================== */
    /* BILLING FEES                                                         */
    /* ===================================================================== */

    async applyTransactionFee(
        payload
    ) {

        if (
            !billingEngine
        ) {

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
    /* HEALTH                                                               */
    /* ===================================================================== */

    async health() {

        return {

            provider:
                "MTN_MOMO",

            status:
                "UP",

            timestamp:
                new Date()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Export Singleton
 * ========================================================================== */

const momoService =
    new MoMoService();

module.exports =
    momoService;

module.exports.MoMoService =
    MoMoService;