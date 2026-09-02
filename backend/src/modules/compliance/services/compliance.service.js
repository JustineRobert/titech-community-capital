"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/modules/compliance/services/compliance.service.js
 * Enterprise Compliance Service
 * ============================================================================
 */

const ComplianceModel =
    require(
        "../../models/Compliance"
    );

const ComplianceRepository =
    require(
        "../../../../repositories/complianceRepository"
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

const complianceRepository =
    new ComplianceRepository(
        ComplianceModel
    );

class ComplianceService {

    /* ===================================================================== */
    /* CREATE COMPLIANCE CASE                                                */
    /* ===================================================================== */

    async createCase(
        payload
    ) {

        try {

            if (!payload.tenantId) {

                throw new Error(
                    "tenantId is required."
                );
            }

            const complianceCase =

                await complianceRepository
                    .create({

                        tenantId:
                            payload.tenantId,

                        category:
                            payload.category,

                        type:
                            payload.type,

                        riskLevel:
                            payload.riskLevel ||

                            "MEDIUM",

                        priority:
                            payload.priority ||

                            "NORMAL",

                        status:
                            "OPEN",

                        assignedTo:
                            payload.assignedTo,

                        correlationId:
                            payload.correlationId,

                        metadata:
                            payload.metadata || {},

                        source:
                            payload.source ||

                            "SYSTEM"
                    });

            await auditLogger.audit?.({

                action:
                    "COMPLIANCE_CASE_CREATED",

                entityId:
                    complianceCase._id,

                tenantId:
                    payload.tenantId,

                metadata: {

                    category:
                        payload.category,

                    type:
                        payload.type,

                    riskLevel:
                        payload.riskLevel
                }
            });

            prometheusService
                ?.incrementComplianceCase?.(

                    payload.tenantId,

                    payload.category
                );

            return complianceCase;

        } catch (error) {

            await errorLogger.log?.(

                error,

                {

                    service:
                        "compliance-service",

                    operation:
                        "createCase",

                    tenantId:
                        payload?.tenantId
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* GET CASE                                                              */
    /* ===================================================================== */

    async getCase(
        tenantId,
        caseId
    ) {

        return complianceRepository
            .findById(

                tenantId,

                caseId
            );
    }

    /* ===================================================================== */
    /* SEARCH CASES                                                          */
    /* ===================================================================== */

    async searchCases(
        tenantId,
        filters = {}
    ) {

        return complianceRepository
            .search(

                tenantId,

                filters
            );
    }

    /* ===================================================================== */
    /* UPDATE CASE                                                           */
    /* ===================================================================== */

    async updateCase(
        tenantId,
        caseId,
        updates
    ) {

        const updatedCase =

            await complianceRepository
                .updateById(

                    tenantId,

                    caseId,

                    updates
                );

        await auditLogger.audit?.({

            action:
                "COMPLIANCE_CASE_UPDATED",

            entityId:
                caseId,

            tenantId
        });

        return updatedCase;
    }

    /* ===================================================================== */
    /* CLOSE CASE                                                            */
    /* ===================================================================== */

    async closeCase(
        tenantId,
        caseId,
        resolution
    ) {

        const closedCase =

            await complianceRepository
                .closeCase(

                    tenantId,

                    caseId,

                    resolution
                );

        await auditLogger.audit?.({

            action:
                "COMPLIANCE_CASE_CLOSED",

            entityId:
                caseId,

            tenantId,

            metadata:
                resolution
        });

        return closedCase;
    }

    /* ===================================================================== */
    /* AML CASES                                                             */
    /* ===================================================================== */

    async createAmlCase(
        payload
    ) {

        return this.createCase({

            ...payload,

            category:
                "AML"
        });
    }

    /* ===================================================================== */
    /* FRAUD CASES                                                           */
    /* ===================================================================== */

    async createFraudCase(
        payload
    ) {

        return this.createCase({

            ...payload,

            category:
                "FRAUD"
        });
    }

    /* ===================================================================== */
    /* SANCTIONS CASES                                                       */
    /* ===================================================================== */

    async createSanctionsCase(
        payload
    ) {

        return this.createCase({

            ...payload,

            category:
                "SANCTIONS"
        });
    }

    /* ===================================================================== */
    /* PEP CASES                                                             */
    /* ===================================================================== */

    async createPepCase(
        payload
    ) {

        return this.createCase({

            ...payload,

            category:
                "PEP"
        });
    }

    /* ===================================================================== */
    /* ASSIGN CASE                                                           */
    /* ===================================================================== */

    async assignCase(
        tenantId,
        caseId,
        assignedTo
    ) {

        return complianceRepository
            .updateById(

                tenantId,

                caseId,

                {

                    assignedTo,

                    assignedAt:
                        new Date()
                }
            );
    }

    /* ===================================================================== */
    /* COMPLIANCE METRICS                                                    */
    /* ===================================================================== */

    async getMetrics(
        tenantId
    ) {

        return complianceRepository
            .getComplianceMetrics(
                tenantId
            );
    }

    /* ===================================================================== */
    /* AML DASHBOARD                                                         */
    /* ===================================================================== */

    async getAmlCases(
        tenantId
    ) {

        return complianceRepository
            .getAmlCases(
                tenantId
            );
    }

    /* ===================================================================== */
    /* FRAUD DASHBOARD                                                       */
    /* ===================================================================== */

    async getFraudCases(
        tenantId
    ) {

        return complianceRepository
            .getFraudCases(
                tenantId
            );
    }

    /* ===================================================================== */
    /* HIGH RISK DASHBOARD                                                   */
    /* ===================================================================== */

    async getHighRiskCases(
        tenantId
    ) {

        return complianceRepository
            .getHighRiskCases(
                tenantId
            );
    }

    /* ===================================================================== */
    /* BULK UPDATE                                                           */
    /* ===================================================================== */

    async bulkUpdateCases(
        tenantId,
        filter,
        updates
    ) {

        return complianceRepository
            .bulkUpdate(

                tenantId,

                filter,

                updates
            );
    }

    /* ===================================================================== */
    /* SERVICE HEALTH                                                        */
    /* ===================================================================== */

    async health() {

        return {

            service:
                "compliance-service",

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
                "compliance-service",

            repository:
                "ComplianceRepository",

            capabilities: [

                "aml-cases",

                "fraud-cases",

                "sanctions-screening",

                "pep-screening",

                "risk-management",

                "bulk-updates",

                "analytics",

                "audit-logging"
            ]
        };
    }
}

const complianceService =
    new ComplianceService();

module.exports =
    complianceService;

module.exports.ComplianceService =
    ComplianceService;