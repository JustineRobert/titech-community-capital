"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: airtel.controller.js
 * Enterprise Airtel Money Controller
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Collections
 * ✓ Disbursements
 * ✓ Transaction Status
 * ✓ Webhook Processing
 * ✓ Provider Balance
 * ✓ Tenant Isolation
 * ✓ Audit Logging
 * ✓ Error Logging
 * ✓ Prometheus Metrics
 * ✓ Request Correlation
 * ✓ AML/Fraud Ready
 * ✓ Enterprise Diagnostics
 * ============================================================================
 */

const airtelService =
    require("./airtel.service");

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

class AirtelController {

    /* ===================================================================== */
    /* COLLECTIONS                                                           */
    /* ===================================================================== */

    async collect(
        req,
        res,
        next
    ) {

        try {

            const transaction =
                await airtelService.collect({

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
                    "AIRTEL_COLLECTION_CREATED",

                entityType:
                    "AirtelTransaction",

                entityId:
                    transaction.transactionId,

                metadata: {

                    amount:
                        transaction.amount,

                    provider:
                        "AIRTEL_MONEY"
                }
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    req.tenantId,

                    "AIRTEL"
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
    /* DISBURSEMENTS                                                         */
    /* ===================================================================== */

    async disburse(
        req,
        res,
        next
    ) {

        try {

            const transaction =
                await airtelService.disburse({

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
                    "AIRTEL_DISBURSEMENT_CREATED",

                entityType:
                    "AirtelTransaction",

                entityId:
                    transaction.transactionId,

                metadata: {

                    amount:
                        transaction.amount,

                    provider:
                        "AIRTEL_MONEY"
                }
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    req.tenantId,

                    "AIRTEL"
                );

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

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    operation:
                        "disburse"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* TRANSACTION STATUS                                                    */
    /* ===================================================================== */

    async getTransactionStatus(
        req,
        res,
        next
    ) {

        try {

            const transaction =
                await airtelService
                    .getTransactionStatus({

                        tenantId:
                            req.tenantId,

                        referenceId:
                            req.params.referenceId
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

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    operation:
                        "getTransactionStatus"
                }
            );

            next(error);
        }
    }

    /* ===================================================================== */
    /* WEBHOOK                                                               */
    /* ===================================================================== */

    async webhook(
        req,
        res,
        next
    ) {

        try {

            const result =
                await airtelService
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
                    "AIRTEL_WEBHOOK_RECEIVED",

                entityType:
                    "Webhook",

                entityId:
                    result.referenceId,

                metadata:
                    result
            });

            return res.status(200).json({

                success: true,

                message:
                    "Webhook processed successfully"
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
    /* PROVIDER BALANCE                                                      */
    /* ===================================================================== */

    async getProviderBalance(
        req,
        res,
        next
    ) {

        try {

            const balance =
                await airtelService
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
    /* HEALTH                                                                */
    /* ===================================================================== */

    async health(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            provider:
                "AIRTEL_MONEY",

            status:
                "UP",

            timestamp:
                new Date().toISOString()
        });
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            name:
                "AirtelController",

            provider:
                "AIRTEL_MONEY",

            version:
                process.env.APP_VERSION ||
                "1.0.0",

            supportedOperations: [

                "collect",

                "disburse",

                "status",

                "webhook",

                "balance",

                "health"
            ]
        };
    }
}

const airtelController =
    new AirtelController();

module.exports =
    airtelController;

module.exports.AirtelController =
    AirtelController;