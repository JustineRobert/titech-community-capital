'use strict';

/**
 * ============================================================================
 * ENTERPRISE DASHBOARD CONTROLLER
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Multi-Tenant Aware
 * ✅ Executive Metrics
 * ✅ Portfolio Analytics
 * ✅ Savings Analytics
 * ✅ Loan Analytics
 * ✅ Risk Analytics
 * ✅ Fraud Monitoring
 * ✅ Compliance Monitoring
 * ✅ Revenue Intelligence
 * ✅ Executive Summary
 * ✅ Board Dashboard Snapshot
 * ✅ Correlation ID Tracking
 * ✅ Audit Ready Responses
 * ✅ Production Grade Error Handling
 * ✅ Performance Monitoring
 * ============================================================================
 */

const DashboardService = require('../modules/dashboard/services/dashboardService');
const { handleError } = require('../middlewares/errorMiddleware');

class DashboardController {

    /**
     * =========================================================================
     * STANDARD SUCCESS RESPONSE
     * =========================================================================
     */
    static success(
        res,
        data,
        message = 'Success',
        statusCode = 200,
        meta = {}
    ) {
        return res.status(statusCode).json({
            success: true,
            message,
            timestamp: new Date().toISOString(),
            meta,
            data
        });
    }

    /**
     * =========================================================================
     * REQUEST METADATA
     * =========================================================================
     */
    static buildMeta(req, startedAt) {
        return {
            requestId:
                req.id ||
                req.requestId ||
                req.headers['x-request-id'] ||
                null,

            tenantId:
                req.tenant_id ||
                null,

            executionTimeMs:
                Date.now() - startedAt
        };
    }

    /**
     * =========================================================================
     * VALIDATE TENANT
     * =========================================================================
     */
    static validateTenant(req) {
        if (!req.tenant_id) {
            const error = new Error(
                'Tenant ID is required'
            );

            error.statusCode = 400;

            throw error;
        }
    }

    /**
     * =========================================================================
     * DASHBOARD HEALTH
     * =========================================================================
     * GET /api/v1/dashboard/health
     */
    static async health(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            return DashboardController.success(
                res,
                {
                    service:
                        'dashboard-service',
                    status: 'healthy',
                    uptime:
                        process.uptime(),
                    nodeVersion:
                        process.version,
                    environment:
                        process.env.NODE_ENV,
                    memoryUsage:
                        process.memoryUsage()
                },
                'Dashboard service operational',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * EXECUTIVE METRICS
     * =========================================================================
     * GET /dashboard/metrics
     */
    static async getMetrics(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const metrics =
                await DashboardService.getMetrics(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                metrics,
                'Metrics retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * DASHBOARD CHARTS
     * =========================================================================
     * GET /dashboard/charts
     */
    static async getCharts(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const {
                period = '12m'
            } = req.query;

            const charts =
                await DashboardService.getCharts(
                    req.tenant_id,
                    period
                );

            return DashboardController.success(
                res,
                charts,
                'Chart data retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * FRAUD ALERTS
     * =========================================================================
     * GET /dashboard/fraud-alerts
     */
    static async getFraudAlerts(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const page =
                Number(
                    req.query.page
                ) || 1;

            const limit =
                Number(
                    req.query.limit
                ) || 20;

            const data =
                await DashboardService.getFraudAlerts(
                    req.tenant_id,
                    {
                        page,
                        limit
                    }
                );

            return DashboardController.success(
                res,
                data,
                'Fraud alerts retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * COMPLIANCE ALERTS
     * =========================================================================
     * GET /dashboard/compliance-alerts
     */
    static async getComplianceAlerts(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const page =
                Number(
                    req.query.page
                ) || 1;

            const limit =
                Number(
                    req.query.limit
                ) || 20;

            const data =
                await DashboardService.getComplianceAlerts(
                    req.tenant_id,
                    {
                        page,
                        limit
                    }
                );

            return DashboardController.success(
                res,
                data,
                'Compliance alerts retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * REVENUE TREND
     * =========================================================================
     * GET /dashboard/revenue-trend
     */
    static async getRevenueTrend(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const {
                startDate,
                endDate,
                period = 'monthly'
            } = req.query;

            const data =
                await DashboardService.getRevenueTrend(
                    req.tenant_id,
                    {
                        startDate,
                        endDate,
                        period
                    }
                );

            return DashboardController.success(
                res,
                data,
                'Revenue trend retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * PORTFOLIO OVERVIEW
     * =========================================================================
     */
    static async getPortfolioOverview(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getPortfolioOverview(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Portfolio overview retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * SAVINGS ANALYTICS
     * =========================================================================
     */
    static async getSavingsAnalytics(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getSavingsAnalytics(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Savings analytics retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * LOAN ANALYTICS
     * =========================================================================
     */
    static async getLoanAnalytics(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getLoanAnalytics(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Loan analytics retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * RISK ANALYTICS
     * =========================================================================
     */
    static async getRiskAnalytics(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getRiskAnalytics(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Risk analytics retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * EXECUTIVE SUMMARY
     * =========================================================================
     */
    static async getExecutiveSummary(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getExecutiveSummary(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Executive summary retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }

    /**
     * =========================================================================
     * BOARD / CEO SNAPSHOT
     * =========================================================================
     * GET /dashboard/snapshot
     */
    static async getSnapshot(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {

            DashboardController.validateTenant(
                req
            );

            const data =
                await DashboardService.getSnapshot(
                    req.tenant_id
                );

            return DashboardController.success(
                res,
                data,
                'Dashboard snapshot retrieved successfully',
                200,
                DashboardController.buildMeta(
                    req,
                    startedAt
                )
            );

        } catch (error) {
            handleError(
                error,
                req,
                res,
                next
            );
        }
    }
}

module.exports = DashboardController;