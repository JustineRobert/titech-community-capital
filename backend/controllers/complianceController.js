"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/controllers/complianceController.js
 * Enterprise Compliance Controller
 * ============================================================================
 */
jest.mock(
    "../../backend/services/complianceService"
);

jest.mock(
    "../../backend/services/auditService"
);

jest.mock(
    "../../backend/services/metricsService"
);

const logger =
    require("../utils/logger");

const complianceService =
    require("../services/complianceService");

const auditService =
    require("../services/auditService");

const metricsService =
    require("../services/metricsService");

const complianceController =
    require(
        "../../backend/controllers/complianceController"
    );

const complianceService =
    require(
        "../../backend/services/complianceService"
    );

class ComplianceController {

    /* ===================================================================== */
    /* COMPLIANCE DASHBOARD                                                  */
    /* ===================================================================== */

    async dashboard(
        req,
        res,
        next
    ) {

        try {

            const dashboard =
                await complianceService
                    .getDashboard({

                        tenantId:
                            req.tenantId
                    });

            return res.status(200).json({

                success: true,

                data:
                    dashboard
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* AML CASES                                                             */
    /* ===================================================================== */

    async getAMLCases(
        req,
        res,
        next
    ) {

        try {

            const cases =
                await complianceService
                    .getAMLCases({

                        tenantId:
                            req.tenantId,

                        filters:
                            req.query
                    });

            return res.status(200).json({

                success: true,

                data:
                    cases
            });

        } catch (error) {

            next(error);
        }
    }

    async reviewAMLCase(
        req,
        res,
        next
    ) {

        try {

            const result =
                await complianceService
                    .reviewAMLCase({

                        tenantId:
                            req.tenantId,

                        caseId:
                            req.params.caseId,

                        reviewerId:
                            req.userId,

                        decision:
                            req.body.decision,

                        notes:
                            req.body.notes
                    });

            await this.audit(

                req,

                "AML_CASE_REVIEWED",

                result
            );

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* FRAUD CASES                                                           */
    /* ===================================================================== */

    async getFraudCases(
        req,
        res,
        next
    ) {

        try {

            const cases =
                await complianceService
                    .getFraudCases({

                        tenantId:
                            req.tenantId,

                        filters:
                            req.query
                    });

            return res.status(200).json({

                success: true,

                data:
                    cases
            });

        } catch (error) {

            next(error);
        }
    }

    async reviewFraudCase(
        req,
        res,
        next
    ) {

        try {

            const result =
                await complianceService
                    .reviewFraudCase({

                        tenantId:
                            req.tenantId,

                        caseId:
                            req.params.caseId,

                        reviewerId:
                            req.userId,

                        decision:
                            req.body.decision,

                        notes:
                            req.body.notes
                    });

            await this.audit(

                req,

                "FRAUD_CASE_REVIEWED",

                result
            );

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* COMPLIANCE ALERTS                                                     */
    /* ===================================================================== */

    async getAlerts(
        req,
        res,
        next
    ) {

        try {

            const alerts =
                await complianceService
                    .getAlerts({

                        tenantId:
                            req.tenantId,

                        filters:
                            req.query
                    });

            return res.status(200).json({

                success: true,

                data:
                    alerts
            });

        } catch (error) {

            next(error);
        }
    }

    async resolveAlert(
        req,
        res,
        next
    ) {

        try {

            const result =
                await complianceService
                    .resolveAlert({

                        tenantId:
                            req.tenantId,

                        alertId:
                            req.params.alertId,

                        resolvedBy:
                            req.userId,

                        notes:
                            req.body.notes
                    });

            await this.audit(

                req,

                "COMPLIANCE_ALERT_RESOLVED",

                result
            );

            metricsService.increment(
                "titech.compliance.alert.resolved"
            );

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* REGULATORY EVENTS                                                     */
    /* ===================================================================== */

    async getRegulatoryEvents(
        req,
        res,
        next
    ) {

        try {

            const events =
                await complianceService
                    .getRegulatoryEvents({

                        tenantId:
                            req.tenantId,

                        filters:
                            req.query
                    });

            return res.status(200).json({

                success: true,

                data:
                    events
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* COMPLIANCE REPORTS                                                    */
    /* ===================================================================== */

    async generateComplianceReport(
        req,
        res,
        next
    ) {

        try {

            const report =
                await complianceService
                    .generateComplianceReport({

                        tenantId:
                            req.tenantId,

                        reportType:
                            req.query.reportType,

                        from:
                            req.query.from,

                        to:
                            req.query.to
                    });

            await this.audit(

                req,

                "COMPLIANCE_REPORT_GENERATED",

                {
                    reportType:
                        req.query.reportType
                }
            );

            metricsService.increment(
                "titech.compliance.report.generated"
            );

            return res.status(200).json({

                success: true,

                data:
                    report
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* AUDIT HELPER                                                          */
    /* ===================================================================== */

    async audit(
        req,
        action,
        metadata = {}
    ) {

        try {

            await auditService.log({

                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                action,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                source:
                    "ComplianceController",

                metadata
            });

        } catch (error) {

            logger.error(
                "Compliance audit failed",
                {
                    action,
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            controller:
                "ComplianceController",

            version:
                "1.0.0",

            capabilities: [

                "aml-cases",
                "fraud-cases",
                "alerts",
                "regulatory-events",
                "compliance-reports",
                "dashboard"
            ]
        };
    }
}

const complianceController =
    new ComplianceController();

module.exports =
    complianceController;

module.exports.ComplianceController =
    ComplianceController;