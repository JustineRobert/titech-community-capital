"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/services/complianceService.js
 * Enterprise Compliance Service
 * ============================================================================
 */

const logger =
    require("../utils/logger");

const auditService =
    require("./auditService");

const metricsService =
    require("./metricsService");

const complianceRepository =
    require(
        "../repositories/complianceRepository"
    );

const ComplianceLog =
    require(
        "../models/ComplianceLog"
    );

class ComplianceService {

    /* ===================================================================== */
    /* KYC VERIFICATION                                                      */
    /* ===================================================================== */

    async verifyKYC(
        payload = {}
    ) {

        const {

            _id,

            tenantId,

            nationalId,

            phone,

            address,

            requestId,

            correlationId

        } = payload;

        try {

            if (
                !nationalId ||
                !phone ||
                !address
            ) {

                throw new Error(
                    "Incomplete KYC data."
                );
            }

            const verified =
                nationalId.startsWith(
                    "CF"
                );

            const riskLevel =
                verified
                    ? "LOW"
                    : "HIGH";

            const log =
                await ComplianceLog.create({

                    userId:
                        _id,

                    tenantId,

                    activity:
                        "KYC_VERIFICATION",

                    flagged:
                        !verified,

                    riskLevel,

                    reportId:
                        `KYC-${Date.now()}`,

                    createdAt:
                        new Date()
                });

            await auditService.log({

                action:
                    "KYC_VERIFICATION",

                tenantId,

                userId:
                    _id,

                requestId,

                correlationId,

                verified,

                riskLevel
            });

            metricsService.increment(
                "titech.compliance.kyc"
            );

            return {

                verified,

                riskLevel,

                log
            };

        } catch (error) {

            logger.error(
                "KYC verification failed",
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* AML RISK ASSESSMENT                                                   */
    /* ===================================================================== */

    async calculateRiskLevel(
        payload = {}
    ) {

        const {

            _id,

            tenantId,

            transactionVolume = 0

        } = payload;

        let level =
            "LOW";

        if (
            transactionVolume >
            10000000
        ) {

            level =
                "HIGH";

        } else if (
            transactionVolume >
            2000000
        ) {

            level =
                "MEDIUM";
        }

        await ComplianceLog.create({

            userId:
                _id,

            tenantId,

            activity:
                "RISK_ASSESSMENT",

            flagged:
                level === "HIGH",

            reportId:
                `RISK-${Date.now()}`,

            createdAt:
                new Date()
        });

        await auditService.log({

            action:
                "RISK_ASSESSMENT",

            tenantId,

            userId:
                _id,

            level
        });

        metricsService.increment(
            `titech.compliance.risk.${level.toLowerCase()}`
        );

        return level;
    }

    /* ===================================================================== */
    /* STR GENERATION                                                        */
    /* ===================================================================== */

    async generateSTR(
        userId,
        reason = "Suspicious activity detected",
        tenantId = null
    ) {

        const reportId =
            `STR-${Date.now()}`;

        const log =
            await ComplianceLog.create({

                userId,

                tenantId,

                activity:
                    "STR",

                flagged:
                    true,

                reportId,

                reason,

                createdAt:
                    new Date()
            });

        await auditService.log({

            action:
                "STR_GENERATED",

            tenantId,

            userId,

            reportId
        });

        metricsService.increment(
            "titech.compliance.str"
        );

        return log;
    }

    /* ===================================================================== */
    /* AML CASES                                                             */
    /* ===================================================================== */

    async getAMLCases(
        payload
    ) {

        return complianceRepository
            .findAMLCases(
                payload
            );
    }

    async reviewAMLCase(
        payload
    ) {

        const result =

            await complianceRepository
                .reviewAMLCase(
                    payload
                );

        await auditService.log({

            action:
                "AML_CASE_REVIEWED",

            tenantId:
                payload.tenantId,

            caseId:
                payload.caseId,

            reviewerId:
                payload.reviewerId
        });

        metricsService.increment(
            "titech.compliance.aml.review"
        );

        return result;
    }

    /* ===================================================================== */
    /* FRAUD CASES                                                           */
    /* ===================================================================== */

    async getFraudCases(
        payload
    ) {

        return complianceRepository
            .findFraudCases(
                payload
            );
    }

    async reviewFraudCase(
        payload
    ) {

        const result =

            await complianceRepository
                .reviewFraudCase(
                    payload
                );

        await auditService.log({

            action:
                "FRAUD_CASE_REVIEWED",

            tenantId:
                payload.tenantId,

            caseId:
                payload.caseId,

            reviewerId:
                payload.reviewerId
        });

        metricsService.increment(
            "titech.compliance.fraud.review"
        );

        return result;
    }

    /* ===================================================================== */
    /* COMPLIANCE ALERTS                                                     */
    /* ===================================================================== */

    async getAlerts(
        payload
    ) {

        return complianceRepository
            .findAlerts(
                payload
            );
    }

    async resolveAlert(
        payload
    ) {

        const result =

            await complianceRepository
                .resolveAlert(
                    payload
                );

        await auditService.log({

            action:
                "COMPLIANCE_ALERT_RESOLVED",

            tenantId:
                payload.tenantId,

            alertId:
                payload.alertId,

            resolvedBy:
                payload.resolvedBy
        });

        metricsService.increment(
            "titech.compliance.alert.resolved"
        );

        return result;
    }

    /* ===================================================================== */
    /* REGULATORY EVENTS                                                     */
    /* ===================================================================== */

    async getRegulatoryEvents(
        payload
    ) {

        return complianceRepository
            .getRegulatoryEvents(
                payload
            );
    }

    /* ===================================================================== */
    /* REPORTS                                                               */
    /* ===================================================================== */

    async generateComplianceReport(
        payload
    ) {

        const report =

            await complianceRepository
                .generateComplianceReport(
                    payload
                );

        await auditService.log({

            action:
                "COMPLIANCE_REPORT_GENERATED",

            tenantId:
                payload.tenantId,

            reportType:
                payload.reportType
        });

        metricsService.increment(
            "titech.compliance.report.generated"
        );

        return report;
    }

    /* ===================================================================== */
    /* DASHBOARD                                                             */
    /* ===================================================================== */

    async getDashboard(
        payload
    ) {

        return complianceRepository
            .getDashboard(
                payload
            );
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            service:
                "ComplianceService",

            version:
                "1.0.0",

            capabilities: [

                "kyc-verification",

                "risk-assessment",

                "str-generation",

                "aml-cases",

                "fraud-cases",

                "alerts",

                "compliance-reports",

                "regulatory-events",

                "dashboard"
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