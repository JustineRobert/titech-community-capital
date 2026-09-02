"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/modules/payments/providers/momo/momo.controller.js
 * Enterprise MTN MoMo Controller
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Collections (Deposit)
 * ✓ Disbursements (Withdrawals)
 * ✓ Transaction Status
 * ✓ Webhook Processing
 * ✓ Audit Logging
 * ✓ Metrics Logging
 * ✓ Tenant Isolation
 * ✓ Request Correlation
 * ✓ AML/Fraud Integration Hooks
 * ✓ Enterprise Error Handling
 * ============================================================================
 */

const momoService =
    require("./momo.service");

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

class MoMoController {

    /* ===================================================================== */
    /* COLLECT PAYMENT                                                      */
    /* ===================================================================== */

    async collect(
        req,
        res,
        next
    ) {

        try {

            const transaction =
                await momoService.collect({

                    tenantId:
                        req.tenantId,

                    userId:
                        req.userId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    ...req.body
                });

            await auditLogger.billing({

                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                action:
                    "MOMO_COLLECTION_CREATED",

                entityType:
                    "MoMoTransaction",

                entityId:
                    transaction.transactionId,

                metadata: {

                    amount:
                        transaction.amount,

                    provider:
                        "MTN_MOMO"
                }
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    req.tenantId,

                    "MTN"
                );

            return res.status(201).json({

                success: true,

                data:
                    transaction
            });

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        req.tenantId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    operation:
                        "collect"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* DISBURSE PAYMENT                                                     */
    /* ===================================================================== */

    async disburse(
        req,
        res,
        next
    ) {

        try {

            const transaction =
                await momoService.disburse({

                    tenantId:
                        req.tenantId,

                    userId:
                        req.userId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    ...req.body
                });

            await auditLogger.billing({

                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                action:
                    "MOMO_DISBURSEMENT_CREATED",

                entityType:
                    "MoMoTransaction",

                entityId:
                    transaction.transactionId,

                metadata: {

                    amount:
                        transaction.amount
                }
            });

            return res.status(200).json({

                success: true,

                data:
                    transaction
            });

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        req.tenantId,

                    operation:
                        "disburse"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* TRANSACTION STATUS                                                   */
    /* ===================================================================== */

    async getTransactionStatus(
        req,
        res,
        next
    ) {

        try {

            const status =
                await momoService
                    .getTransactionStatus({

                        tenantId:
                            req.tenantId,

                        referenceId:
                            req.params.referenceId
                    });

            return res.status(200).json({

                success: true,

                data:
                    status
            });

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        req.tenantId,

                    operation:
                        "getTransactionStatus"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* WEBHOOK                                                              */
    /* ===================================================================== */

    async webhook(
        req,
        res,
        next
    ) {

        try {

            const result =
                await momoService
                    .processWebhook({

                        headers:
                            req.headers,

                        body:
                            req.body
                    });

            await auditLogger.billing({

                tenantId:
                    result.tenantId,

                action:
                    "MOMO_WEBHOOK_RECEIVED",

                entityType:
                    "Webhook",

                entityId:
                    result.referenceId,

                metadata:
                    result
            });

            return res.status(200).json({

                success: true
            });

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    operation:
                        "webhook"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* ACCOUNT BALANCE                                                      */
    /* ===================================================================== */

    async getProviderBalance(
        req,
        res,
        next
    ) {

        try {

            const balance =
                await momoService
                    .getProviderBalance({

                        tenantId:
                            req.tenantId
                    });

            return res.status(200).json({

                success: true,

                data:
                    balance
            });

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        req.tenantId,

                    operation:
                        "getProviderBalance"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* HEALTH                                                               */
    /* ===================================================================== */

    async health(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            provider:
                "MTN_MOMO",

            status:
                "healthy",

            timestamp:
                new Date().toISOString()
        });
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                          */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            controller:
                "MoMoController",

            capabilities: [

                "collect",

                "disburse",

                "status",

                "webhook",

                "balance"
            ],

            provider:
                "MTN_MOMO",

            version:
                process.env.APP_VERSION ||
                "1.0.0"
        };
    }
}

const momoController =
    new MoMoController();

module.exports =
    momoController;

module.exports.MoMoController =
    MoMoController;