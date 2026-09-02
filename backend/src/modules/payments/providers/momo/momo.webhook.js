"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: momo.webhook.js
 * Enterprise MTN Mobile Money Webhook Processor
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
| Optional Enterprise Services
|--------------------------------------------------------------------------
*/

let ledgerService;
let notificationService;
let savingsService;
let loanService;
let billingEngine;
let fraudService;
let amlService;

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
    savingsService =
        require(
            "../../../savings/services/savings.service"
        );
} catch (_) {}

try {
    loanService =
        require(
            "../../../loans/services/loan.service"
        );
} catch (_) {}

try {
    billingEngine =
        require(
            "../../../billing/services/billingEngine"
        );
} catch (_) {}

try {
    fraudService =
        require(
            "../../../fraud/services/fraud.service"
        );
} catch (_) {}

try {
    amlService =
        require(
            "../../../compliance/services/aml.service"
        );
} catch (_) {}

/*
|--------------------------------------------------------------------------
| In-Memory Idempotency Cache
|--------------------------------------------------------------------------
|
| Replace with Redis in production.
|
*/

const processedEvents =
    new Set();

/* ============================================================================
 * MoMo Webhook Service
 * ========================================================================== */

class MoMoWebhook {

    /* ===================================================================== */
    /* SIGNATURE VERIFICATION                                                */
    /* ===================================================================== */

    verifySignature(
        payload,
        signature
    ) {

        const secret =

            process.env.MOMO_WEBHOOK_SECRET;

        if (!secret) {

            return true;
        }

        const expected =

            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(
                    JSON.stringify(payload)
                )
                .digest("hex");

        return expected === signature;
    }

    /* ===================================================================== */
    /* IDEMPOTENCY                                                           */
    /* ===================================================================== */

    ensureNotProcessed(
        eventId
    ) {

        if (
            processedEvents.has(
                eventId
            )
        ) {

            throw new Error(
                "Duplicate webhook event."
            );
        }

        processedEvents.add(
            eventId
        );
    }

    /* ===================================================================== */
    /* PROCESS PAYMENT SUCCESS                                               */
    /* ===================================================================== */

    async processSuccessfulPayment(
        payload
    ) {

        if (
            ledgerService
        ) {

            await ledgerService.post({

                tenantId:
                    payload.tenantId,

                referenceId:
                    payload.referenceId,

                amount:
                    payload.amount,

                source:
                    "MOMO_COLLECTION"
            });
        }

        if (
            payload.transactionType ===
            "SAVINGS_DEPOSIT"
        ) {

            await savingsService?.credit?.({

                tenantId:
                    payload.tenantId,

                memberId:
                    payload.memberId,

                amount:
                    payload.amount
            });
        }

        if (
            payload.transactionType ===
            "LOAN_REPAYMENT"
        ) {

            await loanService?.recordRepayment?.({

                tenantId:
                    payload.tenantId,

                loanId:
                    payload.loanId,

                amount:
                    payload.amount
            });
        }

        if (
            payload.transactionType ===
            "BILL_PAYMENT"
        ) {

            await billingEngine?.recordPayment?.({

                tenantId:
                    payload.tenantId,

                invoiceId:
                    payload.invoiceId,

                amount:
                    payload.amount
            });
        }

        await notificationService
            ?.sendPaymentReceipt?.({

                tenantId:
                    payload.tenantId,

                memberId:
                    payload.memberId,

                amount:
                    payload.amount,

                referenceId:
                    payload.referenceId
            });
    }

    /* ===================================================================== */
    /* MAIN PROCESSOR                                                        */
    /* ===================================================================== */

    async process(
        payload,
        headers = {}
    ) {

        try {

            const signature =

                headers[
                    "x-momo-signature"
                ];

            if (
                !this.verifySignature(
                    payload,
                    signature
                )
            ) {

                throw new Error(
                    "Invalid webhook signature."
                );
            }

            const eventId =

                payload.eventId ||
                payload.referenceId;

            this.ensureNotProcessed(
                eventId
            );

            await amlService?.monitor?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                transactionType:
                    "MOMO_WEBHOOK"
            });

            await fraudService?.detectFraud?.({

                tenantId:
                    payload.tenantId,

                amount:
                    payload.amount,

                phoneNumber:
                    payload.phoneNumber
            });

            if (
                payload.status ===
                "SUCCESS"
            ) {

                await this
                    .processSuccessfulPayment(
                        payload
                    );
            }

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                action:
                    "MOMO_WEBHOOK_PROCESSED",

                entityType:
                    "Webhook",

                entityId:
                    eventId,

                metadata:
                    payload
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    payload.tenantId,

                    "MTN"
                );

            return {

                success: true,

                provider:
                    "MTN_MOMO",

                status:
                    payload.status,

                referenceId:
                    payload.referenceId,

                processedAt:
                    new Date()
                        .toISOString()
            };

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        payload.tenantId,

                    operation:
                        "webhook"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* HEALTH                                                                */
    /* ===================================================================== */

    health() {

        return {

            provider:
                "MTN_MOMO",

            service:
                "webhook-processor",

            status:
                "UP",

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    diagnostics() {

        return {

            service:
                "momo-webhook",

            processedEvents:
                processedEvents.size,

            supports: [

                "signature-verification",

                "idempotency",

                "ledger-posting",

                "savings-deposit",

                "loan-repayment",

                "billing-payment",

                "notifications",

                "fraud-monitoring",

                "aml-monitoring"
            ]
        };
    }
}

/* ============================================================================
 * Export Singleton
 * ========================================================================== */

const momoWebhook =
    new MoMoWebhook();

module.exports =
    momoWebhook;

module.exports.MoMoWebhook =
    MoMoWebhook;