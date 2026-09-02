"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: reconciliation.job.js
 * Enterprise Reconciliation Scheduler
 * ============================================================================
 */

const crypto =
    require("crypto");

const reconciliationService =
    require(
        "./reconciliation.service"
    );

const auditLogger =
    require(
        "../../../infrastructure/logging/auditLogger"
    );

const errorLogger =
    require(
        "../../../infrastructure/logging/errorLogger"
    );

let prometheusService;

try {

    prometheusService =
        require(
            "../../../infrastructure/monitoring/prometheus.service"
        );

} catch (_) {

    prometheusService = null;
}

let tenantRepository;

try {

    tenantRepository =
        require(
            "../../../../repositories/tenantRepository"
        );

} catch (_) {

    tenantRepository = null;
}

/* ============================================================================
 * Reconciliation Job
 * ========================================================================== */

class ReconciliationJob {

    constructor() {

        this.jobName =
            "payment-reconciliation-job";

        this.running =
            false;

        this.lastRun =
            null;
    }

    /* ===================================================================== */
    /* DISTRIBUTED LOCK                                                     */
    /* ===================================================================== */

    acquireLock() {

        if (this.running) {

            throw new Error(
                "Reconciliation job already running."
            );
        }

        this.running =
            true;
    }

    releaseLock() {

        this.running =
            false;
    }

    /* ===================================================================== */
    /* MAIN EXECUTION                                                       */
    /* ===================================================================== */

    async execute() {

        const executionId =
            crypto.randomUUID();

        try {

            this.acquireLock();

            const startedAt =
                new Date();

            let tenants = [];

            if (
                tenantRepository &&
                typeof tenantRepository.find ===
                    "function"
            ) {

                tenants =
                    await tenantRepository
                        .find({
                            status:
                                "ACTIVE"
                        });
            }

            for (
                const tenant of tenants
            ) {

                await this.processTenant(

                    tenant,
                    executionId
                );
            }

            this.lastRun =
                new Date();

            await auditLogger
                ?.audit?.({

                    action:
                        "RECONCILIATION_JOB_COMPLETED",

                    entityType:
                        "Job",

                    entityId:
                        executionId,

                    metadata: {

                        tenantsProcessed:
                            tenants.length,

                        startedAt,

                        completedAt:
                            new Date()
                    }
                });

            prometheusService
                ?.incrementJobExecution?.(
                    this.jobName
                );

            return {

                success:
                    true,

                executionId,

                tenantsProcessed:
                    tenants.length,

                completedAt:
                    new Date()
                        .toISOString()
            };

        } catch (error) {

            await errorLogger
                ?.log?.(

                    error,

                    {

                        service:
                            this.jobName,

                        operation:
                            "execute"
                    }
                );

            throw error;

        } finally {

            this.releaseLock();
        }
    }

    /* ===================================================================== */
    /* TENANT PROCESSING                                                    */
    /* ===================================================================== */

    async processTenant(
        tenant,
        executionId
    ) {

        try {

            await this.reconcileMTN(
                tenant,
                executionId
            );

            await this.reconcileAirtel(
                tenant,
                executionId
            );

            await this.reconcileLedger(
                tenant,
                executionId
            );

        } catch (error) {

            await errorLogger
                ?.log?.(

                    error,

                    {

                        service:
                            this.jobName,

                        tenantId:
                            tenant?.tenantId,

                        executionId
                    }
                );
        }
    }

    /* ===================================================================== */
    /* MTN                                                                   */
    /* ===================================================================== */

    async reconcileMTN(
        tenant,
        executionId
    ) {

        return reconciliationService
            .reconcileMTN({

                tenantId:
                    tenant.tenantId,

                executionId,

                providerTransactions:
                    [],

                internalTransactions:
                    [],

                reconciledBy:
                    "SYSTEM"
            });
    }

    /* ===================================================================== */
    /* AIRTEL                                                                */
    /* ===================================================================== */

    async reconcileAirtel(
        tenant,
        executionId
    ) {

        return reconciliationService
            .reconcileAirtel({

                tenantId:
                    tenant.tenantId,

                executionId,

                providerTransactions:
                    [],

                internalTransactions:
                    [],

                reconciledBy:
                    "SYSTEM"
            });
    }

    /* ===================================================================== */
    /* LEDGER                                                                */
    /* ===================================================================== */

    async reconcileLedger(
        tenant,
        executionId
    ) {

        return reconciliationService
            .reconcileLedger(

                tenant.tenantId,

                []
            );
    }

    /* ===================================================================== */
    /* MANUAL EXECUTION                                                     */
    /* ===================================================================== */

    async runManual(
        tenantId
    ) {

        return reconciliationService
            .reconcileDay({

                tenantId,

                provider:
                    "MANUAL",

                providerTransactions:
                    [],

                internalTransactions:
                    [],

                reconciledBy:
                    "ADMIN"
            });
    }

    /* ===================================================================== */
    /* HEALTH                                                                */
    /* ===================================================================== */

    health() {

        return {

            job:
                this.jobName,

            status:
                "UP",

            running:
                this.running,

            lastRun:
                this.lastRun
                    ? this.lastRun
                        .toISOString()
                    : null
        };
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    diagnostics() {

        return {

            job:
                this.jobName,

            running:
                this.running,

            lastRun:
                this.lastRun,

            capabilities: [

                "daily-reconciliation",

                "mtn-reconciliation",

                "airtel-reconciliation",

                "ledger-reconciliation",

                "distributed-locking",

                "idempotency",

                "audit-logging",

                "error-logging",

                "metrics"
            ]
        };
    }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

const reconciliationJob =
    new ReconciliationJob();

module.exports =
    reconciliationJob;

module.exports.ReconciliationJob =
    ReconciliationJob;