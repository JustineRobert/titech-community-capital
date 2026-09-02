'use strict';

/**
 * ============================================================================
 * ENTERPRISE DASHBOARD SERVICE
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * Features:
 * ---------------------------------------------------------------------------
 * ✅ Executive Dashboard Metrics
 * ✅ Portfolio Analytics
 * ✅ Savings Analytics
 * ✅ Loan Analytics
 * ✅ Revenue Intelligence
 * ✅ Fraud Monitoring
 * ✅ Compliance Monitoring
 * ✅ Risk Analytics
 * ✅ Board Dashboard Snapshot
 * ✅ Multi-Tenant Support
 * ✅ Structured Logging
 * ✅ Performance Optimized
 * ✅ Enterprise Grade
 * ============================================================================
 */

const logger = require('../../../utils/logger');

const MemberRepository = require('../../../repositories/memberRepository');
const LoanRepository = require('../../../repositories/loanRepository');
const SavingsRepository = require('../../../repositories/savingsRepository');
const TransactionRepository = require('../../../repositories/transactionRepository');
const AuditRepository = require('../../../repositories/auditRepository');

class DashboardService {

    /**
     * =========================================================================
     * EXECUTIVE METRICS
     * =========================================================================
     */
    static async getMetrics(tenantId) {
        try {

            const [
                totalMembers,
                totalSavings,
                outstandingLoans,
                nplRatio,
                collectionRate,
                fraudAlerts,
                complianceAlerts,
                revenue,
                activeSaccos
            ] = await Promise.all([
                MemberRepository.count({ tenantId }),
                SavingsRepository.sumBalance({ tenantId }),
                LoanRepository.sumOutstanding({ tenantId }),
                LoanRepository.calculateNPLRatio({ tenantId }),
                LoanRepository.calculateCollectionRate({ tenantId }),
                AuditRepository.countFraudAlerts({ tenantId }),
                AuditRepository.countComplianceAlerts({ tenantId }),
                TransactionRepository.calculateRevenue({ tenantId }),
                MemberRepository.countActiveSaccos({ tenantId })
            ]);

            return {
                totalMembers,
                totalSavings,
                outstandingLoans,
                nplRatio,
                collectionRate,
                fraudAlerts,
                complianceAlerts,
                revenue,
                activeSaccos
            };

        } catch (error) {
            logger.error('DashboardService.getMetrics failed', {
                tenantId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * =========================================================================
     * DASHBOARD CHARTS
     * =========================================================================
     */
    static async getCharts(tenantId, period = '12m') {
        try {

            const [
                portfolioMix,
                riskDistribution,
                savingsTrend,
                loanTrend,
                revenueTrend
            ] = await Promise.all([
                LoanRepository.getPortfolioMix({
                    tenantId,
                    period
                }),
                LoanRepository.getRiskDistribution({
                    tenantId,
                    period
                }),
                SavingsRepository.getTrend({
                    tenantId,
                    period
                }),
                LoanRepository.getTrend({
                    tenantId,
                    period
                }),
                TransactionRepository.getRevenueTrend({
                    tenantId,
                    period
                })
            ]);

            return {
                portfolioMix,
                riskDistribution,
                savingsTrend,
                loanTrend,
                revenueTrend
            };

        } catch (error) {
            logger.error('DashboardService.getCharts failed', {
                tenantId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * =========================================================================
     * FRAUD ALERTS
     * =========================================================================
     */
    static async getFraudAlerts(
        tenantId,
        options = {}
    ) {
        try {

            return await AuditRepository.getFraudAlerts({
                tenantId,
                ...options
            });

        } catch (error) {

            logger.error(
                'DashboardService.getFraudAlerts failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * COMPLIANCE ALERTS
     * =========================================================================
     */
    static async getComplianceAlerts(
        tenantId,
        options = {}
    ) {
        try {

            return await AuditRepository.getComplianceAlerts({
                tenantId,
                ...options
            });

        } catch (error) {

            logger.error(
                'DashboardService.getComplianceAlerts failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * REVENUE TREND
     * =========================================================================
     */
    static async getRevenueTrend(
        tenantId,
        filters = {}
    ) {
        try {

            return await TransactionRepository.getRevenueTrend({
                tenantId,
                ...filters
            });

        } catch (error) {

            logger.error(
                'DashboardService.getRevenueTrend failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * PORTFOLIO OVERVIEW
     * =========================================================================
     */
    static async getPortfolioOverview(
        tenantId
    ) {
        try {

            const [
                portfolioMix,
                loanBook,
                outstandingLoans,
                nplRatio
            ] = await Promise.all([
                LoanRepository.getPortfolioMix({
                    tenantId
                }),
                LoanRepository.getLoanBookSummary({
                    tenantId
                }),
                LoanRepository.sumOutstanding({
                    tenantId
                }),
                LoanRepository.calculateNPLRatio({
                    tenantId
                })
            ]);

            return {
                portfolioMix,
                loanBook,
                outstandingLoans,
                nplRatio
            };

        } catch (error) {

            logger.error(
                'DashboardService.getPortfolioOverview failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * SAVINGS ANALYTICS
     * =========================================================================
     */
    static async getSavingsAnalytics(
        tenantId
    ) {
        try {

            const [
                totalSavings,
                savingsTrend,
                activeAccounts
            ] = await Promise.all([
                SavingsRepository.sumBalance({
                    tenantId
                }),
                SavingsRepository.getTrend({
                    tenantId
                }),
                SavingsRepository.countActiveAccounts({
                    tenantId
                })
            ]);

            return {
                totalSavings,
                activeAccounts,
                savingsTrend
            };

        } catch (error) {

            logger.error(
                'DashboardService.getSavingsAnalytics failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * LOAN ANALYTICS
     * =========================================================================
     */
    static async getLoanAnalytics(
        tenantId
    ) {
        try {

            const [
                totalLoans,
                outstandingLoans,
                collectionRate,
                nplRatio,
                loanTrend
            ] = await Promise.all([
                LoanRepository.count({
                    tenantId
                }),
                LoanRepository.sumOutstanding({
                    tenantId
                }),
                LoanRepository.calculateCollectionRate({
                    tenantId
                }),
                LoanRepository.calculateNPLRatio({
                    tenantId
                }),
                LoanRepository.getTrend({
                    tenantId
                })
            ]);

            return {
                totalLoans,
                outstandingLoans,
                collectionRate,
                nplRatio,
                loanTrend
            };

        } catch (error) {

            logger.error(
                'DashboardService.getLoanAnalytics failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * RISK ANALYTICS
     * =========================================================================
     */
    static async getRiskAnalytics(
        tenantId
    ) {
        try {

            const [
                riskDistribution,
                nplRatio,
                fraudAlerts,
                complianceAlerts
            ] = await Promise.all([
                LoanRepository.getRiskDistribution({
                    tenantId
                }),
                LoanRepository.calculateNPLRatio({
                    tenantId
                }),
                AuditRepository.countFraudAlerts({
                    tenantId
                }),
                AuditRepository.countComplianceAlerts({
                    tenantId
                })
            ]);

            return {
                riskDistribution,
                nplRatio,
                fraudAlerts,
                complianceAlerts
            };

        } catch (error) {

            logger.error(
                'DashboardService.getRiskAnalytics failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * EXECUTIVE SUMMARY
     * =========================================================================
     */
    static async getExecutiveSummary(
        tenantId
    ) {
        try {

            const [
                metrics,
                portfolio,
                risk,
                revenueTrend
            ] = await Promise.all([
                this.getMetrics(
                    tenantId
                ),
                this.getPortfolioOverview(
                    tenantId
                ),
                this.getRiskAnalytics(
                    tenantId
                ),
                this.getRevenueTrend(
                    tenantId
                )
            ]);

            return {
                metrics,
                portfolio,
                risk,
                revenueTrend,
                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                'DashboardService.getExecutiveSummary failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * BOARD / CEO SNAPSHOT
     * =========================================================================
     */
    static async getSnapshot(
        tenantId
    ) {
        try {

            const [
                metrics,
                fraudAlerts,
                complianceAlerts,
                executiveSummary
            ] = await Promise.all([
                this.getMetrics(
                    tenantId
                ),
                AuditRepository.getFraudAlerts({
                    tenantId,
                    limit: 10
                }),
                AuditRepository.getComplianceAlerts({
                    tenantId,
                    limit: 10
                }),
                this.getExecutiveSummary(
                    tenantId
                )
            ]);

            return {
                metrics,
                executiveSummary,
                fraudAlerts,
                complianceAlerts,
                generatedAt:
                    new Date().toISOString(),
                tenantId
            };

        } catch (error) {

            logger.error(
                'DashboardService.getSnapshot failed',
                {
                    tenantId,
                    error: error.message
                }
            );

            throw error;
        }
    }
}

module.exports = DashboardService;